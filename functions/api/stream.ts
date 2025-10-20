import type { Env, ProviderId } from "../_types";
import { buildCorsHeaders, handleCorsOptions } from "../lib/cors";
import { enforceRateLimit } from "../lib/rateLimit";
import { providers } from "../providers";

const SAFE_RESPONSE_HEADERS = ["content-type", "cache-control", "accept-ranges", "content-length", "content-range", "etag", "last-modified", "expires"];

function error(request: Request, code: string, message: string, status = 400): Response {
  const headers = buildCorsHeaders(request, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  return new Response(JSON.stringify({ code, message }), { status, headers });
}

function createPassthroughHeaders(from: Headers, request: Request): Headers {
  const headers = buildCorsHeaders(request);
  for (const [key, value] of from.entries()) {
    if (SAFE_RESPONSE_HEADERS.includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=3600");
  }
  return headers;
}

export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request, "GET,HEAD,OPTIONS");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return error(request, "METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }

  const rate = await enforceRateLimit(env, request, { key: "stream", limit: 240, windowSeconds: 60 });
  if (!rate.allowed) {
    const headers = buildCorsHeaders(request, { "Content-Type": "application/json; charset=utf-8", "Retry-After": String(rate.retryAfter || 60) });
    return new Response(JSON.stringify({ code: "RATE_LIMITED", message: "Too many requests" }), { status: 429, headers });
  }

  const url = new URL(request.url);
  const rawId = (url.searchParams.get("id") || url.searchParams.get("tid") || "").trim();
  const pidParam = (url.searchParams.get("provider") || "").trim().toLowerCase();
  const quality = (url.searchParams.get("quality") || url.searchParams.get("q") || "320").trim();

  if (!rawId) return error(request, "INVALID_PARAM", "Missing id parameter");

  let providerId: ProviderId | null = null;
  let id = rawId;
  const colonIndex = rawId.indexOf(":");
  if (!pidParam && colonIndex > 0) {
    providerId = rawId.substring(0, colonIndex).toLowerCase() as ProviderId;
    id = rawId.substring(colonIndex + 1);
  } else if (pidParam) {
    providerId = pidParam as ProviderId;
  }
  if (!providerId || !(providers as any)[providerId]) {
    return error(request, "INVALID_PARAM", "Invalid or missing provider");
  }

  // Ask provider for a stream URL
  try {
    const provider = (providers as any)[providerId];
    const info = providerId === "jamendo" ? await provider.getStream(id, quality, env) : await provider.getStream(id, quality);
    if (!info || !info.url) return error(request, "NOT_FOUND", "Stream not found", 404);

    // Proxy the stream to handle CORS and Range
    const init: RequestInit = { headers: {} };
    const rangeHeader = request.headers.get("Range");
    if (rangeHeader) (init.headers as Record<string, string>)["Range"] = rangeHeader;

    // Special case: Kuwo often uses http scheme; we allow it here and let the browser handle via HTTPS proxy
    const upstream = await fetch(info.url, init);
    const headers = createPassthroughHeaders(upstream.headers, request);

    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  } catch (e) {
    return error(request, "UPSTREAM_ERROR", "Failed to open stream", 502);
  }
}
