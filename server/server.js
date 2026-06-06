// Frameline local server · OpenRouter proxy
// Endpoints:
//   POST /api/breakdown      { scene, script }      -> { shots: [...] }
//   POST /api/generate-shot  { shotDescriptor }     -> { imageDataUrl }

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const KEY = process.env.OPENROUTER_API_KEY;
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'openai/gpt-5-image';
const TEXT_MODEL = process.env.TEXT_MODEL || 'anthropic/claude-sonnet-4';

if (!KEY || KEY.includes('REPLACE_WITH')) {
  console.error('\n❌  请先把 OpenRouter API key 填进 .env 文件');
  console.error('   编辑 server/.env，把 OPENROUTER_API_KEY=... 那行改成你的真 key\n');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve the HTML mockup from the parent folder, so http://localhost:3000 = frameline-app
app.use(express.static(path.resolve(__dirname, '..')));

const GENERATED_DIR = path.join(__dirname, 'generated');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR);

// ============================================================
// STORYBOARD PROMPT —— PLACEHOLDERS / 占位提示词
// 出图的画风与专业标记，全靠下面这几段提示词。本开源版只给最简占位，
// 作者调好的版本不在仓库里。把它们换成你自己的，调出你想要的质量。
// 提示：prompt 里不要点名在世艺术家（如某某导演），图像模型会拒绝。
// ============================================================
const STYLE_PREFIX = `A black-and-white, hand-drawn cinematic storyboard sketch. Monochrome ink and graphite, 16:9.`;
// TODO(你来调)：写你自己的画风（笔触 / 明暗 / 质感 / 纸感 …）。

const NOTATION_RULES = `Use standard professional storyboard notation. Strictly NO text, letters, or numbers inside the image.`;
// TODO(你来调)：写你的分镜标记规则（摄影机箭头 / 主体箭头 / 轴线 等行业约定）。

const CAMERA_NOTATION_MAP = {
  // TODO(你来调)：为每种运镜写具体画法说明，决定出图里运镜记号的质量。
  STATIC: 'No camera-move arrow (static shot).',
  'DOLLY IN': 'Indicate a dolly-in camera move.',
  'DOLLY OUT': 'Indicate a dolly-out camera move.',
  'TRUCK L': 'Indicate a truck-left camera move.',
  'TRUCK R': 'Indicate a truck-right camera move.',
  'PAN L': 'Indicate a pan-left camera move.',
  'PAN R': 'Indicate a pan-right camera move.',
  'TILT UP': 'Indicate a tilt-up camera move.',
  'TILT DOWN': 'Indicate a tilt-down camera move.',
  'CRANE': 'Indicate a crane camera move.',
  'HANDHELD': 'Indicate a handheld camera.',
  'SLOW PUSH': 'Indicate a slow push-in camera move.',
  'ZOOM IN': 'Indicate a zoom-in.',
  'ZOOM OUT': 'Indicate a zoom-out.',
};

function buildImagePrompt(shot, characters = []) {
  const cam = CAMERA_NOTATION_MAP[shot.move] || CAMERA_NOTATION_MAP.STATIC;
  const genderMap = { female: 'female', male: 'male' };
  const castLine = (characters || [])
    .filter(c => c && c.name)
    .map(c => `${c.name} = ${genderMap[c.gender] || 'unspecified gender'}${c.note ? ' (' + c.note + ')' : ''}`)
    .join('; ');
  const castBlock = castLine
    ? `\nCHARACTERS (render each silhouette to match this gender — give female characters clearly feminine build/hair/posture, do NOT default everyone to male): ${castLine}.`
    : '';
  return `${STYLE_PREFIX}

${NOTATION_RULES}

SHOT TYPE (metadata only, NOT drawn in image): ${shot.shotType}, ${shot.move}, ${shot.lens}.
SUBJECT: ${shot.desc}${castBlock}
CAMERA NOTATION: ${cam}

NOT: any text, letters, numbers, characters, labels, corner stamps, watermarks.`;
  // TODO(你来调)：加你自己的灯光 / 主体走位标记 / 反向约束，决定画面气质。
}

// ============================================================
// OpenRouter call helper
// ============================================================
async function callOR(body) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:' + PORT,
      'X-Title': 'Frameline',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`OpenRouter ${r.status}: ${txt}`);
  }
  return r.json();
}

