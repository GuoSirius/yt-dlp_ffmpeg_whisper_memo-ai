# 视频下载 / 转码 / 文本识别 流程

基于 `process_videos.py`，一键完成：yt-dlp 下载 → ffmpeg 转码 → whisper 识别 → 写回 Excel。

## 目录结构

```
├── process_videos.py          # 主流程脚本
├── export_2026-06-10_split.xlsx  # 数据源（YouTube视频 / 普诺赛中文站 两个 sheet）
├── cookies/
│   ├── bilibili.txt           # B站 cookie（Netscape 格式）
│   └── youtube.txt            # YouTube cookie
├── downloads/                 # yt-dlp 下载输出（mp4）
│   ├── YouTube视频/
│   └── 普诺赛中文站/
├── transcoded/                # ffmpeg 转码输出（wav 16kHz mono）
│   ├── YouTube视频/
│   └── 普诺赛中文站/
└── reports/                   # 执行报告（JSON）
    └── report_YYYYMMDD_HHMMSS.json
```

## 环境依赖

| 工具 | 路径 | 用途 |
|---|---|---|
| Python | `C:\Users\Admin\.workbuddy\binaries\python\envs\default\Scripts\python.exe` | 脚本运行 |
| yt-dlp | `...\Memo\resources\yt-dlp\yt-dlp.exe` | 视频下载 |
| ffmpeg | `...\Memo\resources\addon\ffmpeg\ffmpeg.exe` | 音频转码 |
| whisper | `http://localhost:9588` | 语音识别 |

## 使用方法

```bash
# 进入项目目录
cd "D:\workspace\resource\普诺赛中文站\20260605-普诺赛中文站视频模块搜索关键词数据补充（爬取所有视频关键词补充到129中台视频模块）"
```

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

## 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `--sheet` | str | 全部 | 指定 sheet：`YouTube视频` 或 `普诺赛中文站` |
| `--id` | str | — | 指定 extra.id 或 title（单条测试） |
| `--step` | str | 全跑 | 只执行某步：`download` / `transcode` / `transcribe` |
| `--force` | flag | off | 强制重做，忽略已有文件 |
| `--concurrency` | int | 1 | 并发数，建议 2~3 |
| `--retry` | int | 0 | 每步失败最大重试次数 |
| `--retry-delay` | float | 5 | 重试间隔基数（秒），指数退避 5→10→20 |
| `--dry-run` | flag | off | 干跑模式，只列任务不执行 |
| `--retry-failed` | path | — | 从报告 JSON 重跑失败项 |

## 重试规则

| 可重试 | 不重试 |
|---|---|
| 网络超时、连接拒绝 | HTTP 404 / 403 / 401 |
| yt-dlp 下载中断 | 视频已删除 / 私有 |
| whisper 服务超时 | 无效 URL、文件不存在 |

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

多线程并发时使用打印锁保证输出不交错；进度变化立即刷新，否则每 2s 保底刷新避免卡住。

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
