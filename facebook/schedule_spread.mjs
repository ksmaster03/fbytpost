// กระจาย 200 ชิ้น (100 โพสต์รูป + 100 Reel) ลงใน ~30 วัน เฉลี่ยทั่ว เวลาทอง 7 ช่วง/วัน สลับรูป-รีล
// ข้ามตัวที่ตั้งไปแล้ว (daily_state.json ใช้ key เดียวกับ schedule_daily.mjs) -> รันซ้ำปลอดภัย
// DRY RUN เป็นค่าเริ่มต้น | --confirm ตั้งจริง | --start YYYY-MM-DD (ดีฟอลต์พรุ่งนี้)
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
const DIR = "D:/Project/fb-mcp/claude_campaign", ENV = "D:/Project/fb-mcp/.env", G = "v22.0";
const SLOTS = ["08:00", "10:30", "12:00", "15:00", "17:30", "19:30", "21:00"]; // เวลาทอง 7 ช่วง/วัน
const REEL_OFFSET = 50, REEL_MAX_DAYS = 29;

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const CONFIRM = args.includes("--confirm");

const env = readFileSync(ENV, "utf8");
const PAGE = env.match(/^FACEBOOK_PAGE_ID=(.*)$/m)[1].trim();
const TOKEN = env.match(/^FACEBOOK_ACCESS_TOKEN=(.*)$/m)[1].trim();
const posts = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8"));
const byId = Object.fromEntries(posts.map((p) => [p.id, p]));
const ids = posts.map((p) => p.id).sort();

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
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));

// สร้างรายการ 200 ชิ้น สลับ รูป(โพสต์ตามลำดับ) กับ รีล(offset 50 ให้คนละหัวข้อ)
const items = [];
for (let i = 0; i < ids.length; i++) {
  items.push({ kind: "post", id: ids[i] });
  items.push({ kind: "reel", id: ids[(i + REEL_OFFSET) % ids.length] });
}
// ล็อก slot ตายตัวตามลำดับชิ้น (index คงที่) -> รันซ้ำ/resume ลงต่อที่เวลาเดิม ไม่กระจุก
const plan = items.map((it, k) => {
  const day = Math.floor(k / SLOTS.length), when = slot(day, SLOTS[k % SLOTS.length]);
  return { ...it, when, day, key: `${it.kind}:${it.id}` };
});
const remaining = plan.filter((p) => !state[p.key]);

const lastDay = plan.length ? plan[plan.length - 1].day : 0;
console.log(`\n===== กระจายเวลา 30 วัน (${CONFIRM ? "จริง 🔴" : "DRY RUN"}) =====`);
console.log(`เพจ ${PAGE} | เริ่ม ${Y}-${String(M+1).padStart(2,"0")}-${String(D).padStart(2,"0")} | ${SLOTS.length} ช่วง/วัน (${SLOTS.join(" ")})`);
console.log(`ยังไม่ตั้ง ${remaining.length} ชิ้น (ตั้งไปแล้ว ${items.length - remaining.length}) -> ทั้งแคมเปญจบใน ~${lastDay + 1} วัน`);
const reelLate = remaining.filter((p) => p.kind === "reel" && p.when > nowS + REEL_MAX_DAYS * 86400).length;
if (reelLate) console.log(`⚠️ รีล ${reelLate} ตัวจะเลย 30 วัน (FB จะปฏิเสธ) — ลด SLOTS/วัน หรือรับว่าเก็บภายหลัง`);
console.log("ตัวอย่าง 10 ชิ้นถัดไป:");
for (const p of remaining.slice(0, 10)) console.log(`  ${fmt(p.when)}  [${p.kind === "post" ? "รูป " : "รีล "}] ${p.id}  ${byId[p.id].image_headline_th}`);

if (!CONFIRM) { console.log(`\n👉 DRY RUN — สั่งซ้ำพร้อม --confirm เพื่อตั้งจริง`); process.exit(0); }

async function schedPhoto(id, when) {
  const img = `${DIR}/images/${id}.png`;
  if (!existsSync(img)) return "noimg";
  const fd = new FormData();
  fd.set("message", byId[id].caption); fd.set("published", "false");
  fd.set("scheduled_publish_time", String(when)); fd.set("access_token", TOKEN);
  fd.set("source", new Blob([readFileSync(img)], { type: "image/png" }), `${id}.png`);
  const r = await (await fetch(`https://graph.facebook.com/${G}/${PAGE}/photos`, { method: "POST", body: fd })).json();
  if (r.error) { console.log(`  ❌ รูป ${id}: ${r.error.message}`); return "fail"; }
  state[`post:${id}`] = { id: r.id || r.post_id, at: fmt(when) }; save(); return "ok";
}
async function schedReel(id, when) {
  const clip = `${DIR}/clips/out/${id}.mp4`;
  if (!existsSync(clip)) return "noclip";
  if (when > nowS + REEL_MAX_DAYS * 86400) return "late";
  const st = await (await fetch(`https://graph.facebook.com/${G}/${PAGE}/video_reels`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ upload_phase: "start", access_token: TOKEN }) })).json();
  if (st.error) { console.log(`  ❌ รีล ${id} start: ${st.error.message}`); return "fail"; }
  const vid = st.video_id, url = st.upload_url || `https://rupload.facebook.com/video-upload/${G}/${vid}`;
  const up = await fetch(url, { method: "POST", headers: { Authorization: `OAuth ${TOKEN}`, offset: "0", file_size: String(statSync(clip).size) }, body: readFileSync(clip) });
  if (up.status >= 400) { console.log(`  ❌ รีล ${id} upload HTTP ${up.status}`); return "fail"; }
  const fin = await (await fetch(`https://graph.facebook.com/${G}/${PAGE}/video_reels?upload_phase=finish&video_id=${vid}&video_state=SCHEDULED&scheduled_publish_time=${when}&description=${encodeURIComponent(byId[id].caption)}&access_token=${encodeURIComponent(TOKEN)}`, { method: "POST" })).json();
  if (fin.error) { console.log(`  ❌ รีล ${id} finish: ${fin.error.message}`); return "fail"; }
  state[`reel:${id}`] = { video_id: vid, at: fmt(when) }; save(); return "ok";
}

const tally = {};
for (const p of remaining) {
  const r = p.kind === "post" ? await schedPhoto(p.id, p.when) : await schedReel(p.id, p.when);
  tally[`${p.kind}:${r}`] = (tally[`${p.kind}:${r}`] || 0) + 1;
  if (r === "ok") console.log(`  ✅ ${p.kind === "post" ? "รูป" : "รีล"} ${p.id} -> ${fmt(p.when)}`);
  await sleep(1200);
}
console.log(`\n===== เสร็จ =====`);
console.log(JSON.stringify(tally, null, 2));
