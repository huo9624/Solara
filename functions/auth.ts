const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_SECONDS = 600;
const LOCK_DURATION_SECONDS = 300;
const TOKEN_SALT = "solara::auth::token@v1";
const ATTEMPT_CACHE_PREFIX = "https://solara-auth-attempts/";

interface Env {
  ACCESS_PASSWORD?: string;
}

interface AuthPayload {
  password?: string;
  token?: string;
}

interface AttemptState {
  attempts: number;
  firstAttempt: number;
  lockedUntil?: number;
}

interface AuthErrorResponse {
  success: false;
  error: string;
  message: string;
  remainingAttempts?: number;
  retryAfter?: number;
}

interface AuthSuccessResponse {
  success: true;
  token: string;
  message: string;
}

const encoder = new TextEncoder();

function jsonResponse<T>(body: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function getClientIp(request: Request): string {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp && cfIp.trim()) {
    return cfIp.trim();
  }
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded) {
    const [first] = forwarded.split(",");
    if (first && first.trim()) {
      return first.trim();
    }
  }
  return "unknown";
}

function createAttemptCacheRequest(ip: string): Request {
  return new Request(`${ATTEMPT_CACHE_PREFIX}${encodeURIComponent(ip)}`);
}

async function readAttemptState(request: Request): Promise<AttemptState | null> {
  const cached = await caches.default.match(request);
  if (!cached) {
    return null;
  }
  try {
    const text = await cached.text();
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text) as Partial<AttemptState>;
    const attempts = Number(parsed.attempts);
    const firstAttempt = Number(parsed.firstAttempt);
    const lockedUntil = parsed.lockedUntil != null ? Number(parsed.lockedUntil) : undefined;
    if (!Number.isFinite(attempts) || !Number.isFinite(firstAttempt)) {
      return null;
    }
    return {
      attempts: Math.max(0, Math.trunc(attempts)),
      firstAttempt,
      lockedUntil: Number.isFinite(lockedUntil) ? lockedUntil : undefined,
    };
  } catch {
    return null;
  }
}

async function saveAttemptState(request: Request, state: AttemptState): Promise<void> {
  const ttl = Math.max(ATTEMPT_WINDOW_SECONDS, LOCK_DURATION_SECONDS);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `max-age=${ttl}, s-maxage=${ttl}`,
  });
  await caches.default.put(request, new Response(JSON.stringify(state), { headers }));
}

async function clearAttemptState(request: Request): Promise<void> {
  try {
    await caches.default.delete(request);
  } catch {
    // ignore cache deletion errors
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a[index] ^ b[index];
  }
  return result === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  const data = encoder.encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function createToken(secret: string): Promise<string> {
  const digestBytes = await digest(`${secret}:${TOKEN_SALT}`);
  return toHex(digestBytes);
}

async function verifyPassword(provided: string, secret: string): Promise<boolean> {
  const [providedDigest, secretDigest] = await Promise.all([
    digest(`solara::password::${provided}`),
    digest(`solara::password::${secret}`),
  ]);
  return timingSafeEqual(providedDigest, secretDigest);
}

async function parseRequestBody(request: Request): Promise<AuthPayload> {
  const text = await request.text();
  if (!text) {
    return {};
  }
  try {
    const data = JSON.parse(text);
    return typeof data === "object" && data !== null ? data as AuthPayload : {};
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function now(): number {
  return Date.now();
}

export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (request.method !== "POST") {
    return jsonResponse<AuthErrorResponse>({
      success: false,
      error: "METHOD_NOT_ALLOWED",
      message: "只支持 POST 请求",
    }, { status: 405 });
  }

  const secret = env.ACCESS_PASSWORD;
  if (!secret) {
    return jsonResponse<AuthErrorResponse>({
      success: false,
      error: "SERVER_NOT_CONFIGURED",
      message: "服务器未配置访问密码",
    }, { status: 500 });
  }

  let payload: AuthPayload;
  try {
    payload = await parseRequestBody(request);
  } catch {
    return jsonResponse<AuthErrorResponse>({
      success: false,
      error: "INVALID_PAYLOAD",
      message: "请求体必须为有效的 JSON",
    }, { status: 400 });
  }

  const providedToken = typeof payload.token === "string" ? payload.token.trim() : "";
  const providedPassword = typeof payload.password === "string" ? payload.password : "";

  if (!providedPassword && !providedToken) {
    return jsonResponse<AuthErrorResponse>({
      success: false,
      error: "MISSING_CREDENTIAL",
      message: "请提供访问密码",
    }, { status: 400 });
  }

  if (providedToken) {
    const expectedToken = await createToken(secret);
    if (providedToken === expectedToken) {
      return jsonResponse<AuthSuccessResponse>({
        success: true,
        token: expectedToken,
        message: "验证成功",
      });
    }
    return jsonResponse<AuthErrorResponse>({
      success: false,
      error: "INVALID_TOKEN",
      message: "登录状态已失效，请重新输入密码",
    }, { status: 401 });
  }

  const ip = getClientIp(request);
  const cacheRequest = createAttemptCacheRequest(ip);
  let attemptState = await readAttemptState(cacheRequest);
  const currentTime = now();

  if (!attemptState) {
    attemptState = { attempts: 0, firstAttempt: currentTime };
  } else {
    const lockedUntil = typeof attemptState.lockedUntil === "number" ? attemptState.lockedUntil : undefined;
    if (lockedUntil && lockedUntil > currentTime) {
      const retryAfterSeconds = Math.ceil(Math.max(1, (lockedUntil - currentTime) / 1000));
      return jsonResponse<AuthErrorResponse>({
        success: false,
        error: "TOO_MANY_ATTEMPTS",
        message: "尝试次数过多，请稍后再试",
        retryAfter: retryAfterSeconds,
      }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
    }

    if (lockedUntil && lockedUntil <= currentTime) {
      attemptState.lockedUntil = undefined;
      attemptState.attempts = 0;
      attemptState.firstAttempt = currentTime;
    } else if (currentTime - attemptState.firstAttempt > ATTEMPT_WINDOW_SECONDS * 1000) {
      attemptState.attempts = 0;
      attemptState.firstAttempt = currentTime;
    }
  }

  const isValidPassword = await verifyPassword(providedPassword, secret);

  if (!isValidPassword) {
    attemptState.attempts += 1;
    const remainingAttempts = Math.max(0, MAX_ATTEMPTS - attemptState.attempts);

    if (attemptState.attempts >= MAX_ATTEMPTS) {
      attemptState.lockedUntil = currentTime + LOCK_DURATION_SECONDS * 1000;
      await saveAttemptState(cacheRequest, attemptState);
      const retryAfterSeconds = Math.ceil(Math.max(1, (attemptState.lockedUntil - currentTime) / 1000));
      return jsonResponse<AuthErrorResponse>({
        success: false,
        error: "TOO_MANY_ATTEMPTS",
        message: "尝试次数过多，请稍后再试",
        retryAfter: retryAfterSeconds,
      }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
    }

    await saveAttemptState(cacheRequest, attemptState);

    return jsonResponse<AuthErrorResponse>({
      success: false,
      error: "INVALID_PASSWORD",
      message: "密码不正确",
      remainingAttempts,
    }, { status: 401 });
  }

  await clearAttemptState(cacheRequest);

  const token = await createToken(secret);

  return jsonResponse<AuthSuccessResponse>({
    success: true,
    token,
    message: "验证成功",
  });
}
