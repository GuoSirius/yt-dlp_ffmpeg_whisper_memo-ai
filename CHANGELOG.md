# Changelog

## Unreleased

### Documentation

- README 同步：Whisper 三后端(local / faster-whisper / service)章节、OUTPUT_DIR 7 子目录结构、--output CLI 与最小产物阈值参数、断点续跑(Resume)校验机制、错误信息透传机制

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
