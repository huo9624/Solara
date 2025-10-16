import { Buffer } from 'node:buffer';  // 静态导入，修复动态 require 错误

const encoder = new TextEncoder();

function timingSafeEqual(a, b) {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

export const onRequest = async (context) => {
  const { request, env } = context;
  const BASIC_USER = "admin";  // 用户名
  const BASIC_PASS = env.PASSWORD || "fallback";  // 从环境变量获取密码
  console.log("PASSWORD loaded:", !!BASIC_PASS ? "Yes" : "No");  // 调试日志

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return new Response("需要登录。", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="站点", charset="UTF-8"' }
    });
  }

  const [scheme, encoded] = authorization.split(" ");
  if (!encoded || scheme !== "Basic") {
    return new Response("无效授权。", { status: 400 });
  }

  const credentials = Buffer.from(encoded, "base64").toString("ascii");
  const index = credentials.indexOf(":");
  const user = credentials.substring(0, index);
  const pass = credentials.substring(index + 1);

  if (!timingSafeEqual(BASIC_USER, user) || !timingSafeEqual(BASIC_PASS, pass)) {
    return new Response("密码错误。", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="站点", charset="UTF-8"' }
    });
  }

  return fetch(request);  // 验证通过，放行
};