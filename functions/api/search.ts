import type { Env, ProviderId, SearchParams, Track } from "../_types";
import { handleCorsOptions, buildCorsHeaders } from "../lib/cors";
import { enforceRateLimit } from "../lib/rateLimit";
import { dedupeTracks } from "../lib/dedupe";
import { getKVJSON, jsonResponse, matchEdgeCache, putEdgeCache, putKVJSON } from "../lib/cache";
import { providers } from "../providers";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 25;
const SEARCH_CACHE_TTL_MIN = 5 * 60; // 5 minutes
const SEARCH_CACHE_TTL_MAX = 15 * 60; // 15 minutes

function pickSearchTtl(): number {
  // simple jittered TTL
  return SEARCH_CACHE_TTL_MIN + Math.floor(Math.random() * (SEARCH_CACHE_TTL_MAX - SEARCH_CACHE_TTL_MIN));
}

function parseProvidersParam(raw: string | null | undefined): ProviderId[] {
  const list = (raw || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const allowed: ProviderId[] = ["gd", "kuwo", "jamendo", "ia"];
  const selected = list.length ? list.filter((p): p is ProviderId => (allowed as string[]).includes(p)) : allowed;
  // Remove duplicates preserving order
  return Array.from(new Set(selected));
}

function ok(data: any, request: Request, cacheTtl?: number): Response {
  const headers = buildCorsHeaders(request, { "Content-Type": "application/json; charset=utf-8" });
  if (cacheTtl && cacheTtl > 0) headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
  return new Response(JSON.stringify(data), { status: 200, headers });
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

  const rate = await enforceRateLimit(env, request, { key: "search", limit: 60, windowSeconds: 60 });
  if (!rate.allowed) {
    const headers = buildCorsHeaders(request, { "Content-Type": "application/json; charset=utf-8", "Retry-After": String(rate.retryAfter || 60) });
    return new Response(JSON.stringify({ code: "RATE_LIMITED", message: "Too many requests" }), { status: 429, headers });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || url.searchParams.get("query") || url.searchParams.get("keyword") || "";
  if (!query || query.trim().length < 1) {
    return error(request, "INVALID_PARAM", "Missing query parameter 'q' or 'query'");
  }
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(url.searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE));
  const providersParam = parseProvidersParam(url.searchParams.get("providers"));

  const kvKey = `search:${providersParam.join("+")}:${page}:${pageSize}:${query.toLowerCase()}`;

  // Try edge cache first
  const cachedEdge = await matchEdgeCache(request);
  if (cachedEdge) return cachedEdge;

  // Then KV cache
  const kvHit = await getKVJSON<any>(env.MUSIC_CACHE, kvKey);
  if (kvHit) {
    const response = ok({ ...kvHit, cached: true }, request, 60);
    // populate edge cache briefly
    await putEdgeCache(request, response.clone());
    return response;
  }

  // Fan-out to providers
  const tasks = providersParam.map(async (pid) => {
    try {
      const provider = (providers as any)[pid];
      if (!provider) return [] as Track[];
      if (pid === "jamendo") {
        return await provider.search(query, page, pageSize, env);
      }
      return await provider.search(query, page, pageSize);
    } catch (e) {
      return [] as Track[];
    }
  });

  const lists = await Promise.all(tasks);
  const flat: Track[] = lists.flat();
  const deduped = dedupeTracks(flat);

  const payload = {
    query,
    page,
    pageSize,
    providers: providersParam,
    count: deduped.length,
    items: deduped,
  };

  const ttl = pickSearchTtl();
  const response = ok(payload, request, ttl);
  await putKVJSON(env.MUSIC_CACHE, kvKey, payload, ttl);
  await putEdgeCache(request, response.clone());

  return response;
}
