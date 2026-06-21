// ส่งข้อความ Messenger หา "คนที่เคยทักเพจ" — เฉพาะที่อยู่ในกรอบนโยบาย Meta
//
// นโยบาย: Standard Messaging ส่งได้ทุกเนื้อหา (รวมโปรโมชัน) เฉพาะภายใน 24 ชม.
// หลังผู้ใช้ทักเพจครั้งล่าสุดเท่านั้น. เกิน 24 ชม. = ส่งข้อความการตลาดไม่ได้
// (ผิด Messenger Platform Policy เสี่ยงเพจโดนระงับ). สคริปต์นี้จึง "กรองทิ้ง"
// conversation ที่เกินกรอบเวลาให้อัตโนมัติ.
//
// ค่าเริ่มต้น = DRY RUN (แค่โชว์ว่าจะส่งหาใครบ้าง ไม่ส่งจริง). ต้องใส่ --confirm ถึงจะยิงจริง.
//
// ใช้:  node messenger_broadcast.mjs --message "ข้อความ"            (dry run)
//       node messenger_broadcast.mjs --message-file msg.txt --confirm  (ส่งจริง)
// ออปชัน: --window-hours 24  --cap 100  --delay-ms 1500

import { readFileSync, writeFileSync } from "fs";

const ENV_PATH = "D:/Project/fb-mcp/.env";
const GRAPH = "v22.0";

// ---- พาร์สอาร์กิวเมนต์ ----
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);

const CONFIRM = has("--confirm");
const WINDOW_H = parseFloat(flag("--window-hours", "24"));
const CAP = parseInt(flag("--cap", "200"), 10);
const DELAY = parseInt(flag("--delay-ms", "1500"), 10);      // หน่วงระหว่าง "คน"
const MSG_GAP = parseInt(flag("--msg-gap-ms", "900"), 10);   // หน่วงระหว่าง "ข้อความ" ของคนเดียวกัน

// เก็บข้อความหลายอันตามลำดับที่สั่งใน CLI (รองรับ --message-file/--message ซ้ำได้)
// คนรับแต่ละคนจะได้รับครบทุกข้อความเรียงตามลำดับนี้
const messages = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--message-file" && args[i + 1] !== undefined) messages.push(readFileSync(args[++i], "utf8"));
  else if (args[i] === "--message" && args[i + 1] !== undefined) messages.push(args[++i]);
}
const texts = messages.map((m) => m.replace(/\r\n/g, "\n").trim()).filter(Boolean);
if (texts.length === 0) { console.error("ต้องระบุข้อความด้วย --message \"...\" หรือ --message-file <ไฟล์> (ใส่ซ้ำได้หลายอัน)"); process.exit(1); }

