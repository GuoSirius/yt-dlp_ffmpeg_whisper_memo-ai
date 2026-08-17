# 配置一致性审计：代码 / .env.example / README

审计范围：`process_videos.js`、`process_videos.py`、`scripts/ocr_frames.py` 实际读取的环境变量，
对比 `.env.example` 模板与 `README.md`（§3.1 配置表、§9.1 平台 URL 格式、语音识别章节）。

## 一、总体结论

| 维度 | 结论 |
|------|------|
| 覆盖完整性 | ✅ 所有代码**实际生效**的用户配置项，在 `.env.example` 与 README §3.1 中均有对应条目，无"硬遗漏" |
| 三处一致性 | ⚠️ 4 处默认值/取值对不上（`WHISPER_LANGUAGE`、`.env.example` 进阶参数、作者本机路径、`EXCEL_FILE` 样例名） |
| 文档超前于实现 | ⚠️ `.env.example` 有 14 个"进阶"变量注释后未接入代码，取消注释不生效 |
| 多余配置 | ✅ 无明显多余项；pass-through 变量（XDG_CACHE_HOME / HF_HOME / MODELSCOPE_CACHE / HF_ENDPOINT / PADDLE_OCR_BASE_DIR）虽主脚本不读，但被子库/子进程消费，非冗余 |
| 新增的 COL_VIDEOLINK | ✅ 三处齐全且行为一致（代码 / .env.example 第 69 行 / README §3.1 第 256 行） |

---

## 二、分类对比矩阵（按模块）

### 2.1 输入与字段映射
| 配置 | 代码读取 | .env.example | README | 状态 |
|------|---------|-------------|--------|------|
| EXCEL_FILE | ✅(`envPath`,默认 `data/examples/website_split.xlsx`) | ✅ 但写成 `website_split_demo.xlsx` | ✅(仅说"路径") | ⚠️ 文件名不一致 |
| VIDEO_SHEETS | ✅ | ✅ | ✅ | OK |
| COL_ID/TITLE/CONTENT/KEYWORDS | ✅ | ✅ | ✅ | OK |
| COL_TENCENTVID/BILIBILIBVID/YOUTUBEID/YOUKUID | ✅ | ✅ | ✅ | OK |
| COL_VIDEOLINK | ✅ | ✅ | ✅(§3.1 第256行) | OK |

### 2.2 平台与下载
| 配置 | 代码读取 | .env.example | README | 状态 |
|------|---------|-------------|--------|------|
| PLATFORM_PRIORITY | ✅(默认 `bilibili,youtube,tencent,youku`) | ✅ | ✅ | OK |
| {平台}_URL_TPL | ✅(动态前缀读取) | ✅ | ✅ | OK |
| OUTPUT_DIR / COOKIES_DIR | ✅(`envPath`) | ✅ | ✅ | OK |
| {平台}_COOKIES_FROM_BROWSER / COOKIE_FILE | ✅ | ✅ | ✅ | OK |
| {平台}_PROXY / USER_AGENT | ✅ | ✅ | ✅ | OK |
| {平台}_FORMAT / JS_RUNTIMES / REMOTE_COMPONENTS | ✅ | ✅(2.3通用列表) | ✅(§3.1 265) | OK |
| **{平台}_REFERRER** | ✅(仅 bilibili 生效) | ✅(2.3列表; BILIBILI_REFERRER 已填) | ❌ 表内未列 | ⚠️ README 缺 |
| **{平台}_CONCURRENT_FRAGMENTS** | ✅ | ✅(2.3列表; BILIBILI_ 已填) | ⚠️ 仅 §9.1 提及 | ⚠️ README 表内缺 |
| PROXY_PROBE_TIMEOUT | ✅ | ✅ | ✅ | OK |
| XDG_CACHE_HOME / HF_HOME / MODELSCOPE_CACHE / HF_ENDPOINT | ⚪ 主脚本不读（子库消费） | ✅(注释示例) | ✅ | OK(透传) |

### 2.3 识别（WHISPER_* / FUNASR_*）
- 代码读取的 WHISPER_* 共 22 个、FUNASR_* 共 15 个（含 *_EXTRA_ARGS）；README §3.1 称"七组共 36 个变量"——按 README 自身分组（共享4+本地11+faster4+服务2 + funasr 9+4+2）正好 36，**口径自洽，不计入 2 个 *_EXTRA_ARGS**，故数量无误，无需修正。
- 主体变量（BACKEND/MODEL/LANGUAGE/DEVICE/COMPUTE_TYPE/VAD_*/MODE/FUNASR_* 等）三处一致。
- ⚠️ 详见第三节"对不上"项（`WHISPER_LANGUAGE` 默认、`WHISPER_SERVICE_MODEL` 写死路径、进阶参数未接入）。

### 2.4 AI / 工具 / 转码 / OCR
| 配置 | 代码读取 | .env.example | README | 状态 |
|------|---------|-------------|--------|------|
| AI_ENABLED/API_KEY/BASE_URL/MODEL/TEMPERATURE/PROMPT_TPL/DEBUG | ✅ | ✅ | ✅ | OK |
| YTDLP / FFMPEG / FFPROBE | ✅ | ✅ | ✅ | OK |
| TRANSCODE_EXT / TRANSCODE_ARGS | ✅ | ✅ | ✅ | OK |
| OCR_MODE/BACKEND/LANG/SCENE_THRESH/MAX_FRAMES/CONF_THRESH/TRIGGER_CPM/MIN_CHARS | ✅ | ✅ | ✅ | OK |
| PYTHON_BIN / PADDLE_OCR_BASE_DIR | ✅(PADDLE_OCR_BASE_DIR 由 ocr_frames.py 读) | ✅ | ✅ | OK |
| MIN_TRANSCRIPT_CHARS / MIN_KEYWORDS_CHARS | ✅ | ✅ | ✅ | OK |
| EXCEL_FLUSH_INTERVAL / EXCEL_LOCK_MAX_WAIT | ✅ | ✅ | ✅ | OK |

