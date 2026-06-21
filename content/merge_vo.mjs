// รวมไฟล์บทพากย์ vo_cXX.json -> clips_vo.json (รูปแบบ { id: vo_text })
import { readFileSync, writeFileSync, existsSync } from "fs";
const DIR = "D:/Project/fb-mcp/claude_campaign";
const out = existsSync(`${DIR}/clips_vo.json`) ? JSON.parse(readFileSync(`${DIR}/clips_vo.json`, "utf8")) : {};
let n = 0;
for (let i = 1; i <= 10; i++) {
  const f = `${DIR}/clips/vo_c${String(i).padStart(2, "0")}.json`;
  if (!existsSync(f)) continue;
  for (const e of JSON.parse(readFileSync(f, "utf8"))) { if (e.id && e.vo_text) { out[e.id] = e.vo_text; n++; } }
}
writeFileSync(`${DIR}/clips_vo.json`, JSON.stringify(out, null, 2));
console.log(`รวมบทพากย์ ${n} อัน -> clips_vo.json (รวมทั้งหมด ${Object.keys(out).length})`);
