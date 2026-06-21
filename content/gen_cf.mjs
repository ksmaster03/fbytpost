// เจนรูปปกที่ยังขาด ผ่าน Cloudflare Workers AI (FLUX schnell) — ฟรี ไม่มี cap ไม่ต้อง GPU
// เติมเฉพาะ id ที่ยังไม่มี images/{id}.png (ที่ ChatGPT เจนไม่ทันเพราะติดโควต้า)
import { readFileSync, writeFileSync, existsSync } from "fs";
const DIR = "D:/Project/fb-mcp/claude_campaign";
const CFENV = "C:/Users/TINV-026/.config/charkathat/.env";
const e = readFileSync(CFENV, "utf8");
const ACC = e.match(/^CLOUDFLARE_ACCOUNT_ID=(.*)$/m)[1].trim();
const TOK = e.match(/^CLOUDFLARE_API_TOKEN=(.*)$/m)[1].trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const posts = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8"));
let made = 0, skip = 0, fail = 0;
for (const p of posts) {
  const out = `${DIR}/images/${p.id}.png`;
  if (existsSync(out)) { skip++; continue; }
  const prompt = `${p.image_prompt || p.image_headline_th} . Absolutely no text, no letters, no words, no captions.`;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
      method: "POST", headers: { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, steps: 4 }),
    });
    const j = await r.json();
    if (j.result && j.result.image) { writeFileSync(out, Buffer.from(j.result.image, "base64")); made++; console.log("✅", p.id); }
    else { fail++; console.log("❌", p.id, JSON.stringify(j.errors || j).slice(0, 160)); }
  } catch (err) { fail++; console.log("❌", p.id, err.message); }
  await sleep(700);
}
console.log(`\n===== Cloudflare: ทำใหม่ ${made} | มีแล้ว ${skip} | พลาด ${fail} =====`);
