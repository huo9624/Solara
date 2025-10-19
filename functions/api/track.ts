import type { Env, ProviderId, Track } from "../_types";
import { buildCorsHeaders, handleCorsOptions } from "../lib/cors";
import { enforceRateLimit } from "../lib/rateLimit";
import { getKVJSON, jsonResponse, matchEdgeCache, putEdgeCache, putKVJSON } from "../lib/cache";
import { providers } from "../providers";

const TRACK_CACHE_TTL_MIN = 60 * 60; // 1 hour
const TRACK_CACHE_TTL_MAX = 6 * 60 * 60; // 6 hours

function pickTrackTtl(): number {
  return TRACK_CACHE_TTL_MIN + Math.floor(Math.random() * (TRACK_CACHE_TTL_MAX - TRACK_CACHE_TTL_MIN));
}

function error(request: Request, code: string, message: string, status = 400): Response {
  const headers = buildCorsHeaders(request, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  return new Response(JSON.stringify({ code, message }), { status, headers });
}

export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request, "GET,OPTIONS");
  }
  if (request.method !== "GET") {
    return error(request, "METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }

  const rate = await enforceRateLimit(env, request, { key: "track", limit: 120, windowSeconds: 60 });
  if (!rate.allowed) {
    const headers = buildCorsHeaders(request, { "Content-Type": "application/json; charset=utf-8", "Retry-After": String(rate.retryAfter || 60) });
    return new Response(JSON.stringify({ code: "RATE_LIMITED", message: "Too many requests" }), { status: 429, headers });
  }

  const url = new URL(request.url);
  // Support id in the form provider:id or provider param
  const pidParam = (url.searchParams.get("provider") || "").trim().toLowerCase();
  const rawId = (url.searchParams.get("id") || url.searchParams.get("tid") || "").trim();

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

  const kvKey = `track:${providerId}:${id}`;
  const cachedEdge = await matchEdgeCache(request);
  if (cachedEdge) return cachedEdge;

  const kvHit = await getKVJSON<any>(env.MUSIC_CACHE, kvKey);
  if (kvHit) {
    const headers = buildCorsHeaders(request, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=120" });
    const resp = new Response(JSON.stringify({ ...kvHit, cached: true }), { status: 200, headers });
    await putEdgeCache(request, resp.clone());
    return resp;
  }

  try {
    const provider = (providers as any)[providerId];
    let track: Track | null;
    if (providerId === "jamendo") {
      track = await provider.getTrack(id, env);
    } else {
      track = await provider.getTrack(id);
    }
    if (!track) return error(request, "NOT_FOUND", "Track not found", 404);

    const ttl = pickTrackTtl();
    const payload = { track, provider: providerId };
    await putKVJSON(env.MUSIC_CACHE, kvKey, payload, ttl);
    const headers = buildCorsHeaders(request, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${ttl}` });
    const response = new Response(JSON.stringify(payload), { status: 200, headers });
    await putEdgeCache(request, response.clone());
    return response;
  } catch (e) {
    return error(request, "UPSTREAM_ERROR", "Failed to fetch track", 502);
  }
}
