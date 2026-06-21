// ตั้งเวลาลงเพจ "วันละ 2 ชิ้น": 12:00 โพสต์รูป (manifest+image) + 19:30 Reel (คนละหัวข้อ, offset 50)
// โพสต์รูปตั้งครบ 100 วัน | Reel ตั้งได้เท่าที่ FB ยอม (~30 วันข้างหน้า) ที่เลยจะข้ามไว้ (รันซ้ำเก็บภายหลัง)
// ค่าเริ่มต้น = DRY RUN. ใส่ --confirm เพื่อตั้งจริง | --start YYYY-MM-DD | --limit <จำนวนวัน>
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
const DIR = "D:/Project/fb-mcp/claude_campaign", ENV = "D:/Project/fb-mcp/.env", G = "v22.0";
const NOON = "12:00", EVE = "19:30", REEL_OFFSET = 50, REEL_MAX_DAYS = 29;

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const CONFIRM = args.includes("--confirm");
const LIMIT = parseInt(flag("--limit", "0"), 10) || 0;

const env = readFileSync(ENV, "utf8");
const PAGE = env.match(/^FACEBOOK_PAGE_ID=(.*)$/m)[1].trim();
const TOKEN = env.match(/^FACEBOOK_ACCESS_TOKEN=(.*)$/m)[1].trim();
const posts = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8"));
const byId = Object.fromEntries(posts.map((p) => [p.id, p]));
const ids = posts.map((p) => p.id).sort();

