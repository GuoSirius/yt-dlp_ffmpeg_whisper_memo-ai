# Project MEMORY.md

## Whisper / FunASR 后端架构
- `WHISPER_BACKEND` 支持**四种**值: `local`(openai-whisper CLI) / `faster-whisper`(CTranslate2) / `service`(whisper.cpp HTTP) / **`funasr`**(阿里, 中文 WER ~5%)
- Python: `faster_whisper.WhisperModel` 全局缓存；Node.js: `whisper-ctranslate2` CLI
- 4 个 faster-whisper 专用: `WHISPER_COMPUTE_TYPE`(int8) / `WHISPER_VAD_FILTER`(True) / `WHISPER_VAD_ONSET`(0.5) / `WHISPER_NUM_WORKERS`(1)
- `WHISPER_EXTRA_ARGS` Python `_apply_fw_extra_args` 转 bool/int/float；JS mergeWhisperArgs 去重
- **FunASR 子模式**: `FUNASR_MODE=cli`(funasr ++model/++input) / `service`(funasr-server OpenAI 兼容)
- **15 个 FUNASR_* 专用参数** + `FUNASR_EXTRA_ARGS` + `--funasr-extra-args` CLI
- 8 主 ASR + 4 辅助模型完整对比见 `.env.example` 和 README「FunASR 可用模型对比表」
- 关键代码: Python `_transcribe_funasr/cli/service` line 1655-1910；JS `transcribeFunasr/Cli/Service` line 1530-1690

## 输出目录（OUTPUT_DIR 统一根）
- **唯一路径 env**：`OUTPUT_DIR`（默认 `output`），CLI `--output <dir>` 覆盖
- **7 个固定子目录**（代码内写死）：`downloads/` `transcoded/` `transcripts/` `keywords/` `reports/` `progress/` `logs/`
- **COOKIES_DIR 独立**（`data/cookies`），启动时一次性 `mkdir` 7 个子目录

## 断点续跑（Resume）机制（2026-06-16 实施，2026-06-19 统一 else 回退）
**核心原则**：transcribe/analyze 不允许"半成功"——要么完整产物落盘 + 校验通过，要么清理掉。
- 产物路径：下载 `downloads/{sheet}/{stem}.mp4` / 转码 `transcoded/{sheet}/{stem}{TRANSCODE_EXT}`（**默认 `.wav`**，由 env 决定，非 `_transcoded.mp4`）/ **识别文本** `transcripts/{sheet}/{stem}.txt` / **关键词** `keywords/{sheet}/{stem}.txt` / 进度 `progress/{sheet}/task_{stem}.json`
- 跳过判定：download/transcode 看 file 存在+size>0；transcribe 看 transcript ≥ `MIN_TRANSCRIPT_CHARS`(50)；analyze 看 keywords ≥ `MIN_KEYWORDS_CHARS`(5)；校验失败 → 降级重做
- **else 回退（2026-06-19 统一）**：每个步骤不在 `--step` 列表时，从磁盘加载前序产物（download→find_downloaded_file / transcode→TRANSCODED_DIR / transcribe→transcript_path），支持 `--step <任意组合> --force`
- 失败不留尾巴：download 清理 `*.part`/`.ytdl`；transcode 清理 0 字节；transcribe/analyze 清理落盘文件

## Excel 实时写回：内存缓存 + 周期落盘（2026-08-14 重构，v1.6）
- **旧方案已废弃**：每条任务 `load_workbook`+`save` 整表 + 锁串行化（`_excel_lock` / `acquireExcelLock`），高并发被磁盘 I/O 拖死
- **新链路**：`write_excel_cell`(Py) / `writeExcelCellByKey`(JS) 只改内存缓存（`_EXCEL_WB` / `_excelWb`）+ 打脏标记；首次写入才整表加载（`_ensure_excel_loaded` / `_ensureExcelLoaded`）
- **三重落盘兜底**：周期（Py daemon 线程 `_excel_flush_loop` / JS `setInterval`）+ 正常退出（`atexit` / `process.on('exit')`）+ 信号（双端 `SIGINT`/`SIGTERM`）
- **`EXCEL_FLUSH_INTERVAL` 单位统一为「秒」**，默认 `3`；JS 内部 ×1000 转毫秒。同一份 `.env` 双端通用（用户明确要求不区分语言）
- 强杀最坏丢一个间隔内修改；`write_all_contents_to_excel` 末尾先 flush 再失效缓存（磁盘为权威源）
- **缺失列自动创建 + 文件占用等待（2026-08-15 增强，commit 9fe8ca4）**：
  - 写入时若 `COL_CONTENT`/`COL_KEYWORDS` 等列不存在，自动在**末列**创建该列表头再写单元格（双端对称：`writeExcelCellByKey`/`writeColumn`(JS) / `_excel_set_cell`(Py)；Py 用 `ws.cell(row=row[0].row, column=target_col)` 避免新列索引越界）
  - **文件被占用（中途用 Excel 打开查看）**：`flushExcel`/`flush_excel` 失败只告警一次（`_excelLockWarned`），脏数据留内存；关闭 Excel 后下次落盘自动恢复（`✅ Excel 已恢复写入`）
  - **收尾不丢数据**：新增 `EXCEL_LOCK_MAX_WAIT`（秒，默认 `300`，`0`=无限）。任务跑完仍占用 → `finalizeExcel`/`finalize_excel` 阻塞等待至写成功再退出；超时仍占用则另存 `<Excel名>.pending.xlsx` 兜底（绝不静默丢）
  - 新增 `_trySaveWb`/`_trySaveExcel`(JS) / `_try_save_excel`(Py) 统一 save + 占用告警去重；`process.on('exit')`/`atexit` 仍做 best-effort 兜底

