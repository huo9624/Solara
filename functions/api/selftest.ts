interface StepResult {
  ok: boolean;
  ms: number;
  error?: string;
}

interface SelfTestResult {
  ok: boolean;
  ms: number;
  source: string;
  keyword: string;
  quality: string;
  steps: {
    search: StepResult & { count?: number };
    track: StepResult & { hasLyric?: boolean };
    stream: StepResult & { hasUrl?: boolean; urlHost?: string };
  };
}

function corsJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function pick<T>(value: T | null | undefined, fallback: T): T {
  return value == null ? fallback : value;
}

function now(): number {
  return Date.now();
}

function ms(start: number): number {
  return Math.max(0, now() - start);
}

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }
  if (request.method !== "GET") {
    return corsJson({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  const source = pick(url.searchParams.get("source"), "netease");
  const keyword = pick(url.searchParams.get("keyword"), "love");
  const quality = pick(url.searchParams.get("quality"), "320");

  const overallStart = now();

  const steps: SelfTestResult["steps"] = {
    search: { ok: false, ms: 0 },
    track: { ok: false, ms: 0 },
    stream: { ok: false, ms: 0 },
  };

  let firstSong: any = null;

  // Step 1: search
  try {
    const s = now();
    const searchUrl = new URL("/proxy", origin);
    searchUrl.searchParams.set("types", "search");
    searchUrl.searchParams.set("source", source);
    searchUrl.searchParams.set("name", keyword);
    searchUrl.searchParams.set("count", "3");
    searchUrl.searchParams.set("pages", "1");
    searchUrl.searchParams.set("s", Math.random().toString(36).slice(2));

    const res = await fetch(searchUrl.toString(), { headers: { Accept: "application/json" } });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const list = Array.isArray(data) ? data : [];
    steps.search = { ok: list.length > 0, ms: ms(s), count: list.length };
    if (list.length > 0) {
      firstSong = list[0];
    } else {
      throw new Error("Empty search result");
    }
  } catch (error: any) {
    steps.search.ok = false;
    steps.search.error = String(error?.message || error || "Search failed");
    steps.search.ms = steps.search.ms || ms(now());
  }

  // Step 2: track (lyric as a lightweight detail check)
  if (firstSong && steps.search.ok) {
    try {
      const s = now();
      const lyricUrl = new URL("/proxy", origin);
      lyricUrl.searchParams.set("types", "lyric");
      lyricUrl.searchParams.set("id", String(firstSong.lyric_id || firstSong.id));
      lyricUrl.searchParams.set("source", String(firstSong.source || source));
      lyricUrl.searchParams.set("s", Math.random().toString(36).slice(2));

      const res = await fetch(lyricUrl.toString(), { headers: { Accept: "application/json" } });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const hasLyric = Boolean(data && (data.lyric || data.lrc));
      steps.track = { ok: hasLyric, ms: ms(s), hasLyric } as any;
      if (!hasLyric) {
        throw new Error("Lyric missing");
      }
    } catch (error: any) {
      steps.track.ok = false;
      steps.track.error = String(error?.message || error || "Track failed");
      steps.track.ms = steps.track.ms || ms(now());
    }
  } else {
    steps.track.ok = false;
    steps.track.error = steps.search.error || "Search step failed";
  }

  // Step 3: stream (get playable url)
  if (firstSong && steps.search.ok) {
    try {
      const s = now();
      const urlReq = new URL("/proxy", origin);
      urlReq.searchParams.set("types", "url");
      urlReq.searchParams.set("id", String(firstSong.url_id || firstSong.id));
      urlReq.searchParams.set("source", String(firstSong.source || source));
      urlReq.searchParams.set("br", quality);
      urlReq.searchParams.set("s", Math.random().toString(36).slice(2));

      const res = await fetch(urlReq.toString(), { headers: { Accept: "application/json" } });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const urlStr: string | null = data && typeof data.url === "string" ? data.url : null;
      const hasUrl = Boolean(urlStr && urlStr.trim());
      let urlHost: string | undefined;
      if (hasUrl) {
        try {
          const parsed = new URL(urlStr!);
          urlHost = parsed.hostname;
        } catch {
          // ignore parse error
        }
      }
      steps.stream = { ok: hasUrl, ms: ms(s), hasUrl, urlHost } as any;
      if (!hasUrl) {
        throw new Error("Stream URL missing");
      }
    } catch (error: any) {
      steps.stream.ok = false;
      steps.stream.error = String(error?.message || error || "Stream failed");
      steps.stream.ms = steps.stream.ms || ms(now());
    }
  } else {
    steps.stream.ok = false;
    steps.stream.error = steps.search.error || "Search step failed";
  }

  const result: SelfTestResult = {
    ok: Boolean(steps.search.ok && steps.track.ok && steps.stream.ok),
    ms: ms(overallStart),
    source,
    keyword,
    quality,
    steps,
  };

  return corsJson(result);
}