// วันเริ่ม (Thai) ดีฟอลต์ = พรุ่งนี้
const sa = flag("--start");
let Y, M, D;
if (sa && /^\d{4}-\d{2}-\d{2}$/.test(sa)) { [Y, M, D] = sa.split("-").map(Number); M -= 1; }
else { const t = new Date(Date.now() + 7 * 3600 * 1000); Y = t.getUTCFullYear(); M = t.getUTCMonth(); D = t.getUTCDate() + 1; }
const slot = (dayOff, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return Date.UTC(Y, M, D + dayOff, h - 7, m, 0) / 1000; };
const fmt = (u) => new Date((u + 7 * 3600) * 1000).toISOString().replace("T", " ").replace(".000Z", "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowS = Math.floor(Date.now() / 1000);

const statePath = `${DIR}/daily_state.json`;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const saveState = () => writeFileSync(statePath, JSON.stringify(state, null, 2));

const days = LIMIT || ids.length;
const plan = [];
for (let d = 0; d < days; d++) {
  const postId = ids[d];
  const reelId = ids[(d + REEL_OFFSET) % ids.length];
  plan.push({ d, postId, noon: slot(d, NOON), reelId, eve: slot(d, EVE), reelClip: `${DIR}/clips/out/${reelId}.mp4`, img: `${DIR}/images/${postId}.png` });
}

console.log(`\n===== ตั้งเวลา รูป+รีล (${CONFIRM ? "จริง 🔴" : "DRY RUN"}) =====`);
console.log(`เพจ ${PAGE} | เริ่ม ${Y}-${String(M+1).padStart(2,"0")}-${String(D).padStart(2,"0")} (Thai) | ${days} วัน | เที่ยง=รูป เย็น=รีล`);
let reelOk = 0, reelLate = 0;
for (const p of plan) { if (p.eve <= nowS + REEL_MAX_DAYS * 86400) reelOk++; else reelLate++; }
console.log(`รูปโพสต์ตั้งได้: ${days} | Reel ตั้งได้ตอนนี้: ${reelOk} | Reel เกิน ~${REEL_MAX_DAYS} วัน (ข้ามไว้): ${reelLate}\n`);
for (const p of plan.slice(0, 6)) console.log(`วันที่ ${p.d + 1}: 12:00 รูป ${p.postId} (${byId[p.postId].image_headline_th}) | 19:30 รีล ${p.reelId} (${byId[p.reelId].image_headline_th})`);
console.log("  ... (ตัวอย่าง 6 วันแรก)");

if (!CONFIRM) { console.log(`\n👉 DRY RUN — สั่งซ้ำพร้อม --confirm เพื่อตั้งจริง`); process.exit(0); }

// ---- โพสต์รูป (photo, scheduled) ----
async function schedPhoto(p) {
  const key = `post:${p.postId}`;
  if (state[key]) return "skip";
  if (!existsSync(p.img)) return "noimg";
  const fd = new FormData();
  fd.set("message", byId[p.postId].caption);
  fd.set("published", "false");
  fd.set("scheduled_publish_time", String(p.noon));
  fd.set("access_token", TOKEN);
  fd.set("source", new Blob([readFileSync(p.img)], { type: "image/png" }), `${p.postId}.png`);
  const r = await (await fetch(`https://graph.facebook.com/${G}/${PAGE}/photos`, { method: "POST", body: fd })).json();
  if (r.error) { console.log(`  ❌ รูป ${p.postId}: ${r.error.message}`); return "fail"; }
  state[key] = { id: r.id || r.post_id, at: fmt(p.noon) }; saveState();
  return "ok";
}

// ---- Reel (video_reels 3 เฟส, scheduled) ----
async function schedReel(p) {
  const key = `reel:${p.reelId}`;
  if (state[key]) return "skip";
  if (p.eve > nowS + REEL_MAX_DAYS * 86400) return "late";
  if (!existsSync(p.reelClip)) return "noclip";
  const start = await (await fetch(`https://graph.facebook.com/${G}/${PAGE}/video_reels`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ upload_phase: "start", access_token: TOKEN }),
  })).json();
  if (start.error) { console.log(`  ❌ รีล ${p.reelId} start: ${start.error.message}`); return "fail"; }
  const vid = start.video_id;
  const uploadUrl = start.upload_url || `https://rupload.facebook.com/video-upload/${G}/${vid}`;
  const buf = readFileSync(p.reelClip);
  const up = await fetch(uploadUrl, { method: "POST", headers: { Authorization: `OAuth ${TOKEN}`, offset: "0", file_size: String(statSync(p.reelClip).size) }, body: buf });
  if (!up.ok && up.status >= 400) { console.log(`  ❌ รีล ${p.reelId} upload HTTP ${up.status}`); return "fail"; }
  const desc = byId[p.reelId].caption;
  const fin = await (await fetch(`https://graph.facebook.com/${G}/${PAGE}/video_reels?upload_phase=finish&video_id=${vid}&video_state=SCHEDULED&scheduled_publish_time=${p.eve}&description=${encodeURIComponent(desc)}&access_token=${encodeURIComponent(TOKEN)}`, { method: "POST" })).json();
  if (fin.error) { console.log(`  ❌ รีล ${p.reelId} finish: ${fin.error.message}`); return "fail"; }
  state[key] = { video_id: vid, at: fmt(p.eve) }; saveState();
  return "ok";
}

let ph = { ok: 0, skip: 0, fail: 0, noimg: 0 }, re = { ok: 0, skip: 0, fail: 0, late: 0, noclip: 0 };
for (const p of plan) {
  const rp = await schedPhoto(p); ph[rp] = (ph[rp] || 0) + 1;
  if (rp === "ok") console.log(`  ✅ รูป ${p.postId} -> ${fmt(p.noon)}`);
  const rr = await schedReel(p); re[rr] = (re[rr] || 0) + 1;
  if (rr === "ok") console.log(`  ✅ รีล ${p.reelId} -> ${fmt(p.eve)}`);
  await sleep(1500);
}
console.log(`\n===== เสร็จ =====`);
console.log(`รูป: ตั้ง ${ph.ok} | ข้าม ${ph.skip || 0} | พลาด ${ph.fail || 0} | ไม่มีรูป ${ph.noimg || 0}`);
console.log(`รีล: ตั้ง ${re.ok} | ข้าม ${re.skip || 0} | เกินกำหนด ${re.late || 0} | พลาด ${re.fail || 0} | ไม่มีคลิป ${re.noclip || 0}`);
console.log(`(Reel ที่เกิน ~${REEL_MAX_DAYS} วัน: รันสคริปต์นี้ซ้ำอีกครั้งใน ~3-4 สัปดาห์ จะเก็บให้อัตโนมัติ)`);
