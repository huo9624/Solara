export type Source = "gd" | "kuwo" | "jamendo" | "ia" | "audius" | "all";

// Cloudflare KV type shim for type checking without @cloudflare/workers-types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KVNamespace = any;

export interface Env {
  JAMENDO_CLIENT_ID?: string;
  AUDIUS_APP_NAME?: string;
  MUSIC_CACHE?: KVNamespace;
}

export interface TrackBase {
  id: string;
  source: Exclude<Source, "all">;
  title: string;
  artist: string;
  duration?: number; // seconds
  album?: string;
  image?: string;
  bitrate?: number; // in kbps if known
  // Any provider-specific fields
  extra?: Record<string, any>;
}

export interface StreamInfo {
  url: string;
  headers?: Record<string, string>;
}

export interface JsonError {
  code: string;
  message: string;
}

export function jsonOk(body: any, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", headers.get("Cache-Control") || "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function jsonError(code: string, message: string, status = 400, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify({ code, message }), { ...init, status, headers });
}

export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export function clampPageSize(value: any, min = 1, max = 50, fallback = 20): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function clampPage(value: any, min = 1, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.trunc(n));
}

export function computeSearchTtlSeconds(): number {
  // 5–15 minutes randomized to avoid stampedes
  const min = 300;
  const max = 900;
  return Math.floor(min + Math.random() * (max - min));
}

export function computeTrackTtlSeconds(): number {
  // 1–6 hours randomized
  const min = 3600;
  const max = 21600;
  return Math.floor(min + Math.random() * (max - min));
}

export async function getKv<T>(env: Env, key: string): Promise<T | null> {
  try {
    if (!env.MUSIC_CACHE) return null;
    const text = await env.MUSIC_CACHE.get(key);
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function putKv(env: Env, key: string, value: any, ttlSeconds: number): Promise<void> {
  try {
    if (!env.MUSIC_CACHE) return;
    await env.MUSIC_CACHE.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch {
    // ignore
  }
}

export function normalizeString(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u2018\u2019\u201C\u201D]/g, '"')
    .replace(/[\(\)\[\]\{\}\-_,.;:!?~`'"/\\]/g, "")
    .trim();
}

export function fingerprint(track: TrackBase): string {
  const title = normalizeString(track.title);
  const artist = normalizeString(track.artist);
  const durationBucket = Number.isFinite(track.duration as number)
    ? String(Math.round((track.duration as number) / 3) * 3)
    : "?";
  return `${title}|${artist}|${durationBucket}`;
}

const SOURCE_QUALITY_DEFAULT: Record<Exclude<Source, "all">, number> = {
  jamendo: 0.75,
  ia: 0.55,
  audius: 0.82,
  gd: 0.78,
  kuwo: 0.7,
};

const SOURCE_STABILITY: Record<Exclude<Source, "all">, number> = {
  jamendo: 0.85,
  ia: 0.6,
  audius: 0.9,
  gd: 0.7,
  kuwo: 0.8,
};

const SOURCE_SCORE: Record<Exclude<Source, "all">, number> = {
  jamendo: 0.85,
  ia: 0.6,
  audius: 0.88,
  gd: 0.75,
  kuwo: 0.7,
};

export function scoreTrack(track: TrackBase): number {
  const bitrate = Number(track.bitrate);
  const quality = Number.isFinite(bitrate) && bitrate > 0 ? Math.min(bitrate / 320, 1) : SOURCE_QUALITY_DEFAULT[track.source] || 0.6;
  const stability = SOURCE_STABILITY[track.source] || 0.6;
  const sourceScore = SOURCE_SCORE[track.source] || 0.6;
  return quality * 0.5 + stability * 0.3 + sourceScore * 0.2;
}

export function dedupeAndSort(tracks: TrackBase[]): TrackBase[] {
  const map = new Map<string, TrackBase>();
  for (const t of tracks) {
    const key = fingerprint(t);
    const current = map.get(key);
    if (!current) {
      map.set(key, t);
      continue;
    }
    // pick the better scored track
    if (scoreTrack(t) > scoreTrack(current)) {
      map.set(key, t);
    }
  }
  return Array.from(map.values()).sort((a, b) => scoreTrack(b) - scoreTrack(a));
}

export async function fetchWithTimeout(input: RequestInfo, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 4500, ...rest } = init;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(input, { ...rest, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(id);
  }
}

export async function fetchJson<T>(input: RequestInfo, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const resp = await fetchWithTimeout(input, init);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP_${resp.status}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

export async function withRetries<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: any = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // small backoff
      await new Promise(r => setTimeout(r, 80 * (i + 1)));
    }
  }
  throw lastErr;
}

export interface CircuitBreaker {
  isOpen(): boolean;
  success(): void;
  failure(): void;
}

export function createCircuitBreaker(threshold = 4, openMs = 30000): CircuitBreaker {
  let fails = 0;
  let openedAt = 0;
  return {
    isOpen() {
      if (fails < threshold) return false;
      const now = Date.now();
      if (now - openedAt > openMs) {
        fails = 0;
        openedAt = 0;
        return false;
      }
      return true;
    },
    success() {
      fails = 0;
      openedAt = 0;
    },
    failure() {
      fails += 1;
      if (fails >= threshold) {
        openedAt = Date.now();
      }
    },
  };
}
