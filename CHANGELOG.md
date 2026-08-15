# Changelog

## [1.6.3] - 2026-08-15

### Bug Fixes

- faster-whisper 子进程注入 PYTHONUTF8 修复 Windows gbk 崩溃，识别失败不再显示裸 null ([`b4fd75d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/b4fd75d))

### Documentation

- 补记 faster-whisper gbk 崩溃修复日志 ([`99e059d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/99e059d))

### CI/CD

- 给 changelog 生成脚本补 commit 链接，重生成 CHANGELOG.md ([`9b47075`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/9b47075))


## [1.6.2] - 2026-08-15

### Features

- 给 Excel 缺失列自动建列，文件被占用时告警一次并阻塞等待写回 ([`9fe8ca4`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/9fe8ca4))

### Bug Fixes

- 识别输出文件未生成时透传 whisper CLI 真实 stderr ([`982e9fc`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/982e9fc))
- 代理预检改为按需触发，仅在确有走代理下载的任务时执行 ([`b089041`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/b089041))

### Documentation

- 记录 Excel 缺失列自动创建与占用等待兜底 ([`14caf6e`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/14caf6e))
- 记录识别 output file not generated 诊断与 stderr 透传修复 ([`e3879f7`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e3879f7))
- 代理预检按需触发作长期记忆，补今日日志 ([`7181daf`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/7181daf))
- 对齐 README 与 .env.example 的识别模型默认值并修正 FUNSR 拼写 ([`6fe50c2`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/6fe50c2))
- 给 WHISPER_BACKEND 四种模式补推荐场景与语言速查 ([`d51f312`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/d51f312))
- update ([`c62a6e0`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/c62a6e0))
- 记录魔戒切换节点解决单视频 SSL EOF 的根因确认 ([`01b76ef`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/01b76ef))

## [1.6.1] - 2026-08-14

### Features

- 新增代理连通性预检，代理失效时提前阻断而非全批下载失败 ([`7777571`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/7777571))

### Bug Fixes

- py 端标准流强制 utf-8，修复重定向输出时 emoji 编码崩溃 ([`4d14ddf`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/4d14ddf))
- 给 Excel 落盘定时器加 unref，避免任务跑完进程不退出 ([`a5f16ab`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a5f16ab))
- 修复报告生成时 sheets 越界引用导致的 ReferenceError ([`bd8752e`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/bd8752e))

### Documentation

- 记录代理端口速查表与 SSL UNEXPECTED_EOF 报错分析 ([`671cb77`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/671cb77))
- 补充常用代理客户端默认端口速查表，纠正 7897 误写 ([`03519f0`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/03519f0))
- 补充代理预检机制长期记忆与今日报障排查记录 ([`e3152f2`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e3152f2))
- 补充代理预检说明与代理端口定位方法 ([`88656e7`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/88656e7))
- 同步 EXCEL_FLUSH_INTERVAL 等 env 到 README 与 .env.example，修正平台列名笔误 ([`c48b908`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/c48b908))

## [1.6.0] - 2026-08-14

### Bug Fixes

- 并发转码进度串扰(B1/B2)与模型竞态(B3),删FunASR重复死代码(M1),Excel实时写改内存缓存+周期落盘(M2) ([`8f993c7`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/8f993c7))

### Refactoring

