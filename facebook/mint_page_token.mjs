// ดึง Page Access Token ใหม่ผ่าน Graph API Explorer โดยเกาะ Chrome ที่ user เปิดไว้ (:9222)
//
// วิธีทำงาน: เกาะ CDP -> เปิด Graph API Explorer -> คอย "ดักจับ" token ที่ขึ้นต้นด้วย EAA
// ในหน้าเว็บ -> ตรวจว่าเป็น PAGE token ของเพจเราจริง + มีสิทธิ์อ่าน conversations
// (pages_messaging) -> เขียนทับ FACEBOOK_ACCESS_TOKEN ใน .env
//
// SAFE: สคริปต์ไม่ยุ่งกับรหัสผ่าน/consent ของ user — แค่ "อ่าน" token ที่ปรากฏหลังจาก
// user กดยืนยันเอง. (Over CDP, browser.close() = detach เท่านั้น ไม่ปิด Chrome จริง)

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";

const CDP = process.env.FB_CDP_URL || "http://127.0.0.1:9222";
const ENV_PATH = "D:/Project/fb-mcp/.env";
const GRAPH = "v22.0";
const EXPLORER = "https://developers.facebook.com/tools/explorer/";
const WAIT_MS = 240_000; // รอ user กด Get Page Access Token + consent สูงสุด 4 นาที
const POLL_MS = 2500;

const env = readFileSync(ENV_PATH, "utf8");
const PAGE_ID = env.match(/^FACEBOOK_PAGE_ID=(.*)$/m)?.[1].trim();
if (!PAGE_ID) { console.error("ไม่พบ FACEBOOK_PAGE_ID ใน .env"); process.exit(1); }

const tokenRe = /EAA[A-Za-z0-9]{20,}/g;

// ตรวจว่า token นี้คือ PAGE token ของเพจเรา + มีสิทธิ์อ่าน conversations หรือไม่
async function classify(token) {
  const me = await (await fetch(`https://graph.facebook.com/${GRAPH}/me?fields=id,name&access_token=${token}`)).json();
  if (me.error) return { ok: false, why: me.error.message };
  const isPage = String(me.id) === String(PAGE_ID);
  if (!isPage) return { ok: false, why: `เป็น token ของ "${me.name}" (id ${me.id}) ไม่ใช่เพจ ${PAGE_ID} — เลือก Get Page Access Token แล้วเลือกเพจให้ถูก` };
  // เช็คสิทธิ์ messaging: ลองอ่าน conversations 1 รายการ
  const conv = await (await fetch(`https://graph.facebook.com/${GRAPH}/${PAGE_ID}/conversations?limit=1&access_token=${token}`)).json();
  if (conv.error) return { ok: false, why: `เป็น PAGE token "${me.name}" แล้ว แต่ยังอ่าน conversations ไม่ได้ (${conv.error.message}) — ติ๊กสิทธิ์ pages_messaging + pages_read_engagement เพิ่ม` };
  return { ok: true, name: me.name };
}

function writeToken(token) {
  const next = env.match(/^FACEBOOK_ACCESS_TOKEN=/m)
    ? env.replace(/^FACEBOOK_ACCESS_TOKEN=.*$/m, `FACEBOOK_ACCESS_TOKEN=${token}`)
    : env.trimEnd() + `\nFACEBOOK_ACCESS_TOKEN=${token}\n`;
  writeFileSync(ENV_PATH, next);
}

let browser;
try {
  browser = await chromium.connectOverCDP(CDP, { timeout: 5000 });
} catch {
  console.error(`\n❌ ต่อ CDP ไม่ได้ที่ ${CDP}\nเปิด Chrome ก่อนด้วยคำสั่ง:\n  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="D:\\Project\\fb-mcp\\profile"\nแล้ว login Facebook ให้เรียบร้อย`);
  process.exit(2);
}

const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("developers.facebook.com")) ?? (await ctx.newPage());
await page.goto(EXPLORER, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await page.bringToFront().catch(() => {});

console.log(`
================ ดึง PAGE TOKEN ================
ในหน้า Graph API Explorer ที่เพิ่งเปิด ให้ทำ (ครั้งเดียว):
  1) ช่อง "Meta App"  -> เลือกแอปของคุณ
  2) ดรอปดาวน์ "User or Page" -> เลือก "Get Page Access Token"
  3) หน้าต่าง consent โผล่ -> เลือกเพจ "โกสินทร์ต้องบินได้"
     และติ๊กสิทธิ์: pages_messaging, pages_read_engagement, pages_show_list
  4) เลือกเพจอีกครั้งในดรอปดาวน์ -> token จะขึ้นในช่อง Access Token
สคริปต์กำลังเฝ้าจับ token ให้อัตโนมัติ... (รอสูงสุด 4 นาที)
===============================================`);

const deadline = Date.now() + WAIT_MS;
const tried = new Set();
let done = false;

while (Date.now() < deadline && !done) {
  // กวาดทุก input/textarea + ข้อความในหน้า หา string ที่ขึ้นต้น EAA
  const found = await page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll("input,textarea")) {
      if (el.value) for (const m of String(el.value).matchAll(/EAA[A-Za-z0-9]{20,}/g)) out.add(m[0]);
    }
    const m2 = (document.body?.innerText || "").matchAll(/EAA[A-Za-z0-9]{20,}/g);
    for (const m of m2) out.add(m[0]);
    return [...out];
  }).catch(() => []);

  for (const tok of found) {
    if (tried.has(tok)) continue;
    tried.add(tok);
    const c = await classify(tok);
    if (c.ok) {
      writeToken(tok);
      console.log(`\n✅ ได้ PAGE token ของ "${c.name}" แล้ว — เขียนลง .env เรียบร้อย`);
      done = true;
      break;
    } else {
      console.log(`… เจอ token แต่ยังใช้ไม่ได้: ${c.why}`);
    }
  }
  if (!done) await page.waitForTimeout(POLL_MS);
}

await browser.close().catch(() => {}); // detach เท่านั้น ไม่ปิด Chrome จริง
if (!done) { console.error("\n⏱️ หมดเวลา ยังไม่เจอ PAGE token ที่ใช้ได้ — รันสคริปต์ใหม่อีกครั้ง"); process.exit(3); }
process.exit(0);
