# PaddleOCR 抽帧识别分支 — 实现计划

> 目标：为视频处理流水线新增「OCR 抽帧识别」能力，专门处理 **无音轨** 或 **音轨文字与时长明显不符常理** 的视频（如 1033：音轨是水印循环 + 画面烧录字幕，ASR 被 VAD 过滤成空）。OCR 定位为 ASR 的兜底补充，最终以「字符数 + 置信度」择优，绝不劣币驱逐良币。
>
> 吸收用户 8 点反馈（2026-08-15）：①OCR 不如 ASR 则回退 ASR、阈值放宽；②抽帧不丢帧、支持 1–2h 长视频；③README 写 PaddleOCR 安装 + 模型默认位置 + 改位置避 C 盘；④`.ocr.txt` 命名不影响断点续跑；⑤env/README 同步；⑥OCR 覆盖遵循第①点；⑦抽帧实用不遗漏；⑧`OCR_MODE=auto` 默认开启。

---

## 0. 架构总览

- **单一实现点**：OCR 逻辑集中在 `scripts/ocr_frames.py`（Python + PaddleOCR）。JS 与 Python 双端都通过 **subprocess 调用同一个脚本**（与 faster-whisper 的「JS 调 CLI / Python 调 API」不同，这里刻意统一为「双端都调脚本」），保证行为 100% 一致、避免两套 PaddleOCR 代码分叉。
- **新步骤 `ocr`**：加入步骤白名单与默认全流程。`ocr` 在 `download` 之后、`transcribe` 之前/并列运行（抽帧只需要原始视频 `dlFile`，不依赖转码后的 `.wav`）。
- **择优落盘**：`ocr` 产出 `transcripts/{sheet}/{stem}.ocr.txt`；最终写入 Excel 内容列与 progress `content` 的是 **OCR 与 ASR 择优后的文本**（best text），而非单纯覆盖。

---

## 1. 触发条件（`OCR_MODE=auto` 默认开启）

`OCR_MODE` 三态：
- `auto`（默认）：满足以下任一才真正跑 OCR：
  1. **无音轨** —— ffprobe `dlFile` 检测不到 audio stream；
  2. **ASR 文本与时长不符常理** —— `asrChars / durationMin < OCR_TRIGGER_CPM`（默认 `2`，即每分钟有效字符不足 2 个）。专治实验视频「说一句 + 长时间切画面等待」，阈值特意放宽，避免误触发。
  - 若 `auto` 且条件都不满足 → `ocr` 步骤标记 `skipped`，最终内容直接用 ASR 文本，不浪费算力。
- `always`：所有视频都跑 OCR（用于验证/全量补识别）。
- `off`：完全关闭 OCR 分支。

触发判定在 `ocr` 步骤开头做；`auto` 下不触发则直接 `skipped` 且不调用脚本。

---

## 2. 抽帧策略（不丢帧、长视频完整 — 对应第②⑦点）

**主抽帧（场景切换）**：
```
ffmpeg -i <dlFile> -vf "select='gt(scene,0.3)',scale=-1:720" -vsync 0 -frame_pts 1 <frames/%06d.png>
```
- `select='gt(scene,0.3)'`：画面显著变化才抽 → 烧录字幕恰好随场景切换出现，天然卡在字幕帧；静止画面不重复抽。
- `scale=-1:720`：保证文字清晰，不缩放过小。
- 1–2h 视频场景切换帧通常几百~一两千张，量可控。

**兜底（不丢帧保障）**：
- 关键帧补充：`select='eq(pict_type,I)'` 合并去重，确保字幕帧零遗漏。
- `OCR_MAX_FRAMES`（默认 `2000`）仅作保护上限：若场景切换帧超上限，自动放宽场景阈值（`0.3 → 0.2`）重抽，仍保证覆盖，**不盲目跳帧丢文字**。

**推理与拼接**：
- `scripts/ocr_frames.py` 逐帧跑 PaddleOCR，丢弃置信度 `< OCR_CONF_THRESH`（默认 `0.6`）的文本块。
- 按时间轴（帧序号/pts）排序，相邻帧重复文字合并去重，拼成最终 OCR 文本。
- 输出：stdout 打印最终文本；同时写 `<out>.ocr.txt` 与可选的 `<out>.ocr.frames.json`（每帧识别结果 + 置信度，便于调试）。

---

## 3. PaddleOCR 引擎与模型位置（对应第③点）

