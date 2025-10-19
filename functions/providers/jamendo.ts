import type { Env, StreamInfo, Track } from "../_types";
import { fetchWithRetry } from "../lib/http";

const JAMENDO_API = "https://api.jamendo.com/v3.0";

function mapJamendoTrack(it: any): Track {
  const title = String(it.name || it.title || "");
  const artist = String(it.artist_name || it.artist || it.user_name || "");
  const artists = artist ? [artist] : [];
  const cover = it.image || it.album_image || (it.album_id ? `https://cf.jamendo.com/?type=album&id=${it.album_id}&width=300` : undefined);
  const duration = Number(it.duration || it.audio_duration || 0) || undefined;
  return {
    id: String(it.id || it.track_id || it.audio_id || title),
    title,
    artists,
    album: it.album_name || undefined,
    duration,
    coverUrl: cover,
    provider: "jamendo",
    isPlayable: Boolean(it.audio || it.audiodownload)
  };
}

export const jamendoProvider = {
  id: "jamendo" as const,

  async search(query: string, page: number, pageSize: number, env?: Env): Promise<Track[]> {
    const clientId = env?.JAMENDO_CLIENT_ID || "";
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: String(Math.max(1, Math.min(pageSize, 50))),
      offset: String(Math.max(0, (page - 1) * pageSize)),
      search: query,
      fuzzysearch: "true",
      include: "musicinfo+stats",
      order: "popularity_total_desc",
    });
    const url = `${JAMENDO_API}/tracks/?${params.toString()}`;
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, { retries: 1, timeoutMs: 7000 });
    const data = await res.json().catch(() => null);
    const list = data && Array.isArray(data.results) ? data.results : [];
    return list.map(mapJamendoTrack);
  },

  async getTrack(id: string, env?: Env): Promise<Track | null> {
    const clientId = env?.JAMENDO_CLIENT_ID || "";
    const params = new URLSearchParams({ client_id: clientId, format: "json", id });
    const url = `${JAMENDO_API}/tracks/?${params.toString()}`;
    const res = await fetchWithRetry(url, {}, { retries: 1, timeoutMs: 6000 });
    const data = await res.json().catch(() => null);
    const list = data && Array.isArray(data.results) ? data.results : [];
    if (!list.length) return null;
    return mapJamendoTrack(list[0]);
  },

  async getStream(id: string, quality: string, env?: Env): Promise<StreamInfo | null> {
    const clientId = env?.JAMENDO_CLIENT_ID || "";
    const params = new URLSearchParams({ client_id: clientId, format: "json", id });
    const url = `${JAMENDO_API}/tracks/?${params.toString()}`;
    const res = await fetchWithRetry(url, {}, { retries: 1, timeoutMs: 6000 });
    const data = await res.json().catch(() => null);
    const list = data && Array.isArray(data.results) ? data.results : [];
    if (!list.length) return null;
    const item = list[0];
    const streamUrl = item.audio || item.audiodownload || null;
    if (!streamUrl) return null;
    return { url: String(streamUrl), provider: "jamendo", format: "mp3", quality: quality || "mp3" };
  },
};
