import type { Env, ProviderId } from "../_types";
import { gdProvider } from "./gd";
import { kuwoProvider } from "./kuwo";
import { jamendoProvider } from "./jamendo";
import { iaProvider } from "./ia";

export const providers = {
  gd: gdProvider,
  kuwo: kuwoProvider,
  jamendo: jamendoProvider,
  ia: iaProvider,
} as const;

export type ProviderMap = typeof providers;

export function resolveProvider(id: string | null | undefined) {
  if (!id) return null;
  const key = id.toLowerCase() as ProviderId;
  return (providers as any)[key] || null;
}

export type Provider = ReturnType<typeof resolveProvider>;

export interface ProviderSearchOptions {
  query: string;
  page: number;
  pageSize: number;
}
