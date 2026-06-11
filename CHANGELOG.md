# Changelog

## 1.0.3 — 2026-06-11

### ✨ Features

- add --url option for direct video URL download pipeline (`468bc1e`)
- use arrow-key navigation for --init conflict prompt (`571f24a`)
- migrate to ESM, interactive --init, move data files to data/ (`a5edd07`)
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

### 🐛 Bug Fixes

- hard-fail on GitHub push failure + verify tag on remote (`5ca14ab`)
- regenerate CHANGELOG with correct per-version commit ranges (`e265f57`)
- changelog generation + arrow-key version select + default Y confirm (`f7f3ce0`)
- update husky commit-msg hook to v9 format (`25f557e`)
- 下载失败后清理残留的 .part/.ytdl 临时文件 (`0251a4b`)
- yt-dlp 子进程( node/ejs )不走代理导致 n-sig 求解失败 (`e00ec5f`)
- whisper.cpp server API 适配 — /inference 不传 model/language (`3a83ab5`)
- 移除 run_with_progress 逐行 DEBUG 打印，解决 Windows 控制台中文路径乱码 (`fb20e4d`)

### 📝 Documentation

- README 新增各平台 URL 格式与视频ID提取正则 (`3cd423d`)
- README 修复目录重复 + 新增 .env 变更权限说明 (`e27d267`)
- .env.example 增加变更权限标注(自由/调序/关联/固定) (`b542865`)
- 文档全面更新 + security: cookie 文件移出版本控制 (`a90b5af`)
- 更新 .env.example (代理端口7897, 注释完善, WHISPER_MODEL标注仅local) (`63dca08`)
- service 模式语言说明修正 — API 不支持指定语言 (`adcb265`)

### 🔧 Chores

- add auto-changelog dev dependency (`9785cbf`)
- env 审查优化 + 清理 __pycache__ 跟踪 (`02361b8`)

### Other

- update (`e3b57e5`)
- update default timeout (`57d329b`)
- update (`fd9b8ac`)
- 初始版本，基本可用 (`0e24d69`)


## 1.0.2 — 2026-06-11

### ✨ Features

- migrate to ESM, interactive --init, move data files to data/ (`a5edd07`)

### 🐛 Bug Fixes

- changelog generation + arrow-key version select + default Y confirm (`f7f3ce0`)

## 1.0.1 — 2026-06-11

### ✨ Features

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

### 🐛 Bug Fixes

- update husky commit-msg hook to v9 format (`25f557e`)
- 下载失败后清理残留的 .part/.ytdl 临时文件 (`0251a4b`)
- yt-dlp 子进程( node/ejs )不走代理导致 n-sig 求解失败 (`e00ec5f`)
- whisper.cpp server API 适配 — /inference 不传 model/language (`3a83ab5`)
- 移除 run_with_progress 逐行 DEBUG 打印，解决 Windows 控制台中文路径乱码 (`fb20e4d`)

### 📝 Documentation

- README 新增各平台 URL 格式与视频ID提取正则 (`3cd423d`)
- README 修复目录重复 + 新增 .env 变更权限说明 (`e27d267`)
- .env.example 增加变更权限标注(自由/调序/关联/固定) (`b542865`)
- 文档全面更新 + security: cookie 文件移出版本控制 (`a90b5af`)
- 更新 .env.example (代理端口7897, 注释完善, WHISPER_MODEL标注仅local) (`63dca08`)
- service 模式语言说明修正 — API 不支持指定语言 (`adcb265`)

### 🔧 Chores

- add auto-changelog dev dependency (`9785cbf`)
- env 审查优化 + 清理 __pycache__ 跟踪 (`02361b8`)

### Other

- update (`e3b57e5`)
- update default timeout (`57d329b`)
- update (`fd9b8ac`)
- 初始版本，基本可用 (`0e24d69`)

