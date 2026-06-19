# Changelog

## [1.5.9] - 2026-06-19

### Chores

- optimize prompt (`a686e82`)


## [1.5.8] - 2026-06-19

### Features

- --id 支持多值批量指定 (`f39c7d2`)

### Chores

- update before release (`4527909`)


## [1.5.7] - 2026-06-19

### Bug Fixes

- 统一各步骤 else 回退，支持任意 --step 组合 + --force (`af285fb`)
- --step analyze --force 单独执行时从磁盘回退加载 transcript (`24d2fa5`)

### Refactoring

- lean-coding skill v2 极简重写 (`e912290`)

### Chores

- update before release (`69a08f1`)


## [1.5.6] - 2026-06-19

### Bug Fixes

- 限制关键词最多 30 个，禁止 AI 联想扩展 (`e12074e`)
- excel 写入前截断超过 32767 字符的内容 (`cd36a87`)

### Refactoring

- 统一优化五处 AI 提示词，对齐 sshk.md 结构 (`1659200`)

### Chores

- optimize prompt (`71244c1`)


## [1.5.5] - 2026-06-18

### Bug Fixes

- faster-whisper VadOptions 参数名 onset 改为 threshold (`a768cec`)
- faster-whisper 后端不支持 temperature_increment_on_fallback 参数 (`51420b4`)


## [1.5.4] - 2026-06-18

### Chores

- update before release (`5048c9a`)


## [1.5.3] - 2026-06-18

### Bug Fixes

- 修复 .env / .env.example 行内注释导致变量值异常 (`c201ef1`)
- 修复 Python 版 .env 加载时行内注释被读入环境变量值中 (`72a01e7`)

### Chores

- update before release (`0c367a5`)
- 重整 .env 和 .env.example 格式 (`457f537`)


## [1.5.2] - 2026-06-18

### Bug Fixes

- 修复 Python 版 .env 加载时行内注释被读入环境变量值中（如 WHISPER_MODEL_DIR 创建含注释的目录）
- 还原 progress（原意是进度），删除错误的 processes 拼写 (`f2f95eb`)
- 删除 py 重复的 FunASR 参数定义; yt-dlp 加 --no-update 和 --socket-timeout 60 修复编码报错和超时 (`2031fb8`)

### Refactoring

- 将 yt-dlp --user-agent 从硬编码改为可配置 (`82587cc`)
- 将 progress 目录/变量/函数统一重命名为 processes (`f41cba8`)

### Documentation

- 新增 HF_ENDPOINT 配置项，解决 faster-whisper/funasr 国内网络下载 HuggingFace 模型失败问题 (`f833e6b`)

### Chores

- update before release (`bdd5d3f`)
- update before release (`531dcc0`)
- 更新 CHANGELOG [Unreleased] 记录 progress→processes 重命名及 yt-dlp 修复 (`2db96bf`)


## [1.5.1] - 2026-06-18

### Bug Fixes

- 修复 faster-whisper 和 funasr CLI 实际识别参数错误 (`c43435a`)
- 修复 ASR 后端预检误报不可用及 JS replace 特殊字符 bug (`5239326`)

### Chores

- 添加 outputs/ 到 .gitignore（funasr Hydra 自动生成） (`a3609d4`)


## [Unreleased]

### Bug Fixes