- 实时写落盘间隔双端统一为秒(EXCEL_FLUSH_INTERVAL=5 通用) ([`cd42333`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/cd42333))
- 实时写 Excel 落盘间隔改为可配置(EXCEL_FLUSH_INTERVAL)，默认 3s ([`7de1d0d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/7de1d0d))

### Documentation

- 补充 B1/B2/B3/M1/M2 落地实现记录 ([`352e5a0`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/352e5a0))

## [1.5.16] - 2026-08-14

### Bug Fixes

- 留空 VIDEO_SHEETS 时枚举全部 sheet（js/py 双版本） ([`cc7db0f`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/cc7db0f))

### Documentation

- update ([`4672a3c`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/4672a3c))

## [1.5.15] - 2026-06-20

### Features

- --url 模式支持并发处理 ([`f5ddf50`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f5ddf50))
- --url 和 --input 模式支持并发处理（p-limit） ([`d8973a3`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/d8973a3))
- --input 支持多个值（js/python 均改，可多次指定或逗号/空格/中文逗号分隔） ([`172f313`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/172f313))
- py 版 --sheet/--file/--url 支持多个值（逗号/空格分隔 + 多次指定） ([`12a18b0`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/12a18b0))
- js 版 --file/--url/--sheet 支持多个值（逗号/空格分隔 + 多次指定） ([`2ea2118`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2ea2118))

### Bug Fixes

- 让 --url 和 --input 模式的报告配置使用 opts.concurrency ([`24ea44b`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/24ea44b))
- --input 模式支持并发处理（ThreadPoolExecutor） ([`1d944ef`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/1d944ef))
- 添加 --input 空文件列表检查 ([`60427d1`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/60427d1))
- 修复 --input 循环的 3 个 bug ([`a9f8e3f`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a9f8e3f))
- python 版 --input 多文件处理缩进修正，循环正确关闭 ([`1d41c52`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/1d41c52))

### Documentation

- 在 ASR 安装说明中添加缓存目录更改提示 ([`0586547`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/0586547))
- 更新 README 记录 JS 并发支持及 --concurrency 说明 ([`24b19e4`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/24b19e4))
- 更新 CHANGELOG 记录 JS 并发支持 ([`c35354c`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/c35354c))
- 统一 README 安装说明到「安装前准备」章节 ([`b37bab5`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/b37bab5))
- 更新 CHANGELOG.md 记录 v1.5.14 的所有修复 ([`ee6c2b4`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/ee6c2b4))
- 更新 2026-06-20 工作日志 ([`95f453d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/95f453d))
- 同步 --input/--url/--sheet/--id 多值支持到 readme 和 changelog ([`26d96c2`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/26d96c2))

### Chores

- update before release ([`79274a0`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/79274a0))
- 更新版本号至 1.5.14 ([`48ad64c`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/48ad64c))

## [1.5.13] - 2026-06-20

### Bug Fixes

- --id 兼容 PowerShell 逗号为空格的展开问题（js/python 均修） ([`8df554f`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/8df554f))

### Chores

- update before release ([`84795b9`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/84795b9))

## [1.5.12] - 2026-06-20

### Bug Fixes

- esm 模块中补充 __filename/__dirname 定义，修复 --version 报错 ([`f8b32e1`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f8b32e1))

## [1.5.11] - 2026-06-20

### Features

- 增加 --version 参数（js/py 均支持）；修复 py 版 --id 匹配逻辑 ([`f03e6c6`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f03e6c6))

### Bug Fixes

- --id 匹配改回只用 COL_ID/COL_TITLE，去掉 AI_DEBUG 调试打印 ([`6de36e6`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/6de36e6))
- --id 匹配增加字符串直接匹配；--file/--output 相对路径改回相对于 shell cwd ([`ff7ba35`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/ff7ba35))

### Chores

- update before release ([`3b743ae`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/3b743ae))

## [1.5.10] - 2026-06-20

### Bug Fixes

- --id 匹配失败无提示、--file 路径解析相对于 cwd 而非项目目录 ([`1f24f3f`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/1f24f3f))

### Chores

- update before release ([`7a01a59`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/7a01a59))

## [1.5.9] - 2026-06-19

### Chores

- optimize prompt ([`a686e82`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a686e82))

## [1.5.8] - 2026-06-19

### Features

- --id 支持多值批量指定 ([`f39c7d2`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f39c7d2))

### Chores

- update before release ([`4527909`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/4527909))

## [1.5.7] - 2026-06-19

### Bug Fixes

- 统一各步骤 else 回退，支持任意 --step 组合 + --force ([`af285fb`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/af285fb))
- --step analyze --force 单独执行时从磁盘回退加载 transcript ([`24d2fa5`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/24d2fa5))

