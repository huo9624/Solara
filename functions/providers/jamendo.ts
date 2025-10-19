import { Env, TrackBase, fetchJson, withRetries, createCircuitBreaker } from "../lib/utils";

interface JamendoTrackResult {
  id: string;
  name: string;
  artist_name: string;
  album_name?: string;
  duration?: number;
  image?: string;
  audio?: string;
  audiodownload?: string;
}

interface JamendoResponse<T> {
  headers: any[];
  results: T[];
}

const breaker = createCircuitBreaker();

export async function searchJamendo(query: string, pageSize: number, page: number, env: Env): Promise<TrackBase[]> {
  if (breaker.isOpen()) return [];
  const clientId = env.JAMENDO_CLIENT_ID || "";
  const offset = (page - 1) * pageSize;
  const params = new URLSearchParams({
    client_id: clientId,
    format: "json",
    limit: String(pageSize),
    offset: String(offset),
    search: query,
    include: "audio+audiodownload+musicinfo+stats",
    order: "popularity_total_desc",
    audioformat: "mp31",
  });
  const url = `https://api.jamendo.com/v3.0/tracks/?${params.toString()}`;

  try {
    const data = await withRetries(() => fetchJson<JamendoResponse<JamendoTrackResult>>(url, { timeoutMs: 4500 }));
    breaker.success();
    const items = Array.isArray(data.results) ? data.results : [];
    return items.map((t): TrackBase => ({
      id: String(t.id),
      source: "jamendo",
      title: t.name || "",
      artist: t.artist_name || "",
      duration: Number(t.duration) || undefined,
      album: t.album_name || undefined,
      image: t.image || undefined,
      extra: { audio: t.audio || undefined, audiodownload: t.audiodownload || undefined },
      bitrate: 192, // heuristic mid-quality
    }));
  } catch (err) {
    breaker.failure();
    return [];
  }
}

export async function getJamendoTrack(id: string, env: Env): Promise<TrackBase | null> {
  if (breaker.isOpen()) return null;
  const clientId = env.JAMENDO_CLIENT_ID || "";
  const params = new URLSearchParams({
    client_id: clientId,
    format: "json",
    id: id,
    include: "audio+audiodownload+musicinfo+stats",
  });
  const url = `https://api.jamendo.com/v3.0/tracks/?${params.toString()}`;
  try {
    const data = await withRetries(() => fetchJson<JamendoResponse<JamendoTrackResult>>(url, { timeoutMs: 4500 }));
    breaker.success();
    const t = data.results && data.results[0];
    if (!t) return null;
    return {
      id: String(t.id),
      source: "jamendo",
      title: t.name || "",
      artist: t.artist_name || "",
      duration: Number(t.duration) || undefined,
      album: t.album_name || undefined,
      image: t.image || undefined,
      extra: { audio: t.audio || undefined, audiodownload: t.audiodownload || undefined },
      bitrate: 192,
    };
  } catch (err) {
    breaker.failure();
    return null;
  }
}

export async function getJamendoStream(track: TrackBase, env: Env): Promise<{ url: string } | null> {
  // Prefer the streaming audio URL; ensure client_id present is not required in audio url
  const audio = track.extra?.audio || track.extra?.audiodownload;
  if (audio) {
    return { url: audio };
  }
  // fallback to refetch
  const fetched = await getJamendoTrack(track.id, env);
  const url = fetched?.extra?.audio || fetched?.extra?.audiodownload;
  return url ? { url } : null;
}