- 修复 ASR 后端预检误报"不可用"：`whisper` / `whisper-ctranslate2` / `funasr` 等 Python CLI 的 `--help` 触发框架初始化耗时 5-30 秒，超过 5 秒 timeout 被 SIGTERM。改用 `where`/`which`（JS）和 `importlib.util.find_spec` / `shutil.which`（Python）轻量检测，全量 < 0.3 秒
- 修复 JS `String.replace('{content}', text)` 的 `$` 特殊字符 bug：转录文本含 `$&` / `` $` `` / `$'` / `$$` 时被错误解释，导致发给 AI 的内容损坏、关键词提取异常。改用函数替换 `() => text`
- 修复 dry-run 环境检测输出中 `backend` 描述不匹配 `WHISPER_BACKEND` 实际值的问题：补全 `faster-whisper` 和 `funasr/cli`、`funasr/service` 四分支（JS + Python 共 7 处）
- 修复 JS `whisper-ctranslate2` CLI 参数错误：移除不存在的 `--num_workers`（Python API 专用），将 `--vad_onset` 改为 `--vad_threshold`（CLI 参数名与 Python API 不同）
- 修复 JS `funasr` CLI Hydra 路径解析错误：Hydra override 解析器不支持非 ASCII 字符（如中文路径 `普诺赛中文站`），路径含中文时自动复制到临时 ASCII 路径再执行
- 修复 JS `funasr` CLI 结果解析：funasr CLI 把结果 `print()` 到 stdout 而非写文件，原代码找 `{input}.json` 文件必然失败。改为优先从 stdout 解析（JSON / Python dict repr / 纯文本三级回退），文件检测仅作兜底
- 修复 Python 重复定义 FunASR 参数（150-186 行）：删除重复段落，仅保留 `_SERVICE_MODEL_LOADED` 缓存变量
- 修复 Python/JS 版 yt-dlp 在 Windows 上报 `UnicodeEncodeError: 'latin-1' codec can't encode`（腾讯视频等含中文页面）：Python 版添加 `-X utf8` 强制 UTF-8 模式；JS 版在子进程 env 中设置 `PYTHONUTF8=1` 和 `PYTHONIOENCODING=utf-8`
- 改进：将 yt-dlp `--user-agent` 参数从硬编码改为可配置：读取 `{前缀}_USER_AGENT` 环境变量（如 `TENCENT_USER_AGENT`），留空则使用 yt-dlp 默认值（py 和 js 同步）
- 修复 Python yt-dlp 下载腾讯视频等站点报 `Read timed out (read timeout=20.0)`：`--socket-timeout` 默认值 20 秒太短，改为 60 秒

### Features

- 新增 `AI_DEBUG` 环境变量：设为 `true` 时打印实际发送的 prompt 前 500 字符 + AI 返回内容前 500 字符，用于排查 AI 分析质量问题

### Refactor

- `progress` → `processes` 全局重命名：目录 `output/progress/` → `output/processes/`、变量 `PROGRESS_DIR` → `PROCESSES_DIR`、函数 `progress_path`/`load_task_progress`/`save_task_progress` → `processes_path`/`load_task_processes`/`save_task_processes`（py 和 js 同步），`.env.example` 和 `README.md` 同步更新

### Documentation

- README「工具预检」章节新增 ASR 后端检测策略表，说明各后端的轻量检测方式和为何不使用 `--help`
- README AI 配置表新增 `AI_DEBUG` 条目
- README 提示词章节新增 `{content}` 替换安全性说明
- README 输出目录章节：`progress/` → `processes/`


## [1.5.0] - 2026-06-16

### Features

- 新增 FunASR 第 4 种 Whisper 后端(中文 WER ~5%) - cli/service 双模式 + 8 主模型 + 4 辅助模型完整支持 (`36c6b73`)

### Chores

- update before release (`4c77b6c`)
- remove dead code (unused imports, variables, functions) (`1e5d852`)


## [1.4.3] - 2026-06-16

### Bug Fixes

- 修复 transcribe catch 块 const_detail 拼写错误 (`94e783d`)

### Chores

- update before release (`a406303`)


## [1.4.2] - 2026-06-16

### Documentation

- 同步 v1.4 的三项核心变更到 README (`395fe09`)

### Chores

- update before release (`92b5359`)


## Unreleased

### Features

- 新增 FunASR 第 4 种 Whisper 后端（中文 WER ~5%，远低于 Whisper 的 ~15%）：CLI 模式走 AutoModel 本地推理，service 模式走 funasr-server OpenAI 兼容 API；15 个 `FUNASR_*` 环境变量 + `FUNASR_EXTRA_ARGS`（与 WHISPER_EXTRA_ARGS 同语义）+ `--funasr-extra-args` CLI 覆盖；模型实例全局缓存，按 model/device/vad/punc/spk 组合复用

### Documentation

- README 同步 FunASR 章节：四后端介绍、CLI/服务两种模式安装启动、8 个主模型 + 4 个辅助模型完整对比表、选型建议、WHISPER vs FunASR 决策树

## [1.4.1] - 2026-06-16

### Bug Fixes

- 错误信息不透传——失败时完整输出 stderr / traceback (`590dc24`)

### Chores

- update before release (`01be99d`)


## [1.4.0] - 2026-06-16