### Refactoring

- lean-coding skill v2 极简重写 ([`e912290`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e912290))

### Chores

- update before release ([`69a08f1`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/69a08f1))

## [1.5.6] - 2026-06-19

### Bug Fixes

- 限制关键词最多 30 个，禁止 AI 联想扩展 ([`e12074e`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e12074e))
- excel 写入前截断超过 32767 字符的内容 ([`cd36a87`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/cd36a87))

### Refactoring

- 统一优化五处 AI 提示词，对齐 sshk.md 结构 ([`1659200`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/1659200))

### Chores

- optimize prompt ([`71244c1`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/71244c1))

## [1.5.5] - 2026-06-19

### Bug Fixes

- faster-whisper VadOptions 参数名 onset 改为 threshold ([`a768cec`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a768cec))
- faster-whisper 后端不支持 temperature_increment_on_fallback 参数 ([`51420b4`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/51420b4))

## [1.5.4] - 2026-06-19

### Chores

- update before release ([`5048c9a`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/5048c9a))

## [1.5.3] - 2026-06-19

### Bug Fixes

- 修复 .env / .env.example 行内注释导致变量值异常 ([`a896469`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a896469))
- 修复 Python 版 .env 加载时行内注释被读入环境变量值中 ([`b37aaad`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/b37aaad))

### Chores

- update before release ([`68f6732`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/68f6732))
- 重整 .env 和 .env.example 格式 ([`36f7d21`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/36f7d21))

## [1.5.2] - 2026-06-19

### Bug Fixes

- 修复 Windows 下 Python 版 yt-dlp 报 UnicodeEncodeError (latin-1 编码) ([`26063cc`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/26063cc))
- 修复 Windows 下 yt-dlp 报 UnicodeEncodeError (latin-1 编码) ([`ebbdd2c`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/ebbdd2c))
- 还原 progress（原意是进度），删除错误的 processes 拼写 ([`f2f95eb`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f2f95eb))
- 删除 py 重复的 FunASR 参数定义; yt-dlp 加 --no-update 和 --socket-timeout 60 修复编码报错和超时 ([`2031fb8`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2031fb8))

### Refactoring

- 将 yt-dlp --user-agent 从硬编码改为可配置 ([`82587cc`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/82587cc))
- 将 progress 目录/变量/函数统一重命名为 processes ([`f41cba8`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f41cba8))

### Documentation

- 新增 HF_ENDPOINT 配置项，解决 faster-whisper/funasr 国内网络下载 HuggingFace 模型失败问题 ([`f833e6b`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f833e6b))

### Chores

- update before release ([`531dcc0`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/531dcc0))
- 更新 CHANGELOG [Unreleased] 记录 progress→processes 重命名及 yt-dlp 修复 ([`2db96bf`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2db96bf))

## [1.5.1] - 2026-06-18

### Bug Fixes

- 修复 faster-whisper 和 funasr CLI 实际识别参数错误 ([`c43435a`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/c43435a))
- 修复 ASR 后端预检误报不可用及 JS replace 特殊字符 bug ([`5239326`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/5239326))

### Chores

- 添加 outputs/ 到 .gitignore（funasr Hydra 自动生成） ([`a3609d4`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a3609d4))

## [1.5.0] - 2026-06-16

### Features

- 新增 FunASR 第 4 种 Whisper 后端(中文 WER ~5%) - cli/service 双模式 + 8 主模型 + 4 辅助模型完整支持 ([`36c6b73`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/36c6b73))

### Chores

- update before release ([`4c77b6c`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/4c77b6c))
- remove dead code (unused imports, variables, functions) ([`1e5d852`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/1e5d852))

## [1.4.3] - 2026-06-16

### Bug Fixes

