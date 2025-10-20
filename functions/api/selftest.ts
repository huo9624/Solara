interface SelfTestResponse {
  ok: boolean;
  elapsed: number;
}

function jsonResponse(body: SelfTestResponse, request: Request, init: ResponseInit = {}): Response {
  const url = new URL(request.url);
  const origin = url.origin;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Vary", "Origin");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function handleOptions(request: Request): Response {
  const url = new URL(request.url);
  const origin = url.origin;
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  });
}

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const start = Date.now();
  // Perform minimal work to ensure the function path is active.
  // Do not touch environment variables or external services.
  // This endpoint only reports a boolean status and the handler latency.
  const elapsed = Math.max(0, Date.now() - start);

  if (request.method === "HEAD") {
    return jsonResponse({ ok: true, elapsed }, request);
  }

  return jsonResponse({ ok: true, elapsed }, request, { status: 200 });
}
