// ตั้งเวลาโพสต์แคมเปญ 100 โพสต์ Claude ลงเพจ วันละ 2 เวลา (12:00 + 19:30 เวลาไทย)
// อ่าน manifest.json -> ถ้ามีรูป images/{id}.png ใช้โพสต์รูป (/photos) ไม่มีก็โพสต์ข้อความ (/feed)
//
// ค่าเริ่มต้น = DRY RUN (โชว์ตารางเฉยๆ). ใส่ --confirm เพื่อตั้งเวลาจริง
// ใช้:  node schedule_campaign.mjs                 (dry run)
//       node schedule_campaign.mjs --confirm        (ตั้งเวลาจริง)
// ออปชัน: --start 2026-06-22 (วันเริ่ม Thai) --limit 10 (ทดลองกี่โพสต์) --times 12:00,19:30
//
// กัน double-schedule ด้วย scheduled_state.json (จำ id ที่ตั้งไปแล้ว) -> รันซ้ำได้ปลอดภัย

import { readFileSync, writeFileSync, existsSync } from "fs";
const DIR = "D:/Project/fb-mcp/claude_campaign";
const ENV = "D:/Project/fb-mcp/.env", G = "v22.0";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const CONFIRM = args.includes("--confirm");
const LIMIT = parseInt(flag("--limit", "0"), 10) || 0;           // 0 = ทั้งหมด
const DELAY = parseInt(flag("--delay-ms", "4000"), 10);
const TIMES = flag("--times", "12:00,19:30").split(",").map((t) => t.trim());

const env = readFileSync(ENV, "utf8");
const PAGE = env.match(/^FACEBOOK_PAGE_ID=(.*)$/m)[1].trim();
const TOKEN = env.match(/^FACEBOOK_ACCESS_TOKEN=(.*)$/m)[1].trim();

// วันเริ่ม: ดีฟอลต์ = พรุ่งนี้ (เวลาไทย)
const startArg = flag("--start");
let startY, startM, startD;
if (startArg && /^\d{4}-\d{2}-\d{2}$/.test(startArg)) {
  [startY, startM, startD] = startArg.split("-").map(Number); startM -= 1;
} else {
  const t = new Date(Date.now() + 7 * 3600 * 1000);
  startY = t.getUTCFullYear(); startM = t.getUTCMonth(); startD = t.getUTCDate() + 1;
}

// unix สำหรับ "วันที่ Thai (startY,startM,startD + dayOffset) เวลา HH:MM Thai"
function slotUnix(dayOffset, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  // Thai = UTC+7 -> UTC = Thai - 7 ชม. (ช่วงกลางวัน วันที่ UTC เท่ากับวันที่ Thai)
  return Date.UTC(startY, startM, startD + dayOffset, h - 7, m, 0) / 1000;
}

const posts = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8"));
const list = LIMIT ? posts.slice(0, LIMIT) : posts;

const statePath = `${DIR}/scheduled_state.json`;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (u) => new Date((u + 7 * 3600) * 1000).toISOString().replace("T", " ").replace(".000Z", "");

// สร้างแผนเวลา
const plan = list.map((p, i) => {
  const day = Math.floor(i / TIMES.length);
  const when = slotUnix(day, TIMES[i % TIMES.length]);
  const img = `${DIR}/images/${p.id}.png`;
  return { ...p, when, hasImg: existsSync(img), imgPath: img, day };
});

console.log(`\n===== ตั้งเวลาแคมเปญ Claude (${CONFIRM ? "จริง 🔴" : "DRY RUN"}) =====`);
console.log(`เพจ: ${PAGE} | โพสต์: ${plan.length} | วันละ ${TIMES.length} (${TIMES.join(", ")}) | เริ่ม ${startY}-${String(startM+1).padStart(2,"0")}-${String(startD).padStart(2,"0")} (Thai)`);
const withImg = plan.filter((p) => p.hasImg).length;
console.log(`มีรูปปกแล้ว: ${withImg}/${plan.length} (ที่เหลือจะโพสต์เป็นข้อความล้วนไปก่อน)\n`);

for (const p of plan) {
  const tag = state[p.id] ? "⏭ ตั้งแล้ว" : (CONFIRM ? "→ ตั้ง" : "·");
  console.log(`${tag}  ${fmt(p.when)}  [${p.hasImg ? "รูป" : "ข้อความ"}] ${p.id}  ${p.image_headline_th}`);
}

if (!CONFIRM) {
  console.log(`\n👉 DRY RUN — ตรวจแล้วสั่งซ้ำพร้อม --confirm เพื่อตั้งเวลาจริง`);
  process.exit(0);
}

// ===== ตั้งเวลาจริง =====
let ok = 0, fail = 0, skip = 0;
for (const p of plan) {
  if (state[p.id]) { skip++; continue; }                         // ตั้งไปแล้ว ข้าม
  try {
    let res;
    if (p.hasImg) {
      const fd = new FormData();
      fd.set("message", p.caption);
      fd.set("published", "false");
      fd.set("scheduled_publish_time", String(p.when));
      fd.set("access_token", TOKEN);
      fd.set("source", new Blob([readFileSync(p.imgPath)], { type: "image/png" }), `${p.id}.png`);
      res = await (await fetch(`https://graph.facebook.com/${G}/${PAGE}/photos`, { method: "POST", body: fd })).json();
    } else {
      res = await (await fetch(`https://graph.facebook.com/${G}/${PAGE}/feed`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: p.caption, published: false, scheduled_publish_time: p.when, access_token: TOKEN }),
      })).json();
    }
    if (res.error) { fail++; console.log(`  ❌ ${p.id}: ${res.error.message}`); }
    else {
      ok++;
      state[p.id] = { post_id: res.id || res.post_id || null, when: p.when, at: fmt(p.when) };
      writeFileSync(statePath, JSON.stringify(state, null, 2));   // เซฟทีละอัน กันหายถ้าค้าง
      console.log(`  ✅ ${p.id} -> ${fmt(p.when)} (${res.id || res.post_id || "ok"})`);
    }
  } catch (e) { fail++; console.log(`  ❌ ${p.id}: ${e.message}`); }
  await sleep(DELAY);
}
console.log(`\n===== เสร็จ: ตั้งสำเร็จ ${ok} | ข้าม(ตั้งแล้ว) ${skip} | พลาด ${fail} =====`);