### Features

- 引入 OUTPUT_DIR 统一输出根目录，新增 --output CLI 参数 (`ee7095e`)
- 新增 faster-whisper 后端支持 (`75f976b`)
- 增量 JSON 进度保存 — 每完成一个任务立即写 output/progress/{sheet}/task_{stem}.json (`c77108f`)

### Bug Fixes

- 增量进度保存 3 项修复 (`d90957a`)

### Chores

- update before release (`a561102`)


## [1.3.3] - 2026-06-13

### Chores

- optimize prompts (`6b70c95`)


## [1.3.2] - 2026-06-13

### Features

- add WHISPER_TSK env (`3db8bd4`)


## [1.3.1] - 2026-06-13

### Documentation

- 修正注释位置并同步README新功能文档 (`b2dbaf7`)


## [1.3.0] - 2026-06-13

### Features

- 提示词支持文件路径、新增 CLI 参数、whisper extra-args 去重 (`973c80b`)

### Chores

- update before release (`a0b4a2a`)


## [1.2.22] - 2026-06-12

### Bug Fixes

- ai分析失败后整体状态未更新为partial的bug (`ab1f9bd`)


## [1.2.21] - 2026-06-12

### Bug Fixes

- dotenv 读取 \n 转义未解析导致 AI prompt 格式错乱 (`c05da81`)

### Chores

- update before release (`b74fb99`)


## [1.2.20] - 2026-06-12

### Features

- add whisper INITIAL_PROMPT bio term list, add AI semantic correction step before keyword extraction (`a7ecd44`)
- unify AI analysis completion log format — add elapsed time to match download/transcode/transcribe (`d6cacca`)
- add elapsed time to whisper completion log, improve AI analysis error details (log URL, include cause) (`7971449`)
- add whisper local progress display — show segment timestamps during transcription (`6c8fc2c`)

### Chores

- update before release (`bb38a58`)


## [1.2.19] - 2026-06-12

### Refactoring

- change whisper condition_on_prev default from true to false (`08cc425`)

### Documentation

- update (`df764e4`)


## [1.2.18] - 2026-06-12

### Bug Fixes

- whisper 预检在中文 Windows GBK 编码下 UnicodeEncodeError — execSync/subprocess 添加 PYTHONIOENCODING=utf-8 (`2e06a04`)

### Documentation

- update (`225b1ef`)


## [1.2.17] - 2026-06-12

### Bug Fixes

- 添加 dotenv override 参数，确保 .env 配置覆盖系统环境变量 (`4084fd9`)

### Refactoring

- whisper env var 分组精简 — MODEL/LANGUAGE 移回 local，OUTPUT_FORMAT 默认 json (`029aaab`)
- 最终化 Whisper 环境变量分组，按共享/服务/本地三组精简 (`c9e9c66`)
- 重构 Whisper 环境变量，最大化 local/service 共享，统一识别参数 (`deff67d`)

### Documentation

- update (`53c0af6`)
- 更新 README Whisper 章节 — 反映共享/服务/本地三组变量结构，补充 INITIAL_PROMPT/CONDITION_ON_PREV 说明 (`f8925fc`)
- 完善 CONDITION_ON_PREV/INITIAL_PROMPT 注释, 修复 Python /load 调用, 同步 .env 文档 (`7b2c8be`)


## [1.2.16] - 2026-06-12

### Bug Fixes

- npm 包缺少 console-ui.mjs 导致运行时模块找不到 (`24a8451`)


## [1.2.15] - 2026-06-12

_No changes._


## [1.2.14] - 2026-06-12

### Features

- 新增控制台进度显示模块 + 优化转码参数 + 调整超时默认值 (`34d08e4`)

### Bug Fixes

- ai 分析失败时错误信息显示为 null (`7d941d8`)

### Documentation

- update (`6315f3a`)


## [1.2.13] - 2026-06-12

### Documentation

- update (`51b9146`)


## [1.2.12] - 2026-06-12

### Chores

- optimize ai prompt (`85a400a`)


## [1.2.11] - 2026-06-12

### Features

- 优化 ffmpeg 转码参数 + 补充 Whisper 模型对比文档 (`d777654`)

### Documentation

- update (`cf1c30d`)


## [1.2.10] - 2026-06-11

### Features

