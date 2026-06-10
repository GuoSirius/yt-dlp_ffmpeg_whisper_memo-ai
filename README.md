# 视频下载 / 转码 / 文本识别 流程

基于 `process_videos.py`，一键完成：yt-dlp 下载 → ffmpeg 转码 → whisper 识别 → 写回 Excel。

## 环境依赖

### 必装工具

| 工具 | 版本要求 | 安装方式 | 用途 |
|---|---|---|---|
| Python | 3.9+ | [python.org](https://www.python.org/) | 脚本运行 |
| yt-dlp | 最新 | `pip install yt-dlp` 或 [GitHub Release](https://github.com/yt-dlp/yt-dlp/releases) | 视频下载 |
| ffmpeg + ffprobe | 4.0+ | [ffmpeg.org](https://ffmpeg.org/download.html) 或 `winget install ffmpeg` | 音频转码 + 时长检测 |

> **验证安装**：在终端执行 `yt-dlp --version`、`ffmpeg -version`、`ffprobe -version`，确保均在 PATH 中。

### 必装 Node.js（YouTube n-sig 挑战）

YouTube 要求 JS 运行时解开 n-sig 挑战，否则无法提取视频格式。

| 方式 | 安装命令 |
|---|---|
| Node.js（推荐） | [nodejs.org](https://nodejs.org/) 下载 LTS 版，安装后 `node --version` 验证 |
| Deno | `winget install DenoLand.Deno` 或 [deno.com](https://deno.com/) |

> 脚本默认使用 `--js-runtimes node`，如果你装的是 deno，修改 `.env` 中 `YOUTUBE_JS_RUNTIMES=deno`。

### Python 依赖

```bash
pip install pandas openpyxl requests python-dotenv
```

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
| 列映射 | `COL_ID` / `COL_TITLE` / `COL_CONTENT` | 唯一标识列 / 标题列 / 输出列 |
| 列映射 | `COL_TENCENTVID` / `COL_BILIBILIBVID` / `COL_YOUTUBEID` / `COL_YOUKUID` | 各平台视频 ID 所在列 |
| Sheet | `VIDEO_SHEETS` | 逗号分隔需要处理的 sheet（留空则全部） |
| 平台 | `PLATFORM_PRIORITY` | 平台重试优先级 |
| 平台 | `{平台}_URL_TPL` | URL 模板（如 `YOUTUBE_URL_TPL=https://youtu.be/{youtubeId}`） |
| 平台 | `{平台}_COOKIE_FILE` / `{平台}_FORMAT` | cookie 路径 / 下载格式 |
| 服务 | `WHISPER_BACKEND` | `local` 或 `service` |
| 服务 | `WHISPER_MODEL` | 模型名 (tiny/base/small/medium/large)，两种后端通用 |
| 服务 | `WHISPER_DEVICE` | 本地模式设备 (cpu/cuda) |
| 服务 | `WHISPER_LANGUAGE` | 语言代码 (仅 backend=local)，空=多语言自动检测（默认） |
| 服务 | `WHISPER_SERVICE_MODEL` | 模型文件路径 (仅 backend=service)，如 models/ggml-base.bin |
| 工具 | `YTDLP` / `FFMPEG` / `FFPROBE` | 外部工具路径 |

### Whisper 语音识别

支持两种后端，通过 `WHISPER_BACKEND` 切换：

**远程服务模式**（默认，whisper.cpp server）：
需要本地或远程运行 whisper.cpp server，监听 `http://localhost:9588`：
- `POST /inference` ← 上传 wav 文件，返回识别文本（参数: file/temperature/temperature_inc/response_format）
- `POST /load` ← 切换模型（参数: model=模型文件路径），如 `models/ggml-base.bin`
- 语言由 whisper.cpp 自动检测，无需配置
- 通过 `WHISPER_SERVICE_MODEL` 指定模型文件路径（留空则使用服务当前已加载的模型）
- 脚本首次识别时会自动 `/load`，同一模型只加载一次（缓存）

**本地 CLI 模式**：
需要在本地安装 `openai-whisper`：`pip install openai-whisper`
```bash
# .env 配置
WHISPER_BACKEND=local
WHISPER_MODEL=base          # tiny / base / small / medium / large
WHISPER_DEVICE=cpu          # cpu 或 cuda
WHISPER_LANGUAGE=zh          # 空=多语言自动检测（默认），需要指定时填 zh/en/ja 等
```
脚本会直接调用 `whisper` CLI，无需额外服务进程。

---

## 目录结构

```
├── process_videos.py              # 主流程脚本
├── .env.example                   # 环境变量模板（可提交 Git）
├── .env                           # 实际环境变量（已 gitignore，按需修改）
├── export_2026-06-10_split.xlsx   # 数据源（YouTube视频 / 普诺赛中文站 两个 sheet）
├── cookies/
│   ├── bilibili.txt               # B站 cookie（Netscape 格式）
│   └── youtube.txt                # YouTube cookie（Netscape 格式）
├── downloads/                     # yt-dlp 下载输出（mp4）
│   ├── YouTube视频/
│   └── 普诺赛中文站/
├── transcoded/                    # ffmpeg 转码输出（wav 16kHz mono）
│   ├── YouTube视频/
│   └── 普诺赛中文站/
└── reports/                       # 执行报告（JSON）
    └── report_YYYYMMDD_HHMMSS.json
```

---

## Cookie 导出（首次使用必须）

### YouTube

1. Chrome 安装扩展 [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. 访问 [youtube.com](https://www.youtube.com) 并登录
3. 点击扩展图标 → Export → 保存为 `cookies/youtube.txt`（覆盖已有文件）

> Cookie 有效期约 1-2 周，过期后需重新导出。下载时如果报 `Sign in to confirm you're not a bot`，说明 cookie 已失效。

### B站（bilibili）

1. 同样使用上述 Chrome 扩展
2. 访问 [bilibili.com](https://www.bilibili.com) 并登录
3. 点击扩展图标 → Export → 保存为 `cookies/bilibili.txt`

---

## 使用方法

### 单条测试

```bash
# 下载 + 转码 + 识别，指定 sheet + extra.id
python process_videos.py --sheet "YouTube视频" --id 2143

# 只跑下载
python process_videos.py --sheet "普诺赛中文站" --id 16 --step download

# 只跑转码（需要已有下载文件）
python process_videos.py --sheet "普诺赛中文站" --id 16 --step transcode

# 只跑识别（需要已有转码文件）
python process_videos.py --sheet "普诺赛中文站" --id 16 --step transcribe

# 强制重新下载（忽略已有文件）
python process_videos.py --sheet "YouTube视频" --id 2143 --force
```

### 批量全量

```bash
# 全量执行（2 个并发，失败重试 3 次）
python process_videos.py --concurrency 2 --retry 3

# 只跑某一 sheet
python process_videos.py --sheet "YouTube视频" --concurrency 2 --retry 3

# 先干跑预览
python process_videos.py --dry-run
```

### 重跑失败

```bash
# 第一次跑完后生成 reports/report_xxx.json
# 查看失败项：
python process_videos.py --retry-failed reports/report_20260610_143000.json --dry-run

# 重跑：
python process_videos.py --retry-failed reports/report_20260610_143000.json --concurrency 2 --retry 3
```

### 超时控制（防止任务卡死）

每个步骤都有独立超时，超时后自动 kill 子进程、标记失败并继续执行后续任务：

```bash
# 自定义超时（单位秒）
python process_videos.py \
    --download-timeout 900 \    # 下载 15 分钟
    --transcode-timeout 600 \   # 转码 10 分钟
    --transcribe-timeout 1200   # 识别 20 分钟

# 默认值：下载 600s / 转码 300s / 识别 600s
```

- 超时属于**可重试错误**，会触发指数退避重试（`--retry` 控制次数）
- 无论超时多少次，**不会阻塞其他并发任务**，失败项会记录到报告
- 超时失败的任务可用 `--retry-failed` 单独重跑

---

## 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `--sheet` | str | 全部 | 指定 sheet：`YouTube视频` 或 `普诺赛中文站` |
| `--id` | str | — | 指定 extra.id 或 title（单条测试） |
| `--step` | str | 全跑 | 只执行某步：`download` / `transcode` / `transcribe` |
| `--force` | flag | off | 强制重做下载+转码，忽略已有文件 |
| `--concurrency` | int | 1 | 并发数，建议 2~3 |
| `--retry` | int | 0 | 每步失败最大重试次数 |
| `--retry-delay` | float | 5 | 重试间隔基数（秒），指数退避 5→10→20 |
| `--download-timeout` | int | 600 | 单个下载任务最长执行时间（秒） |
| `--transcode-timeout` | int | 600 | 单个转码任务最长执行时间（秒） |
| `--transcribe-timeout` | int | 600 | 单个识别任务最长执行时间（秒） |
| `--dry-run` | flag | off | 干跑模式，只列任务不执行 |
| `--retry-failed` | path | — | 从报告 JSON 重跑失败项 |

---

## 重试规则

| 可重试 | 不重试 |
|---|---|
| 网络超时、连接拒绝 | HTTP 404 / 403 / 401 |
| yt-dlp 下载中断 | 视频已删除 / 私有 |
| whisper 服务超时 | 无效 URL、文件不存在 |
| **步骤级超时（任务卡死）** | 参数错误（ValueError/TypeError） |

---

## 智能跳过与自动重转码

脚本默认不会重复处理已有文件，但会在以下情况自动触发重做：

| 步骤 | 跳过条件 | 自动重做条件 |
|---|---|---|
| 下载 | 同名文件已存在（非 `--force`） | `--force` 或文件不存在 |
| 转码 | WAV 已存在 **且** MP4 时间戳 ≤ WAV 时间戳 | `--force` 或 **MP4 比 WAV 新**（重新下载过） |
| 识别 | —（每次必跑，覆盖写入 Excel） | — |

> 关键设计：即使不加 `--force`，只要视频重新下载过（MP4 的修改时间晚于 WAV），转码也会自动重新执行，**确保下载和转码内容始终保持一致**。

---

## 文件名去重

脚本默认使用 `COL_ID`（即 `extra.id`）作为文件名 stem。当同一个 sheet 内出现重复 id 时，自动应用以下去重策略：

| 优先级 | 格式 | 示例 |
|--------|------|------|
| 1 | `{id}` | `2143` |
| 2 | `{id}_{title}` | `2143_产品介绍` |
| 3 | `{id}_{title}_{platformVid}` | `2143_产品介绍_BV1xx4y1z7Ab` |

> 去重仅在同 sheet 内生效，不同 sheet 之间允许同名文件（存放在不同子目录）。

---

---

## 进度显示

执行时会同时展示**总体进度**和**单视频进度**：

```text
[1/91] [2143] 开始处理 (sheet=YouTube视频, platform=youtubeId, title=xxx)
  [2143] 开始下载 (平台=youtubeId)
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

[总进度 1/91 (1.1%)] ✅1 ❌0 ⚠️0 ⏭️0         ← 每完成一个刷新
```

| 层级 | 显示内容 |
|---|---|
| 总体进度 | 完成/总任务数、百分比、✅成功 ❌失败 ⚠️部分 ⏭️无视频 四维计数 |
| 下载 | yt-dlp 实时百分比 + 速度 + ETA |
| 转码 | 先 ffprobe 取时长，再实时解析 `time=` 算百分比（如 `25.3% (38s/150s)`） |
| 识别 | 每 5s 打印已用时间，完成时显示总耗时和文本长度 |

多线程并发时使用打印锁保证输出不交错。

---

## 报告格式

执行后在 `reports/` 生成 `report_YYYYMMDD_HHMMSS.json`：

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

- **success**：下载 + 转码 + 识别全部成功
- **partial**：下载 + 转码成功，识别失败（如 whisper 服务挂了）
- **failed**：下载或转码失败
- **no_video**：该行无可用视频 ID

---

## 典型工作流

```bash
# 1. 干跑预览
python process_videos.py --dry-run

# 2. 单条验证
python process_videos.py --sheet "YouTube视频" --id 2143 --retry 2

# 3. 全量执行
python process_videos.py --concurrency 3 --retry 3

# 4. 查看报告，重跑失败项
python process_videos.py --retry-failed reports/report_xxx.json --concurrency 2 --retry 3
```

---

## 平台适配说明

脚本支持四个视频平台的下载，各有不同的反爬配置：

| 平台 | 字段 | 反爬措施 |
|---|---|---|
| B站 (bilibili) | `extra.bilibiliBvid` | Chrome UA + Referer 头 + 有效 cookie + 并发分片 |
| YouTube | `extra.youtubeId` | Chrome UA + 有效 cookie + Node.js/Deno JS 运行时解 n-sig 挑战 |
| 腾讯视频 | `extra.tencentVid` | 无需特殊配置 |
| 优酷 | `extra.youkuId` | 无需特殊配置（部分视频需会员） |

### 常见下载错误

| 错误 | 平台 | 原因 | 解决方案 |
|---|---|---|---|
| `HTTP Error 412` | B站 | 缺少 Chrome UA 或 cookie 过期 | 重新导出 `cookies/bilibili.txt` |
| `Sign in to confirm you're not a bot` | YouTube | cookie 过期 | 重新导出 `cookies/youtube.txt` |
| `n challenge solving failed` | YouTube | 无 JS 运行时 | 安装 Node.js 或 Deno |
| `Requested format is not available` | YouTube | n-sig 未解开，格式不可用 | 同上，安装 JS 运行时 |
| `HTTP Error 403` | B站 | 地区限制或视频已删除 | 检查视频是否可访问 |

---

## 换电脑使用

1. 安装上述所有必装工具，确保 `yt-dlp`、`ffmpeg`、`ffprobe`、`node` 均在 PATH
2. `pip install pandas openpyxl requests python-dotenv`
3. `cp .env.example .env`，根据实际情况修改 `.env` 中的路径和字段映射
4. 重新导出 B站和 YouTube cookie（浏览器登录后导出）
5. 复制整个项目目录到新电脑
6. `python process_videos.py --dry-run` 验证

## 适配其他 Excel

如果需要用这套脚本处理**其他项目的 Excel**（列名不同、平台不同）：

1. 复制 `.env.example` 为新 `.env`（或修改现有 `.env`）
2. 修改 `EXCEL_FILE` 指向新 Excel
3. 修改列映射（`COL_ID`、`COL_TITLE`、`COL_CONTENT` 及各平台列名）
4. 修改 `VIDEO_SHEETS` 为新的 sheet 名称
5. 如需新平台，在 `PLATFORM_PRIORITY` 中添加 key，并配置对应的 `{KEY}_URL_TPL`
6. `python process_videos.py --dry-run` 验证配置
7. 跑全量
