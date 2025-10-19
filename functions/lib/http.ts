// Lightweight HTTP helpers with timeout and retry.

export interface FetchRetryOptions {
  retries?: number;
  timeoutMs?: number;
  backoffMs?: number;
  retryOn?: number[]; // HTTP status codes to retry
}

export async function fetchWithTimeout(resource: string | Request, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(resource, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

export async function fetchWithRetry(resource: string | Request, init: RequestInit = {}, options: FetchRetryOptions = {}): Promise<Response> {
  const {
    retries = 2,
    timeoutMs = 8000,
    backoffMs = 300,
    retryOn = [408, 429, 500, 502, 503, 504],
  } = options;

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    try {
      const res = await fetchWithTimeout(resource, init, timeoutMs);
      if (!res.ok && retryOn.includes(res.status) && attempt < retries) {
        await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
        attempt += 1;
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw error;
      }
      await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
      attempt += 1;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("fetchWithRetry failed");
}