- 补全 run_input_task AI分析计时日志 + 新增 --content 模式(run_content_task) (`612e96f`)
- 下载/转码完成日志增加文件时长; 修复AI分析英文关键词输出 (`c11892e`)
- 增强下载/转码/识别/AI分析进度日志 (`e2a0967`)
- 继续增强日志输出 - content模式和环境预检日志着色 (`c9d9923`)
- 增强日志输出 - 为每个过程的开始/完成/异常以及整体进度/状态/数量添加着色和突出显示 (`f5f10eb`)

### Bug Fixes

- 修复 report 文件名偶发双点 (..json) 问题 - JS版改用显式日期组件拼接替代 toISOString 链式处理 (`d4d5444`)

### Documentation

- update (`1ad763c`)
- 更新工作日志 - 完整记录所有修复和增强内容 (`56636d9`)


## [1.2.9] - 2026-06-11

### Bug Fixes

- yt-dlp download progress parsing and encoding (`e32acc9`)
- yt-dlp download progress not showing — listen stdout not stderr (`8cb99b0`)
- quote USER_AGENT values with double quotes to prevent semicolon parsing issues (`419dff2`)

### Documentation

- update (`f761ad4`)


## [1.2.8] - 2026-06-11

### Features

- add colored console output and task separators (PY) (`d983920`)
- add colored console output and task separators (JS) (`3119a74`)

### Bug Fixes

- add long-form platform key mappings + upgrade to bright ANSI colors (`f56cb1f`)
- remove AI_TIMEOUT env, unify platform keys (`142bc37`)

### Documentation

- update (`82637ea`)
- add missing WHISPER_SERVICE_MODEL to .env.example (`de1d4d8`)
- restructure README with progressive layout and updated platform keys (`298f049`)


## [1.2.7] - 2026-06-11

### Features

- 补充所有模式 README 示例 + 修复下载和AI分析进度显示 (`9aa2160`)
- --content / --content-column + B站 Firefox cookie (`e25a4a8`)

### Bug Fixes

- 修复JS报告时间戳小数点导致文件名出现两个点的问题 (`c0abe90`)

### Documentation

- update (`df4d7b6`)


## [1.2.6] - 2026-06-11

### Features

- 报告按 sheet/站点分目录存储 (`6610c57`)
- 统一三种来源报告格式 + 修复多处 bug (`2a6f606`)

### Bug Fixes

- groupBySheetMap 返回 Map 而非普通对象，修复 for...of 不可迭代错误 (`dfae532`)

### Documentation

- update (`6ddc48b`)
- 修正 --input 模式的 {sheet} 表述为固定 local (`be61e29`)
- 输出结构速查表 — 三来源×四环节对照 (`248168c`)


## [1.2.5] - 2026-06-11

### Features

- 新增 --offset / --limit 参数，支持跳过和限量处理 Excel 数据 (`d691822`)

### Bug Fixes

- base_dir 改用 cwd 而非脚本安装目录，修复全局安装后路径解析错误 (`0fe5b1e`)

### Documentation

- update (`45a8d45`)


## [1.2.4] - 2026-06-11

### Features

- release body 自动提取当前版本 CHANGELOG 段 (`4f03302`)

### Bug Fixes

- sed 模式改用 #+ 匹配任意层级标题，兼容 major/minor/patch 不同 # 数量 (`86f2e5b`)

### Documentation

- update (`9e4fd55`)


## [1.2.3] - 2026-06-11

### Bug Fixes

- 修复 Release 版本名双 v 前缀 + 只显示当前版本变更 (`9108168`)

### Chores

- 仓库地址统一指向 GitHub (gitee → github) (`d2f3462`)


## [1.2.2] - 2026-06-11

### Bug Fixes

- 修复 workflows/publish.yml 无效的 releases 权限值 (`2a2f778`)


## [1.2.1] - 2026-06-11

### Bug Fixes

- 改进发布流程 — 未提交文件提示提交 + 移除 GITHUB_TOKEN 依赖 (`2269869`)
- release.js 推送失败时显示 git 原始错误信息 (stderr) (`fba88f3`)

### Documentation

- update (`055da24`)


## [1.2.0] - 2026-06-11

### Bug Fixes

- 安全漏洞修复 + dry-run 模式完善 + 全面测试套件 (`3677b6a`)

