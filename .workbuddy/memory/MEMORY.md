# Project MEMORY.md

## 双端架构铁律
- `process_videos.js`(Node ESM CLI) 与 `process_videos.py`(Python) 全流程（download→transcode→transcribe→ocr→analyze）**完全对称**，任何改动必须双端同改同测。
- 外部步骤统一接口：whisper 走 CLI(JS)/API(Py)，ocr 走 `scripts/ocr_frames.py` 子进程（双端同脚本）。
- **全局安装副本同步约定**：用户实跑 `D:/Programs/node_npm/node_global/node_modules/video-pipeline/process_videos.js`（**LF 行尾**，工作区 CRLF）。同步用 Node 脚本 `readFileSync().replace(/\r\n/g,'\n')` 写回，先备份 `.bak`，`node --check` 验证。

## 关键架构决策
- **输出根 OUTPUT_DIR**（默认 `output`）+ 7 固定子目录 `downloads/transcoded/transcripts/keywords/reports/progress/logs/`；COOKIES_DIR 独立。
- **断点续跑**：`progress/{sheet}/task_{stem}.json` 记录各步 status；`success` 步骤加入 skipSteps 复用产物。transcribe/analyze 不允许半成功。
- **Excel 实时写回**（v1.6）：内存缓存 + 周期落盘（EXCEL_FLUSH_INTERVAL 秒，默认 3）+ 退出/信号兜底；缺失列末列自动建；文件占用告警一次 + EXCEL_LOCK_MAX_WAIT 阻塞等待，绝不静默丢。⚠️ **JS 自动建列须用 `_ensureRefCovers` 扩展 `!ref`**（SheetJS 直接 `ws[cellRef]=...` 不自动扩展范围，新列落盘被整片丢弃；2026-08-15 修复 commit `3bcbfbb`）；Py(openpyxl) `ws.cell(...)` 自动跟踪 `max_column`，不受影响。
- **并发安全**（v1.6）：每任务独立 ffmpeg 进度 state；终端刷新加锁；模型双检锁。
- **错误信息透传**原则：失败必输出真实 stderr/traceback，禁止硬截断（用 _print_long/printLong）。
- **OCR 抽帧兜底（2026-08-15 修复，commit c552f87）**：ASR 失败（异常/空文本/无输出）时，若步骤含 ocr 且源视频已下载，自动转 OCR 抽帧（auto 因空文本自然触发、always 强制、off 则 partial）。续跑时 ocr=skipped 旧判定会在本次 ASR 失败后**重新评估 shouldTriggerOcr** 重新触发。择优：ASR 失败时空文本直接采用 OCR（不再要求 OCR≥ASR）。

