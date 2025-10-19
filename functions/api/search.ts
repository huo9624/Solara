import { Track, SearchParams, SearchSuccessResponse, ApiErrorResponse, ProviderID } from "../lib/types";

interface SearchKV {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
}

interface Env {
  JAMENDO_CLIENT_ID?: string;
  SEARCH_CACHE?: SearchKV;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const KV_TTL_SECONDS = 300;
const EDGE_CACHE_TTL_SECONDS = 120;
const KV_PREFIX = "solara::search::v1::";

function createCorsJsonHeaders(status: number): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "*",
  });
  headers.set("Cache-Control", status === 200 ? `public, max-age=${EDGE_CACHE_TTL_SECONDS}` : "no-store");
  return headers;
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function parseParams(url: URL): SearchParams | ApiErrorResponse {
  const qRaw = url.searchParams.get("q") ?? "";
  const sourceRaw = (url.searchParams.get("source") ?? "all").toLowerCase();
  const pageRaw = url.searchParams.get("page") ?? "1";
  const pageSizeRaw = url.searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE);

  const q = qRaw.trim();
  if (!q) {
    return { ok: false, error: "MISSING_QUERY", message: "缺少关键词 q" };
  }

  const validSources: Array<"all" | ProviderID> = ["all", "jamendo", "ia"];
  if (!validSources.includes(sourceRaw as any)) {
    return { ok: false, error: "INVALID_SOURCE", message: "source 仅支持 all|jamendo|ia" };
  }

  const page = Math.max(1, Math.trunc(Number(pageRaw) || 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(pageSizeRaw) || DEFAULT_PAGE_SIZE)));

  return { q, source: sourceRaw as any, page, pageSize };
}

function stableKey(params: SearchParams): string {
  const search = new URLSearchParams();
  search.set("q", params.q.toLowerCase());
  search.set("source", params.source);
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  return `${KV_PREFIX}${search.toString()}`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s\-_.]+/g, " ").replace(/[^a-z0-9\u4e00-\u9fa5 ]+/g, "").trim();
}

function dedupeTracks(items: Track[]): Track[] {
  const seen = new Set<string>();
  const result: Track[] = [];
  for (const item of items) {
    const title = normalizeText(item.title || "");
    const artist = normalizeText(item.artist || "");
    const key = `${title}|${artist}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

async function searchJamendo(q: string, page: number, pageSize: number, clientId?: string): Promise<Track[]> {
  if (!clientId) return [];
  const api = new URL("https://api.jamendo.com/v3.0/tracks");
  const offset = (page - 1) * pageSize;
  api.searchParams.set("client_id", clientId);
  api.searchParams.set("format", "json");
  api.searchParams.set("search", q);
  api.searchParams.set("limit", String(pageSize));
  api.searchParams.set("offset", String(offset));
  api.searchParams.set("fuzzysearch", "true");
  api.searchParams.set("include", "musicinfo+stats");
  api.searchParams.set("imagesize", "200");

  const res = await fetch(api.toString(), {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: EDGE_CACHE_TTL_SECONDS, cacheEverything: true },
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null) as any;
  const rows = Array.isArray(data?.results) ? data.results : [];
  const mapped: Track[] = rows.map((row: any): Track => {
    const id = String(row?.id ?? "");
    const released = typeof row?.releasedate === "string" ? row.releasedate : "";
    const year = released ? Number((released.match(/^\d{4}/) || [""])[0]) || undefined : undefined;
    return {
      id: `jamendo:${id}`,
      source: "jamendo",
      providerId: id,
      title: String(row?.name ?? ""),
      artist: String(row?.artist_name ?? ""),
      album: row?.album_name ? String(row.album_name) : undefined,
      duration: Number(row?.duration) || undefined,
      coverUrl: row?.image ? String(row.image) : undefined,
      year,
      url: row?.audio ? String(row.audio) : undefined,
      popularity: Number(row?.stats?.listened) || undefined,
      extra: undefined,
    };
  });
  return mapped;
}

async function searchInternetArchive(q: string, page: number, pageSize: number): Promise<Track[]> {
  const base = new URL("https://archive.org/advancedsearch.php");
  const term = q.replace(/\"/g, " ").trim();
  const query = `mediatype:audio AND (title:(${term}) OR creator:(${term}) OR subject:(${term}))`;
  base.searchParams.set("q", query);
  base.searchParams.append("fl[]", "identifier");
  base.searchParams.append("fl[]", "title");
  base.searchParams.append("fl[]", "creator");
  base.searchParams.append("fl[]", "year");
  base.searchParams.append("fl[]", "downloads");
  base.searchParams.append("sort[]", "downloads desc");
  base.searchParams.set("rows", String(pageSize));
  base.searchParams.set("page", String(page));
  base.searchParams.set("output", "json");

  const res = await fetch(base.toString(), {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: EDGE_CACHE_TTL_SECONDS, cacheEverything: true },
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null) as any;
  const docs = Array.isArray(data?.response?.docs) ? data.response.docs : [];
  const items: Track[] = docs.map((doc: any): Track => {
    const identifier = String(doc?.identifier ?? "");
    const creator = doc?.creator;
    const artist = Array.isArray(creator) ? creator.join(", ") : (typeof creator === "string" ? creator : "");
    const year = Number(doc?.year) || undefined;
    const downloads = Number(doc?.downloads) || undefined;
    return {
      id: `ia:${identifier}`,
      source: "ia",
      providerId: identifier,
      title: String(doc?.title ?? identifier),
      artist,
      duration: undefined,
      album: undefined,
      coverUrl: identifier ? `https://archive.org/services/img/${encodeURIComponent(identifier)}` : undefined,
      year,
      url: identifier ? `https://archive.org/details/${encodeURIComponent(identifier)}` : undefined,
      popularity: downloads,
      extra: undefined,
    };
  });
  return items;
}

