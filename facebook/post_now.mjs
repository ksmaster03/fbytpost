// โพสต์ข้อความลงเพจทันที (เผยแพร่เลย) — ใช้: node post_now.mjs <ไฟล์ข้อความ>
import { readFileSync } from "fs";
const env = readFileSync("D:/Project/fb-mcp/.env", "utf8");
const PAGE = env.match(/^FACEBOOK_PAGE_ID=(.*)$/m)[1].trim();
const TOKEN = env.match(/^FACEBOOK_ACCESS_TOKEN=(.*)$/m)[1].trim();
const msg = readFileSync(process.argv[2], "utf8");
const r = await (await fetch(`https://graph.facebook.com/v22.0/${PAGE}/feed`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ message: msg, access_token: TOKEN }),
})).json();
if (r.error) { console.log("❌", JSON.stringify(r.error)); process.exit(1); }
const pid = r.id || r.post_id;
console.log("✅ โพสต์แล้ว id:", pid, "\n   ลิงก์: https://www.facebook.com/" + (pid ? pid.replace("_", "/posts/") : ""));