## 非显性坑（改前必看）
- **commitlint start-case**：subject 行首不得为英文大写词（如 "ASR..."/"Excel..."/"OCR..."），**commit message 直接用中文开头**（2026-08-15 实测 "fix: OCR..." 被 subject-case 拒，改为 "fix: 增强 OCR..." 通过）。
- **CHANGELOG**：由 commit 自动生成（`scripts/regenerate-changelog.js` 重写版本段），**不要手改任何内容**（包括 `## [Unreleased]` 段也不加；2026-08-15 用户明确指出，曾手加 Unreleased 被要求撤回）。
- **FunASR CLI**：`++input=path` 不支持非 ASCII 路径 → 含非 ASCII 时复制到 os.tmpdir()；结果 print 到 stdout 不写文件。
- **faster-whisper（JS 子进程）**：Windows 须注入 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8` 防 gbk 崩溃；CLI 无 `--num_workers`，VAD 阈值是 `--vad_threshold`。
- **PaddleOCR 3.x**：参数重命名(det/rec/cls→text_*)、模型缓存改 `PADDLE_PDX_CACHE_HOME`(~/.paddlex)、import 顺序 PaddleOCR 在前；2.x 才是 ~/.paddleocr。
- **⚠️ PaddleOCR 3.x + paddle 3.3.x CPU 必崩（oneDNN/PIR 不兼容，Paddle#77340）**：`FLAGS_use_mkldnn=0` 和构造器 `enable_mkldnn=False` 都救不了 PP-OCRv6（被 PaddleX 内部覆盖），崩溃 `NotImplementedError: ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]`。**唯一可靠开关 = `PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT=0`**（在 `ocr_frames.py` 顶部 `os.environ` 设置）。`ocr.ocr()` 已废弃（3.7 报 DeprecationWarning），须改用 `ocr.predict(input=fp)`，返回 `OCRResult`，文本/置信度在 `rec_texts`/`rec_scores` 键。日志里的 `<Response [404]>` ×N 多为误判，真实失败点是 oneDNN 异常。
- **OCR 进度指示（2026-08-15）**：`ocr_frames.py` 全程无原生进度，子进程写 `<out>.progress.json` 侧车（`{phase,done,total,elapsed_sec}`，抽帧中/识别中/完成），父进程（JS setInterval / Py 后台线程）轮询刷新单行动画（`[stem] OCR 抽帧识别中 N/M 帧 · 阶段 · Ns`），结束 `os.remove` 清理侧车。
- **OCR 文本清洗去重（2026-08-15）**：`ocr_frames.py` 的 `_dedup_lines` 在写盘前做 ①剥离 `Elabscience` 水印词（视频角标每帧都识别到，纯噪声）②跨帧相似行合并（`difflib` ratio≥0.85，吸收 `Buffet`/`Buffe`/`Buffer` 这类 OCR 噪声残缺变体，保留置信度更高/更完整的代表）③全局精确（归一化后）重复剔除（烧录字幕/循环步骤跨多帧重复）。**双端共用脚本，改一处即两端受益**。关键词/AI 分析基于去重后文本，词频不再被噪声虚高。
- **续跑幂等 + content/keywords 一致性（2026-08-15）**：`best_text` 在 ASR 成功却被 OCR 择优（L2828/`use_ocr`）时，progress JSON 额外落 `content_source`('asr'/'ocr') 与 `content_hash`。续跑时：①**幂等**——若 `prior.content_source==='ocr'` 即便本次 ASR 也成功仍沿用 OCR（不再回退成 ASR，保证两次结果一致）；②**analyze 失效**——续跑若 `best_text !== prior.content`（内容在 ASR/OCR 间切换、或 OCR 文本被更新如改了去重）则把 `analyze` 移出 skipSteps 强制重跑关键词，避免 content 与 keywords 不对等。Excel 的 content 列走 `best_text`（JS `contentMap`/Py `content_updates` 优先 `best_text`），与 progress 一致。
- **⚠️ JS `spawnWithTimeout` 契约（2026-08-15 踩坑，commit `583d47a` 修复）**：成功(子进程退出0)时 resolve `{stdout, stderr}`（**无 `code` 字段**），非0退出/超时/启动失败则 **reject**（Error 带 `code`/`stderr`/`stdout`）。调用方**绝不能写 `r.code === 0` 判成功**（永远 false），也不能假定 reject 会被自动转成 ok=false——必须自己 `try/catch` reject，并从子进程写回的 meta 文件读真实成功状态（如 `meta.ok`）。`runOcrFrames` 最初就栽在这两点：用 `r.code` 把 OCR 成功误判失败，且非0退出未 catch 直接把整任务打挂。
- **代理预检按需触发**：仅当确有需代理下载的任务才 TCP 探测（computeNeededProxyUrls），否则整段跳过。
- **npm 发布配置（2026-08-15 修正，commit cf67fe9）**：`package.json` 的 `files` 白名单须含运行时本地文件 `process_videos.py`/`console_ui.py`/`scripts/ocr_frames.py`（原只有 JS 与文档，零 `.py`）；`.npmignore` 不能 deny `*.py`/`scripts/`（npm 规则：`.npmignore` 拒绝优先于 `files` 允许）。改完用 `npm pack --dry-run` 验证 tarball 文件清单。`scripts/release.js`/`regenerate-changelog.js` 是发布期工具、从仓库跑，不进包。
- **OCR_SCRIPT 定位 & 全局副本同步（2026-08-15 踩坑）**：`ocr_frames.py` 随项目发布在 `scripts/`，必须用**脚本自身目录**（`__dirname`/`SCRIPT_DIR`）定位，绝不能用 `BASE_DIR`(=cwd)——否则从数据目录运行时找不到（报错 `can't open file .../cwd/scripts/ocr_frames.py`）。且**全局安装副本原本缺整个 `scripts/` 目录**（npm 发布配置缺陷导致）：改了工作区源码后，必须按同步约定（先 `.bak` 备份 + CRLF→LF）把 `process_videos.js`/`process_videos.py`/`console-ui.mjs`/`scripts/ocr_frames.py` 一并同步进 `D:/Programs/node_npm/node_global/node_modules/video-pipeline/`，否则修复对"实跑的全局副本"无效（`git push` 只覆盖工作区，全局副本是独立文件系统同步）。**同步 FILES 集合必须与 `process_videos.js` 实际 `import` 自 `console-ui.mjs` 的符号集合一致**——漏同步任一被 import 的文件（如 `console-ui.mjs`），全局副本会因 `does not provide an export named 'X'` 直接崩；`node --check` 只验语法不验导入，漏网必现。
- **ASR 后端预检**：CLI 后端查可执行文件存在（<0.3s），service 走 HTTP GET 3s 超时。

## 测试约束
- 沙箱 C 盘常满 + anaconda torch 损坏 → paddleocr/torch 推理在本沙箱跑不通（环境故障，非代码问题）；用桩模块隔离外部依赖、真实调用 process_one_task/processOneTask 验证逻辑。
- 提交前必跑 `node --check` / `py_compile` 双端。