- 修复 transcribe catch 块 const_detail 拼写错误 ([`94e783d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/94e783d))

### Chores

- update before release ([`a406303`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a406303))

## [1.4.2] - 2026-06-16

### Documentation

- 同步 v1.4 的三项核心变更到 README ([`395fe09`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/395fe09))

### Chores

- update before release ([`92b5359`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/92b5359))

## [1.4.1] - 2026-06-16

### Bug Fixes

- 错误信息不透传——失败时完整输出 stderr / traceback ([`590dc24`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/590dc24))

### Chores

- update before release ([`01be99d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/01be99d))

## [1.4.0] - 2026-06-16

### Features

- 引入 OUTPUT_DIR 统一输出根目录，新增 --output CLI 参数 ([`ee7095e`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/ee7095e))
- 新增 faster-whisper 后端支持 ([`75f976b`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/75f976b))
- 增量 JSON 进度保存 — 每完成一个任务立即写 output/progress/{sheet}/task_{stem}.json ([`c77108f`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/c77108f))

### Bug Fixes

- 增量进度保存 3 项修复 ([`d90957a`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/d90957a))

### Chores

- update before release ([`a561102`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a561102))

## [1.3.3] - 2026-06-13

### Chores

- optimize prompts ([`6b70c95`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/6b70c95))

## [1.3.2] - 2026-06-13

### Features

- add WHISPER_TSK env ([`3db8bd4`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/3db8bd4))

## [1.3.1] - 2026-06-13

### Documentation

- 修正注释位置并同步README新功能文档 ([`b2dbaf7`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/b2dbaf7))

## [1.3.0] - 2026-06-13

### Features

- 提示词支持文件路径、新增 CLI 参数、whisper extra-args 去重 ([`973c80b`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/973c80b))

### Chores

- update before release ([`a0b4a2a`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a0b4a2a))

## [1.2.22] - 2026-06-13

### Bug Fixes

- ai分析失败后整体状态未更新为partial的bug ([`ab1f9bd`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/ab1f9bd))

## [1.2.21] - 2026-06-12

### Bug Fixes

- dotenv 读取 \n 转义未解析导致 AI prompt 格式错乱 ([`c05da81`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/c05da81))

### Chores

- update before release ([`b74fb99`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/b74fb99))

## [1.2.20] - 2026-06-12

### Features

- add whisper INITIAL_PROMPT bio term list, add AI semantic correction step before keyword extraction ([`a7ecd44`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a7ecd44))
- unify AI analysis completion log format — add elapsed time to match download/transcode/transcribe ([`d6cacca`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/d6cacca))
- add elapsed time to whisper completion log, improve AI analysis error details (log URL, include cause) ([`7971449`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/7971449))
- add whisper local progress display — show segment timestamps during transcription ([`6c8fc2c`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/6c8fc2c))

### Chores

- update before release ([`bb38a58`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/bb38a58))

## [1.2.19] - 2026-06-12

### Refactoring

- change whisper condition_on_prev default from true to false ([`08cc425`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/08cc425))

### Documentation

- update ([`df764e4`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/df764e4))

## [1.2.18] - 2026-06-12

### Bug Fixes

- whisper 预检在中文 Windows GBK 编码下 UnicodeEncodeError — execSync/subprocess 添加 PYTHONIOENCODING=utf-8 ([`2e06a04`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2e06a04))

### Documentation

- update ([`225b1ef`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/225b1ef))

## [1.2.17] - 2026-06-12

### Bug Fixes

- 添加 dotenv override 参数，确保 .env 配置覆盖系统环境变量 ([`4084fd9`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/4084fd9))

### Refactoring

