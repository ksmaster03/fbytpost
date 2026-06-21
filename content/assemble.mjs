// รวมไฟล์โพสต์ทั้ง 10 หมวด -> manifest.json (ครบทุก field) + prompts.json (สำหรับเจนรูป)
import { readFileSync, writeFileSync, existsSync } from "fs";
const DIR = "D:/Project/fb-mcp/claude_campaign";
const all = [];
const issues = [];
for (let i = 1; i <= 10; i++) {
  const f = `${DIR}/posts/c${String(i).padStart(2, "0")}.json`;
  if (!existsSync(f)) { issues.push(`ขาดไฟล์ ${f}`); continue; }
  try {
    const arr = JSON.parse(readFileSync(f, "utf8"));
    if (!Array.isArray(arr)) { issues.push(`${f} ไม่ใช่ array`); continue; }
    for (const p of arr) {
      if (!p.id || !p.caption || !p.image_prompt) { issues.push(`${f}: โพสต์ field ไม่ครบ (${p.id || "?"})`); continue; }
      all.push(p);
    }
  } catch (e) { issues.push(`${f}: parse error ${e.message}`); }
}
// เรียงตาม id ให้แน่นอน
all.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(`${DIR}/manifest.json`, JSON.stringify(all, null, 2));
writeFileSync(`${DIR}/prompts.json`, JSON.stringify(all.map((p) => ({ id: p.id, prompt: p.image_prompt })), null, 2));
console.log(`รวมได้ ${all.length} โพสต์ -> manifest.json + prompts.json`);
if (issues.length) { console.log("ปัญหา:"); issues.forEach((x) => console.log("  -", x)); }
else console.log("ทุกไฟล์ผ่านการตรวจ JSON ✅");