// ============================================================
// POST /api/breakdown
// ============================================================
app.post('/api/breakdown', async (req, res) => {
  const { scene = 'INT. 仓库 — 夜', script = '' } = req.body;
  if (!script.trim()) return res.status(400).json({ error: 'script is empty' });

  console.log(`[breakdown] scene="${scene}" script len=${script.length}`);

  const system = `你是专业影视导演的分镜助手。你的任务是把一场戏的剧本拆解成具体的镜头表。

输出格式严格 JSON：
{"slug": "INT. 地点 — 时间", "title": "段落标题（简短）", "characters": [{"name": "林", "gender": "female", "note": "坐轮椅的中年女人", "x": 0.78, "y": 0.35}], "shots": [{"id": 1, "shotType": "WIDE", "move": "STATIC", "lens": "24mm", "durSec": 4, "desc": "...", "dialogue": "", "sfx": ["..."], "section": "A · 进入仓库", "cam": {"x": 0.2, "y": 0.95, "aim": "林"}}]}

字段约束：
- slug: 标准场景 slug，格式 "INT./EXT. 地点 — 时间"，从剧本推断（如 "INT. 公寓 — 日"）
- title: 一句话场景/段落标题（简短，如 "对峙" 或 "重逢"）
- characters: 出场人物数组，每个含 name、gender（必须是 male / female / unknown 之一）、note（关键外形特征，可空）、x/y。务必从剧本判断每个人物的性别
- 调度坐标（俯视图）：想象一张房间俯视图，左上=(0,0)、右下=(1,1)。characters 的 x/y 是各人物在房间里的站位；每个 shot 的 cam.x/cam.y 是该镜头摄影机的位置，cam.aim 是它对准的人物 name（建立镜头可填 "mid"）。**所有机位尽量放在轴线（前两个主要人物连线）的同一侧**，正打/反打也保持同侧不跨线（避免跳轴）。坐标给 0~1 的小数即可，不必精确
- shotType: 必须从 [WIDE, MED, MCU, CU, ECU, OTS, OTS · REV, POV, EWS] 选
- move: 必须从 [STATIC, DOLLY IN, DOLLY OUT, PAN L, PAN R, TILT UP, TILT DOWN, TRUCK L, TRUCK R, CRANE, HANDHELD, SLOW PUSH, ZOOM IN, ZOOM OUT] 选
- lens: 必须从 [18mm, 24mm, 35mm, 50mm, 85mm, 100mm, 135mm, 200mm] 选
- durSec: 数字（秒）
- desc: 一句话画面描述（中文，30-60字，强调动作和构图）。**画面里有人物时必须点明其性别**（如"年轻女人""中年男人"），尤其女性角色要写明，否则出图会默认画成男性
- dialogue: 台词（若无留空字符串）
- sfx: 音效数组（最多2个）
- section: 若戏可分小节，用 "A · xxx" / "B · xxx" 标，单一场景就都用 "A · 主场"

返回 4-8 个镜头，节奏合理。只返回 JSON，不要任何额外文字。`;

  try {
    const data = await callOR({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `场景：${scene}\n\n剧本：\n${script}` },
      ],
      response_format: { type: 'json_object' },
    });
    const raw = data.choices[0].message.content;
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      // try to extract JSON from text
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('LLM did not return valid JSON');
    }
    console.log(`[breakdown] returned ${parsed.shots?.length || 0} shots`);
    res.json(parsed);
  } catch (e) {
    console.error('[breakdown] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// POST /api/generate-shot
// ============================================================
app.post('/api/generate-shot', async (req, res) => {
  const { shot, characters = [], refs = [] } = req.body;
  if (!shot) return res.status(400).json({ error: 'missing shot' });

  const validRefs = (refs || []).filter(u => typeof u === 'string' && u.startsWith('data:image'));
  console.log(`[generate-shot] SH${String(shot.id).padStart(2,'0')} ${shot.shotType} ${shot.move}${validRefs.length ? ' · refs=' + validRefs.length : ''}`);
  let prompt = buildImagePrompt(shot, characters);
  if (validRefs.length) {
    prompt += `\n\nCHARACTER CONSISTENCY: the attached reference image(s) show how the character(s) in this scene must look. Keep the SAME character identity — same hair, build, clothing, silhouette — but draw THIS shot's framing/pose/action. Match the reference, do not invent a different-looking person.`;
  }

  // 有参考图 → 多模态消息（文字 + 参考图）；否则纯文字
  const content = validRefs.length
    ? [{ type: 'text', text: prompt }, ...validRefs.map(url => ({ type: 'image_url', image_url: { url } }))]
    : prompt;

  try {
    const data = await callOR({
      model: IMAGE_MODEL,
      messages: [
        { role: 'user', content },
      ],
      modalities: ['image', 'text'],
    });

    // OpenRouter image gen returns images in message.images array
    const msg = data.choices?.[0]?.message;
    let imageDataUrl = null;

    if (Array.isArray(msg?.images) && msg.images.length) {
      const first = msg.images[0];
      // Possible shapes:
      //   { type: "image_url", image_url: { url: "data:..." } }   (current OpenRouter)
      //   { image_url: "data:..." }
      //   { url: "data:..." }
      //   "data:..." (plain string)
      if (typeof first === 'string') {
        imageDataUrl = first;
      } else if (first?.image_url?.url) {
        imageDataUrl = first.image_url.url;
      } else if (typeof first?.image_url === 'string') {
        imageDataUrl = first.image_url;
      } else if (first?.url) {
        imageDataUrl = first.url;
      }
    } else if (typeof msg?.content === 'string' && msg.content.startsWith('data:image')) {
      imageDataUrl = msg.content;
    }

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      // Dump full response to a file for inspection
      const dumpPath = path.join(GENERATED_DIR, `last-error-${Date.now()}.json`);
      fs.writeFileSync(dumpPath, JSON.stringify(data, null, 2));
      console.error('[generate-shot] no image. Dumped response to:', dumpPath);
      throw new Error('No image returned. Response dumped to ' + path.basename(dumpPath));
    }

    // Save a local copy for debugging
    if (imageDataUrl.startsWith('data:image')) {
      const m = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (m) {
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const fname = `sh${String(shot.id).padStart(2,'0')}-${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(GENERATED_DIR, fname), Buffer.from(m[2], 'base64'));
        console.log(`[generate-shot] saved generated/${fname}`);
      }
    }

    res.json({ imageDataUrl });
  } catch (e) {
    console.error('[generate-shot] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
app.listen(PORT, () => {
  console.log(`\n🎬  Frameline server ready`);
  console.log(`    Open: http://localhost:${PORT}/app/index.html`);
  console.log(`    Text model:  ${TEXT_MODEL}`);
  console.log(`    Image model: ${IMAGE_MODEL}\n`);
});
