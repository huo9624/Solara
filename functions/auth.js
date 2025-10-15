// 导入 Node.js Buffer（Cloudflare Functions 支持 nodejs_compat 标志）
const { Buffer } = require('node:buffer');  // 或 import { Buffer } from "node:buffer"; 如果用 ESM

// 创建文本编码器，用于安全字符串比较
const encoder = new TextEncoder();

// 安全比较函数：防止定时攻击（攻击者通过响应时间猜测密码）
function timingSafeEqual(a, b) {
  const aBytes = encoder.encode(a);  // 将字符串 a 转为字节数组
  const bBytes = encoder.encode(b);  // 将字符串 b 转为字节数组
  if (aBytes.byteLength !== bBytes.byteLength) {  // 长度不等，直接失败
    return false;
  }
  // 使用 Web Crypto API 进行恒时比较（避免侧信道攻击）
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

// Functions 入口函数：处理每个请求
export const onRequest = async (context) => {
  const { request, env } = context;  // 解构上下文：request 是 HTTP 请求，env 是环境变量
  const BASIC_USER = "admin";  // 固定用户名（可自定义，如 "user"）
  const BASIC_PASS = env.PASSWORD || "fallback_password";  // 从环境变量获取密码；fallback 用于测试（生产中移除）
  
  // 调试日志：输出到 Cloudflare 日志（浏览器 F12 Console 或仪表板 Logs 查看）
  console.log("PASSWORD loaded from env:", !!BASIC_PASS ? "Yes" : "No");

  // 检查请求头中的 Authorization（浏览器登录框会自动添加）
  const authorization = request.headers.get("Authorization");
  if (!authorization) {  // 无授权头，返回 401 错误，触发浏览器登录框
    return new Response("请登录访问此站点。", {  // 自定义错误消息
      status: 401,
      headers: {  // WWW-Authenticate 头告诉浏览器弹出 Basic Auth 框
        "WWW-Authenticate": 'Basic realm="我的站点", charset="UTF-8"'
      }
    });
  }

  // 解析授权头：Basic <base64(username:password)>
  const [scheme, encoded] = authorization.split(" ");
  if (!encoded || scheme !== "Basic") {  // 必须是 Basic 方案
    return new Response("无效的认证格式。", { status: 400 });
  }

  // 解码 Base64 凭据
  const credentials = Buffer.from(encoded, "base64").toString("ascii");
  const index = credentials.indexOf(":");  // 分割 username:password
  const user = credentials.substring(0, index);  // 提取用户名
  const pass = credentials.substring(index + 1);  // 提取密码

  // 验证用户名和密码（使用安全比较）
  if (!timingSafeEqual(BASIC_USER, user) || !timingSafeEqual(BASIC_PASS, pass)) {
    return new Response("用户名或密码错误。", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="我的站点", charset="UTF-8"' }
    });
  }

  // 验证通过：转发原始请求到静态内容（fetch Pages 内部资源）
  return fetch(request);
};