## 并发安全修复（2026-08-14，v1.6，commit 8f993c7）
- **B1 每任务独立 ffmpeg 进度 state**：`parse_ffmpeg_progress` 增 `state` 参数；`make_ffmpeg_parser`(Py) / `makeFfmpegProgressParser`(JS) 工厂为每任务建独立 dict。此前模块级 `_ffmpeg_state` 全局共享 → `--concurrency 2+` 百分比串扰
- **B2 终端刷新加锁**：`console_ui.py` 的 `_term_lock` 包裹 `update_line`/`clear_line`/`Spinner.stop`；JS 单线程 stderr 写原子，不加锁
- **B3 模型双检锁**：`_model_load_lock` 包裹 faster-whisper / FunASR 的 `_get_model()`；顺带补了缺失的模块级 `_FUNASR_MODEL=None`/`_FUNASR_MODEL_CFG=""`（原先只有 `global` 引用 → funasr 首调 NameError）
- **M1**：删掉第二份逐字节重复的 FunASR 函数块（净减 ~144 行）

## 错误信息透传（2026-06-16 修复）
- **核心原则**：失败时必须输出真实原因（stderr / traceback），禁止 "Exit code 2" 这种干燥提示
- JS `spawnWithTimeout` reject 时把 stderr 末尾（最长 3000 字符）写进 `error.message`
- Python `_transcribe_*` except 块：完整 traceback + 上下文（音频/模型/SSL 错误检测）
- **禁止硬截断** `[:120]` / `[:200]` —— 用 `_print_long`(Py line 437-451) / `printLong`(JS line 380-389)
- 位置：`spawnWithTimeout` line 984-991

## AI 分析 prompt 注意事项（2026-06-18 修复）
- **JS 陷阱**：`String.replace('{content}', text)` 中 `text` 含 `$&` `` $` `` `$'` `$$` 时会被特殊解释，必须用 `() => text` 函数替换
- Python `str.replace` 无此问题，保持原样
- `AI_DEBUG=true` 环境变量：打印实际 prompt 和 AI 返回内容（排查关键词质量问题）
- `\n` 转义：`.env` 中 `\n` 是字面量，`resolvePromptValue`/`_resolve_prompt_value` 负责转真换行

## Whisper/FunASR CLI 参数差异（2026-06-18 修复）
- **faster-whisper**：JS 用 `whisper-ctranslate2` CLI，Python 用 `WhisperModel` API
  - CLI 无 `--num_workers`（Python 专用）→ JS 不传
  - CLI VAD 阈值是 `--vad_threshold`（Python API 用 `vad_parameters.onset`）
- **funasr CLI**：Hydra override `++input=path` 不支持非 ASCII 路径
  - 修复：路径含非 ASCII 时自动复制到 `os.tmpdir()` 临时路径
  - funasr CLI 把结果 `print()` 到 stdout，不写文件 → 从 stdout 解析（JSON → dict repr → 纯文本）

## ASR 后端预检策略（2026-06-18 统一）
- **核心问题**：`whisper` / `whisper-ctranslate2` / `funasr` 的 `--help` 或 `import` 均触发框架初始化，耗时 5-30 秒
- **统一方案**（全量检测 < 0.3 秒）：
  - JS：全部 CLI 后端用 `where`/`which` 检查可执行文件存在（`local`→`whisper`、`faster-whisper`→`whisper-ctranslate2`、`funasr`→`funasr`）
  - Python：CLI 后端用 `shutil.which()`；Python API 后端用 `importlib.util.find_spec()`（`faster_whisper`/`funasr`）
  - `service` / `funasr/service`：HTTP GET 3 秒超时（不变）
- 关键代码：JS `checkWhisperAvailable` line 870；Python `_check_whisper_available` line 1297