### Refactoring

- 输出目录统一归入 output/ 并清理测试产物 (`f5cad03`)
- whisper/AI 硬编码参数改为 env 可配置 (`611b079`)


## [1.1.0] - 2026-06-11

### Features

- add --input option for local file processing (Node.js + Python) (`4805e3b`)

### Bug Fixes

- whisper transcribe FormData + multi --step + auto-find wav (`f8c9fa2`)


## [1.0.4] - 2026-06-11

### Features

- rename npm package to video-pipeline (`644cc8a`)
- add --url option to Python version (parity with Node.js) (`e1df301`)

### Bug Fixes

- recreate v1.0.3 tag and regenerate CHANGELOG with correct scopes (`9c2db90`)
- normalize CHANGELOG format to Keep a Changelog standard (`2b887f4`)
- correct changelog per-version ranges + fix getLastTag for Windows (`755222a`)

## [1.0.3] - 2026-06-11

### Features

- add --url option for direct video URL download pipeline (`468bc1e`)
- use arrow-key navigation for --init conflict prompt (`571f24a`)

### Bug Fixes

- hard-fail on GitHub push failure + verify tag on remote (`5ca14ab`)
- regenerate CHANGELOG with correct per-version commit ranges (`e265f57`)

## [1.0.2] - 2026-06-11

### Features

- migrate to ESM, interactive --init, move data files to data/ (`a5edd07`)

### Bug Fixes

- changelog generation + arrow-key version select + default Y confirm (`f7f3ce0`)

## [1.0.1] - 2026-06-11

### Features

- upgrade deps + add --init/--file/--env-file CLI options (`879d05c`)
- npm 发布体系搭建 + Node.js 关键修复 (`d3e2c40`)
- 新增 Node.js 版本的 process_videos.js (`1631670`)
- 执行前工具预检 + 超时默认值统一 (`bb8c181`)
- dry-run 增加环境检测和每步可用性状态展示 (`a5defbd`)
- 新增 AI 关键词归纳分析环节 (step analyze) (`8f1a4e1`)
- YouTube cookie 方案改为 Firefox 浏览器直读（替代手动导出，解决 Chrome DPAPI 解密失败问题） (`3230df0`)
- YouTube 下载增加代理支持 (`a7274b3`)
- YouTube 下载增加 --cookies-from-browser 支持 (`2fbd020`)
- WHISPER_LANGUAGE 双后端通用，默认多语言自动检测 (`80679d1`)
- service 模式也支持 WHISPER_MODEL 指定模型 (`470ee4d`)
- 本地 Whisper 支持 + 文件名三级去重 (`2ee8aaf`)
- 引入 .env 环境变量配置系统，脚本可适配任意 Excel (`2622439`)
- run_with_progress 同步化 + 智能重转码 + 文档更新 (`375a9d2`)
- video processing pipeline with platform fixes and timeout control (`24b178d`)

### Bug Fixes

- update husky commit-msg hook to v9 format (`25f557e`)
- 下载失败后清理残留的 .part/.ytdl 临时文件 (`0251a4b`)
- yt-dlp 子进程( node/ejs )不走代理导致 n-sig 求解失败 (`e00ec5f`)
- whisper.cpp server API 适配 — /inference 不传 model/language (`3a83ab5`)
- 移除 run_with_progress 逐行 DEBUG 打印，解决 Windows 控制台中文路径乱码 (`fb20e4d`)

### Documentation

- README 新增各平台 URL 格式与视频ID提取正则 (`3cd423d`)
- README 修复目录重复 + 新增 .env 变更权限说明 (`e27d267`)
- .env.example 增加变更权限标注(自由/调序/关联/固定) (`b542865`)
- 文档全面更新 + security: cookie 文件移出版本控制 (`a90b5af`)
- 更新 .env.example (代理端口7897, 注释完善, WHISPER_MODEL标注仅local) (`63dca08`)
- service 模式语言说明修正 — API 不支持指定语言 (`adcb265`)

### Chores

- add auto-changelog dev dependency (`9785cbf`)
- env 审查优化 + 清理 __pycache__ 跟踪 (`02361b8`)

### Other

- update (`e3b57e5`)
- update default timeout (`57d329b`)
- update (`fd9b8ac`)
- 初始版本，基本可用 (`0e24d69`)
