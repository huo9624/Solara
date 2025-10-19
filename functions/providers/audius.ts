import { Env, TrackBase, fetchJson, withRetries, createCircuitBreaker } from "../lib/utils";

interface AudiusUser {
  name?: string;
  handle?: string;
}

interface AudiusTrack {
  id: string;
  title: string;
  duration?: number;
  artwork?: { [k: string]: string } | string;
  artwork_100x100?: string;
  artwork_480x480?: string;
  artwork_1000x1000?: string;
  user?: AudiusUser;
  user_name?: string;
  stream_url?: string;
}

interface AudiusSearchResponse {
  data: AudiusTrack[];
}

interface AudiusTrackResponse {
  data: AudiusTrack;
}

const breaker = createCircuitBreaker();

function getArtwork(t: AudiusTrack): string | undefined {
  return (
    (typeof t.artwork === "string" ? t.artwork : undefined) ||
    (t.artwork_1000x1000 || t.artwork_480x480 || t.artwork_100x100)
  );
}

function getArtist(t: AudiusTrack): string {
  return t.user?.name || t.user_name || t.user?.handle || "";
}

export async function searchAudius(query: string, pageSize: number, page: number, env: Env): Promise<TrackBase[]> {
  if (breaker.isOpen()) return [];
  const app = env.AUDIUS_APP_NAME || "solara";
  const offset = (page - 1) * pageSize;
  const params = new URLSearchParams({
    query,
    limit: String(pageSize),
    offset: String(offset),
    app_name: app,
  });
  const url = `https://discoveryprovider.audius.co/v1/tracks/search?${params.toString()}`;
  try {
    const data = await withRetries(() => fetchJson<AudiusSearchResponse>(url, { timeoutMs: 4500 }));
    breaker.success();
    const items = data?.data || [];
    return items.map((t): TrackBase => ({
      id: String(t.id),
      source: "audius",
      title: t.title || "",
      artist: getArtist(t),
      duration: Number(t.duration) || undefined,
      image: getArtwork(t),
      bitrate: 256,
      extra: { stream_url: t.stream_url },
    }));
  } catch (err) {
    breaker.failure();
    return [];
  }
}

export async function getAudiusTrack(id: string, env: Env): Promise<TrackBase | null> {
  if (breaker.isOpen()) return null;
  const app = env.AUDIUS_APP_NAME || "solara";
  const url = `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(id)}?app_name=${encodeURIComponent(app)}`;
  try {
    const resp = await withRetries(() => fetchJson<AudiusTrackResponse>(url, { timeoutMs: 4500 }));
    breaker.success();
    const t = resp?.data;
    if (!t) return null;
    return {
      id: String(t.id),
      source: "audius",
      title: t.title || "",
      artist: getArtist(t),
      duration: Number(t.duration) || undefined,
      image: getArtwork(t),
      bitrate: 256,
      extra: { stream_url: t.stream_url },
    };
  } catch (err) {
    breaker.failure();
    return null;
  }
}

export async function getAudiusStream(track: TrackBase, env: Env): Promise<{ url: string } | null> {
  const app = env.AUDIUS_APP_NAME || "solara";
  // Audius supports direct streaming endpoint
  const url = `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(track.id)}/stream?app_name=${encodeURIComponent(app)}`;
  return { url };
}