## 代理预检机制（PROXY_PROBE_TIMEOUT，2026-08-14 实施，2026-08-15 改为按需触发）
- **背景**：YouTube 下载必走 `YOUTUBE_PROXY`；用户换代理客户端后监听端口漂移（7897→17890），旧端口无监听 → 34 条任务全失败还白跑重试。代理预检在环境预检阶段提前抓出"端口不通"。
- **按需触发（2026-08-15 修正）**：用户反馈"下载已被跳过时（如全部已下好）不该硬跑代理预检还中断"。改为：**仅当确有需要走代理下载的任务时才探测**，否则整段跳过、不阻塞。
  - 新增 `computeNeededProxyUrls(tasks, force)`(JS) / `compute_needed_proxy_urls`(Py)：遍历任务，仅当①平台配置了 `*_PROXY` 且②本地尚无已下载文件（`downloads/{sheet}/{stem}.mp4` 存在+size>0）才计入该 proxy；`--force` 时一律视为需要。返回去重后的 proxy→[pkey] 列表。
  - `checkProxies`/`_check_proxies` 只探测该列表；**空集直接跳过**（不 push issue、不置 proxy=false、不中断）。
  - `checkEnvironmentAsync`/`check_environment` 增 `tasks`/`force` 形参；dry-run 面板与两个 `_check_and_confirm_env`/(`run`) 调用点同步传入。
  - 探测在单次运行内只执行一次（函数无状态，调用点本就只调一次）。
- **双端对称实现**（触发条件现为"含 download 步骤 且 确有需代理下载的任务"）：
  - JS：`checkEnvironmentAsync(steps, tasks, force)` 末尾 `await checkProxies(result, computeNeededProxyUrls(tasks, force))`；`parseProxyEndpoint`/`probeTcp`(net.Socket)/`checkProxies`
  - Python：`check_environment(steps, tasks=None, force=False)` 的 download 分支调 `_check_proxies(result, compute_needed_proxy_urls(tasks, force))`；`_parse_proxy_endpoint`/`_probe_tcp`(socket.create_connection)/`_check_proxies`
- **探测语义**：只做 TCP 握手（host:port 能否连上），**不校验能否真翻墙**；同一 proxy 只探一次；失败 push issue + 置 `result.proxy=false`/`allOk=false`，提示去代理客户端查混合端口
- **配置**：`PROXY_PROBE_TIMEOUT`(ms) 默认 `2000`，`0`=关闭预检。scheme 缺省端口按 socks→1080 / https→443 / http→80
- **面板**：dry-run / check 末行显示 `✅ 代理: youtube→<url>` 或 `❌ 代理: ...` 或 `未配置` / `预检关闭` / `全部已下载，跳过`
- **文档同步**：`.env.example` 2.4.4 段「如何定位代理端口」(netstat/lsof/yt-dlp 验证/dry-run 确认) + README「工具预检·代理预检」子节 + 核心配置表 + 故障排查表（10061 连接失败归因为端口失效）
- **全局安装副本同步约定**：用户实跑 `D:/Programs/node_npm/node_global/node_modules/video-pipeline/process_videos.js`（**LF 行尾**，工作区是 CRLF）。同步时用 Node 脚本 `readFileSync().replace(/\r\n/g,'\n')` 写回，先备份 `.bak`；`node --check` 验证

## README 同步规范（2026-06-16 教训，2026-08-14 补充审计脚本）
- **代码变更 + 文档同步必须同 commit 提交**，否则用户拉代码看 README 找不到对应功能
- **commitlint start-case 拦截**：subject 行首出现英文大写词会被拒（`v1.4` → 改「同步 v1.4 的」；`Excel flush …` → 改「实时写落盘…」）。**结论：commit message 直接用中文开头**
- 同步要点：Whisper/FunASR 章节 / 7 子目录结构 / --output CLI / 断点续跑章节 / 错误透传章节 / 参数表 / 核心配置表 / CHANGELOG Unreleased 段
- **env 变量覆盖审计脚本**（新增 env 后必跑）：正则抽取 `os.getenv|os.environ.get|process.env.X|process.env['X']` 得全量变量（当前 62 个），双向比对 README 与 `.env.example`
  - 误报白名单：`EXCEL_FILE`/`COOKIES_DIR` 走 `_env_path()`/`envPath()` 包装；`{prefix}_URL_TPL`、`{prefix}_PROXY` 等是 f-string 动态拼接 —— 正则抓不到属正常
  - 2026-08-14 用此脚本查出 3 类文档缺陷：`EXCEL_FLUSH_INTERVAL` 未文档化、`TRANSCODE_EXT`/`TRANSCODE_ARGS` 漏写、**README 平台列名写错**（应为 `COL_TENCENTVID`/`COL_BILIBILIBVID`/`COL_YOUTUBEID`/`COL_YOUKUID`，非 `COL_TENCENT` 等）
- CHANGELOG 由 commit message 自动生成，**不要手改**
