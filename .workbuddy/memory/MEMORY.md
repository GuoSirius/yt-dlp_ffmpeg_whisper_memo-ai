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

## 断点续跑（Resume）机制（2026-06-16 实施）
**核心原则**：transcribe/analyze 不允许"半成功"——要么完整产物落盘 + 校验通过，要么清理掉。
- 产物路径：下载 `downloads/{sheet}/{stem}.mp4` / 转码 `transcoded/{sheet}/{stem}_transcoded.mp4` / **识别文本** `transcripts/{sheet}/{stem}.txt` / **关键词** `keywords/{sheet}/{stem}.txt` / 进度 `progress/{sheet}/task_{stem}.json`
- 跳过判定：download/transcode 看 file 存在+size>0；transcribe 看 transcript ≥ `MIN_TRANSCRIPT_CHARS`(50)；analyze 看 keywords ≥ `MIN_KEYWORDS_CHARS`(5)；校验失败 → 降级重做
- 失败不留尾巴：download 清理 `*.part`/`.ytdl`；transcode 清理 0 字节；transcribe/analyze 清理落盘文件
- Excel 实时写回：每条完成立即 `write_excel_cell`(Py) / `writeExcelCellByKey`(JS)；Py `_excel_lock` 串行；JS `acquireExcelLock()` 队列

## 错误信息透传（2026-06-16 修复）
- **核心原则**：失败时必须输出真实原因（stderr / traceback），禁止 "Exit code 2" 这种干燥提示
- JS `spawnWithTimeout` reject 时把 stderr 末尾（最长 3000 字符）写进 `error.message`
- Python `_transcribe_*` except 块：完整 traceback + 上下文（音频/模型/SSL 错误检测）
- **禁止硬截断** `[:120]` / `[:200]` —— 用 `_print_long`(Py line 437-451) / `printLong`(JS line 380-389)
- 位置：`spawnWithTimeout` line 984-991

## README 同步规范（2026-06-16 教训）
- **代码变更 + 文档同步必须同 commit 提交**，否则用户拉代码看 README 找不到对应功能
- commitlint 拦截：`v1.4` 出现在行首被判 start-case → 改写为「同步 v1.4 的」才过
- 同步要点：Whisper/FunASR 章节 / 7 子目录结构 / --output CLI / 断点续跑章节 / 错误透传章节 / 参数表 / 核心配置表 / CHANGELOG Unreleased 段
