export type ProviderId = "gd" | "kuwo" | "jamendo" | "ia";

export interface Track {
  id: string;
  title: string;
  artists: string[];
  album?: string;
  duration?: number; // seconds
  coverUrl?: string;
  provider: ProviderId;
  providerTrackId?: string; // raw id if different from id
  isPlayable?: boolean;
  // Optional metadata for ranking
  popularity?: number;
}

export interface StreamInfo {
  url: string;
  format?: string; // e.g. mp3, flac
  bitrateKbps?: number;
  quality?: string; // 128/192/320/999 or textual
  headers?: Record<string, string>;
  // For some providers it may be time-limited
  expiresAt?: number; // epoch ms
  provider: ProviderId;
}

// Cloudflare bindings
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  JAMENDO_CLIENT_ID: string;
  MUSIC_CACHE: KVNamespace;
}

export interface SearchParams {
  query: string;
  page: number;
  pageSize: number;
  providers: ProviderId[];
}

export interface ErrorResponse {
  code: string;
  message: string;
}
