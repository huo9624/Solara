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
  const BASIC_PASS = env.PASSWORD || "fallback";  // 替换为你的密码
  console.log("PASSWORD loaded:", !!BASIC_PASS ? "Yes" : "No");

  // 强制检查所有请求（保护 /auth）
  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return new Response(`
      <html><head><title>需要登录</title></head><body>
        <h1>访问受保护的 /auth 页面</h1>
        <p>浏览器应弹出登录框。用户名: admin，密码: [你的密码]</p>
        <p>如果无弹出，检查浏览器设置。</p>
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
    return new Response("无效授权格式。", { status: 400 });
  }

  const credentials = atob(encoded);  // 原生 Base64 解码
  const index = credentials.indexOf(":");
  const user = credentials.substring(0, index);
  const pass = credentials.substring(index + 1);

  if (!timingSafeEqual(BASIC_USER, user) || !timingSafeEqual(BASIC_PASS, pass)) {
    return new Response(`
      <html><head><title>登录失败</title></head><body>
        <h1>用户名或密码错误</h1>
        <p>请重试。用户名: admin</p>
      </body></html>
    `, {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Sola站点", charset="UTF-8"' }
    });
  }

  // 成功：返回保护内容
  return new Response(`
    <html><head><title>成功</title></head><body>
      <h1>欢迎访问 /auth！</h1>
      <p>密码验证通过。这是受保护的内容。</p>
      <p>你可以在这里添加更多页面。</p>
    </body></html>
  `, { status: 200 });
};