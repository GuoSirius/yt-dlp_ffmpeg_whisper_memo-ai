# 视频处理流水线 (Video Pipeline)

基于 `process_videos.js` (Node.js) 或 `process_videos.py` (Python)，一键完成：yt-dlp 下载 → ffmpeg 转码 → whisper 识别 → AI 关键词归纳 → 写回 Excel。

**五种使用方式，覆盖不同场景：**

| 模式 | 输入 | 跳过步骤 | 适用场景 |
|------|------|---------|----------|
| **Excel 批量** | Excel 行（多视频） | — | 批量处理全流程 |
| **--url 直链** | 单个视频 URL | — | 临时下载单个视频 |
| **--input 本地** | 本地视频/音频文件 | 下载 | 处理已有文件 |
| **--content 纯文本** | 文件路径或内联文本 | 下载+转码+识别 | 已有文本直接分析 |
| **--content-column** | Excel 列的已有文本 | 下载+转码+识别 | 批量分析 Excel 中的文本 |

---

## 安装方式

### Node.js 版本（推荐）

```bash
# 全局安装
npm install -g video-pipeline

# 使用后可直接调用
video-pipeline --help
```

### Python 版本

```bash
# 克隆或下载脚本
git clone https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai.git
cd yt-dlp_ffmpeg_whisper_memo-ai

# 安装 Python 依赖
pip install pandas openpyxl requests python-dotenv questionary
```

---

## 环境依赖

### 必装工具

