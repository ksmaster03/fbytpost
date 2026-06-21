// ตั้งเวลาโพสต์ข้อความลงเพจ (scheduled feed post)
// ใช้: node schedule_post.mjs <ไฟล์ข้อความ> [unixเวลา]   (ไม่ใส่เวลา = 9 โมงเช้าพรุ่งนี้ เวลาไทย)
import { readFileSync } from "fs";
const ENV = "D:/Project/fb-mcp/.env", G = "v22.0";
const env = readFileSync(ENV, "utf8");
const PAGE = env.match(/^FACEBOOK_PAGE_ID=(.*)$/m)[1].trim();
const TOKEN = env.match(/^FACEBOOK_ACCESS_TOKEN=(.*)$/m)[1].trim();

const [msgFile, whenArg] = process.argv.slice(2);
const message = readFileSync(msgFile, "utf8");

// default = พรุ่งนี้ 09:00 เวลาไทย (UTC+7) => 02:00 UTC
let when;
if (whenArg && /^\d+$/.test(whenArg)) when = parseInt(whenArg, 10);
else {
  const thai = new Date(Date.now() + 7 * 3600 * 1000);
  when = Date.UTC(thai.getUTCFullYear(), thai.getUTCMonth(), thai.getUTCDate() + 1, 2, 0, 0) / 1000;
}

const r = await (await fetch(`https://graph.facebook.com/${G}/${PAGE}/feed`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ message, published: false, scheduled_publish_time: when, access_token: TOKEN }),
})).json();

const thaiStr = new Date((when + 7 * 3600) * 1000).toISOString().replace("T", " ").replace(".000Z", " (ไทย)");
if (r.error) { console.log("❌ ตั้งเวลาไม่สำเร็จ:", JSON.stringify(r.error)); process.exit(1); }
console.log(`✅ ตั้งเวลาโพสต์แล้ว: ${thaiStr}\n   post id: ${r.id}`);
