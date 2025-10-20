import type { StreamInfo, Track } from "../_types";
import { fetchWithRetry } from "../lib/http";

const IA_ADVANCED = "https://archive.org/advancedsearch.php";

function mapIAToTrack(doc: any): Track {
  const title = String(doc.title || "");
  const creator = Array.isArray(doc.creator) ? doc.creator[0] : String(doc.creator || doc.artist || "");
  const artists = creator ? [creator] : [];
  return {
    id: String(doc.identifier || title),
    title,
    artists,
    album: undefined,
    duration: undefined,
    coverUrl: doc.identifier ? `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}` : undefined,
    provider: "ia",
    isPlayable: Array.isArray(doc.format) ? doc.format.some((f: string) => /MP3|OGG|FLAC/i.test(f)) : false,
  };
}

async function fetchIAMetadata(identifier: string): Promise<any | null> {
  const url = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
  const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, { retries: 1, timeoutMs: 6000 });
  const data = await res.json().catch(() => null);
  return data;
}

export const iaProvider = {
  id: "ia" as const,

  async search(query: string, page: number, pageSize: number): Promise<Track[]> {
    const params = new URLSearchParams({
      q: `(${query}) AND mediatype:(audio)`,
      output: "json",
      rows: String(pageSize),
      page: String(page),
      "fl[]": ["identifier", "title", "creator", "format", "downloads"].join("&fl[]="),
      sort: ["downloads desc", "avg_rating desc"].join(","),
    });
    const url = `${IA_ADVANCED}?${params.toString()}`;
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, { retries: 1, timeoutMs: 7000 });
    const data = await res.json().catch(() => null);
    const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];
    return docs.map(mapIAToTrack);
  },

  async getTrack(id: string): Promise<Track | null> {
    const meta = await fetchIAMetadata(id);
    if (!meta) return null;
    const title = String(meta.metadata?.title || id);
    const creator = String(meta.metadata?.creator || meta.metadata?.artist || "");
    const artists = creator ? [creator] : [];
    const files = Array.isArray(meta.files) ? meta.files : [];
    // Try best-effort to guess a duration
    const dur = files.map((f: any) => parseLength(f.length)).filter(Boolean)[0] || undefined;
    return {
      id,
      title,
      artists,
      album: meta.metadata?.album || undefined,
      duration: dur,
      coverUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
      provider: "ia",
      isPlayable: files.some((f: any) => /\.(mp3|ogg|flac)$/i.test(f.name || "")),
    };
  },

  async getStream(id: string): Promise<StreamInfo | null> {
    const meta = await fetchIAMetadata(id);
    if (!meta) return null;
    const files = Array.isArray(meta.files) ? meta.files : [];
    const preferred = files.find((f: any) => /\.(mp3)$/i.test(f.name || ""))
      || files.find((f: any) => /\.(ogg)$/i.test(f.name || ""))
      || files.find((f: any) => /\.(flac)$/i.test(f.name || ""));
    if (!preferred) return null;
    const url = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(preferred.name)}`;
    const fmt = (preferred.format || "").toLowerCase().includes("mp3") ? "mp3" : /ogg/.test(preferred.format || "") ? "ogg" : /flac/.test(preferred.format || "") ? "flac" : undefined;
    return { url, provider: "ia", format: fmt };
  },
};

function parseLength(length: any): number | null {
  if (!length) return null;
  if (typeof length === "number" && Number.isFinite(length)) return length;
  if (typeof length === "string") {
    // try mm:ss
    const m = length.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (m) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const hours = Number(m[3] || 0);
      return hours * 3600 + min * 60 + sec;
    }
    const n = Number(length);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
