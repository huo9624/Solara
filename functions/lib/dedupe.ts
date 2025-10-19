import type { Track } from "../_types";

function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[`~!@#$%^&*()_+\-=\[\]{};:'"\\|,.<>/?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArtists(artists: string[]): string {
  return artists.map(a => normalize(a)).filter(Boolean).join(",");
}

function roundDuration(duration?: number): number {
  if (!duration || !Number.isFinite(duration)) return 0;
  return Math.round(Number(duration));
}

function fingerprint(track: Track): string {
  const title = normalize(track.title);
  const artists = normalizeArtists(track.artists || []);
  const dur = roundDuration(track.duration);
  return `${title}|${artists}|${dur}`;
}

export function dedupeTracks(tracks: Track[]): Track[] {
  const map = new Map<string, Track>();
  for (const t of tracks) {
    const key = fingerprint(t);
    if (!map.has(key)) {
      map.set(key, t);
      continue;
    }
    const existing = map.get(key)!;
    // Prefer one with cover, then with duration, then earlier in list
    const existingScore = (existing.coverUrl ? 1 : 0) + (existing.duration ? 1 : 0) + (existing.popularity || 0);
    const newScore = (t.coverUrl ? 1 : 0) + (t.duration ? 1 : 0) + (t.popularity || 0);
    if (newScore > existingScore) {
      map.set(key, t);
    }
  }
  return Array.from(map.values());
}