const env = readFileSync(ENV_PATH, "utf8");
const PAGE = env.match(/^FACEBOOK_PAGE_ID=(.*)$/m)?.[1].trim();
const TOKEN = env.match(/^FACEBOOK_ACCESS_TOKEN=(.*)$/m)?.[1].trim();
if (!PAGE || !TOKEN) { console.error("ไม่พบ FACEBOOK_PAGE_ID / FACEBOOK_ACCESS_TOKEN ใน .env"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = Date.now();

// ---- ดึง conversations ทั้งหมด (ตาม paging) ----
async function fetchConversations() {
  const all = [];
  let url = `https://graph.facebook.com/${GRAPH}/${PAGE}/conversations?fields=id,participants,updated_time&limit=100&access_token=${encodeURIComponent(TOKEN)}`;
  let pages = 0;
  while (url && pages < 50) {
    const j = await (await fetch(url)).json();
    if (j.error) { console.error("อ่าน conversations ไม่ได้:", JSON.stringify(j.error)); process.exit(2); }
    all.push(...(j.data || []));
    url = j.paging?.next || null;
    pages++;
  }
  return all;
}

// หา "เวลาที่ลูกค้าทักเข้ามาล่าสุด" (inbound) ของ thread — ไม่ใช่ updated_time
// (updated_time ขยับตอนเพจส่งออกด้วย ทำให้กรอบ 24 ชม.เพี้ยน) คืน ms หรือ null ถ้าไม่เจอ inbound
async function lastInboundMs(convId) {
  const j = await (await fetch(`https://graph.facebook.com/${GRAPH}/${convId}/messages?fields=from,created_time&limit=15&access_token=${encodeURIComponent(TOKEN)}`)).json();
  if (j.error) return null;
  for (const m of j.data || []) {            // เรียงใหม่->เก่า เจอ inbound ตัวแรกคือล่าสุด
    if (m.from && String(m.from.id) !== String(PAGE)) return new Date(m.created_time).getTime();
  }
  return null;
}

const convos = await fetchConversations();

// Prefilter: updated_time >= last_inbound เสมอ -> เอาเฉพาะ thread ที่ updated ภายในกรอบ
// มาเช็ค inbound จริง (ลดจำนวนเรียก API ให้เหลือเท่าที่จำเป็น)
const candidates = [];
let skippedOld = 0;
for (const c of convos) {
  const user = (c.participants?.data || []).find((p) => String(p.id) !== String(PAGE));
  if (!user) continue;
  const updH = (nowMs - new Date(c.updated_time).getTime()) / 3.6e6;
  if (updH > WINDOW_H) { skippedOld++; continue; }
  candidates.push({ convId: c.id, psid: user.id, name: user.name || "(ไม่ทราบชื่อ)" });
}

// เช็ค inbound ล่าสุดของแต่ละ candidate -> กรองด้วยเวลาที่ลูกค้าทักจริง
console.log(`กำลังตรวจ inbound ล่าสุดของ ${candidates.length} thread (กันยิงนอกกรอบ 24 ชม.)...`);
const eligible = [];
let skippedNoInbound = 0;
for (const c of candidates) {
  const inb = await lastInboundMs(c.convId);
  if (inb == null) { skippedNoInbound++; continue; }   // ไม่เคยมี inbound (เพจทักก่อนฝ่ายเดียว)
  const hours = (nowMs - inb) / 3.6e6;
  if (hours > WINDOW_H) { skippedOld++; continue; }     // ลูกค้าทักเกิน 24 ชม. -> window ปิด
  eligible.push({ psid: c.psid, name: c.name, hours: Math.round(hours * 10) / 10 });
}
eligible.sort((a, b) => a.hours - b.hours);
const targets = eligible.slice(0, CAP);

// ---- รายงานสรุป ----
console.log(`\n===== Messenger Broadcast (${CONFIRM ? "ยิงจริง 🔴" : "DRY RUN — ไม่ส่ง"}) =====`);
console.log(`เพจ: ${PAGE}`);
console.log(`กรอบเวลา: ภายใน ${WINDOW_H} ชม. | cap: ${CAP} | delay: ${DELAY}ms`);
console.log(`conversations ทั้งหมด: ${convos.length} | เข้าเกณฑ์(≤${WINDOW_H}ชม.): ${eligible.length} | จะส่งจริง: ${targets.length} | ข้ามเพราะเกินเวลา: ${skippedOld}`);
console.log(`\n--- จะส่ง ${texts.length} ข้อความ/คน (เรียงตามนี้) ---`);
texts.forEach((t, i) => console.log(`[ข้อความ ${i + 1}]\n${t}\n`));
console.log(`----------------------`);
console.log("\nผู้รับ:");
targets.forEach((t, i) => console.log(`  ${String(i + 1).padStart(3)}. ${t.name}  (${t.hours} ชม.ที่แล้ว)  psid=${t.psid}`));

if (!CONFIRM) {
  console.log(`\n👉 นี่คือ DRY RUN. ถ้าถูกต้อง สั่งซ้ำพร้อม --confirm เพื่อส่งจริง`);
  process.exit(0);
}

// ---- ส่งจริง (Standard Messaging, messaging_type RESPONSE ใช้ได้ในกรอบ 24 ชม.) ----
async function sendOne(psid, text) {
  const r = await (await fetch(`https://graph.facebook.com/${GRAPH}/${PAGE}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: { text },
      access_token: TOKEN,
    }),
  })).json();
  return { ok: !r.error, error: r.error?.message || null, mid: r.message_id || null };
}

const results = [];
for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  const per = []; // ผลของแต่ละข้อความที่ส่งให้คนนี้
  let allOk = true;
  for (let m = 0; m < texts.length; m++) {
    const res = await sendOne(t.psid, texts[m]);
    per.push(res);
    if (!res.ok) allOk = false;
    if (m < texts.length - 1) await sleep(MSG_GAP);
    // ถ้าข้อความแรกส่งไม่ผ่าน (เช่น หลุดกรอบ 24 ชม.) ไม่ต้องยิงข้อความถัดไปให้คนนี้
    if (!res.ok) break;
  }
  results.push({ psid: t.psid, name: t.name, ok: allOk, msgs: per });
  const firstErr = per.find((p) => !p.ok)?.error;
  console.log(`  [${i + 1}/${targets.length}] ${allOk ? "✅" : "❌"} ${t.name}${allOk ? "" : " — " + firstErr}`);
  if (i < targets.length - 1) await sleep(DELAY);
}

const sent = results.filter((r) => r.ok).length;
const logPath = `D:/Project/fb-mcp/store/broadcast_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
try { writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), window_h: WINDOW_H, sent, failed: results.length - sent, results }, null, 2)); } catch {}
console.log(`\n===== เสร็จ: ส่งสำเร็จ ${sent}/${results.length} | log: ${logPath} =====`);
