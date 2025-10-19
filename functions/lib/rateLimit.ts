import type { Env } from "../_types";

function getClientIp(request: Request): string {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded && forwarded.trim()) return forwarded.split(",")[0].trim();
  return "unknown";
}

interface WindowState {
  points: number[]; // epoch seconds
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface RateLimitOptions {
  key: string; // logical name for bucket
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining?: number;
  retryAfter?: number; // seconds
}

export async function enforceRateLimit(env: Env, request: Request, opts: RateLimitOptions): Promise<RateLimitResult> {
  const ip = getClientIp(request);
  const kvKey = `ratelimit:${opts.key}:${ip}`;
  try {
    const raw = await env.MUSIC_CACHE.get(kvKey);
    const state: WindowState = raw ? JSON.parse(raw) : { points: [] };
    const now = nowSeconds();
    const windowStart = now - opts.windowSeconds;
    const fresh = state.points.filter(ts => ts > windowStart);
    if (fresh.length >= opts.limit) {
      const earliest = Math.min(...fresh);
      const retryAfter = Math.max(1, (earliest + opts.windowSeconds) - now);
      return { allowed: false, remaining: 0, retryAfter };
    }
    fresh.push(now);
    const newState: WindowState = { points: fresh.slice(-opts.limit) };
    await env.MUSIC_CACHE.put(kvKey, JSON.stringify(newState), { expirationTtl: opts.windowSeconds });
    const remaining = Math.max(0, opts.limit - fresh.length);
    return { allowed: true, remaining };
  } catch {
    // If KV fails, allow the request (fail open)
    return { allowed: true };
  }
}