- 依赖：`pip install paddlepaddle paddleocr`（Apache 2.0，免费离线，百度源国内无 GFW）。
- **默认模型位置（Windows）**：`C:\Users\{username}\.paddleocr`
- **改位置避 C 盘**（避免占 C 盘）：
  - 环境变量 `PADDLE_OCR_BASE_DIR`（官方 v2.10.0 支持）；
  - 或代码 `PaddleOCR(det_model_dir=..., rec_model_dir=..., cls_model_dir=...)` 指定绝对路径；
  - 推荐：`D:\AI_Models\PaddleOCR`。
- `scripts/ocr_frames.py` 读取 `PADDLE_OCR_BASE_DIR` 并透传给 `PaddleOCR(...)`；README 写明安装步骤 + 这两点。
- `OCR_LANG`：`en`（默认，生物医学英文站）| `ch`，映射到 PaddleOCR `lang` 参数。

---

## 4. OCR vs ASR 择优（对应第①⑥点 — 核心）

`ocr` 步骤跑完后，与 ASR 文本（`result.transcribe.file`）比较，决定最终写入的内容：

- **采用 OCR** 的条件：`ocrChars >= asrChars` **且** `ocrAvgConf >= OCR_CONF_THRESH`。
- **否则回退 ASR**（含 ASR 本身为空、水印循环等情况 → 此时 OCR 直接胜出）。
- 这样 OCR 永远是兜底：质量不及 ASR 仍用 ASR，不会用噪声覆盖干净 ASR。
- 阈值放宽：`OCR_TRIGGER_CPM` 设低（放宽触发面），但择优阶段用「字符数 + 置信度」双重把关，避免触发宽泛导致劣币驱逐良币。

---

## 5. 产物命名与断点续跑兼容（对应第④点 — 关键）

- **独立产物**：`transcripts/{sheet}/{stem}.ocr.txt`（与 ASR 的 `transcripts/{sheet}/{stem}.txt` 完全独立，命名变化 **不影响** 原有 ASR 续跑检测）。
- **新增 helper**（镜像 `transcriptPath`, `process_videos.js:527`）：
  ```js
  function ocrTextPath(sheetName, stem) {
    const d = path.join(TRANSCRIPTS_DIR, sheetName);
    fs.mkdirSync(d, { recursive: true });
    return path.join(d, `${stem}.ocr.txt`);
  }
  ```
- **续跑 skip 判定**（镜像 `process_videos.js:2443-2480` 的 `prior.*` 逻辑）：
  - `prior.ocr && prior.ocr.status === 'success'` 且 `*.ocr.txt` 存在 + `validateOcrText()` 通过（`>= OCR_MIN_CHARS`，默认 `30`）→ `skipSteps.add('ocr')`。
  - `prior.ocr.status === 'skipped'`（auto 未触发）→ 直接 skip，复用 ASR。
  - `transcribe` 的 skip 判定（看 `*.txt`）**完全不动**，两套独立。
- **progress JSON 扩展**（镜像 `saveTaskProgress`, `process_videos.js:2097-2148`）：
  - 新增 `ocr: { status, file, error, chars, avgConf, triggered, reason }` 字段；
  - `content` 字段改为写入 **best text**（择优后的最终文本），resume 时若 `prior.content` 可用直接复用，无需重算；
  - `analyze`（关键词）步骤的输入改为 best text，而非仅 `result.transcribe.file`。
- `--force` 强制重跑 `ocr`；`--step` 不含 `ocr` 时从磁盘加载 `*.ocr.txt` + `prior.content`。

### 代码改动点（JS 端，Python 端对称）
| 位置 | 改动 |
|---|---|
| `process_videos.js:3669` allowed 列表 | 加入 `'ocr'` |
| `process_videos.js:3781` 默认 steps | `['download','transcode','transcribe','analyze','ocr']` |
| `process_videos.js:527` 附近 | 新增 `ocrTextPath()` + `validateOcrText()` |
| `process_videos.js:2443-2480` skip 逻辑 | 新增 `prior.ocr` 段 |
| `process_videos.js:2097-2148` saveTaskProgress | 新增 `ocr` 字段；`content` = best text |
| `process_videos.js` 步骤主循环（transcode 之后） | 新增 `ocr` 步骤：`hasAudioTrack()` + 触发判定 + 调 `scripts/ocr_frames.py` + 择优 |
| `process_videos.js` analyze 输入 | 改用 best text |
| `process_videos.py` 全对称 | 同上（步骤白名单、skip、`save_task_progress`、择优、analyze 输入） |

---

## 6. 配置项清单（对应第⑤⑧点）

新增到 `.env.example` + 双端代码（Python `os.getenv` / JS `process.env`）：