- whisper env var 分组精简 — MODEL/LANGUAGE 移回 local，OUTPUT_FORMAT 默认 json ([`029aaab`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/029aaab))
- 最终化 Whisper 环境变量分组，按共享/服务/本地三组精简 ([`c9e9c66`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/c9e9c66))
- 重构 Whisper 环境变量，最大化 local/service 共享，统一识别参数 ([`deff67d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/deff67d))

### Documentation

- update ([`53c0af6`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/53c0af6))
- 更新 README Whisper 章节 — 反映共享/服务/本地三组变量结构，补充 INITIAL_PROMPT/CONDITION_ON_PREV 说明 ([`f8925fc`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f8925fc))
- 完善 CONDITION_ON_PREV/INITIAL_PROMPT 注释, 修复 Python /load 调用, 同步 .env 文档 ([`7b2c8be`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/7b2c8be))

## [1.2.16] - 2026-06-12

### Bug Fixes

- npm 包缺少 console-ui.mjs 导致运行时模块找不到 ([`24a8451`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/24a8451))

## [1.2.15] - 2026-06-12

_No changes._

## [1.2.14] - 2026-06-12

### Features

- 新增控制台进度显示模块 + 优化转码参数 + 调整超时默认值 ([`34d08e4`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/34d08e4))

### Bug Fixes

- ai 分析失败时错误信息显示为 null ([`7d941d8`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/7d941d8))

### Documentation

- update ([`6315f3a`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/6315f3a))

## [1.2.13] - 2026-06-12

### Documentation

- update ([`51b9146`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/51b9146))

## [1.2.12] - 2026-06-12

### Chores

- optimize ai prompt ([`85a400a`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/85a400a))

## [1.2.11] - 2026-06-12

### Features

- 优化 ffmpeg 转码参数 + 补充 Whisper 模型对比文档 ([`d777654`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/d777654))

### Documentation

- update ([`cf1c30d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/cf1c30d))

## [1.2.10] - 2026-06-12

### Features

- 补全 run_input_task AI分析计时日志 + 新增 --content 模式(run_content_task) ([`612e96f`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/612e96f))
- 下载/转码完成日志增加文件时长; 修复AI分析英文关键词输出 ([`c11892e`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/c11892e))
- 增强下载/转码/识别/AI分析进度日志 ([`e2a0967`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e2a0967))
- 继续增强日志输出 - content模式和环境预检日志着色 ([`c9d9923`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/c9d9923))
- 增强日志输出 - 为每个过程的开始/完成/异常以及整体进度/状态/数量添加着色和突出显示 ([`f5f10eb`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f5f10eb))

### Bug Fixes

- 修复 report 文件名偶发双点 (..json) 问题 - JS版改用显式日期组件拼接替代 toISOString 链式处理 ([`d4d5444`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/d4d5444))

### Documentation

- update ([`1ad763c`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/1ad763c))
- 更新工作日志 - 完整记录所有修复和增强内容 ([`56636d9`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/56636d9))

## [1.2.9] - 2026-06-11

### Bug Fixes

- yt-dlp download progress parsing and encoding ([`e32acc9`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e32acc9))
- yt-dlp download progress not showing — listen stdout not stderr ([`8cb99b0`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/8cb99b0))
- quote USER_AGENT values with double quotes to prevent semicolon parsing issues ([`419dff2`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/419dff2))

### Documentation

- update ([`f761ad4`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f761ad4))

## [1.2.8] - 2026-06-11

### Features

- add colored console output and task separators (PY) ([`d983920`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/d983920))
- add colored console output and task separators (JS) ([`3119a74`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/3119a74))

### Bug Fixes

- add long-form platform key mappings + upgrade to bright ANSI colors ([`f56cb1f`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f56cb1f))
- remove AI_TIMEOUT env, unify platform keys ([`142bc37`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/142bc37))

### Documentation

- update ([`82637ea`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/82637ea))
- add missing WHISPER_SERVICE_MODEL to .env.example ([`de1d4d8`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/de1d4d8))
- restructure README with progressive layout and updated platform keys ([`298f049`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/298f049))

## [1.2.7] - 2026-06-11

### Features

- 补充所有模式 README 示例 + 修复下载和AI分析进度显示 ([`9aa2160`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/9aa2160))
- --content / --content-column + B站 Firefox cookie ([`e25a4a8`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e25a4a8))

### Bug Fixes

