// อัป Reel ขึ้น YouTube Shorts ทีละชุด (quota ~6/วัน) — ตั้ง publishAt ให้ตรงเวลารีลลง FB (sync กัน)
// idempotent ผ่าน yt_state.json | ใช้: node yt_batch.mjs [--limit 6]
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
const DIR = "D:/Project/fb-mcp/claude_campaign";
const YT = "D:/Claude Guidebook/YoutubeMCP";
const PY = "D:/Project/f5tts-thai/.venv/Scripts/python.exe";
const BASH = "C:/Program Files/Git/bin/bash.exe";

const args = process.argv.slice(2);
const LIMIT = parseInt((args[args.indexOf("--limit") + 1]) || "6", 10);

const byId = Object.fromEntries(JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8")).map((p) => [p.id, p]));
const daily = JSON.parse(readFileSync(`${DIR}/daily_state.json`, "utf8"));
const ytPath = `${DIR}/yt_state.json`;
const ytState = existsSync(ytPath) ? JSON.parse(readFileSync(ytPath, "utf8")) : {};

// รีลที่มีเวลาแล้ว + มีไฟล์คลิป เรียงตามเวลาลง FB
const reels = Object.keys(daily).filter((k) => k.startsWith("reel:"))
  .map((k) => ({ id: k.slice(5), at: daily[k].at }))
  .filter((r) => r.at && byId[r.id] && existsSync(`${DIR}/clips/out/${r.id}.mp4`))
  .sort((a, b) => a.at.localeCompare(b.at));
const todo = reels.filter((r) => !ytState[r.id]).slice(0, LIMIT);

console.log(`YouTube Shorts: อัปรอบนี้ ${todo.length} | อัปไปแล้ว ${Object.keys(ytState).length}/${reels.length} | quota ~6/วัน`);
const nowMs = Date.now();
let ok = 0, fail = 0;
for (const r of todo) {
  const p = byId[r.id];
  // publishAt = เวลารีลลง FB (ไทย) -> UTC RFC3339 ; ถ้าเลยแล้วเลื่อน +1 ชม.
  const [d, t] = r.at.split(" ");
  let when = new Date(`${d}T${t}+07:00`).getTime();
  if (when < nowMs + 15 * 60000) when = nowMs + 60 * 60000;
  const iso = new Date(when).toISOString().replace(/\.\d+Z$/, "Z");
  const title = (p.image_headline_th + " | ใช้ Claude ทำงาน #Shorts").slice(0, 95);
  const descFile = `${DIR}/clips/vo/_ytdesc_${r.id}.txt`;
  writeFileSync(descFile, p.caption);
  try {
    const out = execSync(`"${PY}" "${YT}/upload_yt.py" "${DIR}/clips/out/${r.id}.mp4" ${JSON.stringify(title)} "${descFile}" private "${iso}"`, { shell: BASH, stdio: ["ignore", "pipe", "pipe"] }).toString();
    const m = out.match(/video_id:\s*(\S+)/);
    ytState[r.id] = { video_id: m ? m[1] : null, publishAt: iso }; writeFileSync(ytPath, JSON.stringify(ytState, null, 2));
    ok++; console.log(`  ✅ ${r.id} -> ${iso} ${m ? "https://youtube.com/shorts/" + m[1] : ""}`);
  } catch (e) { fail++; console.log(`  ❌ ${r.id}: ${(e.stderr || e.stdout || "").toString().split("\n").slice(-3).join(" ").slice(0, 200)}`); }
}
console.log(`\nเสร็จ: อัป ${ok} | พลาด ${fail} | เหลือ ${reels.length - Object.keys(ytState).length} (รันซ้ำพรุ่งนี้เก็บต่อ)`);
