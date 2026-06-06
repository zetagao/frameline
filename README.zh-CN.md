# Frameline

[English](README.md) | 简体中文

**给影视 / 广告从业者用的 AI 分镜工具。**
粘贴一场戏的剧本 → AI 拆成一张真正的镜头表（景别、运镜、镜头、轴线、调度）→ 生成黑白手绘电影感分镜板 → 导出 PDF、Excel 通告表、EDL 或 FCPXML。

不是"用一句提示词出一张好看的图"——而是**以「场」为粒度**，产出一整场戏能直接拿去拍、能接进真实制作与剪辑流程的分镜。

![工作台](screenshots/workspace.png)

---

## 功能

- **场粒度拆解** —— 粘贴一整场戏，AI 返回镜头列表（镜号 / 景别 / 运镜 / 镜头 / 时长 / 描述 / 台词 / 音效），可编辑。
- **真正的镜头表** —— 用行业通用标记，不只是图。
- **黑白手绘分镜板** —— 每个镜头出一张电影感草图，运镜箭头按行业惯例画在画面边缘。
- **角色一致性** —— 把角色参考图喂进生成，让同一角色在多镜之间保持一致（首张板自动锚定，也可手动指定）。
- **动态调度图** —— 每场一张俯视调度图：角色位置、轴线、以及每个镜头的机位 + 视野范围。

  ![调度图](screenshots/floorplan.png)

- **导出** —— PDF 分镜、**内嵌分镜图的 Excel 通告表**、EDL（CMX3600）以及给 Premiere / DaVinci / Final Cut 用的 FCPXML。

| | |
|---|---|
| ![分镜板 1](screenshots/board-1.png) | ![分镜板 2](screenshots/board-2.png) |

---

## 工作原理

- **文本拆解** 用大语言模型（默认 `anthropic/claude-sonnet-4`），经 [OpenRouter](https://openrouter.ai) 调用。
- **图像生成** 用图像模型（默认 `openai/gpt-5-image`），同样经 OpenRouter，支持传参考图做角色一致性。
- 前端是单文件静态 HTML 应用；一个轻量 Node/Express 服务负责代理 OpenRouter 请求。

> **自带 OpenRouter API key。** 服务用的是*你自己的* key，只为你自己的用量付费。

> **说明 —— 不含调好的提示词。** 决定成品风格的那套调过的「画风 / 标记」提示词**不在本仓库里**，`server/server.js` 里是简单占位。想要好效果请自己补（搜 `TODO(你来调)`）。拆解结构的提示词是包含的，所以工具开箱即可跑通。

---

## 快速开始

```bash
# 1. 需要 Node 18+
cd server
npm install

# 2. 填入你的 OpenRouter key
cp .env.example .env
# 然后编辑 .env，把 OPENROUTER_API_KEY=sk-or-... 改成你的真 key

# 3. 启动
node server.js

# 4. 浏览器打开
#    http://localhost:3000/app/index.html
```

不启动服务（直接以文件方式打开 `app/index.html`）时，应用以静态 demo 形式运行、用占位反馈——方便看 UI，但不会真正调用 AI。

---

## 技术栈

- 前端：原生 HTML / CSS / JS（Tailwind CDN、GSAP、jsPDF、html2canvas、ExcelJS）
- 服务：Node + Express + OpenRouter API
- 无构建步骤、无框架。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