function sortTracks(items: Track[]): Track[] {
  return items.slice().sort((a, b) => {
    const pa = a.popularity ?? 0;
    const pb = b.popularity ?? 0;
    if (pb !== pa) return pb - pa;
    const ta = a.title.toLowerCase();
    const tb = b.title.toLowerCase();
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  });
}

export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }
  if (request.method !== "GET") {
    const payload: ApiErrorResponse = { ok: false, error: "METHOD_NOT_ALLOWED", message: "只支持 GET 请求" };
    return new Response(JSON.stringify(payload), {
      status: 405,
      headers: createCorsJsonHeaders(405),
    });
  }

  const url = new URL(request.url);
  const parsed = parseParams(url);
  if (!("q" in parsed)) {
    return new Response(JSON.stringify(parsed), { status: 400, headers: createCorsJsonHeaders(400) });
  }

  const params = parsed as SearchParams;

  const edgeCache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await edgeCache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const kvKey = stableKey(params);
  const kv: SearchKV | undefined = env.SEARCH_CACHE;
  if (kv && typeof kv.get === "function") {
    try {
      const snapshot = await kv.get(kvKey);
      if (snapshot) {
        const parsedSnapshot = JSON.parse(snapshot) as SearchSuccessResponse;
        const response = new Response(JSON.stringify(parsedSnapshot), { status: 200, headers: createCorsJsonHeaders(200) });
        try { await edgeCache.put(cacheKey, response.clone()); } catch {}
        return response;
      }
    } catch {}
  }

  const providers: ProviderID[] = params.source === "all" ? ["jamendo", "ia"] : [params.source];

  const startTime = Date.now();
  const [jamendoItems, iaItems] = await Promise.all([
    providers.includes("jamendo") ? searchJamendo(params.q, params.page, params.pageSize, env.JAMENDO_CLIENT_ID) : Promise.resolve([]),
    providers.includes("ia") ? searchInternetArchive(params.q, params.page, params.pageSize) : Promise.resolve([]),
  ]);

  const combined = dedupeTracks(sortTracks([...jamendoItems, ...iaItems]));

  const start = (params.page - 1) * params.pageSize;
  const end = start + params.pageSize;
  const pageItems = combined.slice(start, end);

  const body: SearchSuccessResponse = {
    ok: true,
    params,
    total: combined.length,
    results: pageItems,
    took: Math.max(0, Date.now() - startTime),
    providers: {
      jamendo: jamendoItems.length || undefined,
      ia: iaItems.length || undefined,
    },
  };

  const response = new Response(JSON.stringify(body), { status: 200, headers: createCorsJsonHeaders(200) });

  try { await edgeCache.put(cacheKey, response.clone()); } catch {}

  if (kv && typeof kv.put === "function") {
    try { await kv.put(kvKey, JSON.stringify(body), { expirationTtl: KV_TTL_SECONDS }); } catch {}
  }

  return response;
}
