// 同步工作区源码到全局安装副本（D:/Programs/node_npm/node_global/node_modules/video-pipeline）。
// 约定：工作区 JS/Py 为 CRLF，全局副本须为 LF（否则用户实跑报错）。
// 流程：先备份 .bak，再 CRLF->LF 写回，最后 node --check 校验 JS。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const GLOBAL = 'D:/Programs/node_npm/node_global/node_modules/video-pipeline';
const FILES = [
  'process_videos.js',
  'process_videos.py',
  'console-ui.mjs',
  'scripts/ocr_frames.py',
];

let ok = true;
for (const rel of FILES) {
  const src = path.join(process.cwd(), rel);
  const dst = path.join(GLOBAL, rel);
  if (!fs.existsSync(src)) { console.error(`✘ 源文件缺失: ${src}`); ok = false; continue; }
  if (!fs.existsSync(dst)) { console.error(`✘ 目标缺失: ${dst}`); ok = false; continue; }
  const raw = fs.readFileSync(src, 'latin1');
  const lf = raw.replace(/\r\n/g, '\n');
  // 内容一致则跳过，避免无谓生成 .bak
  if (fs.existsSync(dst) && fs.readFileSync(dst, 'latin1') === lf) {
    console.log(`· 跳过 ${rel}（内容一致，无需同步）`);
    continue;
  }
  // 备份
  fs.copyFileSync(dst, dst + '.bak');
  fs.writeFileSync(dst, lf, 'latin1');
  console.log(`✔ 已同步 ${rel} -> ${dst} (CRLF ${raw.includes('\r\n') ? 'converted->LF' : 'unchanged'})`);
  if (rel.endsWith('.js')) {
    try {
      execFileSync('C:/Users/Admin/.workbuddy/binaries/node/versions/22.22.2/node.exe',
        ['--check', dst], { stdio: 'pipe' });
      console.log(`  ✔ node --check 通过: ${rel}`);
    } catch (e) {
      console.error(`  ✘ node --check 失败: ${rel}\n${(e.stderr || e.stdout || '').toString()}`);
      ok = false;
    }
  }
}
process.exit(ok ? 0 : 1);
