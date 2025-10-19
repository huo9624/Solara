import { TrackBase, withRetries, fetchJson } from "../lib/utils";

const API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";

export async function searchKuwo(query: string, pageSize: number, page: number): Promise<TrackBase[]> {
  const params = new URLSearchParams({
    types: "search",
    source: "kuwo",
    name: query,
    count: String(pageSize),
    pages: String(page),
  });
  const url = `${API_BASE_URL}?${params.toString()}`;
  try {
    const data = await withRetries(() => fetchJson<any[]>(url, { timeoutMs: 5000 }));
    if (!Array.isArray(data)) return [];
    return data.map((s: any): TrackBase => ({
      id: String(s.id),
      source: "kuwo",
      title: s.name || "",
      artist: Array.isArray(s.artist) ? s.artist.join(", ") : (s.artist || ""),
      duration: undefined,
      album: s.album || undefined,
      image: s.pic_id ? `${API_BASE_URL}?types=pic&id=${encodeURIComponent(s.pic_id)}&source=kuwo&size=300` : undefined,
      bitrate: 192,
      extra: { url_id: s.url_id, lyric_id: s.lyric_id },
    }));
  } catch (err) {
    return [];
  }
}