| 变量 | 默认 | 含义 | 标记 |
|---|---|---|---|
| `OCR_MODE` | `auto` | `auto` / `always` / `off` | 【调序】 |
| `OCR_BACKEND` | `paddleocr` | 当前仅 paddleocr | 【固定】 |
| `OCR_LANG` | `en` | `en` / `ch` | 【调序】 |
| `OCR_SCENE_THRESH` | `0.3` | 场景切换抽帧阈值 | 【自由】 |
| `OCR_MAX_FRAMES` | `2000` | 抽帧保护上限 | 【自由】 |
| `OCR_CONF_THRESH` | `0.6` | 文本块置信度下限 | 【自由】 |
| `OCR_TRIGGER_CPM` | `2` | auto 触发：每分钟最少有效字符 | 【自由】 |
| `OCR_MIN_CHARS` | `30` | ocr 产物最短长度（续跑校验） | 【自由】 |

`.env.example` 在「五、语音识别」段（line 305）之后插入新段「五-B / 六、OCR 抽帧识别」，含安装步骤、模型默认位置、改位置方式（`PADDLE_OCR_BASE_DIR`）、触发逻辑、优劣选择说明。

---

## 7. README 同步（对应第③⑤点）

- 新增章节「OCR 抽帧识别」：安装（pip）、模型默认位置 `C:\Users\{user}\.paddleocr`、改位置 `PADDLE_OCR_BASE_DIR`、`OCR_MODE` 三态、`auto` 触发条件、OCR/ASR 择优规则、产物 `*.ocr.txt` 与续跑兼容。
- 核心配置表补充 `OCR_*` 八项。
- 步骤总览图补充 `ocr` 步骤；「断点续跑」段补充 `*.ocr.txt` 校验说明。
- 更新 `README`「下载 → 转码 → 语音识别 → AI 关键词归纳」为含 OCR 的说明（可选，避免误导）。

---

## 8. 验证计划（1033 实跑）

1. 装 `paddlepaddle` + `paddleocr`，设 `PADDLE_OCR_BASE_DIR=D:\AI_Models\PaddleOCR` 让模型下到非 C 盘。
2. 单跑 1033：`node process_videos.js --step download --step transcode --step transcribe --step ocr --id <1033行>`（或全量带 ocr）。
3. 预期：`hasAudioTrack` 检测到水印音轨 → `auto` 触发 OCR → `*.ocr.txt` 出现画面烧录字幕文字 → 择优后 `content` = OCR 文本 → Excel 内容列写入 OCR 文字。
4. 对比：关 OCR（`OCR_MODE=off`）时 1033 仍为空（回归验证兜底逻辑不破坏原行为）。
5. 长视频抽样：挑一个 1h+ 视频验证抽帧帧数受 `OCR_MAX_FRAMES` 保护、不超时、不丢字幕。

---

## 9. 风险与见解

- **风险**：OCR 对模糊、艺术字、手写、强背景干扰识别差；长视频帧多推理慢（仅 `auto` 触发时跑，可接受）。
- **见解**：1033 类「音轨水印 + 画面烧录字幕」正是 OCR 最佳场景；VAD 把水印音轨过滤成空，OCR 补回画面文字。
- **结论**：OCR 定位为 ASR 兜底补充，以字符数 + 置信度择优，方案可行、风险可控。

---

## 10. 实现分期（小步提交，每节一 commit）

1. **P1 脚本**：`scripts/ocr_frames.py`（ffmpeg 抽帧 + PaddleOCR + 择优无关、纯抽帧输出）+ 双端调用封装 + 配置项读取。
2. **P2 触发与步骤**：`hasAudioTrack` + `OCR_MODE` 触发判定 + `ocr` 步骤接入（先只产出 `*.ocr.txt`，不接择优）。
3. **P3 择优与落盘**：OCR/ASR 比较、best text 写入 `content` 与 Excel、analyze 改用 best text。
4. **P4 续跑**：`prior.ocr` skip 逻辑 + `saveTaskProgress` 扩展 + `validateOcrText`。
5. **P5 文档**：`.env.example` OCR 段 + README 章节 + 核心配置表。
6. **P6 验证**：1033 + 长视频抽样，确认双端（JS 主改 + 全局副本 LF 同步、`node --check` / `py_compile`）+ 双远程推送。

> 注：遵循项目约定，每完成一个逻辑小节单独 commit 并推送（wincred）；JS 主改（CRLF）与全局安装副本（`D:/Programs/node_npm/node_global/node_modules/video-pipeline/`，LF）同步时用 `node -e` 写回并 `node --check` 校验。