- 修复JS报告时间戳小数点导致文件名出现两个点的问题 ([`c0abe90`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/c0abe90))

### Documentation

- update ([`df4d7b6`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/df4d7b6))

## [1.2.6] - 2026-06-11

### Features

- 报告按 sheet/站点分目录存储 ([`6610c57`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/6610c57))
- 统一三种来源报告格式 + 修复多处 bug ([`2a6f606`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2a6f606))

### Bug Fixes

- groupBySheetMap 返回 Map 而非普通对象，修复 for...of 不可迭代错误 ([`dfae532`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/dfae532))

### Documentation

- update ([`6ddc48b`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/6ddc48b))
- 修正 --input 模式的 {sheet} 表述为固定 local ([`be61e29`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/be61e29))
- 输出结构速查表 — 三来源×四环节对照 ([`248168c`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/248168c))

## [1.2.5] - 2026-06-11

### Features

- 新增 --offset / --limit 参数，支持跳过和限量处理 Excel 数据 ([`d691822`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/d691822))

### Bug Fixes

- base_dir 改用 cwd 而非脚本安装目录，修复全局安装后路径解析错误 ([`0fe5b1e`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/0fe5b1e))

### Documentation

- update ([`45a8d45`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/45a8d45))

## [1.2.4] - 2026-06-11

### Features

- release body 自动提取当前版本 CHANGELOG 段 ([`4f03302`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/4f03302))

### Bug Fixes

- sed 模式改用 #+ 匹配任意层级标题，兼容 major/minor/patch 不同 # 数量 ([`86f2e5b`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/86f2e5b))

### Documentation

- update ([`9e4fd55`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/9e4fd55))

## [1.2.3] - 2026-06-11

### Bug Fixes

- 修复 Release 版本名双 v 前缀 + 只显示当前版本变更 ([`9108168`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/9108168))

### Chores

- 仓库地址统一指向 GitHub (gitee → github) ([`d2f3462`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/d2f3462))

## [1.2.2] - 2026-06-11

### Bug Fixes

- 修复 workflows/publish.yml 无效的 releases 权限值 ([`2a2f778`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2a2f778))

## [1.2.1] - 2026-06-11

### Bug Fixes

- 改进发布流程 — 未提交文件提示提交 + 移除 GITHUB_TOKEN 依赖 ([`2269869`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2269869))
- release.js 推送失败时显示 git 原始错误信息 (stderr) ([`fba88f3`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/fba88f3))

### Documentation

- update ([`055da24`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/055da24))

## [1.2.0] - 2026-06-11

### Bug Fixes

- 安全漏洞修复 + dry-run 模式完善 + 全面测试套件 ([`3677b6a`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/3677b6a))

### Refactoring

- 输出目录统一归入 output/ 并清理测试产物 ([`f5cad03`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f5cad03))
- whisper/AI 硬编码参数改为 env 可配置 ([`611b079`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/611b079))

## [1.1.0] - 2026-06-11

### Features

- add --input option for local file processing (Node.js + Python) ([`4805e3b`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/4805e3b))

### Bug Fixes

- whisper transcribe FormData + multi --step + auto-find wav ([`f8c9fa2`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f8c9fa2))

## [1.0.4] - 2026-06-11

### Features

- rename npm package to video-pipeline ([`644cc8a`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/644cc8a))
- add --url option to Python version (parity with Node.js) ([`e1df301`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e1df301))

### Bug Fixes

- recreate v1.0.3 tag and regenerate CHANGELOG with correct scopes ([`9c2db90`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/9c2db90))
- normalize CHANGELOG format to Keep a Changelog standard ([`2b887f4`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2b887f4))
- correct changelog per-version ranges + fix getLastTag for Windows ([`755222a`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/755222a))

## [1.0.3] - 2026-06-11

### Features

- add --url option for direct video URL download pipeline ([`468bc1e`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/468bc1e))
- use arrow-key navigation for --init conflict prompt ([`571f24a`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/571f24a))

### Bug Fixes

