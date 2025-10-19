import { Env, TrackBase, fetchJson, withRetries, createCircuitBreaker } from "../lib/utils";

interface IAAdvancedDoc {
  identifier: string;
  title?: string;
  creator?: string;
  downloads?: number;
  licenseurl?: string;
}

interface IAAdvancedResponse {
  response: {
    numFound: number;
    start: number;
    docs: IAAdvancedDoc[];
  };
}

interface IAMetadataFile {
  name: string;
  format?: string;
  length?: string | number; // length in seconds or HH:MM:SS
}

interface IAMetadataResponse {
  metadata: Record<string, any>;
  files: IAMetadataFile[];
  d1?: string;
  d2?: string;
}

const breaker = createCircuitBreaker();

function parseLength(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value) return undefined;
  const parts = value.split(":").map(n => Number(n));
  if (parts.some(n => !Number.isFinite(n))) return undefined;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return Number(value) || undefined;
}

function pickBestAudioFile(files: IAMetadataFile[]): IAMetadataFile | null {
  if (!Array.isArray(files)) return null;
  const priorities = [
    (f: IAMetadataFile) => /\bVBR MP3\b/i.test(f.format || "") || /\b192Kbps\b/i.test(f.format || ""),
    (f: IAMetadataFile) => /\b128Kbps\b/i.test(f.format || ""),
    (f: IAMetadataFile) => /\bMP3\b/i.test(f.format || ""),
    (f: IAMetadataFile) => /\bOgg\b/i.test(f.format || ""),
  ];
  for (const test of priorities) {
    const match = files.find(test);
    if (match) return match;
  }
  // fallback first audio-ish extension
  const match = files.find(f => /\.(mp3|ogg|flac|wav)$/i.test(f.name));
  return match || null;
}

export async function searchIA(query: string, pageSize: number, page: number): Promise<TrackBase[]> {
  if (breaker.isOpen()) return [];
  const offset = (page - 1) * pageSize;
  const qParts = [
    'mediatype:(audio) AND (licenseurl:(*creativecommons* OR *publicdomain* OR *public domain*))',
    `AND (title:("${query}") OR creator:("${query}") OR description:("${query}"))`,
    'AND (format:("VBR MP3" OR MP3 OR Ogg))',
  ];
  const params = new URLSearchParams({
    q: qParts.join(" "),
    output: "json",
    rows: String(pageSize),
    start: String(offset),
  });
  // Sort by downloads desc
  params.append("sort[]", "downloads desc");
  const url = `https://archive.org/advancedsearch.php?${params.toString()}`;
  try {
    const data = await withRetries(() => fetchJson<IAAdvancedResponse>(url, { timeoutMs: 5000 }));
    breaker.success();
    const docs = data?.response?.docs || [];
    return docs.map((d): TrackBase => ({
      id: d.identifier,
      source: "ia",
      title: d.title || d.identifier,
      artist: d.creator || "",
      duration: undefined,
      album: undefined,
      image: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
      bitrate: 128,
      extra: {},
    }));
  } catch (err) {
    breaker.failure();
    return [];
  }
}

export async function getIATrack(id: string): Promise<TrackBase | null> {
  if (breaker.isOpen()) return null;
  const metaUrl = `https://archive.org/metadata/${encodeURIComponent(id)}`;
  try {
    const meta = await withRetries(() => fetchJson<IAMetadataResponse>(metaUrl, { timeoutMs: 6000 }));
    breaker.success();
    const best = pickBestAudioFile(meta.files || []);
    const duration = parseLength(best?.length);
    let title = meta.metadata?.title || id;
    const artist = meta.metadata?.creator || "";
    if (best && /\.(mp3|ogg|flac|wav)$/i.test(best.name)) {
      // keep title as is
    }
    return {
      id,
      source: "ia",
      title,
      artist,
      duration,
      image: `https://archive.org/services/img/${encodeURIComponent(id)}`,
      bitrate: /\bVBR MP3\b/i.test(best?.format || "") ? 192 : /\b128Kbps\b/i.test(best?.format || "") ? 128 : 128,
      extra: { file: best?.name, format: best?.format },
    };
  } catch (err) {
    breaker.failure();
    return null;
  }
}

export async function getIAStream(track: TrackBase): Promise<{ url: string } | null> {
  const fileName = track.extra?.file;
  if (!fileName) {
    const t = await getIATrack(track.id);
    if (!t || !t.extra?.file) return null;
    return { url: `https://archive.org/download/${encodeURIComponent(t.id)}/${encodeURIComponent(t.extra.file)}` };
  }
  return { url: `https://archive.org/download/${encodeURIComponent(track.id)}/${encodeURIComponent(fileName)}` };
}
