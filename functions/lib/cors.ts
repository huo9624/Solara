export function getAllowedOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null; // Non-CORS request
  try {
    const reqOrigin = new URL(request.url).origin;
    // Only allow same-origin requests by default
    if (origin === reqOrigin) return origin;
  } catch {
    // ignore
  }
  return null;
}

export function buildCorsHeaders(request: Request, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const allowed = getAllowedOrigin(request);
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", allowed);
    headers.set("Vary", "Origin");
  }
  return headers;
}

export function handleCorsOptions(request: Request, allowMethods = "GET,OPTIONS", allowHeaders = "Content-Type"): Response {
  const headers = new Headers();
  const allowed = getAllowedOrigin(request);
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", allowed);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", allowMethods);
  headers.set("Access-Control-Allow-Headers", allowHeaders);
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers });
}
