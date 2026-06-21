// สร้างคลิปรีล 9:16 หนึ่งคลิปจาก: รูปปก (images/{id}.png) + บทพากย์ (clips_vo.json) + หัวข้อ (manifest)
// ใช้ edge-tts (เสียงไทย) + ffmpeg ล้วน (เครื่องไม่มี GPU) -> clips/out/{id}.mp4
// ใช้: node make_clip.mjs <id>
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { execSync } from "child_process";

const DIR = "D:/Project/fb-mcp/claude_campaign";
const BASH = "C:/Program Files/Git/bin/bash.exe";
const BGM = "D:/Claude Guidebook/bgm/The Journey Ahead - Ezra Lipp.mp3";
const VOICE = "th-TH-NiwatNeural";
const HANDLE = "โกสินทร์ต้องบินได้";
const LEAD = 0.8, TAIL = 1.4;           // เงียบนำ + ท้ายคลิป
const sh = (c) => execSync(c, { shell: BASH, stdio: ["ignore", "pipe", "pipe"] }).toString();

const id = process.argv[2];
if (!id) { console.error("ใส่ id ด้วย"); process.exit(1); }

// เตรียมโฟลเดอร์ + ฟอนต์ไทย (ก๊อปเข้า clips/fonts กันปัญหา path มี colon ใน ffmpeg)
for (const d of ["clips", "clips/vo", "clips/out", "clips/fonts"]) mkdirSync(`${DIR}/${d}`, { recursive: true });
for (const f of ["tahoma.ttf", "tahomabd.ttf"]) if (!existsSync(`${DIR}/clips/fonts/${f}`)) copyFileSync(`C:/Windows/Fonts/${f}`, `${DIR}/clips/fonts/${f}`);

const post = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8")).find((p) => p.id === id);
const vo = JSON.parse(readFileSync(`${DIR}/clips_vo.json`, "utf8"));
const voText = vo[id];
const img = `${DIR}/images/${id}.png`;
if (!post || !voText) { console.log("ขาดข้อมูล/บทพากย์:", id); process.exit(2); }
if (!existsSync(img)) { console.log("ยังไม่มีรูป:", id); process.exit(3); }
const outMp4 = `${DIR}/clips/out/${id}.mp4`;
if (existsSync(outMp4)) { console.log("มีคลิปแล้ว ข้าม:", id); process.exit(0); }

// 1) edge-tts -> mp3 + srt
const txt = `${DIR}/clips/vo/${id}.txt`, mp3 = `${DIR}/clips/vo/${id}.mp3`, srt = `${DIR}/clips/vo/${id}.srt`;
writeFileSync(txt, voText.replace(/\r/g, ""));
sh(`python -m edge_tts --voice ${VOICE} --rate=-3% --file "${txt}" --write-media "${mp3}" --write-subtitles "${srt}"`);
const voDur = parseFloat(sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${mp3}"`).trim());
const total = +(LEAD + voDur + TAIL).toFixed(2);

// 2) SRT -> ASS (หัวข้อค้างบน + handle มุมบน + ซับวิ่งล่าง เลื่อนตาม LEAD)
const toSec = (t) => { const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000; };
const assT = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = (s % 60).toFixed(2).padStart(5, "0"); return `${h}:${String(m).padStart(2, "0")}:${x}`; };
const cues = [];
const raw = existsSync(srt) ? readFileSync(srt, "utf8") : "";
for (const block of raw.split(/\r?\n\r?\n/)) {
  const mt = block.match(/(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/);
  if (!mt) continue;
  const text = block.split(/\r?\n/).slice(block.split(/\r?\n/).findIndex((l) => l.includes("-->")) + 1).join(" ").replace(/\{|\}/g, "").trim();
  if (text) cues.push({ a: toSec(mt[1]) + LEAD, b: toSec(mt[2]) + LEAD, text });
}
const esc = (s) => s.replace(/\n/g, " ").replace(/,/g, "\\,").trim();
const ass = `${DIR}/clips/vo/${id}.ass`;
const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Head,Tahoma,72,&H00FFFFFF,&H00FFFFFF,&H00301A00,&H96000000,1,0,0,0,100,100,0,0,1,4,2,8,80,80,90,0
Style: Cap,Tahoma,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&HB4000000,1,0,0,0,100,100,0,0,1,4,2,2,90,90,180,0
Style: Tag,Tahoma,40,&H0000A6FF,&H0000A6FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,1,2,60,60,70,0

[Events]
Format: Layer, Start, End, Style, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${assT(0)},${assT(total)},Head,0,0,0,,${esc(post.image_headline_th)}
Dialogue: 0,${assT(0)},${assT(total)},Tag,0,0,0,,${esc(HANDLE)}
`;
const body = cues.map((c) => `Dialogue: 0,${assT(c.a)},${assT(Math.min(c.b, total))},Cap,0,0,0,,${esc(c.text)}`).join("\n");
writeFileSync(ass, head + body + "\n");

// 3) ffmpeg ประกอบคลิป (รัน cwd=clips ใช้ path relative กันปัญหา colon)
const leadMs = Math.round(LEAD * 1000);
const fc = [
  `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=26:2,eq=brightness=-0.10[bg]`,
  `[0:v]scale=960:960:force_original_aspect_ratio=increase,crop=960:960,setsar=1[sq]`,
  `[bg][sq]overlay=(W-w)/2:(H-h)/2-150[comp]`,
  `[comp]ass=vo/${id}.ass:fontsdir=fonts[v]`,
  `[1:a]adelay=${leadMs}|${leadMs},apad[vod]`,
  `[2:a]volume=0.14,afade=t=in:st=0:d=2[bgm]`,
  `[vod][bgm]amix=inputs=2:duration=longest:dropout_transition=3,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
].join(";");
const cmd = `cd "${DIR}/clips" && ffmpeg -y -loop 1 -i "../images/${id}.png" -i "vo/${id}.mp3" -stream_loop -1 -i "${BGM}" -filter_complex "${fc}" -map "[v]" -map "[a]" -t ${total} -r 30 -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -c:a aac -b:a 192k "out/${id}.mp4"`;
sh(cmd);
const outDur = parseFloat(sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${outMp4}"`).trim());
console.log(`✅ ${id}: คลิปยาว ${outDur.toFixed(1)}s (พากย์ ${voDur.toFixed(1)}s) -> clips/out/${id}.mp4`);
