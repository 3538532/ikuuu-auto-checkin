import { appendFileSync } from "fs";

// 域名：优先 HOST 环境变量，缺省 ikuuu.top
const host = (process.env.HOST || "ikuuu.top").trim() || "ikuuu.top";
const baseUrl = `https://${host}`;
const checkInUrl = `${baseUrl}/user/checkin`;

// 站点有 WAF/极验，Node 默认 UA 容易被拦，这里伪装成浏览器
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// 只保留可读片段，避免日志刷屏
function snippet(text, max = 180) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, max);
}

// 签到
async function checkIn(account) {
  const response = await fetch(checkInUrl, {
    method: "POST",
    redirect: "follow", // 默认行为，这里显式写出来，便于理解 302 会被跟随
    headers: {
      Cookie: account.cookie,
      "User-Agent": USER_AGENT,
      Referer: `${baseUrl}/user`,
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  const trimmed = body.trim();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}；final=${response.url}；content-type=${contentType || "空"}；片段：${snippet(body)}`
    );
  }

  if (!trimmed) {
    throw new Error(
      `接口返回空内容；final=${response.url}；status=${response.status}；content-type=${contentType || "空"}`
    );
  }

  // 注意：本站成功时也会用 text/html 返回 JSON，因此只按正文判断，不看 content-type。
  // 正文以 < 开头基本等于：Cookie 失效被重定向到登录页，或被 WAF 拦截。
  if (trimmed.startsWith("<") || /<!doctype|<html/i.test(trimmed.slice(0, 300))) {
    throw new Error(
      `接口返回了 HTML 页面（通常是 Cookie 已失效被跳转到登录页，或请求被站点拦截），请重新获取 Cookie 更新 ACCOUNTS；final=${response.url}；content-type=${contentType || "空"}；片段：${snippet(body)}`
    );
  }

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `JSON 解析失败 - ${error.message}；final=${response.url}；content-type=${contentType || "空"}；片段：${snippet(body)}`
    );
  }

  const msg = data.msg || data.message || JSON.stringify(data);
  console.log(`${account.name}: ${msg}`);

  return msg;
}

// 处理
async function processSingleAccount(account) {
  const checkInResult = await checkIn(account);

  return checkInResult;
}

function setGitHubOutput(name, value) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<EOF\n${value}\nEOF\n`);
}

// 入口
async function main() {
  console.log(`目标站点: ${checkInUrl}`);
  console.log(
    `HOST 环境变量: ${process.env.HOST ? `"${process.env.HOST}"` : "(未设置，使用默认值 ikuuu.top)"}`
  );

  let accounts;

  try {
    if (!process.env.ACCOUNTS) {
      throw new Error("❌ 未配置账户信息。");
    }

    accounts = JSON.parse(process.env.ACCOUNTS);

    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error("❌ 账户信息配置格式错误。应为数组，例如 [{\"name\":\"ikuuu\",\"cookie\":\"uid=...; key=...\"}]");
    }

    accounts.forEach((account, index) => {
      if (!account || typeof account.cookie !== "string" || !account.cookie.trim()) {
        throw new Error(`❌ 第 ${index + 1} 个账户缺少 cookie 字段。`);
      }
      if (!account.name) {
        account.name = `账户${index + 1}`;
      }
    });
  } catch (error) {
    const message = error.message.includes("JSON")
      ? "❌ 账户信息配置格式错误（ACCOUNTS 不是合法 JSON）。"
      : error.message;
    console.error(message);
    setGitHubOutput("result", message);
    process.exit(1);
  }

  const allPromises = accounts.map((account) => processSingleAccount(account));
  const results = await Promise.allSettled(allPromises);

  const msgHeader = "\n======== 签到结果 ========\n";
  console.log(msgHeader);

  let hasError = false;

  const resultLines = results.map((result, index) => {
    const accountName = accounts[index].name;

    const isSuccess = result.status === "fulfilled";

    if (!isSuccess) {
      hasError = true;
    }

    const icon = isSuccess ? "✅" : "❌";
    const message = isSuccess ? result.value : result.reason.message;

    const line = `${accountName}: ${icon} ${message}`;

    isSuccess ? console.log(line) : console.error(line);

    return line;
  });

  const resultMsg = resultLines.join("\n");

  setGitHubOutput("result", resultMsg);

  if (hasError) {
    process.exit(1);
  }
}

main();
