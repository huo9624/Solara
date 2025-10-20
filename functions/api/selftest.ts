import type { Env } from "../_types";
import { buildCorsHeaders, handleCorsOptions } from "../lib/cors";

interface ErrorShape {
  code: string;
  message: string;
  status?: number;
}

interface SearchStep {
  ok: boolean;
  provider?: string;
  query?: string;
  count?: number;
  sampleId?: string;
  error?: ErrorShape;
}

interface TrackStep {
  ok: boolean;
  provider?: string;
  id?: string;
  title?: string;
  playable?: boolean;
  error?: ErrorShape;
}

interface StreamStep {
  ok: boolean;
  provider?: string;
  id?: string;
  status?: number;
  error?: ErrorShape;
}

function okJson(request: Request, data: any, status = 200): Response {
  const headers = buildCorsHeaders(request, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  return new Response(JSON.stringify(data), { status, headers });
}

export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request, "GET,HEAD,OPTIONS");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return okJson(request, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed", status: 405 } }, 405);
  }

  const started = Date.now();
  const base = new URL(request.url).origin;

  // Prefer IA for selftest since it requires no credentials; fall back to Jamendo
  const testProviders = ["ia", "jamendo"] as const;
  let search: SearchStep = { ok: false };
  let track: TrackStep = { ok: false };
  let stream: StreamStep = { ok: false };

  for (const pid of testProviders) {
    try {
      const q = "love";
      const url = `${base}/api/search?q=${encodeURIComponent(q)}&source=${encodeURIComponent(pid)}&page=1&pageSize=5`;
      const res = await fetch(url, { cache: "no-store" });
      const status = res.status;
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !Array.isArray(data.items)) {
        search = { ok: false, provider: pid, query: q, error: { code: "SEARCH_FAILED", message: `Search failed with status ${status}`, status } };
        continue;
      }
      const count: number = data.items.length;
      if (count < 1) {
        search = { ok: false, provider: pid, query: q, count, error: { code: "NO_RESULTS", message: "No search results" } };
        continue;
      }
      const item = data.items[0];
      const id = String(item.id || "");
      search = { ok: true, provider: pid, query: q, count, sampleId: id };

      // Track step
      try {
        const tUrl = `${base}/api/track?provider=${encodeURIComponent(pid)}&id=${encodeURIComponent(id)}`;
        const tRes = await fetch(tUrl, { cache: "no-store" });
        const tStatus = tRes.status;
        const tData = await tRes.json().catch(() => null);
        if (!tRes.ok || !tData || !tData.track) {
          track = { ok: false, provider: pid, id, error: { code: "TRACK_FAILED", message: `Track failed with status ${tStatus}`, status: tStatus } };
          continue; // try next provider if available
        }
        track = { ok: true, provider: pid, id, title: String(tData.track.title || ""), playable: Boolean(tData.track.isPlayable) };
      } catch (e: any) {
        track = { ok: false, provider: pid, id, error: { code: "TRACK_EXCEPTION", message: String(e && e.message || e) } };
        continue;
      }

      // Stream step (HEAD to avoid large transfer)
      try {
        const sUrl = `${base}/api/stream?provider=${encodeURIComponent(pid)}&id=${encodeURIComponent(search.sampleId || "")}`;
        const sRes = await fetch(sUrl, { method: "HEAD" });
        const sStatus = sRes.status;
        if (sStatus === 200 || sStatus === 206) {
          stream = { ok: true, provider: pid, id: search.sampleId, status: sStatus };
        } else {
          stream = { ok: false, provider: pid, id: search.sampleId, status: sStatus, error: { code: "STREAM_FAILED", message: `Stream returned ${sStatus}`, status: sStatus } };
        }
      } catch (e: any) {
        stream = { ok: false, provider: pid, id: search.sampleId, error: { code: "STREAM_EXCEPTION", message: String(e && e.message || e) } };
      }

      // If we reached here with stream attempted, break out regardless of success to avoid long loops
      break;
    } catch (e: any) {
      search = { ok: false, provider: pid, error: { code: "SEARCH_EXCEPTION", message: String(e && e.message || e) } };
      // try next provider
      continue;
    }
  }

  const envSummary = {
    JAMENDO_CLIENT_ID: Boolean(env && (env as any).JAMENDO_CLIENT_ID),
    MUSIC_CACHE: Boolean(env && (env as any).MUSIC_CACHE),
    AUDIUS_APP_NAME: Boolean(env && (env as any).AUDIUS_APP_NAME),
  };

  const elapsed = Math.max(0, Date.now() - started);
  const ok = search.ok && track.ok && stream.ok;

  return okJson(request, { ok, elapsed, env: envSummary, search, track, stream });
}
