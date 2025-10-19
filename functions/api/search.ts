import { Env, handleOptions, jsonError, jsonOk, clampPage, clampPageSize, getKv, putKv, computeSearchTtlSeconds, dedupeAndSort, TrackBase, Source } from "../lib/utils";
import { searchJamendo } from "../providers/jamendo";
import { searchIA } from "../providers/ia";
import { searchAudius } from "../providers/audius";
import { searchGD } from "../providers/gd";
import { searchKuwo } from "../providers/kuwo";

export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }
  if (request.method !== "GET") {
    return jsonError("METHOD_NOT_ALLOWED", "只支持 GET 请求", 405);
  }
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || url.searchParams.get("keyword") || url.searchParams.get("name") || "";
  const rawSource = (url.searchParams.get("source") || "all").toLowerCase() as Source;
  const page = clampPage(url.searchParams.get("page"));
  const pageSize = clampPageSize(url.searchParams.get("pageSize") || url.searchParams.get("limit"), 1, 50, 50);

  if (!q || q.trim().length < 1) {
    return jsonError("INVALID_QUERY", "缺少搜索关键词 q");
  }

  const source: Source = ["all", "gd", "kuwo", "jamendo", "ia", "audius"].includes(rawSource) ? rawSource : "all";

  // Try KV cache first
  const kvKey = `search:${source}:${q}:${page}:${pageSize}`;
  const kvHit = await getKv<any>(env, kvKey);
  if (kvHit) {
    const headers = new Headers({ "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" });
    return new Response(JSON.stringify(kvHit), { status: 200, headers });
  }

  // Prepare providers
  let tasks: Promise<TrackBase[]>[] = [];
  if (source === "all") {
    tasks = [
      searchJamendo(q, pageSize, page, env),
      searchAudius(q, pageSize, page, env),
      searchIA(q, pageSize, page),
    ];
    // also include gd and kuwo with smaller sizes to increase coverage
    tasks.push(searchGD(q, Math.min(20, pageSize), page));
    tasks.push(searchKuwo(q, Math.min(20, pageSize), page));
  } else if (source === "jamendo") {
    tasks = [searchJamendo(q, pageSize, page, env)];
  } else if (source === "audius") {
    tasks = [searchAudius(q, pageSize, page, env)];
  } else if (source === "ia") {
    tasks = [searchIA(q, pageSize, page)];
  } else if (source === "gd") {
    tasks = [searchGD(q, pageSize, page)];
  } else if (source === "kuwo") {
    tasks = [searchKuwo(q, pageSize, page)];
  }

  const results: TrackBase[] = [];
  const settled = await Promise.allSettled(tasks);
  for (const item of settled) {
    if (item.status === "fulfilled" && Array.isArray(item.value)) {
      results.push(...item.value);
    }
  }

  const uniqueSorted = dedupeAndSort(results);

  const payload = {
    ok: true,
    source,
    query: q,
    page,
    pageSize,
    total: uniqueSorted.length,
    results: uniqueSorted,
  };

  const ttl = computeSearchTtlSeconds();
  // Save to KV
  putKv(env, kvKey, payload, ttl).catch(() => {});

  // Also leverage CDN cache
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": `public, max-age=${Math.min(120, ttl)}`,
  });
  return new Response(JSON.stringify(payload), { status: 200, headers });
}