- hard-fail on GitHub push failure + verify tag on remote ([`5ca14ab`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/5ca14ab))
- regenerate CHANGELOG with correct per-version commit ranges ([`e265f57`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e265f57))

## [1.0.2] - 2026-06-11

### Features

- migrate to ESM, interactive --init, move data files to data/ ([`a5edd07`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a5edd07))

### Bug Fixes

- changelog generation + arrow-key version select + default Y confirm ([`f7f3ce0`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/f7f3ce0))

## [1.0.1] - 2026-06-11

### Features

- upgrade deps + add --init/--file/--env-file CLI options ([`879d05c`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/879d05c))
- npm 发布体系搭建 + Node.js 关键修复 ([`d3e2c40`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/d3e2c40))
- 新增 Node.js 版本的 process_videos.js ([`1631670`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/1631670))
- 执行前工具预检 + 超时默认值统一 ([`bb8c181`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/bb8c181))
- dry-run 增加环境检测和每步可用性状态展示 ([`a5defbd`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a5defbd))
- 新增 AI 关键词归纳分析环节 (step analyze) ([`8f1a4e1`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/8f1a4e1))
- YouTube cookie 方案改为 Firefox 浏览器直读（替代手动导出，解决 Chrome DPAPI 解密失败问题） ([`3230df0`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/3230df0))
- YouTube 下载增加代理支持 ([`a7274b3`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a7274b3))
- YouTube 下载增加 --cookies-from-browser 支持 ([`2fbd020`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2fbd020))
- WHISPER_LANGUAGE 双后端通用，默认多语言自动检测 ([`80679d1`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/80679d1))
- service 模式也支持 WHISPER_MODEL 指定模型 ([`470ee4d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/470ee4d))
- 本地 Whisper 支持 + 文件名三级去重 ([`2ee8aaf`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2ee8aaf))
- 引入 .env 环境变量配置系统，脚本可适配任意 Excel ([`2622439`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/2622439))
- run_with_progress 同步化 + 智能重转码 + 文档更新 ([`375a9d2`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/375a9d2))
- video processing pipeline with platform fixes and timeout control ([`24b178d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/24b178d))

### Bug Fixes

- update husky commit-msg hook to v9 format ([`25f557e`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/25f557e))
- 下载失败后清理残留的 .part/.ytdl 临时文件 ([`0251a4b`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/0251a4b))
- yt-dlp 子进程( node/ejs )不走代理导致 n-sig 求解失败 ([`e00ec5f`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e00ec5f))
- whisper.cpp server API 适配 — /inference 不传 model/language ([`3a83ab5`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/3a83ab5))
- 移除 run_with_progress 逐行 DEBUG 打印，解决 Windows 控制台中文路径乱码 ([`fb20e4d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/fb20e4d))

### Documentation

- README 新增各平台 URL 格式与视频ID提取正则 ([`3cd423d`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/3cd423d))
- README 修复目录重复 + 新增 .env 变更权限说明 ([`e27d267`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e27d267))
- .env.example 增加变更权限标注(自由/调序/关联/固定) ([`b542865`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/b542865))
- 文档全面更新 + security: cookie 文件移出版本控制 ([`a90b5af`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/a90b5af))
- 更新 .env.example (代理端口7897, 注释完善, WHISPER_MODEL标注仅local) ([`63dca08`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/63dca08))
- service 模式语言说明修正 — API 不支持指定语言 ([`adcb265`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/adcb265))

### Chores

- add auto-changelog dev dependency ([`9785cbf`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/9785cbf))
- env 审查优化 + 清理 __pycache__ 跟踪 ([`02361b8`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/02361b8))

### Other

- update ([`e3b57e5`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/e3b57e5))
- update default timeout ([`57d329b`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/57d329b))
- update ([`fd9b8ac`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/fd9b8ac))
- 初始版本，基本可用 ([`0e24d69`](https://github.com/GuoSirius/yt-dlp_ffmpeg_whisper_memo-ai/commit/0e24d69))