| 工具 | 版本要求 | 安装方式 | 用途 |
|------|-----------|----------|------|
| Python | 3.9+ | [python.org](https://www.python.org/) | 脚本运行 |
| yt-dlp | 最新 | `pip install yt-dlp` 或 [GitHub Release](https://github.com/yt-dlp/yt-dlp/releases) | 视频下载 |
| ffmpeg + ffprobe | 4.0+ | [ffmpeg.org](https://ffmpeg.org/download.html) 或 `winget install ffmpeg` | 音频转码 + 时长检测 |

> **验证安装**：在终端执行 `yt-dlp --version`、`ffmpeg -version`、`ffprobe -version`，确保均在 PATH 中。

### 必装 Node.js（YouTube n-sig 挑战）

YouTube 要求 JS 运行时解开 n-sig 挑战，否则无法提取视频格式。

| 方式 | 安装命令 |
|------|----------|
| Node.js（推荐） | [nodejs.org](https://nodejs.org/) 下载 LTS 版，安装后 `node --version` 验证 |
| Deno | `winget install DenoLand.Deno` 或 [deno.com](https://deno.com/) |

> 脚本默认使用 `--js-runtimes node`，如果你装的是 deno，修改 `.env` 中 `YOUTUBE_JS_RUNTIMES=deno`。

### Python 依赖

```bash
pip install pandas openpyxl requests python-dotenv questionary
```

> `questionary` 为可选依赖（交互式确认时使用），建议一并安装。

### 环境变量配置（.env）

**从 v2 开始，所有路径、字段映射、平台参数均通过 `.env` 文件配置。** 这意味着同一套脚本可以直接用于其他 Excel 文件，只需修改 `.env` 中的值即可。

```bash
# 首次使用：复制模板
cp .env.example .env

# 编辑 .env 适配你的 Excel 结构
# 详见 .env.example 中的注释
```

**核心配置项说明：**

| 分类 | 变量 | 说明 |
|------|------|------|
| 输入 | `EXCEL_FILE` | Excel 文件路径 |
| 列映射 | `COL_ID` / `COL_TITLE` / `COL_CONTENT` / `COL_KEYWORDS` | 唯一标识列 / 标题列 / 识别文本输出列 / AI 关键词输出列 |
| 列映射 | `COL_TENCENT` / `COL_BILIBILI` / `COL_YOUTUBE` / `COL_YOUKU` | 各平台视频 ID 所在列 |
| Sheet | `VIDEO_SHEETS` | 逗号分隔需要处理的 sheet（留空则全部） |
| 平台 | `PLATFORM_PRIORITY` | 平台重试优先级 |
| 平台 | `{平台}_URL_TPL` | URL 模板（如 `YOUTUBE_URL_TPL=https://youtu.be/{youtube}`） |
| 平台 | `{平台}_COOKIES_FROM_BROWSER` | 从浏览器直读 cookie（推荐 Firefox，替代手动导出文件） |
| 平台 | `{平台}_COOKIE_FILE` | cookie 文件路径（备用方案，需定期更新） |
| 平台 | `{平台}_PROXY` | 代理地址（如 `http://127.0.0.1:7897`，Clash Verge） |
| 平台 | `{平台}_FORMAT` / `{平台}_USER_AGENT` | 下载格式 / UA |
| 平台 | `{平台}_JS_RUNTIMES` / `{平台}_REMOTE_COMPONENTS` | JS 运行时 / 远程组件（YouTube n-sig 求解） |
| 识别 | `WHISPER_BACKEND` | `local`（本地 openai-whisper）/ `faster-whisper`（CTranslate2 加速，推荐）/ `service`（whisper.cpp server）/ `funasr`（阿里 FunASR，中文 WER ~5%，中文场景强烈推荐） |
| 识别 | `WHISPER_*` / `FUNASR_*` 系列 | 详见下方「Whisper 语音识别」章节——分共享(4) / 本地(11) / faster-whisper(4) / 服务(2) / **funasr 共享(9) + funasr CLI(4) + funasr service(2) = 15** 七组，共 36 个变量 |
| 工具 | `YTDLP` / `FFMPEG` / `FFPROBE` | 外部工具路径 |
| 输出 | `OUTPUT_DIR` | 输出根目录（默认 `output`），7 个子目录（`downloads/` `transcoded/` `transcripts/` `keywords/` `reports/` `progress/` `logs/`）由代码自动创建，目录名硬编码。优先级：**CLI `--output <dir>` > env `OUTPUT_DIR` > 默认 `output`** |
| 输出 | `COOKIES_DIR` | Cookie 文件目录（独立于 `OUTPUT_DIR`，不归并到其下） |
| 校验 | `MIN_TRANSCRIPT_CHARS` / `MIN_KEYWORDS_CHARS` | 断点续跑时的最小长度阈值（字符数）。识别文本/关键词文件低于此值视为残缺产物，会被清理并重做。默认 `50` / `5` |
| AI 分析 | `AI_ENABLED` | `true` 启用 / `false` 跳过（默认 true） |
| AI 分析 | `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | OpenAI 兼容 API 配置 |
| AI 分析 | `AI_PROMPT_TPL` | 提示词模板，必须包含 `{content}` 占位符。支持文件路径（try-file-first），CLI 覆盖：`--ai-prompt <text|path>`（CLI > .env > 内置默认） |
| AI 分析 | `AI_TEMPERATURE` | AI 推理温度 (0.0~2.0) |
| AI 分析 | `AI_DEBUG` | `true` 时打印实际发送的 prompt 前 500 字符 + AI 返回内容前 500 字符，用于排查关键词质量问题（默认 `false`） |

### .env 配置项变更权限

`.env.example` 中每个配置项都带有变更权限标记，含义如下：

| 标记 | 含义 | 涵盖的配置项 | 示例 |
|------|------|-------------|------|
| **【自由】** | 值可随意改为任意合法内容 | 路径、开关、数字、字符串、URL、UA、格式参数等 | `EXCEL_FILE`, `YOUTUBE_PROXY`, `WHISPER_MODEL` |
| **【调序】** | 只能从固定集合中增减/排序，不能用集合外的值 | `PLATFORM_PRIORITY` | 只能包含 `bilibili` / `youtube` / `tencent` / `youku` |
| **【关联】** | 值需与脚本内约定的 Key 名一致 | URL 模板中的 `{占位符}` | `{youtube}` 必须跟 `COL_YOUTUBE` 的后缀一致 |
| **【固定】** | 除非 Excel 列名或脚本内部逻辑改变，否则不应修改 | 列名映射 | `COL_ID=extra.id`、`COL_TITLE=title` 等 |

> **最容易混淆的是【调序】**：`PLATFORM_PRIORITY` 可以调整顺序、增减条目，但只能用脚本已定义的 4 个 key，新增 `tiktok`、`douyin` 等无效 key 会导致脚本无法识别。

### Whisper 语音识别

支持**四种后端**，通过 `WHISPER_BACKEND` 切换。所有 Whisper / FunASR 相关环境变量分多组管理：

**🔷 共享变量（四种后端均生效）**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WHISPER_BACKEND` | `local` | 后端选择：`local` / `faster-whisper` / `service` / **`funasr`**（中文专用, WER ~5%） |
| `WHISPER_TEMPERATURE` | `0.0` | 采样温度（0.0=贪婪解码，推荐中文识别） |
| `WHISPER_TEMPERATURE_INC` | `0.2` | 温度递减步长（fallback 时温度递增步长） |
| `WHISPER_OUTPUT_FORMAT` | `json` | 输出格式：`json` / `txt` / `srt` / `vtt` / `tsv` |

**🔶 服务模式独有**（`WHISPER_BACKEND=service`）

需要本地或远程运行 whisper.cpp server，监听 `http://127.0.0.1:9588`。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WHISPER_SERVICE` | `http://127.0.0.1:9588` | whisper.cpp server 地址 |
| `WHISPER_SERVICE_MODEL` | （模型文件路径） | 模型文件路径，如 `models/ggml-base.bin`；留空=使用当前已加载模型 |

API 端点：
- `POST /inference` ← 上传 wav 文件，返回识别文本（参数: file / temperature / temperature_inc / response_format）
- `POST /load` ← 切换模型（参数: model=模型文件路径），脚本首次识别时自动调用，同一模型只加载一次（缓存）

> 注意：四种模式不能混用。`WHISPER_MODEL` / `WHISPER_LANGUAGE` 等本地变量在服务模式或 faster-whisper 模式下不生效；`WHISPER_COMPUTE_TYPE` / `WHISPER_VAD_FILTER` 等 faster-whisper 专有变量在其他模式下不生效；`FUNASR_*` 仅在 funasr 模式下生效；反之亦然。

**🔸 本地模式独有**（`WHISPER_BACKEND=local`）

需安装 `openai-whisper`：`pip install openai-whisper`，脚本直接调用 `whisper` CLI。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WHISPER_TASK` | `transcribe` | 任务类型: transcribe / translate |
| `WHISPER_MODEL` | `medium` | 模型大小：tiny / base / small / medium / large-v3 / turbo |
| `WHISPER_LANGUAGE` | `zh` | 语言代码（zh/en/ja 等），空=多语言自动检测 |
| `WHISPER_DEVICE` | `cpu` | 推理设备：cpu / cuda |
| `WHISPER_MODEL_DIR` | 空 | 模型缓存目录，空=`~/.cache/whisper`（或 `$XDG_CACHE_HOME/whisper`） |
| `WHISPER_BEAM_SIZE` | `5` | Beam search 宽度（越大越准但越慢，建议 5） |
| `WHISPER_BEST_OF` | `5` | 候选采样数（非零时启用温度采样） |
| `WHISPER_INITIAL_PROMPT` | 生物医学 90+ 术语 | 首段音频提示词，已预填细胞/免疫/分子/蛋白/实验技术等高频术语，空格分隔。支持文件路径（try-file-first）：值指向存在的文件则读取内容。CLI 覆盖：`--whisper-initial-prompt <text|path>`（CLI > .env > 内置默认） |
| `WHISPER_CONDITION_ON_PREV` | `False` | 推荐 `False`：每段独立解码，避免长视频错误累积；`True`=前段文本传入当前段（仅适合短音频<30分钟） |
| `WHISPER_FP16` | `False` | FP16 推理（需 CUDA/GPU，CPU 上无效） |
| `WHISPER_THREADS` | `0` | CPU 线程数（0=自动检测） |
| `WHISPER_EXTRA_ARGS` | 空 | 额外 whisper CLI 参数（shell 字符串，如 `--beam_size 5 --verbose`），追加到命令末尾。同名参数自动去重（extra 覆盖已有）。CLI 覆盖：`--whisper-extra-args`（CLI > .env） |

> **选择建议**：默认 `False`（每段独立，避免长视频错误累积）；短音频(<30min)单人连贯语音可设 `True` 提升连贯性。专有名词多的场景可配合 `INITIAL_PROMPT` 提升准确率，详细示例见 `.env.example`。需要微调 whisper 行为时可通过 `WHISPER_EXTRA_ARGS` 传入额外 CLI 参数（如 `--beam_size 10 --verbose`），同名参数自动去重。

**🔹 faster-whisper 模式独有**（`WHISPER_BACKEND=faster-whisper`）

CTranslate2 重写的 Whisper 推理实现，速度约为 openai-whisper 的 4 倍、内存减半，推荐用于 CPU 批量场景。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WHISPER_COMPUTE_TYPE` | `int8` | 计算精度：`int8`（CPU 最优）/`float16`（GPU 推荐）/`int8_float16`/`default`/`auto` |
| `WHISPER_VAD_FILTER` | `True` | 启用 Silero VAD 静音过滤，减少幻觉、加速推理 |
| `WHISPER_VAD_ONSET` | `0.5` | VAD 灵敏度阈值（0.0~1.0，越高越严格/只保留高置信语音） |
| `WHISPER_NUM_WORKERS` | `1` | CTranslate2 并行 worker 数（仅 Python 版生效；JS 版 CLI 不支持此参数） |

> **Python vs JS 差异**：
> - Python 版：使用 `faster_whisper.WhisperModel` Python API（`num_workers` + `vad_parameters.onset`）
> - Node.js 版：调用 `whisper-ctranslate2` CLI（无 `--num_workers`，VAD 阈值参数名为 `--vad_threshold`）
> - 两者参数语义一致，CLI 参数名自动映射，用户无需关心差异
>
> **依赖**：
> - Python 版：`pip install faster-whisper`（使用 Python API 模块导入，模型实例全局缓存）
> - Node.js 版：`pip install whisper-ctranslate2`（脚本以 `whisper-ctranslate2` CLI 方式调用，参数透传）
>
> **共享参数复用**：`WHISPER_MODEL` / `WHISPER_LANGUAGE` / `WHISPER_BEAM_SIZE` / `WHISPER_INITIAL_PROMPT` / `WHISPER_EXTRA_ARGS` 等 17 个共享变量在 faster-whisper 模式下同样生效，无需重复配置。

**🔸 funasr 模式独有**（`WHISPER_BACKEND=funasr`）

阿里达摩院开源的工业级中文语音识别工具包，中文 WER 约 **5%**（Whisper 中文约 15%），内置 VAD + 标点 + 热词 + 说话人 + 情感识别能力。推荐中文场景使用。

funasr 模式通过 `FUNASR_MODE` 进一步选择子模式：
- **`cli`**（默认）= 本地 `funasr` CLI（首次自动从 ModelScope 下载模型，CPU 也能跑）
- **`service`** = 远程 `funasr-server`（OpenAI 兼容 API，GPU 推荐，多任务并发）

**funasr 共享变量（cli + service 通用）**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FUNASR_MODE` | `cli` | 子模式：`cli`（本地 AutoModel）/`service`（远程 funasr-server） |
| `FUNASR_MODEL` | `paraformer-zh` | 主 ASR 模型：见下「可用模型对比表」 |
| `FUNASR_VAD_MODEL` | `fsmn-vad` | VAD 模型（语音活动检测），留空=用主模型内置 VAD |
| `FUNASR_PUNC_MODEL` | `ct-punc` | 标点恢复模型（自动加中英文标点），留空=不做标点恢复 |
| `FUNASR_SPK_MODEL` | 空 | 说话人分离/确认模型（`cam++`），留空=不做说话人分离 |
| `FUNASR_EMOTION_MODEL` | 空 | 情感识别模型（`emotion2vec_plus_large`），留空=不做情感识别 |
| `FUNASR_HOTWORD` | 空 | 热词列表（空格分隔），如 `"魔搭 ModelScope 通义千问"`，显著提升专有名词识别 |
| `FUNASR_LANGUAGE` | `zh` | 主语言（中文 `zh`；SenseVoice 配 `auto` 可自动检测 50+ 语种） |
| `FUNASR_EXTRA_ARGS` | 空 | 额外 funasr 参数（shell 字符串），追加到命令末尾。同名参数自动去重（extra 覆盖已有）。CLI 覆盖：`--funasr-extra-args`（CLI > .env） |

**funasr CLI 模式独有**（`FUNASR_MODE=cli`）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FUNASR_DEVICE` | `cpu` | 推理设备：`cpu` / `cuda`（GPU 强烈推荐，中文 large 模型差距 10×+） |
| `FUNASR_QUANTIZE` | `True` | int8 量化（省 50% 内存，CPU 推荐；GPU 设为 `False`） |
| `FUNASR_BATCH_SIZE_S` | `300` | 动态批处理音频秒数（60-600，大文件=更大值） |
| `FUNASR_VAD_MAX_SEGMENT` | `20000` | VAD 最大单段长度（ms，`0`=不切分） |

依赖：`pip install funasr modelscope`，脚本以 `funasr ++model=... ++input=...` 方式调用，模型自动从 ModelScope 下载到 `~/.cache/modelscope/hub`。

**funasr 服务模式独有**（`FUNASR_MODE=service`）

需先启动 `funasr-server`：
```bash
# GPU 模式（强烈推荐）
pip install funasr vllm fastapi uvicorn python-multipart
funasr-server --device cuda --port 8899

# CPU 模式
funasr-server --device cpu --port 8899

# 额外启用 MCP 协议（让 Claude / Cursor 等 AI 助手能直接调用语音识别）
funasr-server --device cuda --port 8899 --enable-mcp
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FUNASR_SERVICE_URL` | `http://localhost:8899` | funasr-server 地址 |
| `FUNASR_SERVICE_MODEL` | `iic/SenseVoiceSmall` | 服务侧加载的模型 ID（首次调用会触发 ModelScope 下载） |

API 端点（OpenAI 兼容）：`POST {URL}/v1/audio/transcriptions`（参数: file / model / response_format / prompt=热词 / language），脚本首次识别时直接调用，模型由服务端管理。

**FunASR 可用模型对比表**（funasr 1.3.9，2026-05-29 发布）

| 模型名 | 参数量 | 磁盘 | 速度 | 语种 | 时间戳 | 情绪 | 事件 | 说话人 | 推荐场景 |
|--------|--------|------|------|------|--------|------|------|--------|----------|
| `paraformer-zh` | 220M | ~1GB | 13×实时 | zh/en | ✓ | ✗ | ✗ | 需 cam++ | **中文首选（精度最高）** |
| `SenseVoiceSmall` | 234M | ~1GB | 170×实时 | 50+ | ✗ | ✓ | ✓ | 需 cam++ | 多语种/实时/需情绪/事件 |
| `Fun-ASR-Nano` | 800M | ~3GB | 加速（vLLM） | 31 | ✓ | ✗ | ✗ | 需 cam++ | 复杂上下文理解 |
| `paraformer-zh-streaming` | 220M | ~1GB | 流式 | zh/en | ✓ | ✗ | ✗ | 需 cam++ | 实时字幕 |
| `Qwen3-ASR` | 1700M | ~7GB | 较慢 | 52 | ✗ | ✗ | ✗ | 需 cam++ | 多语种高质量 |
| `GLM-ASR-Nano` | 1500M | ~6GB | 较慢 | 17 | ✗ | ✗ | ✗ | 需 cam++ | 方言场景 |
| `Whisper-large-v3` | 1550M | ~3GB | 1× | 多 | ✗ | ✗ | ✗ | 需 cam++ | 兼容 Whisper 用户 |
| `Whisper-large-v3-turbo` | 809M | ~2GB | 2-3× | 多 | ✗ | ✗ | ✗ | 需 cam++ | Whisper 加速 |

辅助模型（按需搭配主模型）：

| 模型 | 参数量 | 磁盘 | 速度 | 功能 |
|------|--------|------|------|------|
| `fsmn-vad` | 0.4M | 内置 | 实时 | VAD 语音活动检测 |
| `ct-punc` | 290M | ~1GB | — | 中英文标点恢复 |
| `cam++` | 7.2M | 内置 | 实时 | 说话人分离/确认（CPU 实时） |
| `emotion2vec_plus_large` | 300M | ~1GB | — | 情感识别 |

> **选择建议**：
> - **中文批量处理** → `paraformer-zh`（高精 + 13×实时，CPU 也能跑，性价比最高）
> - **多语种 / 实时** → `SenseVoiceSmall`（170×实时，50+ 语种，内置情绪/事件检测）
> - **需要说话人分离** → `paraformer-zh` + `cam++`
> - **流式字幕** → `paraformer-zh-streaming`
> - **GPU 高质量** → `Qwen3-ASR`（52 语种）/ `Fun-ASR-Nano`（31 语种 LLM 架构）

> **WHISPER vs FunASR 选型**：Whisper 优势是 99 种语言覆盖 + 翻译任务 (`task=translate`)；FunASR 优势是中文 WER 显著更低、内置 VAD/标点/说话人/情感、中文场景速度更快。**纯中文识别强烈推荐 FunASR**。

### 目录结构

```
├── process_videos.js              # Node.js 主流程脚本（推荐）
├── process_videos.py              # Python 主流程脚本（备选）
├── package.json                   # Node.js 项目配置（npm 包）
├── .env.example                  # 环境变量模板（可提交 Git）
├── .env                          # 实际环境变量（已 gitignore，按需修改）
├── data/                         # 数据源目录
│   └── export_2026-06-10_split.xlsx   # Excel 数据源
├── cookies/                     # 站点 cookie 文件（独立于 OUTPUT_DIR）
│   ├── bilibili.txt            # B站 cookie（Netscape 格式）
│   └── youtube.txt             # YouTube cookie 备用（Firefox 直读方案不需要）
├── output/                       # 输出根目录（OUTPUT_DIR 控制，可通过 --output / env 覆盖）
│   ├── downloads/                # yt-dlp 下载输出（mp4）
│   │   ├── youtube/              # 按平台/sheet 分目录
│   │   └── bilibili/
│   ├── transcoded/               # ffmpeg 转码输出（wav 16kHz mono）
│   │   ├── youtube/
│   │   └── bilibili/
│   ├── transcripts/              # whisper 识别文本（断点续跑校验依据）
│   │   ├── youtube/
│   │   └── bilibili/
│   ├── keywords/                 # AI 关键词归纳结果（断点续跑校验依据）
│   │   ├── youtube/
│   │   └── bilibili/
│   ├── progress/                 # 增量进度 JSON（每任务完成即时写入）
│   │   ├── youtube/
│   │   └── bilibili/
│   ├── reports/                 # 执行报告（按 sheet/平台分目录）
│   │   ├── YouTube视频/
│   │   │   ├── report_YYYYMMDD_HHMMSS.json   # JSON 报告（机器可读，用于重跑）
│   │   │   └── tasks/                        # 人类可读文本摘要
│   │   │       ├── 2143.txt
│   │   │       └── ...
│   │   ├── 普诺赛中文站/
│   │   │   ├── report_YYYYMMDD_HHMMSS.json
│   │   │   └── tasks/
│   │   │       └── ...
│   │   ├── youtube/                  # --url 模式按平台名分目录
│   │   │   ├── report_YYYYMMDD_HHMMSS.json
│   │   │   └── tasks/
│   │   ├── local/                    # --input 模式默认目录
│   │   │   ├── report_YYYYMMDD_HHMMSS.json
│   │   │   └── tasks/
│   │   └── content/                  # --content 模式固定目录
│   │       ├── report_YYYYMMDD_HHMMSS.json
│   │       └── tasks/
│   └── logs/                       # 运行日志 / console-ui 输出
├── scripts/                      # 辅助脚本
│   ├── release.js                 # 版本发布脚本
│   └── regenerate-changelog.js  # CHANGELOG 重建脚本
├── .github/                      # GitHub Actions 工作流
├── .husky/                      # Git hooks（commit 消息检查）
├── node_modules/                 # Node.js 依赖（已 gitignore）
├── CHANGELOG.md                  # 版本变更记录
├── README.md                     # 使用文档
└── LICENSE                       # MIT 许可证
```

---

## Cookie 设置（首次使用必须）

### YouTube（推荐：Firefox 浏览器直读）

yt-dlp 可直接从 Firefox 浏览器读取 cookie，无需手动导出：

1. 用 Firefox 浏览器登录 [youtube.com](https://www.youtube.com)
2. 在 `.env` 中设置 `YOUTUBE_COOKIES_FROM_BROWSER=firefox`
3. 脚本自动通过 `--cookies-from-browser firefox` 读取

> Firefox 在 Windows 上的 cookie 加密格式 yt-dlp 可稳定解密，只要浏览器保持登录态即可。
> **Chrome/Edge 在 Windows 上 DPAPI 解密已知失败**，不推荐使用。

### YouTube（备用：手动导出文件）

如果无法使用 Firefox，可手动导出 cookie 文件：

1. Chrome 安装扩展 [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. 访问 [youtube.com](https://www.youtube.com) 并登录
3. 点击扩展图标 → Export → 保存为 `cookies/youtube.txt`
4. 在 `.env` 中注释掉 `YOUTUBE_COOKIES_FROM_BROWSER`，启用 `YOUTUBE_COOKIE_FILE=cookies/youtube.txt`

> ⚠️ YouTube cookie 有效期约 48 小时，过期后需重新导出。下载时如果报 `cookies does no longer seem to be valid`，说明 cookie 已失效。**优先用 Firefox 方案，免维护。**

### B站（bilibili）

**方案 A（推荐）：直接从 Firefox 浏览器读 cookie**

1. 用 Firefox 浏览器登录 [bilibili.com](https://www.bilibili.com)
2. 在 `.env` 中设置 `BILIBILI_COOKIES_FROM_BROWSER=firefox`
3. 脚本自动通过 `--cookies-from-browser firefox` 读取

> Firefox cookie 直读方案同样适用于 B站，无需手动导出。

**方案 B（备用）：从文件读取 cookie**

1. Chrome 安装扩展 [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. 访问 [bilibili.com](https://www.bilibili.com) 并登录
3. 点击扩展图标 → Export → 保存为 `cookies/bilibili.txt`
4. 在 `.env` 中注释掉 `BILIBILI_COOKIES_FROM_BROWSER`，启用 `BILIBILI_COOKIE_FILE=cookies/bilibili.txt`

---

## 使用方法

### 单条测试

```bash
# 下载 + 转码 + 识别 + AI分析，指定 sheet + extra.id
node process_videos.js --sheet "YouTube视频" --id 2143
# 或 Python 版本
python process_videos.py --sheet "YouTube视频" --id 2143

# 只跑下载
node process_videos.js --sheet "普诺赛中文站" --id 16 --step download
# 或 Python 版本
python process_videos.py --sheet "普诺赛中文站" --id 16 --step download

# 只跑转码（需要已有下载文件）
node process_videos.js --sheet "普诺赛中文站" --id 16 --step transcode

# 只跑识别（需要已有转码文件）
node process_videos.js --sheet "普诺赛中文站" --id 16 --step transcribe

# 只跑 AI 分析（需要已有识别文本）
node process_videos.js --sheet "普诺赛中文站" --id 16 --step analyze

# 强制重新下载（忽略已有文件）
node process_videos.js --sheet "YouTube视频" --id 2143 --force
```

### 批量全量

```bash
# 全量执行（2 个并发，失败重试 3 次）
node process_videos.js --concurrency 2 --retry 3

# 只跑某一 sheet
node process_videos.js --sheet "YouTube视频" --concurrency 2 --retry 3

# 先干跑预览
node process_videos.js --dry-run

# Excel 数据量大时，偏移+限量调试
node process_videos.js --offset 10 --limit 5 --dry-run  # 跳过前10条，预览5条
node process_videos.js --limit 3 --concurrency 1        # 只处理前3条
```

### 重跑失败

```bash
# 第一次跑完后生成 reports/{sheet名称}/report_xxx.json
# 查看失败项：
node process_videos.js --retry-failed reports/YouTube视频/report_20260610_143000.json --dry-run

# 重跑：
node process_videos.js --retry-failed reports/YouTube视频/report_20260610_143000.json --concurrency 2 --retry 3
```

### 超时控制（防止任务卡死）

每个步骤都有独立超时，超时后自动 kill 子进程、标记失败并继续执行后续任务：

```bash
# 自定义超时（单位秒，设为 0 表示不限制）
node process_videos.js \
    --download-timeout 1800 \   # 下载 30 分钟
    --transcode-timeout 1200 \  # 转码 20 分钟
    --transcribe-timeout 0 \    # 识别 不限制
    --analyze-timeout 300       # AI 分析 5 分钟

# 默认值：下载 1800s / 转码 1200s / 识别 0(不限制) / AI 分析 300s
```

- 超时属于**可重试错误**，会触发指数退避重试（`--retry` 控制次数）
- 无论超时多少次，**不会阻塞其他并发任务**，失败项会记录到报告
- 超时失败的任务可用 `--retry-failed` 单独重跑

### 直接指定 URL 下载

```bash
# 直接指定视频链接，自动识别平台（支持标准链接、短链接、内嵌链接）
node process_videos.js --url "https://www.youtube.com/watch?v=zzJmKPX8a3c"
python process_videos.py --url "https://www.bilibili.com/video/BV1xx411c7mD"

# 指定输出文件名（不含扩展名）
node process_videos.js --url "https://youtu.be/zzJmKPX8a3c" --name "产品介绍"

# 只执行部分步骤
node process_videos.js --url "https://www.youtube.com/watch?v=zzJmKPX8a3c" --step transcode
```

**支持的 URL 格式：**
- YouTube: 标准页、短链接、Shorts、内嵌页、直播
- B站: 标准页（BV/av号）、短链接、内嵌页、移动端
- 腾讯视频: 标准页、内嵌页、移动端
- 优酷: 标准页

**文件命名规则：**
- 默认：`{平台}_{视频ID}`（如 `youtube_zzJmKPX8a3c`）
- 自定义：通过 `--name` 指定（如 `--name "产品介绍"`）
- 冲突处理：自动提示选择（覆盖 / 跳过 / 自定义名称）

### 处理本地文件

```bash
# 指定本地视频文件，跳过下载，直接转码→识别→分析
node process_videos.js --input "downloads/产品介绍.mp4"
python process_videos.py --input "downloads/产品介绍.mp4"

# 指定输出文件名
node process_videos.js --input "downloads/产品介绍.mp4" --name "产品介绍_分析"

# 只执行部分步骤
node process_videos.js --input "downloads/产品介绍.mp4" --step analyze
```

**文件校验：**
- 检查文件是否存在
- 检查文件格式是否支持（视频/音频）
- 检查是否可以正常读取
- 校验失败会提示错误并退出

### 处理纯文本内容（跳过视频步骤）

如果你已经有了一段文本内容（比如爬虫爬取的、之前识别好的、或者从其他途径获取的），可以直接做 AI 分析，跳过下载、转码、识别三个步骤：

```bash
# ═══════════ --content 模式：纯文本 AI 分析 ═══════════

# 从文件读取内容，自动用文件名作为输出名
node process_videos.js --content "data/article.txt"
python process_videos.py --content "data/article.txt"

# 直接提供内联文本，自动取前 32 字符作为输出名
node process_videos.js --content "这是一段需要分析的内容..."
python process_videos.py --content "这是一段需要分析的内容..."

# 指定输出文件名（--name）
node process_videos.js --content "data/article.txt" --name "文章分析"
python process_videos.py --content "data/article.txt" --name "文章分析"

# 配合 --dry-run 预览
node process_videos.js --content "data/article.txt" --dry-run
```

**输出文件命名规则：**
- 指定了 `--name` → 使用 `--name` 的值
- 内容是文件路径 → 使用文件名（不含扩展名）
- 内容是内联文本 → 使用前 32 个字符

**输出位置：** `output/reports/content/tasks/{name}.txt` + `output/reports/content/report_xxx.json`

### Excel 列文本批量 AI 分析

当 Excel 某列已经存好了文本内容（比如之前爬虫爬取的），可以批量对这些文本做 AI 关键词分析：

```bash
# ═══════════ --content-column 模式：批量 AI 分析 ═══════════

# 对 Excel 中 "content" 列的文本逐行做 AI 关键词分析，结果写回 "keywords" 列
node process_videos.js --content-column "content"

# 指定其他列名
node process_videos.js --content-column "爬取文本"

# 指定特定 sheet
node process_videos.js --sheet "普诺赛中文站" --content-column "content"

# 配合 --dry-run 预览
node process_videos.js --content-column "content" --dry-run

# 配合 --offset / --limit 调试
node process_videos.js --content-column "content" --offset 0 --limit 3
node process_videos.js --content-column "content" --concurrency 2 --retry 2
```

> **注意**：`--content-column` 模式自动设置 `--step analyze`（仅 AI 分析），不会触发下载/转码/识别。
> 文本为空的行会自动跳过。
> 分析结果写入 Excel 的 `keywords` 列（由 `COL_KEYWORDS` 环境变量指定）。

### 工具预检（执行前自动检测）

每次执行任务前，脚本会自动检测本次涉及步骤所需的工具/服务是否可用：

| 步骤 | 检测项 | 不可用时行为 |
|------|--------|-------------|
| download | yt-dlp 可调用 | 提示用户，输入 `yes` 继续 / 其他取消 |
| transcode | ffmpeg + ffprobe 可调用 | 同上 |
| transcribe | whisper 后端可用（按 `WHISPER_BACKEND` 分支检测） | 同上 |
| analyze | AI_ENABLED=true 且 API 配置完整 | 同上 |

**ASR 后端检测策略**（轻量秒级，不实际启动 CLI）：

| 后端 | 检测方式 | 说明 |
|------|---------|------|
| `local` | `where`/`which whisper` | 检查 `whisper` 可执行文件是否存在（JS）；`shutil.which()`（Python） |
| `faster-whisper` | JS: `where`/`which whisper-ctranslate2`；Python: `importlib.util.find_spec("faster_whisper")` | JS 用 CLI，Python 用 Python API |
| `funasr` (cli) | `where`/`which funasr`（JS）；`importlib.util.find_spec("funasr")`（Python） | 同上 |
| `funasr` (service) | HTTP GET `FUNASR_SERVICE_URL` | 3 秒超时 |
| `service` | HTTP GET `WHISPER_SERVICE` | 3 秒超时 |

> **为什么不直接跑 `--help`？** `whisper`、`whisper-ctranslate2`、`funasr` 等 Python CLI 的 `--help` 均会触发框架初始化（Hydra / CTranslate2 / 模型注册），耗时 **5-30 秒**，严重拖慢 dry-run 和预检。改用可执行文件/包存在检测后，全量检测 < 0.3 秒。

- **dry-run** 模式下同样展示检测结果（但不中断执行）
- 所有模式（正常执行、重跑失败、单步运行）均执行预检
- 即使工具不可用，用户仍可选择强制继续（但相应步骤大概率失败）

---

## 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `--sheet <name>` | str | 全部 | 指定 sheet 名称 |
| `--id <id>` | str | — | 指定 extra.id 或 title（单条测试） |
| `--offset <n>` | int | 0 | 跳过前 N 条任务（从 0 开始），适合调试大量数据 |
| `--limit <n>` | int | 0 | 最多处理 N 条任务，0 表示无限制 |
| `--step <step>` | str | 全跑 | 只执行某步：`download` / `transcode` / `transcribe` / `analyze` |
| `--force` | flag | off | 强制重做下载+转码，忽略已有文件 |
| `--concurrency <n>` | int | 1 | 并发数，建议 2~3 |
| `--retry <n>` | int | 0 | 每步失败最大重试次数 |
| `--retry-delay <n>` | float | 5 | 重试间隔基数（秒），指数退避 5→10→20 |
| `--download-timeout <n>` | int | 1800 | 单个下载任务最长执行时间（秒），0=不限制 |
| `--transcode-timeout <n>` | int | 1200 | 单个转码任务最长执行时间（秒），0=不限制 |
| `--transcribe-timeout <n>` | int | 0 | 单个识别任务最长执行时间（秒），0=不限制 |
| `--analyze-timeout <n>` | int | 300 | 单个 AI 分析任务最长执行时间（秒），0=不限制 |
| `--dry-run` | flag | off | 干跑模式，只列任务不执行 |
| `--retry-failed <path>` | path | — | 从报告 JSON 重跑失败项（如 `reports/YouTube视频/report_xxx.json`） |
| `--init` | flag | off | 复制 .env.example 到当前目录并重命名为 .env |
| `--file <path>` | path | — | 指定 Excel 文件路径（优先级高于 EXCEL_FILE 环境变量） |
| `--output <dir>` | path | `output` | 整体覆盖 `OUTPUT_DIR`（优先级：**CLI > env > 默认**）。子目录名由代码硬编码 |
| `--input <path>` | path | — | 指定本地视频文件路径（跳过下载，直接转码→识别→分析） |
| `--url <url>` | str | — | 直接指定视频下载链接（跳过 Excel），支持标准链接和内嵌链接 |
| `--content <text 或 path>` | str | — | 直接提供文本内容（文件路径或内联文本），跳过下载/转码/识别，仅做 AI 分析 |
| `--content-column <col>` | str | — | Excel 模式：指定包含已有文本的列名，批量做 AI 分析（自动设 --step analyze） |
| `--name <name>` | str | — | 指定输出文件名，不含扩展名（与 --url / --input / --content 配合使用） |
| `--env-file <path>` | path | .env | 指定要加载的 .env 文件路径 |
| `--whisper-initial-prompt <text\|path>` | str | .env | Whisper 初始提示词（文本或文件路径，CLI 优先级最高） |
| `--ai-prompt <text\|path>` | str | .env | AI 分析提示词模板（文本或文件路径，CLI 优先级最高） |
| `--whisper-extra-args <args>` | str | .env | Whisper 额外参数（shell 字符串，如 `"--beam_size 5"`，最高优先级且自动去重） |

---

## 重试规则

| 可重试 | 不重试 |
|----------|----------|
| 网络超时、连接拒绝 | HTTP 404 / 403 / 401 |
| yt-dlp 下载中断 | 视频已删除 / 私有 |
| whisper 服务超时 | 无效 URL、文件不存在 |
| **步骤级超时（任务卡死）** | 参数错误（ValueError/TypeError） |

---

## 智能跳过与自动重转码

脚本默认不会重复处理已有文件，但会在以下情况自动触发重做：

| 步骤 | 跳过条件 | 自动重做条件 |
|------|-----------|----------------|
| 下载 | 同名文件已存在（非 `--force`） | `--force` 或文件不存在 |
| 转码 | WAV 已存在 **且** MP4 时间戳 ≤ WAV 时间戳 | `--force` 或 **MP4 比 WAV 新**（重新下载过） |
| 识别 | —（每次必跑，覆盖写入 Excel） | — |

> 关键设计：即使不加 `--force`，只要视频重新下载过（MP4 的修改时间晚于 WAV），转码也会自动重新执行，**确保下载和转码内容始终保持一致**。

---

## 断点续跑（Resume）机制

从 v1.4 开始，脚本在「智能跳过」基础上引入了严格的**断点续跑校验**——四步产物要么完整落盘 + 校验通过，要么不留尾巴，确保断电/中断后可安全续跑。

### 产物路径与校验依据

| 步骤 | 产物 | 校验条件 | 校验失败行为 |
|------|------|---------|--------------|
| download | `downloads/{sheet}/{stem}.mp4` | 文件存在 + size>0 | 清理 `.part`/`.ytdl`，重做 |
| transcode | `transcoded/{sheet}/{stem}.wav` | 文件存在 + size>0 | 清理 0 字节产物，重做 |
| transcribe | `transcripts/{sheet}/{stem}.txt` | 长度 ≥ `MIN_TRANSCRIPT_CHARS`（默认 50） | 清理文本，重做 |
| analyze | `keywords/{sheet}/{stem}.txt` | 长度 ≥ `MIN_KEYWORDS_CHARS`（默认 5） | 清理关键词，重做 |

### 跳过判定（每次 `process_one_task` 入口）

1. 读取 `progress/{sheet}/task_{stem}.json`，若 `force=False` 且步骤状态 = `success` 才进入跳过检查
2. **校验产物文件**：存在性 + 长度阈值
3. **校验通过** → 跳过该步 + 复制之前的产物（避免重复推理）
4. **校验失败** → 视为"上次的 success 不可信"，**降级为重做该 step**

### 失败不留尾巴

| 失败步骤 | 清理动作 |
|----------|----------|
| download | 清理 `*.part` / `*.ytdl` 残留 |
| transcode | 清理 0 字节的转码文件 |
| transcribe | 清理 transcript 文本文件（不留半残文本） |
| analyze | 清理 keywords 文本文件 |

### Excel 实时写回

- 每个任务完成后立即调用 `write_excel_cell`（Python `_excel_lock` 串行化 / JS `acquireExcelLock` promise 队列）
- 不再依赖末尾批量写 → 断电时 Excel 已是最新内容
- 单步运行（`--step`）不写 Excel（避免误覆盖）

### 启动统计

启动时扫描 progress JSON 并打印：

```
♻️  完整跳过 5 条 / 部分续跑 12 条 / 全量重跑 78 条
```

> **核心原则**：transcribe / analyze 不允许"半成功"——要么完整产物落盘 + 校验通过，要么清理掉。

---

## 错误信息透传

从 v1.4.1 开始，失败时不再只显示 "Exit code 2" 这种无意义信息，而是**完整透传 stderr / traceback**。

### 透传机制

| 层 | 行为 |
|----|------|
| **JS `spawnWithTimeout`** | 子进程退出码非 0 时，把 stderr **末尾 3000 字符**直接嵌入到 `error.message` 中，所有调用方自动受益 |
| **Python `_transcribe_local`** | 累积 stderr 到 `_stderr_lines`，subprocess 失败时随异常一并抛出 |
| **Python `_transcribe_faster_whisper` except** | 打印完整 traceback + 音频路径 + 文件大小 + 模型配置 + SSL 错误自动检测 |
| **JS 三个 transcribe catch 块** | 不再 `slice(0, 500)` 截断，上限提至 5000 字符；用 `e.stderr || e.message` 取最详细的那一份 |

### 长消息打印辅助

新增 `_print_long()`（Python）/ `printLong()`（JS）助手：

- 超过 `max_chars`（默认 800）时按字符截断，并附 `...(已截断)` 提示
- 含换行时**逐行缩进**打印，便于在多行 traceback 中保持可读性

### SSL/CERTIFICATE 错误自动检测

当 `faster-whisper` 识别抛出 SSL 错误时（例如 `CERTIFICATE_VERIFY_FAILED`），自动检测并提示三条解决建议：

```
💡 SSL 证书验证失败，可能原因：
  1. Python 证书未更新 → 运行 /Applications/Python\ 3.13/Install\ Certificates.command
  2. 代理拦截 HTTPS   → 临时关闭代理或设置 REQUESTS_CA_BUNDLLE
  3. 使用系统证书     → pip install --upgrade certifi
```

### 失败样例对比

**修复前**（只知道 exit code）：

```
[2143] 转码失败: download+transcode success but transcribe failed: Exit code 2
[2143] 识别失败: Exit code 2
```

**修复后**（完整 traceback + SSL 提示）：

```
[2143] 转码失败: download+transcode success but transcribe failed: whisper-ctranslate2 退出码 2
       stderr 末尾:
         RuntimeError: Failed to load audio
         urllib3.exceptions.MaxRetryError: HTTPSConnectionPool(host='huggingface.co', port=443): Max retries exceeded
         ...
       💡 SSL 证书验证失败，可能原因：
         1. Python 证书未更新 → ...
         2. 代理拦截 HTTPS   → ...
         3. 使用系统证书     → ...
```

---

## 临时文件自动清理

yt-dlp 下载过程中会生成 `.part`（未完成分片）和 `.ytdl`（元数据）临时文件。脚本在以下时机自动清理这些残留：

| 时机 | 说明 |
|------|------|
| 下载开始前 | 清除上次中断留下的 `.part` / `.ytdl`，确保干净环境 |
| 跳过已有文件时 | 检查并清除该视频的历史残留 |
| 下载失败后 | 立即清理，避免无效文件占磁盘 |

> 例如：`2152.mp4.part` + `2152.mp4.ytdl` 会在下次下载该视频时自动删除，无需手动清理。

---

## AI 关键词归纳

在识别完成后，脚本可自动调用 OpenAI 兼容 API 对识别文本做关键词归纳，结果写入 `keywords` 列。

### 配置

在 `.env` 中配置以下变量（见 `.env.example`）：

```env
# 启用/禁用 AI 分析环节
AI_ENABLED=true

# OpenAI 兼容 API（支持任何兼容接口）
AI_API_KEY=sk-xxx
AI_BASE_URL=https://apihub.agnes-ai.com/v1
AI_MODEL=agnes-2.0-flash

# 提示词模板（{content} 会被识别文本替换）
# 采用两步法：先语义修正 Whisper 同音/形近/术语错误，再提取关键词
# 支持文件路径：值指向存在的文件则读取内容（try-file-first 策略）
# CLI 覆盖：--ai-prompt <text|path> 优先级最高（CLI > .env > 内置默认）
AI_PROMPT_TPL=你是多语言内容分析专家...这是内容：{content}

# 请求超时（秒，通过 --analyze-timeout 参数设置）
```

### 工作原理

1. whisper 识别完成 → 得到文本（存入 `content` 列）
2. AI 先对识别文本做**语义修正**（修正 Whisper 常见的同音错字、专业术语误判、形近字混淆）
3. 再对修正后的文本提取搜索关键词 → 写入 `keywords` 列

> **提示词模板可自由定制**：只需保留 `{content}` 占位符，提示词内容可改为翻译、摘要、分类等任意任务。完整模板见 `.env.example`。值支持文件路径（指向存在的文件则自动读取内容），也可通过 `--ai-prompt` CLI 参数临时覆盖（优先级：CLI > .env > 内置默认）。

### 单独运行

```bash
# 已有识别文本，只跑 AI 分析
node process_videos.js --sheet "普诺赛中文站" --id 427 --step analyze
# 或 Python 版本
python process_videos.py --sheet "普诺赛中文站" --id 427 --step analyze

# 单独跑 analyze 超过 16 条不会写入 Excel
# 要想写入 Excel 跑完整流程 --step analyze
node process_videos.js --sheet "YouTube视频" --step analyze --concurrency 2
```

### 禁用 AI 分析

设置 `AI_ENABLED=false`，识别完成后跳过 AI 分析步骤。

### 提示词优先级

`WHISPER_INITIAL_PROMPT` 和 `AI_PROMPT_TPL` 均支持三种输入方式：

| 方式 | 示例 | 说明 |
|------|------|------|
| 内联文本 | `WHISPER_INITIAL_PROMPT=细胞 冻存` | 直接写入值 |
| 文件路径 | `AI_PROMPT_TPL=./prompts/my-prompt.txt` | 值指向存在的文件时自动读取内容 |
| CLI 覆盖 | `--ai-prompt ./prompts/custom.txt` | 优先级最高，临试覆盖不修改 .env |

优先级：**CLI 参数 > .env 环境变量 > 内置默认值**

> **`{content}` 替换安全性**：JS 版使用 `replace('{content}', () => text)` 函数替换，避免转录文本中的 `$&`、`` $` ``、`$'`、`$$` 等 JavaScript 特殊模式被错误解释。Python 版 `str.replace()` 天然无此问题。

```bash
# 用自定义 prompt 文件跑全量
video-pipeline --ai-prompt ./prompts/keyword-extract.txt --sheet "普诺赛中文站"

# 临时覆盖 whisper 初始提示词 + 额外参数
video-pipeline --whisper-initial-prompt "细胞冻存,复苏" --whisper-extra-args "--beam_size 10 --verbose" --id 427
```

---

## 文件名去重

脚本默认使用 `COL_ID`（即 `extra.id`）作为文件名 stem。当同一个 sheet 内出现重复 id 时，自动应用以下去重策略：

| 优先级 | 格式 | 示例 |
|--------|------|------|
| 1 | `{id}` | `2143` |
| 2 | `{id}_{title}` | `2143_产品介绍` |
| 3 | `{id}_{title}_{platform}` | `2143_产品介绍_bilibili` |

> 去重仅在同 sheet 内生效，不同 sheet 之间允许同名文件（存放在不同子目录）。

---

## 进度显示

执行时会同时展示**总体进度**和**单视频进度**：

```text
[1/91] [2143] 开始处理 (sheet=YouTube视频, platform=youtube, title=xxx)
  [2143] 开始下载 (平台=youtube)
  [2143] https://youtu.be/zzJmKPX8a3c
  [2143] 解析页面...
  [2143] 15.2% 2.50MiB/s ETA 00:17          ← 下载实时进度
  [2143] 45.8% 3.12MiB/s ETA 00:08
  [2143] 下载完成 -> 2143.mp4
  [2143] 开始转码 -> 2143.wav
  [2143] 25.3% (38s/150s)                    ← 转码进度 + 时长比
  [2143] 50.1% (75s/150s)
  [2143] 转码完成
  [2143] 开始识别 (文件 45.2MB)...
  [2143] 识别中... 5s                        ← 识别每 5s 报时
  [2143] 识别完成 (22s, 1234 字符)
  [2143] AI 分析中... 5s                     ← AI 每 5s 报时
  [2143] AI 分析中... 10s
  [2143] AI 分析完成 (567 字符)

[总进度 1/91 (1.1%)] ✅1 ❌0 ⚠️0 ⏭️0         ← 每完成一个刷新
```

| 层级 | 显示内容 |
|------|----------|
| 总体进度 | 完成/总任务数、百分比、✅成功 ❌失败 ⚠️部分 ⏭️无视频 四维计数 |
| 下载 | yt-dlp 实时百分比 + 速度 + ETA |
| 转码 | 先 ffprobe 取时长，再实时解析 `time=` 算百分比（如 `25.3% (38s/150s)`） |
| 识别 | 每 5s 打印已用时间，完成时显示总耗时和文本长度 |
| AI 分析 | 每 5s 打印已用时间，完成时显示结果长度或失败原因 |

多线程并发时使用打印锁保证输出不交错。

---

## 输出结构速查表

五种输入来源在不同处理环节的输出路径汇总如下。所有路径均以 `output/` 为根，可通过 **`OUTPUT_DIR` 环境变量** 或 **`--output <dir>` CLI 参数** 整体覆盖（CLI > env > 默认 `output`）。子目录名（`downloads/` `transcoded/` `transcripts/` `keywords/` `reports/` `progress/` `logs/`）由代码硬编码，不支持单独覆盖。

> `{sheet}` = Excel 工作表名（如 `YouTube视频`、`普诺赛中文站`）
> `{platform}` = 视频平台标识（如 `youtube`、`bilibili`、`tencent`、`youku`）
> `{stem}` = 去重后的安全文件名（不含扩展名）

### ① Excel 批量模式（默认）

| 环节 | 输出路径 | 产物格式 | 说明 |
|------|---------|---------|------|
| 下载 | `output/downloads/{sheet}/{stem}.mp4` | 视频 | yt-dlp 下载原始视频 |
| 转码 | `output/transcoded/{sheet}/{stem}.wav` | 音频 | ffmpeg 转 16kHz mono WAV |
| 识别 | `output/transcripts/{sheet}/{stem}.txt` | 文本 | whisper 识别原文（断点续跑校验依据，< `MIN_TRANSCRIPT_CHARS` 视为残缺） |
| AI 关键词 | `output/keywords/{sheet}/{stem}.txt` | 文本 | AI 关键词归纳结果（断点续跑校验依据，< `MIN_KEYWORDS_CHARS` 视为残缺） |
| 进度 | `output/progress/{sheet}/task_{stem}.json` | JSON | 单任务增量进度（每步完成立即写入，断电可续） |
| JSON 报告 | `output/reports/{sheet}/report_YYYYMMDD_HHMMSS.json` | JSON | 机器可读，含 summary + failed_items，可供 --retry-failed 重跑 |
| 文本报告 | `output/reports/{sheet}/tasks/{stem}.txt` | 文本 | 人类可读，含语音识别原文 + AI 关键词分析 |
| 运行日志 | `output/logs/` | 文本 | console-ui / 步骤日志（按时间戳） |

> 多 sheet 同时执行时，每个 sheet 独立一个子目录，互不干扰。

### ② --url 直链模式

| 环节 | 输出路径 | 产物格式 | 说明 |
|------|---------|---------|------|
| 下载 | `output/downloads/{platform}/{name}.mp4` | 视频 | yt-dlp 下载单个视频 |
| 转码 | `output/transcoded/{platform}/{name}.wav` | 音频 | ffmpeg 转 16kHz mono WAV |
| 识别 | `output/transcripts/{platform}/{name}.txt` | 文本 | whisper 识别原文 |
| AI 关键词 | `output/keywords/{platform}/{name}.txt` | 文本 | AI 关键词归纳结果 |
| 进度 | `output/progress/{platform}/task_{name}.json` | JSON | 单任务增量进度 |
| JSON 报告 | `output/reports/{platform}/report_YYYYMMDD_HHMMSS.json` | JSON | 格式与 Excel 模式一致 |
| 文本报告 | `output/reports/{platform}/tasks/{name}.txt` | 文本 | 含识别原文 + AI 分析 |

> `{platform}` 由脚本自动从 URL 解析，如 `https://www.youtube.com/watch?v=xxx` → `youtube`。

### ③ --input 本地文件模式

| 环节 | 输出路径 | 产物格式 | 说明 |
|------|---------|---------|------|
| 下载 | —（跳过） | — | 本地文件无需下载 |
| 转码 | `output/transcoded/local/{stem}.wav` | 音频 | ffmpeg 转 16kHz mono WAV |
| 识别 | `output/transcripts/local/{stem}.txt` | 文本 | whisper 识别原文 |
| AI 关键词 | `output/keywords/local/{stem}.txt` | 文本 | AI 关键词归纳结果 |
| 进度 | `output/progress/local/task_{stem}.json` | JSON | 单任务增量进度 |
| JSON 报告 | `output/reports/local/report_YYYYMMDD_HHMMSS.json` | JSON | 格式与 Excel 模式一致 |
| 文本报告 | `output/reports/local/tasks/{stem}.txt` | 文本 | 含识别原文 + AI 分析 |

> `local` 是 `--input` 模式的固定目录名（与 Excel 模式的 sheet 名无关），所有本地文件处理结果统一归入此目录。

### ④ --content 纯文本模式

| 环节 | 输出路径 | 产物格式 | 说明 |
|------|---------|---------|------|
| 下载 | —（跳过） | — | 无需下载 |
| 转码 | —（跳过） | — | 无需转码 |
| 识别 | —（跳过） | — | 无需语音识别 |
| AI 关键词 | `output/keywords/content/{stem}.txt` | 文本 | AI 关键词归纳结果 |
| 进度 | `output/progress/content/task_{stem}.json` | JSON | 单任务增量进度 |
| JSON 报告 | `output/reports/content/report_YYYYMMDD_HHMMSS.json` | JSON | 格式与 Excel 模式一致 |
| 文本报告 | `output/reports/content/tasks/{stem}.txt` | 文本 | 含源内容 + AI 关键词分析 |

> `content` 是固定目录名。{stem} = `--name` 值 > 文件名 stem > 内联文本前 32 字符。

### ⑤ --content-column Excel列文本批量模式

| 环节 | 输出路径 | 产物格式 | 说明 |
|------|---------|---------|------|
| 下载 | —（跳过） | — | 无需下载 |
| 转码 | —（跳过） | — | 无需转码 |
| 识别 | —（跳过） | — | 无需语音识别 |
| AI 关键词 | `output/keywords/{sheet}/{stem}.txt` | 文本 | AI 关键词归纳结果 |
| 进度 | `output/progress/{sheet}/task_{stem}.json` | JSON | 单任务增量进度 |
| JSON 报告 | `output/reports/{sheet}/report_YYYYMMDD_HHMMSS.json` | JSON | 按 Excel sheet 分目录，格式与 Excel 模式一致 |
| 文本报告 | `output/reports/{sheet}/tasks/{stem}.txt` | 文本 | 含列文本 + AI 关键词分析 |
| Excel 写回 | `{EXCEL_FILE}` 的 `keywords` 列 | Excel | AI 关键词写入 Excel |

> 此模式自动设置 `--step analyze`，下载/转码/识别全跳过。AI 结果同时写入 Excel 和报告文件。

---

### 五种来源对比一览

| 维度 | Excel 批量 | --url 直链 | --input 本地文件 | --content 纯文本 | --content-column 列文本 |
|------|-----------|-----------|-----------------|-----------------|------------------------|
| 输入 | Excel 行（多视频批量） | 单个视频 URL | 本地视频/音频文件 | 文件路径或内联文本 | Excel 列的已有文本 |
| 下载 | ✅ yt-dlp | ✅ yt-dlp | ❌ 跳过 | ❌ 跳过 | ❌ 跳过 |
| 转码 | ✅ ffmpeg | ✅ ffmpeg | ✅ ffmpeg | ❌ 跳过 | ❌ 跳过 |
| 识别 | ✅ whisper | ✅ whisper | ✅ whisper | ❌ 跳过 | ❌ 跳过 |
| AI 分析 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 下载目录 | `downloads/{sheet}/` | `downloads/{platform}/` | 无 | 无 | 无 |
| 转码目录 | `transcoded/{sheet}/` | `transcoded/{platform}/` | `transcoded/local/` | 无 | 无 |
| 识别目录 | `transcripts/{sheet}/` | `transcripts/{platform}/` | `transcripts/local/` | 无 | 无 |
| 关键词目录 | `keywords/{sheet}/` | `keywords/{platform}/` | `keywords/local/` | `keywords/content/` | `keywords/{sheet}/` |
| 进度目录 | `progress/{sheet}/` | `progress/{platform}/` | `progress/local/` | `progress/content/` | `progress/{sheet}/` |
| 报告目录 | `reports/{sheet}/` | `reports/{platform}/` | `reports/local/` | `reports/content/` | `reports/{sheet}/` |
| 分组依据 | Excel sheet 名 | URL 解析的平台名 | 固定 `local` | 固定 `content` | Excel sheet 名 |
| 并发支持 | ✅ 多线程 | ❌ 单任务 | ❌ 单任务 | ❌ 单任务 | ✅ 多线程 |
| 写入 Excel | ✅ | ❌ | ❌ | ❌ | ✅ |
| 支持 --retry-failed | ✅ | ❌ | ❌ | ❌ | ❌ |
| 适用场景 | 批量处理全流程 | 临时下载单个视频 | 处理已有视频文件 | 已有文本直接分析 | 批量分析Excel中的文本 |

---

### JSON 报告结构

```json
{
  "timestamp": "2026-06-10T14:30:00",
  "config": { "concurrency": 3, "retry": 3 },
  "summary": {
    "total": 91,
    "success": 85,
    "partial": 3,
    "failed": 2,
    "no_video": 1
  },
  "failed_items": [
    {
      "sheet": "普诺赛中文站",
      "id": "427",
      "title": "xxx视频",
      "download_error": "HTTP Error 403",
      "transcode_error": null,
      "transcribe_error": null
    }
  ]
}
```

### 状态含义

- **success**：下载 + 转码 + 识别全部成功（AI 分析失败不影响此状态）
- **partial**：下载 + 转码成功，识别或 AI 分析失败
- **failed**：下载或转码失败
- **no_video**：该行无可用视频 ID

---

## 典型工作流

### 场景一：Excel 批量处理视频

```bash
# 1. 干跑预览
node process_videos.js --dry-run
# 或 Python 版本
python process_videos.py --dry-run

# 2. 单条验证
node process_videos.js --sheet "YouTube视频" --id 2143 --retry 2

# 3. 全量执行
node process_videos.js --concurrency 3 --retry 3

# 4. 查看报告，重跑失败项
node process_videos.js --retry-failed reports/YouTube视频/report_xxx.json --concurrency 2 --retry 3
```

### 场景二：临时下载单个视频

```bash
# 从 URL 下载 → 转码 → 识别 → AI 分析，一条龙
node process_videos.js --url "https://www.youtube.com/watch?v=zzJmKPX8a3c"

# 指定输出文件名
node process_videos.js --url "https://www.bilibili.com/video/BV1xx411c7mD" --name "产品介绍视频"
```

### 场景三：处理本地视频文件

```bash
# 已有视频文件，直接转码分析
node process_videos.js --input "downloads/产品介绍.mp4"

# 只做 AI 分析（已有转码+识别结果）
node process_videos.js --input "downloads/产品介绍.mp4" --step analyze
```

### 场景四：纯文本 AI 分析

```bash
# 已有文本内容，跳过所有视频步骤，直接做关键词提取
node process_videos.js --content "data/article.txt"

# 内联文本直接分析
node process_videos.js --content "今天我们要讨论的是普诺赛产品..." --name "产品讨论"
```

### 场景五：批量分析 Excel 中的已有文本

```bash
# Excel 某列已有文本（如爬虫爬取的），批量做 AI 关键词分析
node process_videos.js --content-column "content" --dry-run      # 先预览
node process_videos.js --content-column "content" --concurrency 2  # 执行
```

---

## 平台适配说明

脚本支持四个视频平台的下载，各有不同的反爬配置：

| 平台 | 字段 | 反爬措施 |
|------|-------|----------|
| B站 (bilibili) | `extra.bilibili` | Chrome UA + Referer 头 + 有效 cookie + 并发分片 |
| YouTube | `extra.youtube` | Chrome UA + Firefox cookie 直读 + 代理 + Node.js 解 n-sig |
| 腾讯视频 | `extra.tencent` | 无需特殊配置 |
| 优酷 | `extra.youku` | 无需特殊配置（部分视频需会员） |

> YouTube 反爬最强：需要 **代理** + **登录态 cookie** + **JS runtime 解 n-sig** 三者配合。
> 脚本会自动给 yt-dlp 及其 node/ejs 子进程注入 `HTTPS_PROXY` 环境变量，确保所有流量走代理。

### 各平台 URL 格式与视频 ID 提取

脚本通过 `{平台}_URL_TPL` 生成下载链接，支持 yt-dlp 能识别的所有 URL 格式。
下表列出各平台「标准页面 / 内嵌链接 / 短链接」格式及视频 ID 提取正则，方便从完整 URL 中解析视频 ID。

#### YouTube

| 格式类型 | URL 示例 | 视频 ID 提取正则 |
|----------|-----------|-------------------|
| 标准观看页 | `https://www.youtube.com/watch?v=VIDEO_ID` | `youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})` |
| 短链接 | `https://youtu.be/VIDEO_ID` | `youtu\.be/([a-zA-Z0-9_-]{11})` |
| Shorts | `https://www.youtube.com/shorts/VIDEO_ID` | `youtube\.com/shorts/([a-zA-Z0-9_-]{11})` |
| 内嵌页 | `https://www.youtube.com/embed/VIDEO_ID` | `youtube\.com/embed/([a-zA-Z0-9_-]{11})` |
| 直播 | `https://www.youtube.com/live/VIDEO_ID` | `youtube\.com/live/([a-zA-Z0-9_-]{11})` |

- **视频 ID 格式**：11 位字符（大小写字母 + 数字 + `-` + `_`）
- **统一提取正则**（覆盖所有格式）：
  ```
  (?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})
  ```
- **格式互转**：
  - 标准 → 短链接：提取 `VIDEO_ID` → `https://youtu.be/VIDEO_ID`
  - 标准 → 内嵌：提取 `VIDEO_ID` → `https://www.youtube.com/embed/VIDEO_ID`
  - Shorts → 标准：提取 `VIDEO_ID` → `https://www.youtube.com/watch?v=VIDEO_ID`

#### B站（bilibili）

| 格式类型 | URL 示例 | 视频 ID 提取正则 |
|----------|-----------|-------------------|
| 标准页（BV 号） | `https://www.bilibili.com/video/BV1xx411c7mD` | `bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})` |
| 标准页（av 号） | `https://www.bilibili.com/video/av170001` | `bilibili\.com\/video\/av(\d+)` |
| 短链接 | `https://b23.tv/BV1xx411c7mD` | `b23\.tv\/(BV[a-zA-Z0-9]{10})` |
| 内嵌页 | `https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&cid=CID` | `bvid=(BV[a-zA-Z0-9]{10})` |
| 移动端 | `https://m.bilibili.com/video/BV1xx411c7mD` | `m\.bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})` |

- **BV 号格式**：`BV` + 10 位字符（大小写敏感）
- **统一提取正则**：
  ```
  bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})|bvid=(BV[a-zA-Z0-9]{10})
  ```
- **格式互转**：
  - 标准 → 内嵌：提取 `BV_ID` 后需通过 B站 API 获取 `cid`
    → `https://api.bilibili.com/x/player/pagelist?bvid=BV_ID` 获取 cid
    → 内嵌 URL：`https://player.bilibili.com/player.html?bvid=BV_ID&cid=CID&page=1`
  - BV 号 → av 号：需调用 API（`https://api.bilibili.com/x/web-interface/view?bvid=BV_ID` 返回 `aid`）

#### 腾讯视频

| 格式类型 | URL 示例 | 视频 ID 提取正则 |
|----------|-----------|-------------------|
| 标准页（x/page） | `https://v.qq.com/x/page/VIDEO_ID.html` | `v\.qq\.com\/x\/page\/([a-zA-Z0-9]+)\.html` |
| 标准页（x/cover） | `https://v.qq.com/x/cover/COVER/VIDEO_ID.html` | `v\.qq\.com\/x\/cover\/[^\/]+\/([a-zA-Z0-9]+)\.html` |
| 内嵌页 | `https://v.qq.com/txp/iframe/player.html?vid=VIDEO_ID` | `[?&]vid=([a-zA-Z0-9]+)` |
| 移动端 | `https://m.v.qq.com/x/mv.xhtml?vid=VIDEO_ID` | `[?&]vid=([a-zA-Z0-9]+)` |

- **视频 ID 格式**：字母 + 数字组合（如 `o0325y3hqh`，长度不固定）
- **统一提取正则**：
  ```
  v\.qq\.com\/(?:x\/page\/|x\/cover\/[^\/]+\/)([a-zA-Z0-9]+)\.html|[?&]vid=([a-zA-Z0-9]+)
  ```
- **格式互转**：
  - 标准 → 内嵌：提取 `VIDEO_ID` → `https://v.qq.com/txp/iframe/player.html?vid=VIDEO_ID`

#### 优酷（Youku）

| 格式类型 | URL 示例 | 视频 ID 提取正则 |
|----------|-----------|-------------------|
| 标准页（v_show） | `https://v.youku.com/v_show/id_VIDEO_ID.html` | `v\.youku\.com\/v_show\/id_([a-zA-Z0-9=]+)\.html` |
| 标准页（video） | `https://v.youku.com/video/VIDEO_ID` | `v\.youku\.com\/video\/([a-zA-Z0-9=]+)` |
| 标准页（www） | `https://www.youku.com/v_show/id_VIDEO_ID.html` | `www\.youku\.com\/v_show\/id_([a-zA-Z0-9=]+)\.html` |

- **视频 ID 格式**：旧格式 `X` + Base64 字符串（可能含 `=` 填充）；新格式长度不固定
- **统一提取正则**：
  ```
  v\.youku\.com\/v_show\/id_([a-zA-Z0-9=]+)\.html|v\.youku\.com\/video\/([a-zA-Z0-9=]+)
  ```
- **格式互转**：
  - 优酷内嵌格式较复杂，建议直接使用标准页链接（`{YOUKU_URL_TPL}`）

> **脚本使用提示**：Excel 中只需填入视频 ID（如 `zzJmKPX8a3c`、`BV1pg411b7Ug`、`o0325y3hqh`、`XMzgxNzExNTY4MA==`），脚本自动替换 URL 模板中的 `{youtube}`、`{bilibili}` 等占位符生成下载链接。

### 常见下载错误

| 错误 | 平台 | 原因 | 解决方案 |
|------|------|------|----------|
| `Sign in to confirm you're not a bot` | YouTube | cookie 过期或无效 | 检查 Firefox 登录态，或重新导出 cookie 文件 |
| `cookies does no longer seem to be valid` | YouTube | cookie 文件超过 48h | 用 Firefox cookies-from-browser 方案（免维护） |
| `Unable to download webpage: HTTP Error 403` | YouTube | IP 被识别为非 YouTube 地区 | 确保代理运行（端口 7897），检查 `YOUTUBE_PROXY` |
| `n challenge solving failed` | YouTube | 无 JS 运行时 | 安装 Node.js，确保 `YOUTUBE_JS_RUNTIMES=node` |
| `Requested format is not available` | YouTube | n-sig 未解开，格式不可用 | 同上，安装 JS 运行时 |
| `HTTP Error 412` | B站 | 缺少 Chrome UA 或 cookie 过期 | 重新导出 `cookies/bilibili.txt` 或使用 Firefox 直读 |
| `HTTP Error 403` | B站 | 地区限制或视频已删除 | 检查视频是否可访问 |
| `dpapi decryption failed` | YouTube | Windows Chrome cookie 加密 | **改用 Firefox**（`.env` 中设 `YOUTUBE_COOKIES_FROM_BROWSER=firefox`） |

---

## 换电脑使用

### Node.js 版本

1. 安装 Node.js (18+)：[nodejs.org](https://nodejs.org/)
2. 安装视频处理工具：
   ```bash
   npm install -g video-pipeline
   ```
3. 克隆或下载项目文件（`.env.example`、`.env`、`cookies/` 等）
4. 安装必装工具：`yt-dlp`、`ffmpeg`、`ffprobe`，确保均在 PATH
5. 用 Firefox 登录 YouTube，设置 `YOUTUBE_COOKIES_FROM_BROWSER=firefox`
6. B站 cookie 仍需手动导出 `cookies/bilibili.txt`（或设置 `BILIBILI_COOKIES_FROM_BROWSER=firefox`）
7. 启动代理（Clash Verge 等），确认端口匹配 `YOUTUBE_PROXY`
8. `video-pipeline --dry-run` 验证

### Python 版本

1. 安装 Python 3.9+：[python.org](https://www.python.org/)
2. 安装必装工具：`yt-dlp`、`ffmpeg`、`ffprobe`，确保均在 PATH
3. 安装 Python 依赖：`pip install pandas openpyxl requests python-dotenv questionary`
4. `cp .env.example .env`，根据实际情况修改 `.env` 中的路径、代理端口和字段映射
5. 用 Firefox 登录 YouTube，设置 `YOUTUBE_COOKIES_FROM_BROWSER=firefox`
6. B站 cookie 仍需手动导出 `cookies/bilibili.txt`（或设置 `BILIBILI_COOKIES_FROM_BROWSER=firefox`）
7. 启动代理（Clash Verge 等），确认端口匹配 `YOUTUBE_PROXY`
8. `python process_videos.py --dry-run` 验证

---

## 适配其他 Excel

如果需要用这套脚本处理**其他项目的 Excel**（列名不同、平台不同）：

**方法一：修改 .env 文件**

1. 复制 `.env.example` 为新 `.env`（或修改现有 `.env`）
2. 修改 `EXCEL_FILE` 指向新 Excel
3. 修改列映射（`COL_ID`、`COL_TITLE`、`COL_CONTENT` 及各平台列名）
4. 修改 `VIDEO_SHEETS` 为新的 sheet 名称
5. 如需新平台，在 `PLATFORM_PRIORITY` 中添加 key，并配置对应的 `{KEY}_URL_TPL`
6. `node process_videos.js --dry-run` 验证配置
7. 跑全量

**方法二：使用 --file 选项（推荐）**

```bash
# 直接指定 Excel 文件，无需修改 .env
node process_videos.js --file "data/其他项目.xlsx" --dry-run

# 配合 --env-file 使用自定义环境变量
node process_videos.js --file "data/其他项目.xlsx" --env-file ".env.其他项目" --dry-run
```

**优点：**
- 无需修改 `.env` 文件
- 可以为不同项目创建不同的 `.env` 配置文件
- 命令行优先级高于环境变量
