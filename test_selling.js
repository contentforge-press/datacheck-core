/**
 * 销售引擎测试
 */
"use strict";

const s = require("./selling.js");

let PASS = 0, FAIL = 0;
const FAILURES = [];

function check(name, cond, detail) {
  if (cond) {
    PASS++;
    console.log(`  PASS  ${name}`);
  } else {
    FAIL++;
    FAILURES.push([name, detail || ""]);
    console.log(`  FAIL  ${name}  ${detail || ""}`);
  }
}

console.log("=".repeat(70));
console.log("销售引擎测试");
console.log("=".repeat(70));

// 生成一个测试许可
const crypto = require("crypto");
function makeLicense(plan, email, days) {
  const SIG_LEN = 16;
  const secret = "dvq-public-verify-2026";
  const emailB64 = Buffer.from(email).toString("base64").replace(/=+$/, "");
  const exp = new Date(Date.now() + days * 86400000);
  const expires =
    exp.getUTCFullYear().toString() +
    String(exp.getUTCMonth() + 1).padStart(2, "0") +
    String(exp.getUTCDate()).padStart(2, "0");
  const payload = `${plan}.${emailB64}.${expires}`;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")
    .slice(0, SIG_LEN);
  return `DVC-${plan}-${emailB64}-${expires}-${sig}`;
}

// ============================================================
console.log("\n[1] 许可验证");
const key = makeLicense("pro", "buyer@example.com", 365);
const lic = s.verifyLicense(key);
check("Pro 许可有效", lic.valid, JSON.stringify(lic));
check("Plan 正确", lic.plan === "pro", lic.plan);
check("Email 解析", lic.email === "buyer@example.com", lic.email);

const expired = makeLicense("pro", "x@y.com", -1);
const lic2 = s.verifyLicense(expired);
check("过期许可被拒", !lic2.valid && lic2.reason === "expired", lic2.reason);

const fake = "DVC-pro-YnV5ZXJAZXhhbXBsZS5jb20-20991231-deadbeefdeadbeef";
const lic3 = s.verifyLicense(fake);
check("伪造许可被拒", !lic3.valid, lic3.reason);

check("空 key 被拒", !s.verifyLicense("").valid);
check("乱码 key 被拒", !s.verifyLicense("hello").valid);

// ============================================================
console.log("\n[2] 用量检查");
const user = { valid: false, plan: "free" };

// 小文件
const u1 = s.checkUsage(user, "n8n", 500);
check("免费小文件可用", u1.allowed, u1.reason);

// 大文件
const u2 = s.checkUsage(user, "n8n", 50000);
check("免费大文件被拦", !u2.allowed, u2.reason);
check("拦截提示存在", u2.shouldUpsell && u2.upsellMessage.length > 20);
check("拦截带升级链接", u2.checkout.includes("dodopayments"), u2.checkout);
check("链接带归因", u2.checkout.includes("ref=n8n-node"), u2.checkout);

// Pro 用户
const u3 = s.checkUsage(lic, "n8n", 1000000);
check("Pro 大文件可用", u3.allowed, u3.reason);

// ============================================================
console.log("\n[3] 归因");
for (const ch of ["n8n", "cli", "mcp", "extension"]) {
  const a = s.attribution(ch);
  check(`归因 ${ch}`, a.channel === s.CHANNELS[ch], JSON.stringify(a));
}

// ============================================================
console.log("\n[4] 升级文案");
for (const ch of ["n8n", "cli", "mcp"]) {
  const t = s.upsellText(ch);
  check(`${ch} 文案存在`, t.length > 100, `len=${t.length}`);
  check(`${ch} 文案有链接`, t.includes("dodopayments"), "");
  check(`${ch} 文案带归因`, t.includes(`ref=${s.CHANNELS[ch]}`), "");
}

// n8n 文案应该提到具体功能
const n8nText = s.upsellText("n8n");
check("n8n 文案提到跨表", n8nText.includes("Cross-table"), "");
check("n8n 文案提到告警", n8nText.includes("Alerts"), "");
check("n8n 文案提到行数", n8nText.includes("5M"), "");

// ============================================================
console.log("\n[5] 计费链接");
const url = s.checkoutUrl("n8n", "pro");
check("Pro 链接正确", url.includes("pdt_0Nq62Ecr9PnrPukjAEhaM"), url);
check("Report 链接正确",
  s.checkoutUrl("n8n", "report").includes("pdt_0Nq63a5zRdQV94lR1uRQo"), "");

// ============================================================
console.log("\n[6] 状态持久化");
const st = s.loadState();
check("能读状态", typeof st === "object", typeof st);
check("状态有 usage 或为空", !st.usage || typeof st.usage === "object", "");

console.log("\n" + "=".repeat(70));
console.log(`结果: ${PASS} 通过, ${FAIL} 失败`);
console.log("=".repeat(70));

if (FAILURES.length) {
  console.log("\n失败:");
  for (const [n, d] of FAILURES) console.log(`  · ${n}: ${d}`);
}

console.log("\n" + "=".repeat(70));
console.log("样例：n8n 渠道升级文案");
console.log("=".repeat(70));
console.log(s.upsellText("n8n"));

process.exit(FAIL === 0 ? 0 : 1);
