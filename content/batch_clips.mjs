// ทำคลิปทีละตัวจากรายการ id ที่มีบทพากย์ (clips_vo.json) — ข้ามตัวที่ทำแล้ว/รูปยังไม่มา
// รันซ้ำได้ (idempotent) เพื่อเก็บตัวที่รูปเพิ่งเจนเสร็จ
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
const DIR = "D:/Project/fb-mcp/claude_campaign";
const BASH = "C:/Program Files/Git/bin/bash.exe";
const vo = JSON.parse(readFileSync(`${DIR}/clips_vo.json`, "utf8"));
const ids = Object.keys(vo).sort();
let ok = 0, done = 0, pendImg = 0, fail = 0;
const pending = [];
for (const id of ids) {
  if (existsSync(`${DIR}/clips/out/${id}.mp4`)) { done++; continue; }
  if (!existsSync(`${DIR}/images/${id}.png`)) { pendImg++; pending.push(id); continue; }
  try {
    process.stdout.write(`ทำ ${id} ... `);
    execSync(`node "${DIR}/make_clip.mjs" ${id}`, { shell: BASH, stdio: ["ignore", "pipe", "pipe"] });
    ok++; console.log("เสร็จ");
  } catch (e) { fail++; console.log("พลาด:", (e.stderr || e.stdout || e).toString().split("\n").slice(-3).join(" ")); }
}
console.log(`\n===== สรุป: ทำใหม่ ${ok} | มีอยู่แล้ว ${done} | รอรูป ${pendImg} | พลาด ${fail} | รวมเป้า ${ids.length} =====`);
if (pending.length) console.log("รอรูป:", pending.join(", "));
