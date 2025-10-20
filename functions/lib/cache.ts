import type { KVNamespace } from "../_types";

export async function getKVJSON<T = unknown>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    const val = await kv.get(key);
    if (!val) return null;
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

export async function putKVJSON(kv: KVNamespace, key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  try {
    const text = JSON.stringify(value);
    await kv.put(key, text, typeof ttlSeconds === "number" && ttlSeconds > 0 ? { expirationTtl: ttlSeconds } : undefined);
  } catch {
    // Ignore KV put failures
  }
}

export function jsonResponse(data: any, request: Request, status = 200, cacheTtlSeconds?: number): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  if (typeof cacheTtlSeconds === "number" && cacheTtlSeconds > 0) {
    headers.set("Cache-Control", `public, max-age=${cacheTtlSeconds}`);
  } else {
    headers.set("Cache-Control", "no-store");
  }
  const response = new Response(JSON.stringify(data), { status, headers });
  return response;
}

export async function matchEdgeCache(request: Request): Promise<Response | null> {
  try {
    const cached = await caches.default.match(request);
    return cached || null;
  } catch {
    return null;
  }
}

export async function putEdgeCache(request: Request, response: Response): Promise<void> {
  try {
    await caches.default.put(request, response);
  } catch {
    // ignore write failures
  }
}