---

## 三、具体问题清单（对不上 / 错误 / 遗漏）

### 🔴 1. `WHISPER_LANGUAGE` 默认值三处打架（错误/对不上）
- 代码：`process_videos.js:141` 与 `process_videos.py:157` 默认均为 `''`（空 = 自动检测）。
- `.env.example:374`：`WHISPER_LANGUAGE=en`（非注释，强制英文）。
- `README.md:338`：默认值列写 `en`，但正文又说"空=多语言自动检测"。
- 影响：若用户从 `.env` 删掉该行，行为从"英文"悄悄变成"自动检测"，与文档承诺不符。
- 建议：统一口径——要么代码默认改为 `'en'`，要么将 `.env.example` 与 README 都改为"默认留空=自动检测"。

### 🔴 2. `.env.example` 14 个"进阶"变量未接入代码（文档超前于实现）
以下变量在 `.env.example` 中带"需要时取消注释"注释，但**代码无任何读取逻辑**，取消注释后不会产生任何效果：

WHISPER 组（433–446 行附近）：
`WHISPER_PATIENCE`、`WHISPER_SUPPRESS_TOKENS`、`WHISPER_CARRY_INITIAL_PROMPT`、
`WHISPER_COMPRESSION_RATIO_THRESHOLD`、`WHISPER_LOGPROB_THRESHOLD`、
`WHISPER_NO_SPEECH_THRESHOLD`、`WHISPER_HALLUCINATION_SILENCE_THRESH`、`WHISPER_VERBOSE`

FUNASR 组（574–579 行附近）：
`FUNASR_MODEL_REVISION`、`FUNASR_VAD_REVISION`、`FUNASR_PUNC_REVISION`、
`FUNASR_MODEL_DIR`、`FUNASR_THREADS`、`FUNASR_VERBOSE`

> 对照：真正生效的是 `WHISPER_EXTRA_ARGS` / `FUNASR_EXTRA_ARGS`（代码确实读取，§5 / §5-B 已正确注释）。
- 建议：
  - 短期：在注释里明确标注"以下参数**尚未接入**，需用 `*_EXTRA_ARGS` 以 CLI 参数字符串形式传入"；
  - 或补实现（在 CLI 拼参处读取这些变量）。

### 🟡 3. `WHISPER_SERVICE_MODEL` 在模板里写死作者本机路径（错误/多余）
- `.env.example:364`：`WHISPER_SERVICE_MODEL=D:/Programs/memo-ai/models/ggml-medium.bin`（非注释）。
- 代码默认 `''`；README:322 说"留空=使用当前已加载模型"。
- 这是作者本机绝对路径，既非合理默认值，又有泄露机器信息之嫌，且只在 `WHISPER_BACKEND=service` 时才有意义。
- 建议：改为注释掉或留空（与 README 描述一致），例如 `# WHISPER_SERVICE_MODEL=`。

### 🟡 4. `EXCEL_FILE` 示例文件名三处不完全一致
- 代码默认：`data/examples/website_split.xlsx`（`process_videos.js:60` / `process_videos.py:111`）。
- `.env.example:31`：`data/examples/website_split_demo.xlsx`。
- 二者指向不同文件名；README 未指明该样例文件是否存在。
- 建议：统一为一个真实存在的文件名，避免新用户照抄后报"文件不存在"。

### 🟡 5. README §3.1 配置表漏列两个平台级变量（遗漏）
- `{平台}_REFERRER`：代码 `process_videos.js:384`/`process_videos.py:359` 读取（仅 bilibili 生效），`.env.example` 已填 `BILIBILI_REFERRER`，但 README §3.1 表未出现。
- `{平台}_CONCURRENT_FRAGMENTS`：代码读取，`.env.example` 已填 `BILIBILI_CONCURRENT_FRAGMENTS`，README 表内未列（仅 §9.1 提及）。
- 建议：在 §3.1 平台分类补一行，或将其并入 264 行的"格式/UA"合并行说明。

---

## 四、一致 / 已正确项（确认无问题）
- ✅ `COL_VIDEOLINK`：代码、`.env.example`(第69行)、README(§3.1 第256行) 三处齐全，优先级/回退/落盘逻辑与文档一致。
- ✅ `URL_PLATFORM_MAP`（JS）/ `_URL_PLATFORM_MAP`（PY）已覆盖 README §9.1 列的全部平台 URL 形态（标准页/短链/iframe/移动端/av号/youku video 路径等），双端对称。
- ✅ 四个平台 ID 列、`PLATFORM_PRIORITY`、各 `*_URL_TPL`、`AI_*`/`OCR_*`/`WHISPER_*`/`FUNASR_*` 主体一致。
- ✅ `*_EXTRA_ARGS` 进阶通道真实生效。
- ✅ pass-through 缓存变量（XDG_CACHE_HOME / HF_HOME / MODELSCOPE_CACHE / HF_ENDPOINT / PADDLE_OCR_BASE_DIR）被子库消费，非冗余。
