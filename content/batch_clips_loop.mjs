// ทำคลิปทั้งหมดที่มีบทพากย์ (clips_vo.json) แบบวนซ้ำ — ทยอยทำเมื่อรูปเจนเสร็จ จนครบแล้วหยุดเอง
// idempotent: ข้ามคลิปที่ทำแล้ว / รูปที่ยังไม่มา จะรอแล้ววนเช็คใหม่
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
const DIR = "D:/Project/fb-mcp/claude_campaign";
const BASH = "C:/Program Files/Git/bin/bash.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vo = JSON.parse(readFileSync(`${DIR}/clips_vo.json`, "utf8"));
const ids = Object.keys(vo).sort();
const haveClip = (id) => existsSync(`${DIR}/clips/out/${id}.mp4`);
const haveImg = (id) => existsSync(`${DIR}/images/${id}.png`);

let pass = 0, idleWaits = 0;
while (true) {
  pass++;
  let made = 0, pendImg = 0, fail = 0;
  for (const id of ids) {
    if (haveClip(id)) continue;
    if (!haveImg(id)) { pendImg++; continue; }
    try { execSync(`node "${DIR}/make_clip.mjs" ${id}`, { shell: BASH, stdio: ["ignore", "pipe", "pipe"] }); made++; console.log(`p${pass} ✅ ${id}`); }
    catch (e) { fail++; console.log(`p${pass} ❌ ${id}: ${(e.stderr || e.stdout || "").toString().split("\n").slice(-2).join(" ")}`); }
  }
  const total = ids.filter(haveClip).length;
  console.log(`-- pass ${pass}: ทำใหม่ ${made} | รอรูป ${pendImg} | พลาด ${fail} | รวม ${total}/${ids.length} --`);
  if (total >= ids.length) { console.log("🎉 ครบทุกคลิปแล้ว"); break; }
  if (made === 0) {                       // ไม่มีคลิปใหม่รอบนี้ = รอรูปเจนเพิ่ม
    idleWaits++;
    if (idleWaits > 90) { console.log(`หยุด: รอรูปนานเกินไป ยังขาด ${pendImg} คลิป`); break; }
    await sleep(60000);
  } else idleWaits = 0;
}
const done = ids.filter(haveClip).length;
console.log(`\n===== จบ: คลิปเสร็จ ${done}/${ids.length} =====`);
