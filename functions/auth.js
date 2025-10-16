const encoder = new TextEncoder();

function timingSafeEqual(a, b) {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

export const onRequest = async (context) => {
  const { request, env } = context;
  const BASIC_USER = "admin";
  const BASIC_PASS = env.PASSWORD || "fallback";  // 环境变量密码
  console.log("PASSWORD loaded:", !!BASIC_PASS ? "Yes" : "No");

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return new Response(`
      <html><head><title>需要登录</title></head><body>
        <h1>访问受保护页面</h1><p>请在浏览器弹出框输入用户名和密码。</p>
      </body></html>
    `, {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Sola站点", charset="UTF-8"',
        "Content-Type": "text/html"
      }
    });
  }

  const [scheme, encoded] = authorization.split(" ");
  if (!encoded || scheme !== "Basic") {
    return new Response("无效授权。", { status: 400 });
  }

  // 用原生 atob 解码（无需 Buffer）
  const credentials = atob(encoded);
  const index = credentials.indexOf(":");
  const user = credentials.substring(0, index);
  const pass = credentials.substring(index + 1);

  if (!timingSafeEqual(BASIC_USER, user) || !timingSafeEqual(BASIC_PASS, pass)) {
    return new Response(`
      <html><head><title>登录失败</title></head><body>
        <h1>用户名或密码错误</h1><p>请重试。</p>
      </body></html>
    `, {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Sola站点", charset="UTF-8"' }
    });
  }

  // 验证通过，返回自定义成功页（或 fetch）
  return new Response(`
    <html><head><title>成功</title></head><body>
      <h1>欢迎！</h1><p>密码验证通过。这是受保护的内容。</p>
    </body></html>
  `, { status: 200 });
};