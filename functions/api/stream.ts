import { Env, handleOptions, jsonError, fetchWithTimeout } from "../lib/utils";
import { getJamendoTrack, getJamendoStream } from "../providers/jamendo";
import { getIAStream, getIATrack } from "../providers/ia";
import { getAudiusTrack, getAudiusStream } from "../providers/audius";

const SAFE_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "accept-ranges",
  "content-length",
  "content-range",
  "etag",
  "last-modified",
  "expires",
];

function corsHeaders(init?: Headers): Headers {
  const headers = new Headers();
  if (init) {
    for (const [key, value] of init.entries()) {
      if (SAFE_RESPONSE_HEADERS.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
  }
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=3600");
  }
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

async function proxyStream(targetUrl: string, request: Request, extraHeaders?: Record<string, string>): Promise<Response> {
  const init: RequestInit = {
    method: "GET",
    headers: {
      "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
      "Accept": request.headers.get("Accept") || "*/*",
      ...(extraHeaders || {}),
    },
  };

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    (init.headers as Record<string, string>)["Range"] = rangeHeader;
  }

  const upstream = await fetchWithTimeout(targetUrl, { ...init, timeoutMs: 15000 });
  const headers = corsHeaders(upstream.headers);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

const KUWO_HOST_PATTERN = /(^|\.)kuwo\.cn$/i;

function normalizeKuwoUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (!KUWO_HOST_PATTERN.test(parsed.hostname)) return null;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.protocol = "http:"; // Kuwo streams require http and referer
    return parsed;
  } catch {
    return null;
  }
}

const API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";

async function resolveKuwoUrlById(id: string): Promise<string | null> {
  try {
    const url = `${API_BASE_URL}?types=url&id=${encodeURIComponent(id)}&source=kuwo&br=320`;
    const resp = await fetchWithTimeout(url, { timeoutMs: 6000 });
    const text = await resp.text();
    const data = JSON.parse(text);
    if (data && typeof data.url === "string" && data.url) return data.url;
    return null;
  } catch {
    return null;
  }
}

async function streamForSource(source: string, id: string, request: Request, env: Env): Promise<Response> {
  if (source === "jamendo") {
    const track = (await getJamendoTrack(id, env)) || { id, source: "jamendo", title: "", artist: "" } as any;
    const stream = await getJamendoStream(track, env);
    if (!stream) return jsonError("STREAM_NOT_FOUND", "未找到音频流", 404);
    return proxyStream(stream.url, request);
  }
  if (source === "ia") {
    const track = (await getIATrack(id)) || { id, source: "ia", title: "", artist: "" } as any;
    const stream = await getIAStream(track);
    if (!stream) return jsonError("STREAM_NOT_FOUND", "未找到音频流", 404);
    return proxyStream(stream.url, request);
  }
  if (source === "audius") {
    const track = (await getAudiusTrack(id, env)) || { id, source: "audius", title: "", artist: "" } as any;
    const stream = await getAudiusStream(track, env);
    if (!stream) return jsonError("STREAM_NOT_FOUND", "未找到音频流", 404);
    return proxyStream(stream.url, request);
  }
  if (source === "kuwo") {
    const raw = await resolveKuwoUrlById(id);
    if (!raw) return jsonError("STREAM_NOT_FOUND", "未找到音频流", 404);
    const normalized = normalizeKuwoUrl(raw);
    if (!normalized) return jsonError("INVALID_TARGET", "无效的目标音频地址", 400);
    return proxyStream(normalized.toString(), request, { Referer: "https://www.kuwo.cn/" });
  }
  return jsonError("UNSUPPORTED_SOURCE", `不支持的来源: ${source}`, 400);
}

export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "GET" && request.method !== "HEAD") return jsonError("METHOD_NOT_ALLOWED", "只支持 GET/HEAD 请求", 405);

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || url.searchParams.get("trackId") || "";
  const source = (url.searchParams.get("source") || "").toLowerCase();
  if (!id) return jsonError("MISSING_ID", "缺少歌曲 ID");
  if (!source) return jsonError("MISSING_SOURCE", "缺少来源 source");

  try {
    return await streamForSource(source, id, request, env);
  } catch (err) {
    return jsonError("STREAM_ERROR", (err as Error)?.message || "上游流媒体错误", 502);
  }
}
