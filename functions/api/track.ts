import { Env, handleOptions, jsonError, jsonOk, clampPageSize, getKv, putKv, computeTrackTtlSeconds, TrackBase } from "../lib/utils";
import { getJamendoTrack } from "../providers/jamendo";
import { getIATrack } from "../providers/ia";
import { getAudiusTrack } from "../providers/audius";

export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "GET") return jsonError("METHOD_NOT_ALLOWED", "只支持 GET 请求", 405);

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || url.searchParams.get("trackId") || "";
  const source = (url.searchParams.get("source") || "").toLowerCase();

  if (!id) return jsonError("MISSING_ID", "缺少歌曲 ID");
  if (!source) return jsonError("MISSING_SOURCE", "缺少来源 source");

  const kvKey = `track:${source}:${id}`;
  const kvHit = await getKv<any>(env, kvKey);
  if (kvHit) {
    const headers = new Headers({ "Cache-Control": "public, max-age=120", "Access-Control-Allow-Origin": "*" });
    return new Response(JSON.stringify(kvHit), { status: 200, headers });
  }

  let track: TrackBase | null = null;
  if (source === "jamendo") {
    track = await getJamendoTrack(id, env);
  } else if (source === "ia") {
    track = await getIATrack(id);
  } else if (source === "audius") {
    track = await getAudiusTrack(id, env);
  } else {
    return jsonError("UNSUPPORTED_SOURCE", `不支持的来源: ${source}`, 400);
  }

  if (!track) return jsonError("NOT_FOUND", "未找到对应歌曲", 404);

  const payload = { ok: true, track };

  const ttl = computeTrackTtlSeconds();
  putKv(env, kvKey, payload, ttl).catch(() => {});

  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": `public, max-age=${Math.min(600, ttl)}`,
  });
  return new Response(JSON.stringify(payload), { status: 200, headers });
}
