# Project MEMORY.md

## Whisper 后端架构
- `WHISPER_BACKEND` 支持三种值: `local`(openai-whisper CLI) / `faster-whisper`(CTranslate2) / `service`(whisper.cpp HTTP)
- Python 版 faster-whisper: 使用 `faster_whisper` Python API 模块导入，模型实例全局缓存
- Node.js 版 faster-whisper: 使用 `whisper-ctranslate2` CLI (child_process.spawn)
- 新增 4 个 faster-whisper 专用参数: `WHISPER_COMPUTE_TYPE`(int8) / `WHISPER_VAD_FILTER`(True) / `WHISPER_VAD_ONSET`(0.5) / `WHISPER_NUM_WORKERS`(1)
- 所有共享参数 (model/language/task/temperature/beam_size/initial_prompt等) 三后端复用
- `WHISPER_EXTRA_ARGS` 在 Python 版通过 `_apply_fw_extra_args` 自动类型转换后注入 kwargs；JS 版通过 CLI 参数直接传递
- 未来计划接入 funasr

## 输出目录结构（OUTPUT_DIR 统一根）
- **唯一路径 env 变量**：`OUTPUT_DIR`（默认 `output`），可通过 `--output <dir>` CLI 覆盖，优先级 CLI > env > 默认
- **代码内 7 个固定子目录**（不可通过 env 覆盖）：`downloads/` `transcoded/` `transcripts/` `keywords/` `reports/` `progress/` `logs/`
- **COOKIES_DIR 独立**（`data/cookies`），不归并到 OUTPUT_DIR 下
- 启动时一次性 `mkdir` 7 个子目录（幂等）
- 删除了之前 6 个独立的目录 env 变量（DOWNLOADS_DIR/TRANSCODED_DIR/REPORTS_DIR/PROGRESS_DIR/TRANSCRIPTS_DIR/KEYWORDS_DIR）

## 断点续跑（Resume）机制（2026-06-16 实施）
**核心原则**：transcribe/analyze 不允许"半成功"——要么完整产物落盘 + 校验通过，要么清理掉。

### 产物路径
- 下载：`output/downloads/{sheet}/{stem}.mp4`
- 转码：`output/transcoded/{sheet}/{stem}_transcoded.mp4`
- **识别文本**：`output/transcripts/{sheet}/{stem}.txt`（断点续跑校验依据）
- **关键词**：`output/keywords/{sheet}/{stem}.txt`（断点续跑校验依据）
- 进度：`output/progress/{sheet}/task_{stem}.json`

### 跳过判定（每次 process_one_task 入口）
1. 读 progress JSON，`force=False` 且 `overall_status` / 步骤 status=success 时进入跳过检查
2. **download/transcode 跳过条件**：记录的 file 路径存在 + size>0
3. **transcribe 跳过条件**：`output/transcripts/.../{stem}.txt` 存在 + 内容长度 ≥ `MIN_TRANSCRIPT_CHARS`(50)
4. **analyze 跳过条件**：`output/keywords/.../{stem}.txt` 存在 + 长度 ≥ `MIN_KEYWORDS_CHARS`(5)
5. 任意校验失败 → 视为"上次的 success 不可信"，**降级为重做该 step**

### 失败不留尾巴
- download 失败：清理 `*.part` / `*.ytdl` 残留
- transcode 失败：清理 0 字节的转码文件
- transcribe 失败：清理 transcript 文本文件（无半残文本）
- analyze 失败：清理 keywords 文本文件

### Excel 实时写回
- 每条任务完成后立即通过 `write_excel_cell`(Python) / `writeExcelCellByKey`(JS) 写 Excel
- Python 用 `_excel_lock` 串行化；JS 用 promise 队列 `acquireExcelLock()`
- 不再依赖末尾批量写 → 断电时 Excel 已有最新内容

### 启动统计
启动时扫描 progress JSON 打印："♻️ 完整跳过 N 条 / 部分续跑 M 条 / 全量重跑 K 条"

### 关键代码位置
- Python `process_videos.py`:
  - 工具函数 line 333-414（`transcript_path`/`keywords_path`/`progress_path`/`safe_remove`/`validate_*`/`load_task_progress`）
  - `write_excel_cell` 抽取出来 line 1697-1750
  - `process_one_task` 续跑 + 落盘 + 失败清理 line 2009-2180
  - `save_task_progress` 末尾实时写 Excel line 1687-1703
  - `run()` 启动扫描 line 2532-2548
- JS `process_videos.js`:
  - 工具函数 line 482-580（同名）
  - `writeExcelCellByKey` + `acquireExcelLock` line 555-616
  - `processOneTask` 续跑 + 落盘 + 失败清理 line 1764-1980
  - `saveTaskProgress` 改为 async + 实时写 line 1637-1660
  - `run()` 启动扫描 line 2661-2676

