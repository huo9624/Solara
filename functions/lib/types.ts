export type ProviderID = "jamendo" | "ia";

export interface Track {
  id: string;
  source: ProviderID;
  providerId: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  coverUrl?: string;
  year?: number;
  url?: string;
  popularity?: number;
  extra?: Record<string, unknown>;
}

export interface SearchParams {
  q: string;
  source: "all" | ProviderID;
  page: number;
  pageSize: number;
}

export interface SearchSuccessResponse {
  ok: true;
  params: SearchParams;
  total: number;
  results: Track[];
  took: number;
  providers?: Partial<Record<ProviderID, number>>;
  cache?: "HIT" | "MISS" | "KV_HIT";
}

export interface ApiErrorResponse {
  ok: false;
  error: string;
  message: string;
}
