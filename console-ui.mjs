/**
 * 控制台单行动态显示工具
 * 提供：单行刷新、进度条、旋转动画、yt-dlp/fmpeg 进度解析
 */

// ── 旋转动画帧 ───────────────────────────────────────────────────────────────────
const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let _spinTimer = null;
let _spinLabel = '';
let _spinStart = 0;

// ── 单行刷新（覆盖当前行）────────────────────────────────────────────────────────
function updateLine(text) {
  // \x1b[2K = 清除整行, \r = 回到行首
  process.stderr.write(`\x1b[2K\r${text}`);
}

function clearLine() {
  process.stderr.write('\x1b[2K\r');
}

// ── 格式化工具 ───────────────────────────────────────────────────────────────────
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GiB`;
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtSpeed(bps) {
  if (!bps || !isFinite(bps)) return '---';
  if (bps < 1024) return `${bps.toFixed(0)}B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)}KiB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)}MiB/s`;
}

// ── 文本进度条（无 ANSI 依赖，纯文本）────────────────────────────────────
function textBar(percent, width = 18) {
  const filled = Math.round(percent / 100 * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, empty))}]`;
}

// ── 旋转动画 ───────────────────────────────────────────────────────────────────
function startSpinner(label) {
  stopSpinner();
  _spinLabel = label;
  _spinStart = Date.now();
  let frame = 0;
  _spinTimer = setInterval(() => {
    const elapsed = ((Date.now() - _spinStart) / 1000).toFixed(0);
    updateLine(`  ${SPINNER[frame % SPINNER.length]} ${_spinLabel}... ${elapsed}s`);
    frame++;
  }, 160);
}

function stopSpinner(finalText = '') {
  if (_spinTimer) {
    clearInterval(_spinTimer);
    _spinTimer = null;
  }
  if (finalText) {
    clearLine();
    process.stderr.write(`  ${finalText}\n`);
  }
}

// ── yt-dlp 进度行解析 ────────────────────────────────────────────────────────
// 输入示例：
//   [download]  45.2% of  100.00MiB at  12.34MiB/s ETA 00:04
//   [download] Destination: xxx.f248.mp4
//   [download] Merging formats into "xxx.mp4"
// 返回：{ percent, downloaded, total, speed, eta } 或 null
function parseYtdlpLine(line) {
  // 检测正在下载的流类型
  if (line.includes('[download] Destination:')) {
    const m = line.match(/Destination:.*\.(mp4|webm|mkv|flv|f\d+)/);
    if (m) {
      return { type: 'dest', ext: m[1] };
    }
  }
  if (line.includes('Merging formats into')) {
    return { type: 'merge' };
  }
  // 解析进度：允许千位分隔符空格和 ETA 格式
  const prog = line.match(
    /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(MiB|KiB|GiB)\s+at\s+([\d.]+)(MiB|KiB|GiB)\/s(?:\s+ETA\s+(\d+:\d+))?/
  );
  if (prog) {
    return {
      type: 'progress',
      percent: parseFloat(prog[1]),
      downloaded: parseFloat(prog[2]),
      downloadedUnit: prog[3],
      speed: parseFloat(prog[4]),
      speedUnit: prog[5],
      eta: prog[6] || '',
    };
  }
  return null;
}

// ── fmpeg 进度解析（需配合 -progress pipe:1 -nostats）────────────────
// 输入为 key=value 行，如：out_time_us=12345678\ntotal_size=456789\nspeed=1.5x
// 累积行直到出现 packet=1 或空行，然后返回进度对象
// 返回：{ percent, elapsed, speed } 或 null
let _ffmpegState = { durationUs: 0, outTimeUs: 0, speed: 0, totalSize: 0 };

function parseFfmpegProgress(line, totalDurationSec, state) {
  if (!state) state = _ffmpegState;  // 向后兼容：不传则用全局态
  line = line.trim();
  if (!line || line.startsWith('[')) return null;
  const kv = line.match(/^(\w+)=(.+)$/);
  if (!kv) return null;
  const key = kv[1];
  const val = kv[2].trim();
  if (key === 'out_time_us') {
    state.outTimeUs = parseInt(val, 10) || 0;
  } else if (key === 'speed') {
    const m = val.match(/([\d.]+)x/);
    state.speed = m ? parseFloat(m[1]) : 0;
  } else if (key === 'total_size') {
    state.totalSize = parseInt(val, 10) || 0;
  } else if (key === 'duration_us') {
    state.durationUs = parseInt(val, 10) || 0;
  }
  // 用 out_time_us / duration 计算进度
  const dur = totalDurationSec > 0 ? totalDurationSec * 1e6 : (state.durationUs || 1);
  const percent = Math.min(100, (state.outTimeUs / dur) * 100);
  return {
    type: 'progress',
    percent: Math.round(percent * 10) / 10,
    elapsed: state.outTimeUs / 1e6,
    speed: state.speed,
    totalSize: state.totalSize,
  };
}

// 每个转码任务创建独立的进度状态（B1），避免并发转码时百分比串扰/跳 0。
function makeFfmpegProgressParser(totalDurationSec) {
  const state = { durationUs: 0, outTimeUs: 0, speed: 0, totalSize: 0 };
  return (line) => parseFfmpegProgress(line, totalDurationSec, state);
}

function resetFfmpegState() {
  _ffmpegState = { durationUs: 0, outTimeUs: 0, speed: 0, totalSize: 0 };
}

// ── 导出 ──────────────────────────────────────────────────────────────────────────
export {
  updateLine,
  clearLine,
  fmtSize,
  fmtTime,
  fmtSpeed,
  textBar,
  startSpinner,
  stopSpinner,
  parseYtdlpLine,
  parseFfmpegProgress,
  makeFfmpegProgressParser,
  resetFfmpegState,
};
