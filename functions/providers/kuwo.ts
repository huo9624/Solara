import type { Track, StreamInfo } from "../_types";
import { fetchWithRetry } from "../lib/http";

const API_BASE = "https://music-api.gdstudio.xyz/api.php";

function mapSongToTrack(song: any): Track {
  const title = String(song.name || song.title || "");
  const artistStr = Array.isArray(song.artist) ? song.artist.join(" / ") : String(song.artist || song.singer || "");
  const artists = artistStr ? artistStr.split(/[,/]|\s*\/\s*/).map((s: string) => s.trim()).filter(Boolean) : [];
  const track: Track = {
    id: String(song.id ?? song.url_id ?? song.songid ?? song.rid ?? title),
    title,
    artists,
    album: song.album || song.albumname || undefined,
    duration: Number(song.duration || song.dt || 0) / 1000 || undefined,
    coverUrl: song.pic || song.picUrl || song.pic_id ? `${API_BASE}?types=pic&id=${encodeURIComponent(song.pic_id || song.pic || song.picUrl)}&source=kuwo&size=300` : undefined,
    provider: "kuwo",
    providerTrackId: String(song.id || song.url_id || song.songid || song.rid || ""),
    isPlayable: true,
  };
  return track;
}

export const kuwoProvider = {
  id: "kuwo" as const,

  async search(query: string, page: number, pageSize: number): Promise<Track[]> {
    const params = new URLSearchParams({
      types: "search",
      source: "kuwo",
      name: query,
      count: String(pageSize),
      pages: String(page),
    });
    const url = `${API_BASE}?${params.toString()}`;
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, { retries: 1, timeoutMs: 5000 });
    const data = await res.json().catch(() => []);
    if (!Array.isArray(data)) return [];
    return data.map(mapSongToTrack);
  },

  async getTrack(id: string): Promise<Track | null> {
    // No direct track endpoint; validate by getting url
    const s = await this.getStream(id, "320").catch(() => null);
    if (!s) return null;
    return { id, title: id, artists: [], provider: "kuwo", isPlayable: true };
  },

  async getStream(id: string, quality: string): Promise<StreamInfo | null> {
    const params = new URLSearchParams({ types: "url", id, source: "kuwo", br: quality });
    const url = `${API_BASE}?${params.toString()}`;
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, { retries: 1, timeoutMs: 6000 });
    const data = await res.json().catch(() => null);
    if (!data || !data.url) return null;
    // For Kuwo, prefer proxying via /proxy target to handle http scheme
    return { url: String(data.url), provider: "kuwo", quality };
  },
};
