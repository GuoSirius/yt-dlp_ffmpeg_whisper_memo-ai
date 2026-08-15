# Project MEMORY.md

## 双端架构铁律
- `process_videos.js`(Node ESM CLI) 与 `process_videos.py`(Python) 全流程（download→transcode→transcribe→ocr→analyze）**完全对称**，任何改动必须双端同改同测。
- 外部步骤统一接口：whisper 走 CLI(JS)/API(Py)，ocr 走 `scripts/ocr_frames.py` 子进程（双端同脚本）。
- **全局安装副本同步约定**：用户实跑 `D:/Programs/node_npm/node_global/node_modules/video-pipeline/process_videos.js`（**LF 行尾**，工作区 CRLF）。同步用 Node 脚本 `readFileSync().replace(/\r\n/g,'\n')` 写回，先备份 `.bak`，`node --check` 验证。

## 关键架构决策
- **输出根 OUTPUT_DIR**（默认 `output`）+ 7 固定子目录 `downloads/transcoded/transcripts/keywords/reports/progress/logs/`；COOKIES_DIR 独立。
- **断点续跑**：`progress/{sheet}/task_{stem}.json` 记录各步 status；`success` 步骤加入 skipSteps 复用产物。transcribe/analyze 不允许半成功。
- **Excel 实时写回**（v1.6）：内存缓存 + 周期落盘（EXCEL_FLUSH_INTERVAL 秒，默认 3）+ 退出/信号兜底；缺失列末列自动建；文件占用告警一次 + EXCEL_LOCK_MAX_WAIT 阻塞等待，绝不静默丢。
- **并发安全**（v1.6）：每任务独立 ffmpeg 进度 state；终端刷新加锁；模型双检锁。
- **错误信息透传**原则：失败必输出真实 stderr/traceback，禁止硬截断（用 _print_long/printLong）。
- **OCR 抽帧兜底（2026-08-15 修复，commit c552f87）**：ASR 失败（异常/空文本/无输出）时，若步骤含 ocr 且源视频已下载，自动转 OCR 抽帧（auto 因空文本自然触发、always 强制、off 则 partial）。续跑时 ocr=skipped 旧判定会在本次 ASR 失败后**重新评估 shouldTriggerOcr** 重新触发。择优：ASR 失败时空文本直接采用 OCR（不再要求 OCR≥ASR）。

## 非显性坑（改前必看）
- **commitlint start-case**：subject 行首不得为英文大写词（如 "ASR..."/"Excel..."），**commit message 直接用中文开头**。
- **CHANGELOG**：发版由 `scripts/regenerate-changelog.js` 从 commit 重写版本段；但**日常手动维护顶部 `## [Unreleased]` 段**记录已修未发版项（README 同步规范明确列为同步点）。不要手改已发布版本段。
- **FunASR CLI**：`++input=path` 不支持非 ASCII 路径 → 含非 ASCII 时复制到 os.tmpdir()；结果 print 到 stdout 不写文件。
- **faster-whisper（JS 子进程）**：Windows 须注入 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8` 防 gbk 崩溃；CLI 无 `--num_workers`，VAD 阈值是 `--vad_threshold`。
- **PaddleOCR 3.x**：参数重命名(det/rec/cls→text_*)、模型缓存改 `PADDLE_PDX_CACHE_HOME`(~/.paddlex)、关 `FLAGS_use_mkldnn=0`、import 顺序 PaddleOCR 在前；2.x 才是 ~/.paddleocr。
- **代理预检按需触发**：仅当确有需代理下载的任务才 TCP 探测（computeNeededProxyUrls），否则整段跳过。
- **ASR 后端预检**：CLI 后端查可执行文件存在（<0.3s），service 走 HTTP GET 3s 超时。

## 测试约束
- 沙箱 C 盘常满 + anaconda torch 损坏 → paddleocr/torch 推理在本沙箱跑不通（环境故障，非代码问题）；用桩模块隔离外部依赖、真实调用 process_one_task/processOneTask 验证逻辑。
- 提交前必跑 `node --check` / `py_compile` 双端。
