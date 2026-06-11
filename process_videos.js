#!/usr/bin/env node
/**
 * 视频下载、转码、文本识别、AI分析一体化流程脚本 (Node.js 版)
 *
 * 用法:
 *   node process_videos.js --concurrency 3 --retry 3
 *   node process_videos.js --sheet "YouTube视频" --concurrency 2
 *   node process_videos.js --sheet "普诺赛中文站" --id 427
 *   node process_videos.js --step download
 *   node process_videos.js --dry-run
 *   node process_videos.js --offset 10 --limit 5   # 跳过前10条，只处理5条
 */

// ============================== 依赖 ==============================
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync, execFile } from 'child_process';
import readline from 'readline';
import XLSX from 'xlsx';
import pLimit from 'p-limit';
import { fileURLToPath } from 'url';
import { program } from 'commander';
import { select, input } from '@inquirer/prompts';

// --env-file 需在 dotenv 加载前解析
let _dotenvPath = '.env';
const _envFileIdx = process.argv.indexOf('--env-file');
if (_envFileIdx !== -1 && _envFileIdx + 1 < process.argv.length) {
  _dotenvPath = process.argv[_envFileIdx + 1];
}
dotenv.config({ path: _dotenvPath });

// ============================== 路径配置 ==============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = process.cwd();

function envPath(key, defaultValue) {
  const val = process.env[key] || defaultValue;
  const p = path.resolve(val);
  return path.isAbsolute(val) ? p : path.resolve(BASE_DIR, val);
}

let EXCEL_FILE = envPath('EXCEL_FILE', 'data/export_2026-06-10_split.xlsx');
const DOWNLOADS_DIR = envPath('DOWNLOADS_DIR', 'output/downloads');
const TRANSCODED_DIR = envPath('TRANSCODED_DIR', 'output/transcoded');
const COOKIES_DIR = envPath('COOKIES_DIR', 'cookies');
const REPORTS_DIR = envPath('REPORTS_DIR', 'output/reports');

const YTDLP = process.env.YTDLP || 'yt-dlp';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const WHISPER_BACKEND = process.env.WHISPER_BACKEND || 'service';
const WHISPER_SERVICE = process.env.WHISPER_SERVICE || 'http://localhost:9588';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base';
const WHISPER_DEVICE = process.env.WHISPER_DEVICE || 'cpu';
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || '';
const WHISPER_SERVICE_MODEL = process.env.WHISPER_SERVICE_MODEL || '';
const WHISPER_TEMPERATURE = process.env.WHISPER_TEMPERATURE || '0.0';
const WHISPER_TEMPERATURE_INC = process.env.WHISPER_TEMPERATURE_INC || '0.2';
const WHISPER_RESPONSE_FORMAT = process.env.WHISPER_RESPONSE_FORMAT || 'json';
let _SERVICE_MODEL_LOADED = null;

const TRANSCODE_EXT = process.env.TRANSCODE_EXT || '.wav';
const FFMPEG_TRANSCODE_ARGS = (process.env.TRANSCODE_ARGS || '-ar 16000 -ac 1 -c:a pcm_s16le').split(/\s+/).filter(Boolean);

// ============================== Excel 字段映射 ==============================
const COL_ID = process.env.COL_ID || 'extra.id';
const COL_TITLE = process.env.COL_TITLE || 'title';
const COL_CONTENT = process.env.COL_CONTENT || 'content';
const COL_KEYWORDS = process.env.COL_KEYWORDS || 'keywords';
const COL_TENCENTVID = process.env.COL_TENCENTVID || 'extra.tencent';
const COL_BILIBILIBVID = process.env.COL_BILIBILIBVID || 'extra.bilibili';
const COL_YOUTUBEID = process.env.COL_YOUTUBEID || 'extra.youtube';
const COL_YOUKUID = process.env.COL_YOUKUID || 'extra.youku';

// ============================== 平台配置 ==============================
const PLATFORM_COL_MAP = {
  tencent: COL_TENCENTVID,
  tencentVid: COL_TENCENTVID,
  bilibili: COL_BILIBILIBVID,
  bilibiliBvid: COL_BILIBILIBVID,
  youtube: COL_YOUTUBEID,
  youtubeId: COL_YOUTUBEID,
  youku: COL_YOUKUID,
  youkuId: COL_YOUKUID,
};

// ============================== 工具函数 ==============================
function c(color, text) {
  const codes = {
    // styles
    bold:      '\x1b[1m',
    dim:       '\x1b[2m',
    underline: '\x1b[4m',
    // foreground
    black:   '\x1b[30m',
    red:     '\x1b[31m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    blue:    '\x1b[34m',
    magenta: '\x1b[35m',
    cyan:    '\x1b[36m',
    white:   '\x1b[37m',
    gray:    '\x1b[90m',
    // background
    bgBlack:   '\x1b[40m',
    bgRed:     '\x1b[41m',
    bgGreen:   '\x1b[42m',
    bgYellow:  '\x1b[43m',
    bgBlue:    '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan:    '\x1b[46m',
    bgWhite:   '\x1b[47m',
    bgGray:    '\x1b[100m',
    // reset
    reset:   '\x1b[0m',
  };
  if (Array.isArray(color)) {
    return color.map(cl => codes[cl] || '').join('') + text + codes.reset;
  }
  return (codes[color] || '') + text + codes.reset;
}

// 日志样式辅助
function styleStart(msg)  { return c(['bold', 'cyan'], `► ${msg}`); }
function styleDone(msg)   { return c(['bold', 'green'], `✔ ${msg}`); }
function styleFail(msg)   { return c(['bold', 'red'], `✘ ${msg}`); }
function styleWarn(msg)   { return c(['bold', 'yellow'], `⚠ ${msg}`); }
function styleSkip(msg)   { return c(['dim', 'yellow'], `⏭ ${msg}`); }
function styleInfo(msg)   { return c('cyan', `  ${msg}`); }
function styleCount(n, label) { return c('bold', n) + ' ' + label; }
function styleSection(title) { return '\n' + c(['bold', 'blue'], `═══ ${title} ═══`); }
function styleProgress(cur, total) { return c('cyan', `[${cur}/${total}]`); }

const PLATFORM_PRIORITY = (process.env.PLATFORM_PRIORITY || 'bilibili,youtube,tencent,youku')
  .split(',').map(s => s.trim()).filter(Boolean);

const _VIDEO_SHEETS_RAW = process.env.VIDEO_SHEETS || '';
const VIDEO_SHEETS = _VIDEO_SHEETS_RAW
  ? _VIDEO_SHEETS_RAW.split(',').map(s => s.trim()).filter(Boolean)
  : [];

const _PKEY_ENV_PREFIX = {
  tencent: 'TENCENT',
  tencentVid: 'TENCENT',
  bilibili: 'BILIBILI',
  bilibiliBvid: 'BILIBILI',
  youtube: 'YOUTUBE',
  youtubeId: 'YOUTUBE',
  youku: 'YOUKU',
  youkuId: 'YOUKU',
};

function buildPlatformConfig() {
  const config = {};
  for (const pkey of PLATFORM_PRIORITY) {
    const prefix = _PKEY_ENV_PREFIX[pkey] || pkey.toUpperCase();
    const cfg = {
      field: PLATFORM_COL_MAP[pkey] || `extra.${pkey}`,
      url_tpl: process.env[`${prefix}_URL_TPL`] || '',
    };

    // Cookie
    const cfb = process.env[`${prefix}_COOKIES_FROM_BROWSER`] || '';
    const cookieFile = process.env[`${prefix}_COOKIE_FILE`] || '';
    cfg.cookies_from_browser = cfb;
    cfg.cookie_file = cookieFile ? path.resolve(BASE_DIR, cookieFile) : null;

    // Proxy
    const proxy = process.env[`${prefix}_PROXY`] || '';
    if (proxy) cfg.proxy = proxy;

    // Extra headers
    const ua = process.env[`${prefix}_USER_AGENT`] || '';
    const extraHeaders = [];
    if (ua) extraHeaders.push('--user-agent', ua);
    if (pkey === 'bilibili') {
      const referer = process.env[`${prefix}_REFERER`] || '';
      if (referer) extraHeaders.push('--add-header', `Referer:${referer}`);
    }
    if (ua || (pkey === 'bilibili' && process.env[`${prefix}_REFERER`])) {
      extraHeaders.push('--add-header', 'Accept-Language:zh,en;q=0.9');
    }
    if (extraHeaders.length) cfg.extra_headers = extraHeaders;

    // Concurrent fragments
    const cf = process.env[`${prefix}_CONCURRENT_FRAGMENTS`] || '';
    if (cf) cfg.concurrent_fragments = parseInt(cf, 10);

    // Extra args (YouTube)
    if (pkey === 'youtube') {
      const jsRt = process.env[`${prefix}_JS_RUNTIMES`] || '';
      const rc = process.env[`${prefix}_REMOTE_COMPONENTS`] || '';
      const extraArgs = [];
      if (jsRt) extraArgs.push('--js-runtimes', jsRt);
      if (rc) extraArgs.push('--remote-components', rc);
      if (extraArgs.length) cfg.extra_args = extraArgs;
    }

    // Format
    const fmt = process.env[`${prefix}_FORMAT`] || '';
    if (fmt) cfg.format = fmt;

    config[pkey] = cfg;
  }
  return config;
}

const PLATFORM_CONFIG = buildPlatformConfig();

// ============================== 日志 ==============================
function logInfo(msg) {
  console.log(`${timestamp()} ${c('green', '[INFO]')}  ${msg}`);
}
function logWarn(msg) {
  console.log(`${timestamp()} ${c('yellow', '[WARN]')}  ${msg}`);
}
function logError(msg) {
  console.log(`${timestamp()} ${c(['bold', 'red'], '[ERROR]')} ${msg}`);
}
function logStep(msg) {
  console.log(`${timestamp()} ${c('cyan', '[STEP]')}  ${msg}`);
}
function logDebug(msg) {
  if (process.env.DEBUG) console.log(`${timestamp()} ${c('gray', '[DEBUG]')} ${msg}`);
}
function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

// Node.js 单线程模型下 console.log 是原子的，不会出现行内交错
function lockedPrint(s) {
  console.log(s);
}

// ============================== 进度追踪 ==============================
class OverallProgress {
  constructor(total) {
    this.total = total;
    this.completed = 0;
    this.success = 0;
    this.failed = 0;
    this.partial = 0;
    this.noVideo = 0;
  }
  addResult(status) {
    this.completed++;
    if (status === 'success') this.success++;
    else if (status === 'failed') this.failed++;
    else if (status === 'partial') this.partial++;
    else if (status === 'no_video') this.noVideo++;
  }
  summaryLine() {
    const pct = this.total ? (this.completed / this.total * 100).toFixed(1) : '0.0';
    const parts = [];
    // 进度条样式
    const barWidth = 20;
    const filled = Math.round(barWidth * this.completed / this.total);
    const bar = c('green', '█'.repeat(filled)) + c('dim', '░'.repeat(barWidth - filled));
    parts.push(`\n${bar} ${c('bold', `${pct}%`)} ${c('dim', `(${this.completed}/${this.total})`)}`);
    // 状态统计
    parts.push(this.success > 0 ? c(['bold', 'green'], `  ✅ 成功: ${this.success}`) : c('dim', `  ✅ 成功: 0`));
    parts.push(this.failed > 0 ? c(['bold', 'red'], `  ❌ 失败: ${this.failed}`) : c('dim', `  ❌ 失败: 0`));
    parts.push(this.partial > 0 ? c(['bold', 'yellow'], `  ⚠️  部分: ${this.partial}`) : c('dim', `  ⚠️  部分: 0`));
    parts.push(this.noVideo > 0 ? c('cyan', `  ⏹️  无视频: ${this.noVideo}`) : c('dim', `  ⏹️  无视频: 0`));
    return parts.join('\n');
  }
}

// ============================== 数据结构 ==============================
class StepResult {
  constructor(status = 'skipped', file = null, error = null, retriesUsed = 0) {
    this.status = status;
    this.file = file;
    this.error = error;
    this.retries_used = retriesUsed;
  }
}

class TaskResult {
  constructor(sheet, idVal, title, platform = null, videoUrl = null, stem = '') {
    this.sheet = sheet;
    this.id_val = idVal;
    this.title = title;
    this.platform = platform;
    this.video_url = videoUrl;
    this.stem = stem;
    this.download = new StepResult('skipped');
    this.transcode = new StepResult('skipped');
    this.transcribe = new StepResult('skipped');
    this.analyze = new StepResult('skipped');
    this.overall_status = 'pending';
    this.error = null;
  }
  toJSON() {
    return {
      sheet: this.sheet,
      id_val: this.id_val,
      title: this.title,
      platform: this.platform,
      video_url: this.video_url,
      stem: this.stem,
      download: { ...this.download },
      transcode: { ...this.transcode },
      transcribe: { ...this.transcribe },
      analyze: { ...this.analyze },
      overall_status: this.overall_status,
      error: this.error,
    };
  }
}

// ============================== 工具函数 ==============================
function safeFilename(name) {
  let safe = String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
  // 防止路径遍历：过滤 ..
  while (safe.includes('..')) safe = safe.replace('..', '_');
  // 防止以 . 开头（Unix 隐藏文件）
  safe = safe.replace(/^\.+/, '');
  return safe || 'unknown';
}

function readExcelSheet(sheetName) {
  const wb = XLSX.readFile(EXCEL_FILE);
  if (!wb.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found in ${EXCEL_FILE}`);
  }
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws);
}

function writeExcelCell(sheetName, rowIndex, colName, value) {
  // rowIndex is 0-based in the sheet data
  const wb = XLSX.readFile(EXCEL_FILE);
  if (!wb.SheetNames.includes(sheetName)) {
    logWarn(`Sheet [${sheetName}] not found, skip write`);
    return false;
  }
  const ws = wb.Sheets[sheetName];

  // Convert to AOA to find column index
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const headers = aoa[0];
  const colIdx = headers.indexOf(colName);
  if (colIdx === -1) {
    logWarn(`[${sheetName}] column "${colName}" not found, skip write`);
    return false;
  }

  // Ensure the row exists
  while (aoa.length <= rowIndex + 1) {
    aoa.push([]);
  }
  aoa[rowIndex + 1][colIdx] = value;

  // Rebuild sheet
  const newWs = XLSX.utils.aoa_to_sheet(aoa);
  wb.Sheets[sheetName] = newWs;
  XLSX.writeFile(wb, EXCEL_FILE);
  return true;
}

function getVideoId(row) {
  for (const pkey of PLATFORM_PRIORITY) {
    const cfg = PLATFORM_CONFIG[pkey];
    const val = row[cfg.field];
    if (val != null && String(val).trim() !== '') {
      return { pkey, vid: String(val).trim() };
    }
  }
  return { pkey: null, vid: null };
}

function buildUrl(pkey, vid) {
  const tpl = PLATFORM_CONFIG[pkey]?.url_tpl || '';
  return tpl.replace(`{${pkey}}`, vid);
}
// ═══════════════════════════════════════════════════════════════════
// URL 解析（--url 模式）
// ═══════════════════════════════════════════════════════════════════

const URL_PLATFORM_MAP = [
  {
    platform: 'bilibili',
    pkey: 'bilibili',
    patterns: [
      /bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})/,
      /b23\.tv\/([a-zA-Z0-9]+)/,
      /player\.bilibili\.com\/player\.html\?[^"'\s]*\baid=(\d+)/,
    ],
  },
  {
    platform: 'youtube',
    pkey: 'youtube',
    patterns: [
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    ],
  },
  {
    platform: 'tencent',
    pkey: 'tencent',
    patterns: [
      /v\.qq\.com\/x\/page\/([a-zA-Z0-9]+)\.html/,
      /v\.qq\.com\/x\/cover\/[^/]+\/([a-zA-Z0-9]+)\.html/,
      /[?&]vid=([a-zA-Z0-9]+)/,
    ],
  },
  {
    platform: 'youku',
    pkey: 'youku',
    patterns: [
      /v\.youku\.com\/v_show\/id_([a-zA-Z0-9=]+)\.html/,
    ],
  },
];

function parseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  url = url.trim();

  // 提取 iframe src
  const iframeMatch = url.match(/src=["']([^"']+)["']/);
  if (iframeMatch) url = iframeMatch[1];

  for (const entry of URL_PLATFORM_MAP) {
    for (const re of entry.patterns) {
      const m = url.match(re);
      if (m && m[1]) {
        return {
          platform: entry.platform,
          pkey: entry.pkey,
          videoId: m[1],
          watchUrl: url,
        };
      }
    }
  }
  return null;
}


// ============================== stem 去重 ==============================
function safeId(val) {
  try {
    return safeFilename(String(Math.floor(Number(val))));
  } catch {
    return safeFilename(String(val));
  }
}

function precomputeStems(rows, sheetName) {
  if (!rows.length) return;
  // Calculate stems for each row
  const stems = rows.map(row => {
    const eid = row[COL_ID];
    if (eid != null && String(eid).trim() !== '') {
      return safeId(eid);
    }
    return safeFilename(String(row[COL_TITLE] || 'unknown'));
  });

  // Resolve duplicates
  const finalStems = [...stems];
  const count1 = {};
  for (const s of finalStems) count1[s] = (count1[s] || 0) + 1;

  for (let i = 0; i < finalStems.length; i++) {
    if (count1[finalStems[i]] > 1) {
      const title = safeFilename(String(rows[i][COL_TITLE] || ''));
      finalStems[i] = title ? `${finalStems[i]}_${title}` : finalStems[i];
    }
  }

  const count2 = {};
  for (const s of finalStems) count2[s] = (count2[s] || 0) + 1;

  for (let i = 0; i < finalStems.length; i++) {
    if (count2[finalStems[i]] > 1) {
      const { pkey, vid } = getVideoId(rows[i]);
      if (pkey && vid) {
        finalStems[i] = `${finalStems[i]}_${safeFilename(vid)}`;
      }
    }
  }

  // Cache on rows (using _stemCache keyed by sheetName + original index)
  rows.forEach((row, i) => {
    if (!row._stemCache) row._stemCache = {};
    row._stemCache[sheetName] = finalStems[i];
  });
}
async function resolveUrlConflict(proposedPath) {
  if (!fs.existsSync(proposedPath)) return { action: 'proceed', path: proposedPath };

  const stem = path.basename(proposedPath, path.extname(proposedPath));
  const dir = path.dirname(proposedPath);
  const ext = path.extname(proposedPath);

  console.log(`\n⚠️  文件已存在: ${c('yellow', proposedPath)}`);

  const action = await select({
    message: '如何处理?',
    choices: [
      { name: '覆盖 (重新下载替换)', value: 'overwrite' },
      { name: '跳过 (保留已有文件)', value: 'skip' },
      { name: '自定义文件名', value: 'custom' },
    ],
  });

  if (action === 'skip') return { action: 'skip', path: null };
  if (action === 'overwrite') return { action: 'proceed', path: proposedPath };

  // custom name
  const customName = await input({
    message: '输入自定义文件名 (不含扩展名):',
    default: stem,
  });
  if (!customName.trim()) {
    console.log(c('yellow', '文件名不能为空，使用默认名称'));
    return { action: 'proceed', path: proposedPath };
  }
  const newPath = path.join(dir, `${safeFilename(customName)}${ext}`);
  return resolveUrlConflict(newPath);
}


function stemName(row, sheetName = '') {
  if (sheetName && row._stemCache && row._stemCache[sheetName]) {
    return row._stemCache[sheetName];
  }
  const eid = row[COL_ID];
  if (eid != null && String(eid).trim() !== '') {
    return safeId(eid);
  }
  return safeFilename(String(row[COL_TITLE] || 'unknown'));
}

function rowKey(row) {
  const eid = row[COL_ID];
  if (eid != null && String(eid).trim() !== '') {
    return safeId(eid);
  }
  return String(row[COL_TITLE] || 'unknown');
}

function findDownloadedFile(dlDir, stem) {
  if (!fs.existsSync(dlDir)) return null;
  const entries = fs.readdirSync(dlDir);
  for (const name of entries) {
    const parsed = path.parse(name);
    if (parsed.name === stem) {
      return path.join(dlDir, name);
    }
  }
  return null;
}

// ============================== 重试机制 ==============================
function isRetryable(err) {
  // Non-retryable keywords in stderr
  if (err.stderr) {
    const lower = err.stderr.toLowerCase();
    const nonRetry = ['404', '403', '401', 'unavailable', 'private video',
      'video is not available', 'this video is no longer', 'removed',
      'deleted', 'invalid url', 'unsupported url'];
    for (const kw of nonRetry) {
      if (lower.includes(kw)) return false;
    }
    return true;
  }
  // Timeout / connection errors are retryable
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return true;
  if (err.name === 'TimeoutError' || err.message?.includes('timeout')) return true;
  return false;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryCall(fn, maxRetries = 0, baseDelay = 5, taskLabel = '') {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retriesUsed: attempt, error: null };
    } catch (err) {
      lastError = String(err.message || err).slice(0, 500);
      if (!isRetryable(err)) throw err;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        logWarn(`[${taskLabel}] 第 ${attempt + 1}/${maxRetries + 1} 次尝试失败，${delay}s 后重试: ${err.message}`);
        await sleep(delay * 1000);
      } else {
        throw err;
      }
    }
  }
  throw new Error(lastError || 'unknown');
}

// ============================== 工具存在性检查 ==============================
function which(cmd) {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${cmd}`, { stdio: 'pipe' });
    } else {
      execSync(`which ${cmd}`, { stdio: 'pipe' });
    }
    return true;
  } catch {
    return false;
  }
}

async function checkWhisperAvailable() {
  if (WHISPER_BACKEND === 'local') {
    try {
      execSync('whisper --help', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      logError('本地 whisper CLI 不可用，请确认: pip install openai-whisper');
      return false;
    }
  } else {
    try {
      const resp = await fetch(WHISPER_SERVICE, { signal: AbortSignal.timeout(3000) });
      return true;
    } catch {
      return false;
    }
  }
}

function checkEnvironment(steps) {
  const result = {
    ytdlp: true, ffmpeg: true, ffprobe: true,
    whisper: true, ai: true, allOk: true, issues: []
  };
  // We can only do sync checks here, async ones deferred
  if (steps.includes('download') && !which(YTDLP)) {
    result.ytdlp = false;
    result.allOk = false;
    result.issues.push(`yt-dlp not available (${YTDLP})`);
  }
  if (steps.includes('transcode')) {
    if (!which(FFMPEG)) {
      result.ffmpeg = false;
      result.allOk = false;
      result.issues.push(`ffmpeg not available (${FFMPEG})`);
    }
    if (!which(FFPROBE)) {
      result.ffprobe = false;
      result.allOk = false;
      result.issues.push(`ffprobe not available (${FFPROBE})`);
    }
  }
  // whisper check requires async, skip in sync version
  // (will be checked async before execution)
  if (steps.includes('analyze')) {
    const aiEnabled = (process.env.AI_ENABLED || 'true').toLowerCase() === 'true';
    const aiKey = process.env.AI_API_KEY || '';
    const aiUrl = process.env.AI_BASE_URL || '';
    if (!aiEnabled) {
      result.ai = false;
      result.allOk = false;
      result.issues.push('AI analysis disabled (AI_ENABLED=false)');
    } else if (!aiKey || !aiUrl) {
      result.ai = false;
      result.allOk = false;
      result.issues.push('AI config incomplete (missing AI_API_KEY / AI_BASE_URL)');
    }
  }
  return result;
}

async function checkEnvironmentAsync(steps) {
  const result = checkEnvironment(steps);
  if (steps.includes('transcribe')) {
    const ok = await checkWhisperAvailable();
    if (!ok) {
      result.whisper = false;
      result.allOk = false;
      const backend = WHISPER_BACKEND === 'local' ? 'local CLI' : `service ${WHISPER_SERVICE}`;
      result.issues.push(`whisper not available (${backend})`);
    }
  }
  return result;
}

// ============================== 进度显示辅助 ==============================
function spawnWithTimeout(cmd, args, timeout, options = {}) {
  const { onProgress, ...spawnOpts } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      ...spawnOpts,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error(`Timeout after ${timeout}s`), { name: 'TimeoutError', code: 'ETIMEDOUT' }));
    }, timeout * 1000);

    if (onProgress) {
      // 同时监听 stdout 和 stderr — yt-dlp --newline 的 [download] 进度输出在 stdout
      const onLine = (buf, line) => { try { onProgress(line); } catch {} };
      const rlOut = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      rlOut.on('line', line => { stdout += line + '\n'; onLine('stdout', line); });
      const rlErr = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
      rlErr.on('line', line => { stderr += line + '\n'; onLine('stderr', line); });
    } else {
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
    }

    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`Exit code ${code}`), { code, stderr }));
    });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ============================== AI 分析 ==============================
async function stepAnalyze(text, maxRetries, retryDelay, timeout = 300, label = 'analyze') {
  if (!text || !text.trim()) {
    return { text: null, retries: 0, error: 'content empty, skip AI analysis' };
  }

  const apiKey = process.env.AI_API_KEY || '';
  const baseUrl = (process.env.AI_BASE_URL || '').replace(/\/$/, '');
  const model = process.env.AI_MODEL || '';
  const promptTpl = process.env.AI_PROMPT_TPL || '帮我归纳总结一下Keywords，尽可能全一点，这是内容：{content}';
  const aiTemperature = parseFloat(process.env.AI_TEMPERATURE || '0.3');
  const aiTimeout = timeout;

  if (!apiKey || !baseUrl || !model) {
    return { text: null, retries: 0, error: 'AI config incomplete' };
  }

  const prompt = promptTpl.replace('{content}', text);
  const apiUrl = `${baseUrl}/chat/completions`;
  const payload = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: aiTemperature,
  });

  let lastErr = null;
  const maxAttempts = maxRetries + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let done = false;
    const analyzeStart = Date.now();
    const progressInterval = setInterval(() => {
      if (!done) {
        const elapsed = ((Date.now() - analyzeStart) / 1000).toFixed(0);
        lockedPrint(`  [${label}] ${c('cyan', 'AI 分析中')}... ${elapsed}s`);
      }
    }, 5000);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), aiTimeout * 1000);
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      done = true;
      clearInterval(progressInterval);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
      }
      const body = await resp.json();
      const content = body.choices?.[0]?.message?.content || '';
      return { text: content.trim(), retries: attempt, error: null };
    } catch (e) {
      done = true;
      clearInterval(progressInterval);
      lastErr = String(e.message).slice(0, 500);
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(retryDelay * Math.pow(2, attempt), 30);
        lockedPrint(`  [${label}] ${styleWarn(`AI 分析第 ${attempt + 1} 次尝试失败`)}: ${lastErr.slice(0, 100)}, ${delay}s 后重试...`);
        await sleep(delay * 1000);
      }
    }
  }
  return { text: null, retries: maxAttempts, error: `AI analysis failed after ${maxAttempts} retries: ${lastErr}` };
}

// ============================== 清理残留文件 ==============================
function cleanupPartials(dlDir, stem) {
  const patterns = [
    new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\..*\\.part$`),
    new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\..*\\.ytdl$`),
  ];
  try {
    const files = fs.readdirSync(dlDir);
    for (const f of files) {
      const fullPath = path.join(dlDir, f);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;
      } catch { continue; }
      if (f === `${stem}.part` || f === `${stem}.ytdl` || patterns.some(p => p.test(f))) {
        try { fs.unlinkSync(fullPath); lockedPrint(`  [${stem}] cleaned partial: ${f}`); } catch {}
      }
    }
  } catch {}
}

// ============================== 下载 ==============================
function parseYtdlpProgress(line) {
  // Parse yt-dlp progress lines like:
  //   "[download]  12.3% of ~50.00MiB at  2.5MiB/s ETA 00:15"
  //   "[download]   0.0% of   61.66MiB at  Unknown B/s ETA Unknown"
  const m = line.match(/\[download\]\s+([\d.]+%)\s+of\s+~?\s*([\d.]+[KMG]iB)/);
  if (!m) return null;
  const pct  = m[1];                // e.g. "12.3%"
  const size = m[2];                // e.g. "50.00MiB"
  const spd  = (line.match(/at\s+([\d.]+ ?[KMG]?i?B\/s)/) || [])[1] || '?';
  const eta  = (line.match(/ETA\s+([\d:]+)/) || [])[1] || '?';
  return `DL ${pct} of ${size} @ ${spd} ETA ${eta}`;
}

async function stepDownload(row, sheetName, maxRetries, retryDelay, force, timeout = 600) {
  const { pkey, vid } = getVideoId(row);
  const stem = stemName(row, sheetName);

  if (!pkey) {
    return { file: null, retries: 0, error: 'no video ID' };
  }

  const dlDir = path.join(DOWNLOADS_DIR, sheetName);
  fs.mkdirSync(dlDir, { recursive: true });

  if (!force) {
    const existing = findDownloadedFile(dlDir, stem);
    if (existing) {
      lockedPrint(styleSkip(`[${stem}] 已存在 ${path.basename(existing)}, 跳过下载`));
      return { file: existing, retries: 0, error: null };
    }
  }

  const videoUrl = buildUrl(pkey, vid);
  lockedPrint(styleStart(`[${stem}] 开始下载 (platform=${pkey})`));
  lockedPrint(c('dim', `  ${videoUrl}`));

  const cfg = PLATFORM_CONFIG[pkey];
  const args = [
    videoUrl,
    '-o', path.join(dlDir, `${stem}.%(ext)s`),
    '--no-playlist',
    '--newline',
    '--merge-output-format', 'mp4',
    '-f', cfg.format || 'bestvideo+bestaudio/best',
  ];

  if (force) {
    args.push('--force-overwrites');
  }

  if (cfg.concurrent_fragments) {
    args.push('--concurrent-fragments', String(cfg.concurrent_fragments));
  }

  // Cookies
  if (cfg.cookies_from_browser) {
    args.push('--cookies-from-browser', cfg.cookies_from_browser);
  } else if (cfg.cookie_file && fs.existsSync(cfg.cookie_file)) {
    args.push('--cookies', cfg.cookie_file);
  }

  // Proxy
  const extraEnv = {};
  if (cfg.proxy) {
    args.push('--proxy', cfg.proxy);
    extraEnv.HTTPS_PROXY = cfg.proxy;
    extraEnv.HTTP_PROXY = cfg.proxy;
  }

  if (cfg.extra_headers) args.push(...cfg.extra_headers);
  if (cfg.extra_args) args.push(...cfg.extra_args);

  const env = { ...process.env, ...extraEnv };

  let lastProgress = '';
  async function doDownload() {
    const { stdout, stderr } = await spawnWithTimeout(YTDLP, args, timeout, {
      env,
      onProgress: line => {
        const prog = parseYtdlpProgress(line);
        if (prog && prog !== lastProgress) {
          lastProgress = prog;
          lockedPrint(`  [${stem}] ${prog}`);
        }
      },
    });
    // spawnWithTimeout already rejects on non-zero exit code, no need for stderr check
  }

  try {
    await retryCall(doDownload, maxRetries, retryDelay, stem);
  } catch (e) {
    const errMsg = (e.stderr || e.message || '').slice(-2000);
    lockedPrint(styleFail(`[${stem}] 下载失败: ${errMsg.slice(0, 200)}`));
    return { file: null, retries: maxRetries, error: errMsg.slice(0, 500) };
  }

  const downloaded = findDownloadedFile(dlDir, stem);
  if (downloaded) {
    const sizeMB = (fs.statSync(downloaded).size / 1024 / 1024).toFixed(1);
    lockedPrint(styleDone(`[${stem}] 下载完成 -> ${path.basename(downloaded)} (${sizeMB} MB)`));
    return { file: downloaded, retries: 0, error: null };
  }
  lockedPrint(styleFail(`[${stem}] 下载后未找到文件`));
  return { file: null, retries: 0, error: 'file not found after download' };
}

// ============================== 转码 ==============================
function getDuration(filepath) {
  try {
    const result = execSync(
      `${FFPROBE} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filepath}"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    const dur = parseFloat(result.trim());
    return isNaN(dur) ? null : dur;
  } catch {
    return null;
  }
}

async function stepTranscode(srcFile, sheetName, maxRetries, retryDelay, force, timeout = 600) {
  const tcDir = path.join(TRANSCODED_DIR, sheetName);
  fs.mkdirSync(tcDir, { recursive: true });
  const stem = path.parse(srcFile).name;
  const outFile = path.join(tcDir, stem + TRANSCODE_EXT);

  if (!force && fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
    // Check if source is newer than output
    const srcMtime = fs.statSync(srcFile).mtimeMs;
    const outMtime = fs.statSync(outFile).mtimeMs;
    if (srcMtime > outMtime) {
      lockedPrint(styleWarn(`[${stem}] 源文件已更新(重新下载), 重新转码`));
    } else {
      lockedPrint(styleSkip(`[${stem}] 转码文件已存在, 跳过 (${path.basename(outFile)})`));
      return { file: outFile, retries: 0, error: null };
    }
  }

  const totalDur = getDuration(srcFile);
  lockedPrint(styleStart(`[${stem}] 开始转码 -> ${path.basename(outFile)}`));
  if (totalDur && totalDur > 0) {
    lockedPrint(c('dim', `  时长: ${Math.floor(totalDur / 60)}:${(totalDur % 60).toFixed(0).padStart(2, '0')}`));
  }

  async function doTranscode() {
    const args = ['-y', '-i', srcFile, ...FFMPEG_TRANSCODE_ARGS, outFile];
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let lastProgress = '';
    const startTime = Date.now();

    child.stderr.on('data', d => {
      stderr += d.toString();
      // Parse ffmpeg progress
      const match = stderr.match(/time=(\d+):(\d+):(\d+\.?\d*)/g);
      if (match) {
        const last = match[match.length - 1];
        const m = last.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
        if (m) {
          const elapsed = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          let progress;
          if (totalDur && totalDur > 0) {
            const pct = Math.min(100, (elapsed / totalDur * 100)).toFixed(1);
            progress = `${pct}% (${Math.floor(elapsed)}s/${Math.floor(totalDur)}s)`;
          } else {
            progress = `${elapsed.toFixed(1)}s`;
          }
          if (progress !== lastProgress) {
            lockedPrint(`  [${stem}] ${c('cyan', '转码中')} ${progress}`);
            lastProgress = progress;
          }
        }
      }
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(Object.assign(new Error(`Transcode timeout after ${timeout}s`), { name: 'TimeoutError' }));
      }, timeout * 1000);

      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(Object.assign(new Error(`ffmpeg exit code ${code}`), { stderr }));
      });
      child.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  try {
    await retryCall(doTranscode, maxRetries, retryDelay, stem);
    const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
    lockedPrint(styleDone(`[${stem}] 转码完成 (${sizeMB} MB)`));
    return { file: outFile, retries: 0, error: null };
  } catch (e) {
    const errMsg = (e.stderr || e.message || '').slice(-2000);
    lockedPrint(styleFail(`[${stem}] 转码失败: ${errMsg.slice(0, 200)}`));
    return { file: null, retries: maxRetries, error: errMsg.slice(0, 500) };
  }
}

// ============================== 识别 ==============================
async function stepTranscribe(audioFile, maxRetries, retryDelay, timeout = 600) {
  const stem = path.parse(audioFile).name;

  const whisperOk = await checkWhisperAvailable();
  if (!whisperOk) {
    const backend = WHISPER_BACKEND === 'local' ? 'local CLI' : WHISPER_SERVICE;
    logWarn(`[${stem}] whisper not available (${backend})`);
    return { text: null, retries: 0, error: `whisper not available (${backend})` };
  }

  const fileSizeMB = (fs.statSync(audioFile).size / (1024 * 1024)).toFixed(1);
  const dur = getDuration(audioFile);
  const durStr = dur ? `, 时长 ${Math.floor(dur / 60)}:${(dur % 60).toFixed(0).padStart(2, '0')}` : '';
  if (WHISPER_BACKEND === 'local') {
    const langLabel = WHISPER_LANGUAGE || 'auto';
    lockedPrint(styleStart(`[${stem}] 开始语音识别 [local(${WHISPER_MODEL}/${langLabel})] (${fileSizeMB}MB${durStr})`));
  } else {
    const modelLabel = WHISPER_SERVICE_MODEL || WHISPER_MODEL || '(server default)';
    lockedPrint(styleStart(`[${stem}] 开始语音识别 [service(${modelLabel})] (${fileSizeMB}MB${durStr})`));
  }

  if (WHISPER_BACKEND === 'local') {
    return transcribeLocal(audioFile, stem, maxRetries, retryDelay);
  } else {
    return transcribeService(audioFile, stem, maxRetries, retryDelay, timeout);
  }
}

async function transcribeLocal(audioFile, stem, maxRetries, retryDelay, timeout = 600) {
  const startTime = Date.now();
  const outDir = path.dirname(audioFile);

  async function doTranscribe() {
    const args = [
      audioFile,
      '--model', WHISPER_MODEL,
      '--device', WHISPER_DEVICE,
    ];
    if (WHISPER_LANGUAGE) args.push('--language', WHISPER_LANGUAGE);
    args.push('--output_format', 'txt', '--output_dir', outDir);

    const { stderr } = await spawnWithTimeout('whisper', args, timeout);
    // whisper writes output to {stem}.txt
    const outTxt = path.join(outDir, `${stem}.txt`);
    if (!fs.existsSync(outTxt)) {
      throw new Error('whisper output file not generated');
    }
    return fs.readFileSync(outTxt, 'utf-8').trim();
  }

  try {
    const { result: text, retriesUsed, error } = await retryCall(doTranscribe, maxRetries, retryDelay, stem);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    if (error) return { text: null, retries: retriesUsed, error };
    lockedPrint(styleDone(`[${stem}] 识别完成 (${elapsed}s, ${text.length} 字符)`));
    return { text, retries: 0, error: null };
  } catch (e) {
    lockedPrint(styleFail(`[${stem}] 识别失败: ${e.message}`));
    return { text: null, retries: maxRetries, error: String(e.message).slice(0, 500) };
  }
}

async function transcribeService(audioFile, stem, maxRetries, retryDelay, timeout = 600) {
  const startTime = Date.now();
  let done = false;
  const progressInterval = setInterval(() => {
    if (!done) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      lockedPrint(`  [${stem}] ${c('magenta', '识别中')}... ${elapsed}s`);
    }
  }, 5000);

  async function doTranscribe() {
    try {
      // Switch model if needed
      if (WHISPER_SERVICE_MODEL && WHISPER_SERVICE_MODEL !== _SERVICE_MODEL_LOADED) {
        lockedPrint(c('dim', `  [${stem}] 切换模型: ${WHISPER_SERVICE_MODEL}`));
        const loadForm = new FormData();
        loadForm.append('model', WHISPER_SERVICE_MODEL);
        const loadResp = await fetch(`${WHISPER_SERVICE}/load`, {
          method: 'POST',
          body: loadForm,
          signal: AbortSignal.timeout(30000),
        });
        if (!loadResp.ok) throw new Error(`/load failed: HTTP ${loadResp.status}`);
        _SERVICE_MODEL_LOADED = WHISPER_SERVICE_MODEL;
      }

      // Run inference
      const fileBlob = await fs.openAsBlob(audioFile);
      const form = new FormData();
      form.append('file', fileBlob, path.basename(audioFile));
      form.append('temperature', WHISPER_TEMPERATURE);
      form.append('temperature_inc', WHISPER_TEMPERATURE_INC);
      form.append('response_format', WHISPER_RESPONSE_FORMAT);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout * 1000);
      const resp = await fetch(`${WHISPER_SERVICE}/inference`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`/inference failed: HTTP ${resp.status}`);
      const data = await resp.json();
      const text = (data.text || '').trim();
      if (!text) throw new Error('whisper returned empty text');
      return text;
    } finally {
      // Don't set done here - let the outer finally handle it
    }
  }

  try {
    const { result: text, retriesUsed, error } = await retryCall(doTranscribe, maxRetries, retryDelay, stem);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    if (error) return { text: null, retries: retriesUsed, error };
    lockedPrint(styleDone(`[${stem}] 识别完成 (${elapsed}s, ${text.length} 字符)`));
    return { text, retries: 0, error: null };
  } catch (e) {
    lockedPrint(styleFail(`[${stem}] 识别失败: ${e.message}`));
    return { text: null, retries: maxRetries, error: String(e.message).slice(0, 500) };
  } finally {
    done = true;
    clearInterval(progressInterval);
  }
}

// ============================== Excel 批量写回 ==============================
function writeAllContentsToExcel(results, keywordsDict = null) {
  if (!results.length) return;

  // Collect content updates
  const updates = new Map(); // key: "sheet|id"
  for (const r of results) {
    if (r.transcribe.status === 'success' && r.transcribe.file) {
      const text = r.transcribe.file;
      if (text.trim()) {
        updates.set(`${r.sheet}|${r.id_val}`, text);
      }
    }
  }

  if (!updates.size && !keywordsDict?.size) return;

  logInfo(`write ${updates.size} content + ${keywordsDict?.size || 0} keywords to Excel...`);
  const wb = XLSX.readFile(EXCEL_FILE, { cellFormula: true, cellDates: true });

  /**
   * Write text values to a specific column, matching rows by id or title.
   * Uses direct cell writes to preserve existing formatting.
   */
  function writeColumn(sheetName, colName, entries) {
    if (!wb.SheetNames.includes(sheetName)) return;
    const ws = wb.Sheets[sheetName];

    // Read header row only (via AOA for detection - we don't rebuild the sheet)
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const headers = aoa[0];
    const targetCol = headers.indexOf(colName);
    const idCol = headers.indexOf(COL_ID);
    const titleCol = headers.indexOf(COL_TITLE);
    if (targetCol === -1) return;

    for (const [key, text] of entries) {
      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r];
        let matched = false;
        if (idCol !== -1 && row[idCol] != null) {
          try {
            if (String(Math.floor(Number(row[idCol]))) === String(key)) matched = true;
          } catch { }
        }
        if (!matched && titleCol !== -1 && String(row[titleCol]) === String(key)) matched = true;
        if (matched) {
          // Write directly to cell to preserve formatting of other cells
          const cellRef = XLSX.utils.encode_cell({ r, c: targetCol });
          ws[cellRef] = { t: 's', v: text };
          logInfo(`[${sheetName}/${key}] ${colName} written (${text.length} chars)`);
          break;
        }
      }
    }
  }

  // Write content column
  for (const [sheetName, rowsObj] of groupBySheetMap(updates)) {
    writeColumn(sheetName, COL_CONTENT, Object.entries(rowsObj));
  }

  // Write keywords column
  if (keywordsDict && keywordsDict.size) {
    const kwBySheet = new Map(); // sheetName -> [[key, text], ...]
    for (const [key, kwText] of keywordsDict) {
      const [sheetName, kwKey] = key.split('|');
      if (!kwBySheet.has(sheetName)) kwBySheet.set(sheetName, []);
      kwBySheet.get(sheetName).push([kwKey, kwText]);
    }
    for (const [sheetName, entries] of kwBySheet) {
      writeColumn(sheetName, COL_KEYWORDS, entries);
    }
  }

  XLSX.writeFile(wb, EXCEL_FILE, { cellDates: true });
  logInfo('Excel write done');
}

function groupBySheetMap(updates) {
  const result = new Map();
  for (const [compositeKey, text] of updates) {
    const [sheetName, key] = compositeKey.split('|');
    if (!result.has(sheetName)) result.set(sheetName, {});
    result.get(sheetName)[key] = text;
  }
  return result;
}

// ============================== 报告 ==============================
function computeSummary(results) {
  let success = 0, partial = 0, failed = 0, noVideo = 0;
  for (const r of results) {
    if (r.overall_status === 'success') success++;
    else if (r.overall_status === 'partial') partial++;
    else if (r.overall_status === 'failed') failed++;
    else if (r.overall_status === 'no_video') noVideo++;
  }
  return { total: results.length, success, partial, failed, no_video: noVideo };
}

/**
 * 生成执行报告 JSON 文件。
 * - 提供 sheetName 时：报告存入 REPORTS_DIR/{sheetName}/report_{ts}.json
 * - 不提供时：按 r.sheet 分组，每 sheet 调用自身，返回路径数组
 */
function generateReport(results, config, sheetName) {
  if (!sheetName) {
    // ── 按 sheet 分组生成 ──
    const sheetGroups = new Map();
    for (const r of results) {
      if (!sheetGroups.has(r.sheet)) sheetGroups.set(r.sheet, []);
      sheetGroups.get(r.sheet).push(r);
    }
    const paths = [];
    for (const [sheet, items] of sheetGroups) {
      paths.push(generateReport(items, config, sheet));
    }
    return paths;
  }

  // ── 单 sheet 报告 ──
  const dir = path.join(REPORTS_DIR, sheetName);
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().split('.')[0].replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
  const reportFile = path.join(dir, `report_${ts}.json`);

  const summary = computeSummary(results);

  const report = {
    timestamp: new Date().toISOString(),
    config,
    summary,
    items: results.map(r => r.toJSON()),
    failed_items: results.filter(r => r.overall_status === 'failed' || r.overall_status === 'partial')
      .map(r => ({
        sheet: r.sheet, id: r.id_val, title: r.title, stem: r.stem,
        error: r.error,
        download_error: r.download.error,
        transcode_error: r.transcode.error,
        transcribe_error: r.transcribe.error,
      })),
  };

  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');
  logInfo(`report generated: ${reportFile}`);
  return reportFile;
}

function printReportSummary(results) {
  const { total, success, partial, failed, no_video: noVid } = computeSummary(results);

  console.log(styleSection('执行摘要'));
  console.log(`  ${c('bold', '总计:')} ${styleCount(total, '条')}`);
  if (success > 0) console.log(`  ${c('green', '✅ 成功:')} ${styleCount(success, '条')}`);
  if (partial > 0) console.log(`  ${c('yellow', '⚠️  部分成功:')} ${styleCount(partial, '条')}`);
  if (failed > 0) console.log(`  ${c('red', '❌ 失败:')} ${styleCount(failed, '条')}`);
  if (noVid > 0) console.log(`  ${c('dim', '⏭️  无视频ID:')} ${styleCount(noVid, '条')}`);
  console.log(c('dim', '='.repeat(60)));

  const failures = results.filter(r => r.overall_status !== 'success');
  if (failures.length) {
    console.log(`\n${c('bold', '失败/异常详情:')}`);
    for (const r of failures) {
      const icon = { partial: c('yellow', '⚠️'), failed: c('red', '❌'), no_video: c('dim', '⏭️') }[r.overall_status] || '?';
      const statusLabel = { partial: '部分成功', failed: '失败', no_video: '无视频ID' }[r.overall_status] || r.overall_status;
      console.log(`  ${icon} [${r.sheet}] ${c('bold', r.id_val)} - ${statusLabel}`);
      console.log(`    标题: ${(r.title || 'N/A').slice(0, 50)}`);
      if (r.error) console.log(`    ${c('red', '错误:')} ${r.error.slice(0, 120)}`);
      if (r.download.status === 'failed') console.log(`    ${c('red', '下载失败:')} ${(r.download.error || 'N/A').slice(0, 120)}`);
      if (r.transcode.status === 'failed') console.log(`    ${c('red', '转码失败:')} ${(r.transcode.error || 'N/A').slice(0, 120)}`);
      if (r.transcribe.status === 'failed') console.log(`    ${c('red', '识别失败:')} ${(r.transcribe.error || 'N/A').slice(0, 120)}`);
    }
  }
}


// ============================== 环境预检 + 用户确认 ==============================
async function checkAndConfirmEnv(envCheck, dryRun, confirmMsg) {
  if (envCheck.allOk) return true;
  console.log(styleSection('工具/服务预检'));
  lockedPrint(c('yellow', '以下依赖不可用:'));
  for (const issue of envCheck.issues) lockedPrint(c('dim', `  • ${issue}`));
  lockedPrint(c('yellow', '\n涉及的步骤将失败。'));
  if (dryRun) return true;
  try {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question(`\n  ${confirmMsg}(输入 yes 继续，其他任意键取消): `, ans => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      });
    });
    if (answer !== 'yes') {
      console.log('用户取消执行（工具不可用）');
      return false;
    }
    return true;
  } catch (e) {
    console.log('非交互环境，取消执行');
    return false;
  }
}

// ============================== 单任务处理 ==============================
async function processOneTask(row, sheetName, steps, maxRetries, retryDelay, force,
  whisperAvailable, positionLabel = '', downloadTimeout = 600, transcodeTimeout = 600,
  transcribeTimeout = 600, analyzeTimeout = 300) {

  const preContent = row.preContent || null;

  const { pkey, vid } = getVideoId(row);
  const stem = stemName(row, sheetName);
  const key = rowKey(row);
  const title = String(row[COL_TITLE] || '');
  const videoUrl = pkey ? buildUrl(pkey, vid) : null;

  const result = new TaskResult(sheetName, key, title, pkey, videoUrl, stem);

  const tag = positionLabel ? `${positionLabel} ` : '';
  lockedPrint('');
  lockedPrint(c('dim', '─'.repeat(62)));
  lockedPrint(c('bold', `  ▶ Task ${positionLabel || '?'}`)
 + c('dim', `  [${stem}]  sheet=${sheetName}  platform=${pkey || 'N/A'}`));
  if (title) lockedPrint(c('dim', `  title: ${title.slice(0, 50)}`));
  lockedPrint(c('dim', '─'.repeat(62)));
  logInfo(`[${stem}] start (sheet=${sheetName}, platform=${pkey || 'N/A'}, title=${title.slice(0, 40)})`);

  // ── download ──
  let dlFile = null;
  if (preContent) {
    result.download = new StepResult('skipped', null, 'pre-content mode');
  } else if (steps.includes('download')) {
    if (!pkey) {
      result.download = new StepResult('skipped');
      result.overall_status = 'no_video';
      result.error = 'no video ID';
      return result;
    }
    try {
      const { file, retries, error } = await stepDownload(row, sheetName, maxRetries, retryDelay, force, downloadTimeout);
      dlFile = file;
      result.download = new StepResult(file ? 'success' : 'failed', file, error, retries);
    } catch (e) {
      result.download = new StepResult('failed', null, String(e.message).slice(0, 500), maxRetries);
    }
    if (!dlFile) {
      result.overall_status = 'failed';
      result.error = `download failed: ${result.download.error}`;
      return result;
    }
  } else {
    const dlDir = path.join(DOWNLOADS_DIR, sheetName);
    dlFile = findDownloadedFile(dlDir, stem);
    if (dlFile) {
      result.download = new StepResult('success', dlFile);
    } else {
      result.download = new StepResult('skipped');
    }
  }

  // ── transcode ──
  let tcFile = null;
  if (preContent) {
    result.transcode = new StepResult('skipped', null, 'pre-content mode');
  } else if (steps.includes('transcode') && dlFile) {
    try {
      const { file, retries, error } = await stepTranscode(dlFile, sheetName, maxRetries, retryDelay, force, transcodeTimeout);
      tcFile = file;
      result.transcode = new StepResult(file ? 'success' : 'failed', file, error, retries);
    } catch (e) {
      result.transcode = new StepResult('failed', null, String(e.message).slice(0, 500), maxRetries);
    }
    if (!tcFile) {
      result.overall_status = 'partial';
      result.error = `download success but transcode failed: ${result.transcode.error}`;
      return result;
    }
  } else {
    const tcDir = path.join(TRANSCODED_DIR, sheetName);
    const tcPath = path.join(tcDir, stem + TRANSCODE_EXT);
    if (fs.existsSync(tcPath)) {
      result.transcode = new StepResult('success', tcPath);
      tcFile = tcPath;
    } else {
      result.transcode = new StepResult('skipped');
    }
  }

  // ── transcribe ──
  if (preContent) {
    result.transcribe = new StepResult('success', preContent);
  } else if (steps.includes('transcribe') && tcFile) {
    if (!whisperAvailable) {
      result.transcribe = new StepResult('failed', null, `whisper unreachable (${WHISPER_SERVICE})`);
      result.overall_status = 'partial';
      result.error = 'download+transcode success but whisper unreachable';
      return result;
    }
    try {
      const { text, retries, error } = await stepTranscribe(tcFile, maxRetries, retryDelay, transcribeTimeout);
      result.transcribe = new StepResult(text ? 'success' : 'failed', text, error, retries);
      if (!text) {
        result.overall_status = 'partial';
        result.error = `download+transcode success but transcribe failed: ${error}`;
      } else {
        result.overall_status = 'success';
      }
    } catch (e) {
      result.transcribe = new StepResult('failed', null, String(e.message).slice(0, 500), maxRetries);
      result.overall_status = 'partial';
      result.error = `download+transcode success but transcribe failed: ${e.message}`;
    }
  }

  // ── AI analyze ──
  if (steps.includes('analyze') && result.transcribe.status === 'success') {
    const aiEnabled = (process.env.AI_ENABLED || 'true').toLowerCase() === 'true';
    if (aiEnabled) {
      const txt = result.transcribe.file;
      if (txt) {
        try {
          const { text: kw, retries, error } = await stepAnalyze(txt, maxRetries, retryDelay, analyzeTimeout, result.stem);
          result.analyze = new StepResult(kw ? 'success' : 'failed', kw, error, retries);
          if (kw) {
            lockedPrint(`  [${result.stem}] ${c('green', 'AI analysis done')} (${kw.length} chars)`);
          } else {
            lockedPrint(`  [${result.stem}] ${c('red', 'AI analysis failed')}: ${error}`);
          }
        } catch (e) {
          result.analyze = new StepResult('failed', null, String(e.message).slice(0, 500), maxRetries);
        }
      } else {
        result.analyze = new StepResult('skipped', null, 'content empty');
      }
    } else {
      result.analyze = new StepResult('skipped');
    }
  } else if (steps.includes('analyze') && result.transcribe.status !== 'success') {
    result.analyze = new StepResult('skipped', null, 'transcribe not successful, skip AI analysis');
  }

  if (result.overall_status === 'pending') {
    result.overall_status = 'success';
  }

  return result;
}

// ============================== 主控流程 ==============================
// ═══════════════════════════════════════════════════════════════════
// 本地文件流水线（--input 模式）
// ═══════════════════════════════════════════════════════════════════

/**
 * 验证本地视频文件，检测可执行步骤
 * 返回 { valid, format, hasVideo, hasAudio, videoCodec, audioCodec,
 *         duration, width, height, errors, feasibleSteps }
 */
function validateInputFile(filePath) {
  const result = {
    valid: false, format: '', hasVideo: false, hasAudio: false,
    videoCodec: '', audioCodec: '', duration: 0, width: 0, height: 0,
    errors: [], feasibleSteps: [],
  };

  // 1. 文件存在性
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    result.errors.push('文件不存在');
    return result;
  }
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    result.errors.push('不是一个文件');
    return result;
  }
  if (stat.size === 0) {
    result.errors.push('文件大小为 0');
    return result;
  }

  // 2. ffprobe 分析
  if (!which(FFPROBE)) {
    result.errors.push(`ffprobe 不可用 (${FFPROBE})`);
    result.valid = true; // 文件本身有效，但无法探测流信息
    result.feasibleSteps = ['transcode', 'transcribe', 'analyze']; // 乐观推测
    return result;
  }

  try {
    const probeRaw = execSync(
      `${FFPROBE} -v error -show_entries stream=codec_type,codec_name,width,height -show_entries format=format_name,duration -of json "${absPath}"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    const info = JSON.parse(probeRaw);

    // 提取 format 信息
    if (info.format) {
      result.format = (info.format.format_name || '').split(',')[0];
      result.duration = parseFloat(info.format.duration || '0');
    }

    // 提取 stream 信息
    if (info.streams) {
      for (const s of info.streams) {
        if (s.codec_type === 'video') {
          result.hasVideo = true;
          result.videoCodec = s.codec_name || '';
          result.width = s.width || 0;
          result.height = s.height || 0;
        }
        if (s.codec_type === 'audio') {
          result.hasAudio = true;
          result.audioCodec = s.codec_name || '';
        }
      }
    }

    result.valid = true;

    // 3. 判断可执行步骤
    if (result.hasVideo) {
      result.feasibleSteps.push('transcode');
    }
    if (result.hasAudio) {
      result.feasibleSteps.push('transcribe', 'analyze');
    }
    // 无视频无音频 → 所有步骤不可行
    if (!result.hasVideo && !result.hasAudio) {
      result.feasibleSteps = [];
      result.errors.push('文件不包含视频或音频流，无法处理');
    }

    // 如果只有视频没有音频：只能转码
    if (result.hasVideo && !result.hasAudio) {
      result.errors.push('文件不含音频轨道，将跳过语音识别和 AI 分析');
    }

  } catch (e) {
    result.errors.push(`ffprobe 解析失败: ${(e.stderr || e.message || '').slice(0, 200)}`);
    result.valid = true; // 文件存在且不为空，让 ffmpeg 自行判断
    result.feasibleSteps = ['transcode', 'transcribe', 'analyze'];
  }

  return result;
}

/**
 * 处理 --input 模式下的文件冲突（已存在的转码/识别结果）
 * @param {string} proposedPath - 即将生成的输出文件路径
 * @returns {Promise<{action: 'overwrite'|'skip', path: string}>}
 */
async function resolveInputConflict(proposedPath) {
  if (!fs.existsSync(proposedPath)) {
    return { action: 'overwrite', path: proposedPath };
  }
  const size = (fs.statSync(proposedPath).size / 1024 / 1024).toFixed(1);
  console.log(`\n⚠️  文件已存在: ${proposedPath} (${size} MB)`);
  const choice = await select({
    message: '如何处理已有文件?',
    choices: [
      { name: '覆盖已有文件 (overwrite)', value: 'overwrite', description: '删除现有文件，重新生成' },
      { name: '跳过此步骤 (skip)', value: 'skip', description: '保留现有文件，不重新处理' },
    ],
  });
  return { action: choice, path: proposedPath };
}

/**
 * --input 模式的独立流水线
 * 不通过 processOneTask（因为它依赖 findDownloadedFile 从 DOWNLOADS_DIR 找文件），
 * 直接串联 step 函数，保证输入文件路径准确传递。
 */
async function runInputTask(opts) {
  const {
    inputPath, stem, sheetName, steps,
    maxRetries, retryDelay, force,
    transcodeTimeout, transcribeTimeout, analyzeTimeout,
    whisperAvailable, fileInfo,
  } = opts;

  console.log(styleSection(`开始处理: ${usedStem}`));

  // ── 解决 stem 重名 ──
  let usedStem = stem;
  {
    let counter = 1;
    const tcDir = path.join(TRANSCODED_DIR, sheetName);
    fs.mkdirSync(tcDir, { recursive: true });
    let testPath = path.join(tcDir, usedStem + TRANSCODE_EXT);
    while (fs.existsSync(testPath) && !steps.includes('transcode')) {
      // 跳过转码但转码产物已存在 → 直接用
      break;
    }
    if (steps.includes('transcode') && !force) {
      while (fs.existsSync(testPath)) {
        usedStem = `${stem}_${counter}`;
        testPath = path.join(tcDir, usedStem + TRANSCODE_EXT);
        counter++;
      }
    }
  }
  if (usedStem !== stem) {
    lockedPrint(styleWarn(`stem "${stem}" 已存在 → 使用 "${usedStem}"`));
  }

  // ── 构建 TaskResult ──
  const result = new TaskResult(sheetName, usedStem, path.basename(inputPath), 'local', null, usedStem);
  result.download = new StepResult('skipped');

  // ── download: 跳过（本地文件）──
  lockedPrint(styleSkip(`[${usedStem}] 下载: 已跳过 (本地文件)`));

  // ── transcode ──
  let tcFile = null;
  if (steps.includes('transcode')) {
    logStep(`[${usedStem}] 开始转码...`);
    try {
      const { file, error } = await stepTranscode(inputPath, sheetName, maxRetries, retryDelay, force, transcodeTimeout);
      tcFile = file;
      if (file && fs.existsSync(file)) {
        const size = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
        lockedPrint(styleDone(`[${usedStem}] 转码完成: ${path.basename(file)} (${size} MB)`));
        result.transcode = new StepResult('success', file);
      } else {
        lockedPrint(styleWarn(`[${usedStem}] 转码: ${file ? '已跳过 (文件已存在)' : '失败 — ' + (error || '')}`));
        result.transcode = new StepResult(file ? 'skipped' : 'failed', file, error);
      }
    } catch (e) {
      lockedPrint(styleFail(`[${usedStem}] 转码异常: ${(e.message || '').slice(0, 200)}`));
      result.transcode = new StepResult('failed', null, String(e.message).slice(0, 500));
    }
    if (!tcFile) {
      lockedPrint(styleFail(`\n[${usedStem}] 转码未产出文件，后续步骤将跳过`));
      result.overall_status = 'failed';
      result.error = 'transcode failed';
      return result;
    }
  } else if (steps.includes('transcribe')) {
    const tcDir = path.join(TRANSCODED_DIR, sheetName);
    const expectedTc = path.join(tcDir, usedStem + TRANSCODE_EXT);
    if (fs.existsSync(expectedTc)) {
      tcFile = expectedTc;
      result.transcode = new StepResult('success', tcFile);
      lockedPrint(styleInfo(`使用已有转码文件: ${path.basename(expectedTc)}`));
    } else {
      lockedPrint(styleWarn(`未找到转码文件，将尝试用原始文件识别（可能失败）`));
      tcFile = inputPath;
      result.transcode = new StepResult('warning', inputPath, 'transcode file not found, using raw input');
    }
  } else {
    tcFile = inputPath;
    result.transcode = new StepResult('success', inputPath);
  }

  // ── transcribe ──
  let transcribeText = '';
  if (steps.includes('transcribe') && tcFile) {
    if (!whisperAvailable) {
      lockedPrint(styleFail(`[${usedStem}] whisper 不可用，跳过识别`));
      result.transcribe = new StepResult('failed', null, 'whisper unreachable');
      result.overall_status = 'failed';
      result.error = 'whisper unreachable';
      return result;
    } else {
      // stepTranscribe 内部已经有日志输出
      try {
        const { text, error } = await stepTranscribe(tcFile, maxRetries, retryDelay, transcribeTimeout);
        if (text && typeof text === 'string') {
          transcribeText = text;
          // 日志已在 stepTranscribe 中输出
          result.transcribe = new StepResult('success', text);
        } else {
          lockedPrint(styleFail(`[${usedStem}] 识别失败: ${(error || '').slice(0, 200)}`));
          result.transcribe = new StepResult('failed', null, error);
        }
      } catch (e) {
        lockedPrint(styleFail(`[${usedStem}] 识别异常: ${(e.message || '').slice(0, 200)}`));
        result.transcribe = new StepResult('failed', null, String(e.message).slice(0, 500));
      }
    }
  } else {
    result.transcribe = new StepResult('skipped');
  }

  // ── AI analyze ──
  let analyzeText = '';
  if (steps.includes('analyze') && transcribeText) {
    const aiEnabled = (process.env.AI_ENABLED || 'true').toLowerCase() === 'true';
    if (aiEnabled) {
      logStep(`[${usedStem}] 开始 AI 分析...`);
      try {
        const { text: kw, error } = await stepAnalyze(transcribeText, maxRetries, retryDelay, analyzeTimeout, usedStem);
        if (kw && typeof kw === 'string') {
          analyzeText = kw;
          lockedPrint(styleDone(`[${usedStem}] AI 分析完成: ${kw.length} 字符`));
          result.analyze = new StepResult('success', kw);
        } else {
          lockedPrint(styleFail(`[${usedStem}] AI 分析失败: ${(error || '').slice(0, 200)}`));
          result.analyze = new StepResult('failed', null, error);
        }
      } catch (e) {
        lockedPrint(styleFail(`[${usedStem}] AI 分析异常: ${(e.message || '').slice(0, 200)}`));
        result.analyze = new StepResult('failed', null, String(e.message).slice(0, 500));
      }
    } else {
      lockedPrint(styleWarn(`[${usedStem}] AI 分析已禁用 (AI_ENABLED=false)`));
      result.analyze = new StepResult('skipped');
    }
  } else {
    result.analyze = new StepResult('skipped');
  }

  // ── 判定整体状态 ──
  if (result.transcode.status === 'failed') {
    result.overall_status = 'failed';
  } else if (result.transcribe.status === 'failed' && steps.includes('transcribe')) {
    result.overall_status = 'partial';
  } else if (result.analyze.status === 'failed') {
    result.overall_status = 'partial';
  } else {
    result.overall_status = 'success';
  }

  // ── 保存文本结果 ──
  if (transcribeText || analyzeText) {
    const outDir = path.join(REPORTS_DIR, sheetName, 'tasks');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${usedStem}.txt`);
    const lines = [
      `文件: ${inputPath}`,
      `平台: local`,
      `文件格式: ${fileInfo.format || 'unknown'}`,
      `时长: ${fileInfo.duration ? fileInfo.duration.toFixed(1) + 's' : 'unknown'}`,
      '', '='.repeat(60), '',
    ];
    if (transcribeText) {
      lines.push('【语音识别内容】', '', transcribeText, '');
    }
    if (analyzeText) {
      lines.push('【AI 分析关键词】', '', analyzeText);
    }
    fs.writeFileSync(outFile, lines.join('\n'), 'utf-8');
    console.log(`\n  ${c('cyan', '报告已保存:')} ${outFile}`);
  }

  // ── 总结 ──
  console.log('');
  const success = [];
  if (tcFile) success.push('transcode');
  if (transcribeText) success.push('transcribe');
  if (analyzeText) success.push('analyze');
  const failed = steps.filter(s => s !== 'download' && !success.includes(s));
  if (failed.length === 0) {
    console.log(c('green', '✅ 全部步骤执行成功'));
  } else {
    console.log(c('yellow', `⚠️  ${failed.length} 个步骤未成功: ${failed.join(', ')}`));
  }
  console.log('');

  return result;
}


// ═══════════════════════════════════════════════════════════════════
// 文本内容流水线（--content 模式）
// ═══════════════════════════════════════════════════════════════════

/**
 * --content 模式：纯文本 → AI 关键词提取
 * 文本来源可以是文件路径或内联文本，
 * --name 可指定输出文件名（不含扩展名）。
 * 不指定时：文件路径取 stem，内联文本取前 32 字符。
 */
async function runContentTask(opts) {
  const { content, name, steps, force,
    retry: maxRetries, retryDelay, analyzeTimeout } = opts;

  // ── 1. 读取/确定文本 ──
  const contentPath = path.resolve(content);
  let contentText = '';
  let fromFile = false;
  if (fs.existsSync(contentPath) && fs.statSync(contentPath).isFile()) {
    contentText = fs.readFileSync(contentPath, 'utf-8').trim();
    fromFile = true;
    console.log(`  ${c('dim', '从文件读取:')} ${contentPath} (${contentText.length} 字符)`);
  } else {
    contentText = content;
  }

  if (!contentText || !contentText.trim()) {
    console.error(c('red', '错误: --content 文本内容为空'));
    process.exit(1);
  }

  // ── 2. 确定输出文件名 ──
  let stem = '';
  if (name) {
    stem = safeFilename(name);
  } else if (fromFile) {
    stem = safeFilename(path.parse(contentPath).name);
  } else {
    stem = safeFilename(contentText.replace(/\s+/g, ' ').slice(0, 32).trim());
  }

  if (steps.length === 0) steps = ['analyze'];

  console.log(c('dim', '\n── 开始执行 (内容分析) ──\n'));
  console.log(`  输出名称:  ${c('cyan', stem)}`);
  console.log(`  内容长度:  ${c('cyan', contentText.length + ' 字符')}`);
  console.log(`  执行步骤:  ${c('cyan', steps.join(' → '))}`);

  if (opts.dryRun) {
    console.log('');
    process.exit(0);
  }

  const sheetName = 'content';

  // ── 3. 构建 TaskResult ──
  const result = new TaskResult(sheetName, stem, stem.slice(0, 50), 'local', null, stem);
  result.download = new StepResult('skipped');
  result.transcode = new StepResult('skipped');
  result.transcribe = new StepResult('success', contentText);

  // ── 4. AI 分析 ──
  if (steps.includes('analyze')) {
    const aiEnabled = (process.env.AI_ENABLED || 'true').toLowerCase() === 'true';
    if (!aiEnabled) {
      result.analyze = new StepResult('skipped');
      lockedPrint(styleWarn(`[${stem}] AI 分析已禁用 (AI_ENABLED=false)`));
    } else {
      logStep(`[${stem}] 开始 AI 分析...`);
      try {
        const { text: kw, retries, error } = await stepAnalyze(
          contentText, maxRetries, retryDelay, analyzeTimeout, stem
        );
        result.analyze = new StepResult(kw ? 'success' : 'failed', kw, error, retries);
        if (kw) {
          lockedPrint(styleDone(`[${stem}] AI 分析完成 (${kw.length} 字符)`));
        } else {
          lockedPrint(styleFail(`[${stem}] AI 分析失败: ${error}`));
        }
      } catch (e) {
        result.analyze = new StepResult('failed', null, String(e.message).slice(0, 500), maxRetries);
        lockedPrint(styleFail(`[${stem}] AI 分析异常: ${(e.message || '').slice(0, 200)}`));
      }
    }
  }

  result.overall_status = (result.analyze && result.analyze.status === 'success') ? 'success' : 'partial';

  // ── 5. 保存文本结果 ──
  const an = result.analyze;
  const analyzeText = an && an.file && an.status === 'success' ? an.file : '';
  if (contentText || analyzeText) {
    const outDir = path.join(REPORTS_DIR, sheetName, 'tasks');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${stem}.txt`);
    const lines = [
      `来源: --content`,
      `文件名: ${stem}`,
      '', '='.repeat(60), '',
      '【源内容】', '', contentText, '',
    ];
    if (analyzeText) {
      lines.push('【AI 分析关键词】', '', analyzeText);
    }
    fs.writeFileSync(outFile, lines.join('\n'), 'utf-8');
    lockedPrint(c('cyan', `\n  报告已保存: ${outFile}`));
  }

  // ── 6. 生成标准报告 JSON ──
  const config = { steps, max_retries: maxRetries, retry_delay: retryDelay, concurrency: 1, force: force || false };
  generateReport([result], config, sheetName);
  printReportSummary([result]);

  console.log('');
  return result;
}


// ═══════════════════════════════════════════════════════════════════
// URL 直链流水线（--url 模式）
// ═══════════════════════════════════════════════════════════════════

async function runUrlTask(opts) {
  const {
    watchUrl, platform, pkey, videoId, stem, dlDir, steps,
    maxRetries, retryDelay, force,
    downloadTimeout, transcodeTimeout, transcribeTimeout, analyzeTimeout,
    whisperAvailable,
  } = opts;

  const sheetName = platform;
  const platformField = PLATFORM_CONFIG[pkey]?.field || '';

  // 构建合成 row（模拟 Excel 行结构）
  const syntheticRow = { _stemCache: {} };
  syntheticRow._stemCache[sheetName] = stem;
  if (platformField) syntheticRow[platformField] = videoId;
  if (COL_ID) syntheticRow[COL_ID] = videoId;
  if (COL_TITLE) syntheticRow[COL_TITLE] = videoId;

  console.log(c('dim', '\n── 开始执行 ──\n'));

  const result = await processOneTask(
    syntheticRow, sheetName, steps, maxRetries, retryDelay, force,
    whisperAvailable, '', downloadTimeout, transcodeTimeout,
    transcribeTimeout, analyzeTimeout,
  );

  // ── 展示结果 ──
  console.log(c('dim', '\n── 结果 ──\n'));
  const successes = [];

  if (result.download) {
    if (result.download.file && fs.existsSync(result.download.file)) {
      const size = (fs.statSync(result.download.file).size / 1024 / 1024).toFixed(1) + ' MB';
      console.log(`  \uD83D\uDCE5 下载: ${c('green', result.download.file)} (${size})`);
      successes.push('download');
    } else if (result.download.status === 'skipped') {
      console.log(`  \uD83D\uDCE5 下载: ${c('yellow', '已跳过 (文件已存在)')}`);
      successes.push('download');
    } else {
      console.log(`  \uD83D\uDCE5 下载: ${c('red', '失败')} — ${result.download.error || ''}`);
    }
  }

  if (result.transcode) {
    if (result.transcode.file && fs.existsSync(result.transcode.file)) {
      const size = (fs.statSync(result.transcode.file).size / 1024 / 1024).toFixed(1) + ' MB';
      console.log(`  \uD83C\uDFB5 转码: ${c('green', result.transcode.file)} (${size})`);
      successes.push('transcode');
    } else if (result.transcode.status === 'skipped') {
      console.log(`  \uD83C\uDFB5 转码: ${c('yellow', '已跳过 (文件已存在)')}`);
      successes.push('transcode');
    } else {
      console.log(`  \uD83C\uDFB5 转码: ${c('red', '失败')} — ${result.transcode.error || ''}`);
    }
  }

  if (result.transcribe) {
    // transcribe 的 file 字段存放的是文本内容
    const text = result.transcribe.file;
    if (text && typeof text === 'string') {
      console.log(`  \uD83D\uDCDD 识别: ${c('green', text.length + ' \u5B57\u7B26')}`);
      successes.push('transcribe');
    } else if (result.transcribe.status === 'skipped') {
      console.log(`  \uD83D\uDCDD 识别: ${c('yellow', '已跳过')}`);
      successes.push('transcribe');
    } else {
      console.log(`  \uD83D\uDCDD 识别: ${c('red', '失败')} — ${result.transcribe.error || ''}`);
    }
  }

  if (result.analyze) {
    // analyze 的 file 字段存放的是关键词文本
    const text = result.analyze.file;
    if (text && typeof text === 'string') {
      console.log(`  \uD83E\uDD16 AI\u5206\u6790: ${c('green', text.length + ' \u5B57\u7B26')}`);
      successes.push('analyze');
    } else if (result.analyze.status === 'skipped') {
      console.log(`  \uD83E\uDD16 AI\u5206\u6790: ${c('yellow', '已跳过')}`);
    } else {
      console.log(`  \uD83E\uDD16 AI\u5206\u6790: ${c('red', '失败')} — ${result.analyze.error || ''}`);
    }
  }

  // 保存文本结果
  const transcribeText = (result.transcribe && typeof result.transcribe.file === 'string') ? result.transcribe.file : '';
  const analyzeText = (result.analyze && typeof result.analyze.file === 'string') ? result.analyze.file : '';

  if (transcribeText || analyzeText) {
    const outDir = path.join(REPORTS_DIR, platform, 'tasks');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${stem}.txt`);
    const lines = [
      `URL: ${watchUrl}`,
      `\u5E73\u53F0: ${platform}`,
      `\u89C6\u9891ID: ${videoId}`,
      '', '='.repeat(60), '',
    ];
    if (transcribeText) {
      lines.push('\u3010\u8BED\u97F3\u8BC6\u522B\u5185\u5BB9\u3011', '', transcribeText, '');
    }
    if (analyzeText) {
      lines.push('\u3010AI\u5173\u952E\u8BCD\u5206\u6790\u3011', '', analyzeText, '');
    }
    fs.writeFileSync(outFile, lines.join('\n'), 'utf-8');
    console.log(`\n  \uD83D\uDCC4 \u7ED3\u679C\u5DF2\u4FDD\u5B58\u81F3: ${c('cyan', outFile)}`);
  }

  console.log(c('bold', c('green', `\n\uD83C\uDF89 \u5168\u90E8\u5B8C\u6210! (${successes.length}/${steps.length} \u6B65\u6210\u529F)\n`)));
  return result;
}

async function run({
  targetSheet, targetId, contentColumn, steps, maxRetries, retryDelay,
  concurrency, force, dryRun, retryFailed,
  downloadTimeout, transcodeTimeout, transcribeTimeout, analyzeTimeout,
  offset = 0, rowLimit = 0,
}) {
  // ── 重跑失败模式 ──
  if (retryFailed) {
    return runFromReport(retryFailed, steps, maxRetries, retryDelay, concurrency, force, dryRun,
      downloadTimeout, transcodeTimeout, transcribeTimeout, analyzeTimeout);
  }

  // ── 构建任务列表 ──
  const sheets = targetSheet ? [targetSheet] : VIDEO_SHEETS;
  let tasks = [];
  for (const sheetName of sheets) {
    let rows = readExcelSheet(sheetName);
    if (targetId) {
      rows = rows.filter(row => {
        if (row[COL_ID] != null) {
          try {
            if (String(Math.floor(Number(row[COL_ID]))) === String(targetId)) return true;
          } catch { }
        }
        if (String(row[COL_TITLE]) === String(targetId)) return true;
        return false;
      });
      if (!rows.length) {
        logError(`Sheet [${sheetName}] no match for id/title = ${targetId}`);
        continue;
      }
    }
    precomputeStems(rows, sheetName);
    for (const row of rows) {
      // ── content-column 模式：从指定列读取预置文本 ──
      if (contentColumn) {
        const text = String(row[contentColumn] || '').trim();
        if (!text) {
          logWarn(`[${sheetName}] row ${row[COL_ID] || '?'}: contentColumn "${contentColumn}" 为空，跳过`);
          continue;
        }
        row.preContent = text;
      }
      tasks.push({ row, sheetName });
    }
  }

  // ── 偏移/限量（全局，跨 sheet） ──
  if (offset > 0 || rowLimit > 0) {
    const start = offset;
    const end = rowLimit > 0 ? start + rowLimit : undefined;
    const originalLen = tasks.length;
    tasks = tasks.slice(start, end);
    logInfo(`applied offset=${start}, limit=${rowLimit || 'all'} → tasks: ${originalLen} → ${tasks.length}`);
  }

  logInfo(`tasks: ${tasks.length}, concurrency: ${concurrency}, max retries: ${maxRetries}`);

  const envCheck = await checkEnvironmentAsync(steps);
  if (!await checkAndConfirmEnv(envCheck, dryRun, '是否继续执行？')) return;

  // ── 干跑模式 ──
  if (dryRun) {
    printDryRun(tasks, steps, envCheck);
    return;
  }

  // ── 检测 whisper ──
  let whisperAvailable = false;
  if (steps.includes('transcribe')) {
    whisperAvailable = await checkWhisperAvailable();
    if (!whisperAvailable) {
      const backend = WHISPER_BACKEND === 'local' ? 'local CLI' : WHISPER_SERVICE;
      logWarn(`⚠️ whisper not available (${backend}), transcribe step will fail`);
    }
  }

  // ── 并发执行 ──
  const results = [];
  const overall = new OverallProgress(tasks.length);
  const limit = pLimit(Math.max(1, concurrency));

  const taskFns = tasks.map(({ row, sheetName }, idx) =>
    limit(async () => {
      const posLabel = `[${idx + 1}/${tasks.length}]`;
      let result;
      try {
        result = await processOneTask(row, sheetName, steps, maxRetries, retryDelay, force,
          whisperAvailable, posLabel, downloadTimeout, transcodeTimeout, transcribeTimeout, analyzeTimeout);
      } catch (e) {
        const stem = stemName(row, sheetName);
        logError(`[${stem}] unhandled error: ${e.message}`);
        result = new TaskResult(sheetName, rowKey(row), String(row[COL_TITLE] || ''), null, null, stem);
        result.overall_status = 'failed';
        result.error = `unhandled error: ${String(e.message).slice(0, 500)}`;
      }
      results.push(result);
      overall.addResult(result.overall_status);
      lockedPrint('');
      lockedPrint(c('dim', '─'.repeat(62)));
      console.log(`\n${overall.summaryLine()}\n`);
      return result;
    })
  );

  await Promise.all(taskFns);

  // ── 批量写回 Excel ──
  if (steps.includes('transcribe') || contentColumn) {
    const kwMap = new Map();
    for (const r of results) {
      if (r.analyze.status === 'success' && r.analyze.file) {
        kwMap.set(`${r.sheet}|${r.id_val}`, r.analyze.file);
      }
    }
    writeAllContentsToExcel(results, kwMap.size ? kwMap : null);
  }

  // ── 生成报告 ──
  const config = {
    sheets, target_id: targetId, steps, max_retries: maxRetries,
    retry_delay: retryDelay, concurrency, force,
  };
  const reportPaths = generateReport(results, config);
  printReportSummary(results);

  logInfo(`all done! reports: ${Array.isArray(reportPaths) ? reportPaths.join(', ') : reportPaths}`);
}

function printDryRun(tasks, steps, env) {
  console.log(styleSection(`干跑模式 - 任务清单 (${tasks.length} 条)`));

  // 环境检测
  console.log(`\n  ${c('bold', '环境检测:')}`);
  if (steps.includes('download')) {
    console.log(`  ${env.ytdlp ? c('green', '✅ yt-dlp') : c('red', '❌ yt-dlp')}: ${YTDLP}`);
  } else {
    console.log(`  ${c('dim', '⏭ yt-dlp: 未启用（步骤不含 download）')}`);
  }
  if (steps.includes('transcode')) {
    console.log(`  ${env.ffmpeg ? c('green', '✅ ffmpeg') : c('red', '❌ ffmpeg')}: ${FFMPEG}`);
    console.log(`  ${env.ffprobe ? c('green', '✅ ffprobe') : c('red', '❌ ffprobe')}: ${FFPROBE}`);
  } else {
    console.log(`  ${c('dim', '⏭ ffmpeg/ffprobe: 未启用（步骤不含 transcode）')}`);
  }
  if (steps.includes('transcribe')) {
    const backend = WHISPER_BACKEND === 'local' ? 'local CLI' : `service ${WHISPER_SERVICE}`;
    console.log(`  ${env.whisper ? c('green', `✅ whisper (${backend})`) : c('red', `❌ whisper (${backend})`)}`);
  } else {
    console.log(`  ${c('dim', '⏭ whisper: 未启用（步骤不含 transcribe）')}`);
  }
  if (steps.includes('analyze')) {
    const aiModel = process.env.AI_MODEL || '';
    console.log(`  ${env.ai ? c('green', `✅ AI分析 (${aiModel}): 配置完整`) : c('red', `❌ AI分析: ${env.issues[env.issues.length - 1] || ''}`)}`);
  } else {
    console.log(`  ${c('dim', '⏭ AI分析: 未启用（步骤不含 analyze）')}`);
  }

  // 任务列表
  console.log(`\n  ${c('bold', '任务步骤状态:')}`);
  for (let i = 0; i < tasks.length; i++) {
    const { row, sheetName } = tasks[i];
    const { pkey, vid } = getVideoId(row);
    const stem = stemName(row, sheetName);
    const url = pkey ? buildUrl(pkey, vid) : 'N/A';

    const dlPath = path.join(DOWNLOADS_DIR, sheetName, `${stem}.mp4`);
    const tcPath = path.join(TRANSCODED_DIR, sheetName, `${stem}${TRANSCODE_EXT}`);
    const dlExists = fs.existsSync(dlPath);
    const tcExists = fs.existsSync(tcPath);

    const contentVal = row[COL_CONTENT];
    const contentFilled = contentVal != null && String(contentVal).trim() !== '';
    const keywordsVal = row[COL_KEYWORDS];
    const keywordsFilled = keywordsVal != null && String(keywordsVal).trim() !== '';

    console.log(`\n  ${styleProgress(i + 1, tasks.length)} [${c('cyan', sheetName)}] ${c('bold', stem)}`);
    console.log(`     ${c('dim', `platform=${pkey}`)}`);

    if (!pkey) {
      console.log(`     ${styleFail('无可用视频 ID')}`);
      continue;
    }

    if (steps.includes('download')) {
      let status;
      if (dlExists) status = c('yellow', '[跳过-已有文件]');
      else if (!env.ytdlp) status = c('red', '[不可用-yt-dlp]');
      else status = c('green', '[待执行]');
      console.log(`      ${c('bold', 'download')} : ${status}`);
    }
    if (steps.includes('transcode')) {
      let status;
      if (tcExists) status = c('yellow', '[跳过-已有文件]');
      else if (!env.ffmpeg) status = c('red', '[不可用-ffmpeg]');
      else if (!dlExists) status = c('yellow', '[等待-需先下载]');
      else status = c('green', '[待执行]');
      console.log(`      ${c('bold', 'transcode')}: ${status}`);
    }
    if (steps.includes('transcribe')) {
      let status;
      if (contentFilled) status = c('yellow', `[跳过-content已有${String(contentVal).length}字符]`);
      else if (!env.whisper) status = c('red', '[不可用-whisper]');
      else if (!tcExists) status = c('yellow', '[等待-需先转码]');
      else status = c('green', '[待执行]');
      console.log(`      ${c('bold', 'transcribe')}: ${status}`);
    }
    if (steps.includes('analyze')) {
      let status;
      if (keywordsFilled) status = c('yellow', `[跳过-keywords已有${String(keywordsVal).length}字符]`);
      else if (!env.ai) status = c('red', '[不可用-AI未配置]');
      else if (!contentFilled && !tcExists) status = c('yellow', '[等待-需先识别]');
      else status = c('green', '[待执行]');
      console.log(`      ${c('bold', 'analyze')}  : ${status}`);
    }
  }
}

async function runFromReport(reportPath, steps, maxRetries, retryDelay, concurrency, force, dryRun,
  downloadTimeout, transcodeTimeout, transcribeTimeout, analyzeTimeout) {

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const failedItems = report.failed_items || [];
  if (!failedItems.length) {
    logInfo('no failed items in report');
    return;
  }
  logInfo(`loaded ${failedItems.length} failed items from report`);

  const tasks = [];
  for (const item of failedItems) {
    const sheetName = item.sheet;
    const key = String(item.id);
    const rows = readExcelSheet(sheetName);
    const matched = rows.filter(row => {
      if (row[COL_ID] != null) {
        try {
          if (String(Math.floor(Number(row[COL_ID]))) === key) return true;
        } catch { }
      }
      if (String(row[COL_TITLE]) === key) return true;
      return false;
    });
    if (!matched.length) {
      logWarn(`[${sheetName}] not found ${key}, skip`);
      continue;
    }
    // Precompute stems
    precomputeStems(rows, sheetName);
    tasks.push({ row: matched[0], sheetName });
  }

  if (!tasks.length) {
    logInfo('no valid items to retry');
    return;
  }

  if (dryRun) {
    console.log(`\n  干跑模式 - 重跑 ${tasks.length} 条失败项`);
    for (let i = 0; i < tasks.length; i++) {
      const { row, sheetName } = tasks[i];
      const { pkey, vid } = getVideoId(row);
      const stem = stemName(row, sheetName);
      const url = pkey ? buildUrl(pkey, vid) : 'N/A';
      console.log(`  ${i + 1}. [${sheetName}] ${stem}  platform=${pkey}  url=${url}`);
    }
    return;
  }

  const envRfr = await checkEnvironmentAsync(steps);
  if (!await checkAndConfirmEnv(envRfr, dryRun, '是否继续重跑？')) return;

  let whisperAvailable = false;
  if (steps.includes('transcribe')) {
    whisperAvailable = await checkWhisperAvailable();
  }

  const results = [];
  const overall = new OverallProgress(tasks.length);
  const limit = pLimit(Math.max(1, concurrency));

  const taskFns = tasks.map(({ row, sheetName }, idx) =>
    limit(async () => {
      const posLabel = `[${idx + 1}/${tasks.length}]`;
      let result;
      try {
        result = await processOneTask(row, sheetName, steps, maxRetries, retryDelay, force,
          whisperAvailable, posLabel, downloadTimeout, transcodeTimeout, transcribeTimeout, analyzeTimeout);
      } catch (e) {
        const stem = stemName(row, sheetName);
        logError(`[${stem}] unhandled error: ${e.message}`);
        result = new TaskResult(sheetName, rowKey(row), String(row[COL_TITLE] || ''), null, null, stem);
        result.overall_status = 'failed';
        result.error = `unhandled: ${String(e.message).slice(0, 500)}`;
      }
      results.push(result);
      overall.addResult(result.overall_status);
      lockedPrint('');
      lockedPrint(c('dim', '─'.repeat(62)));
      console.log(`\n${overall.summaryLine()}\n`);
      return result;
    })
  );

  await Promise.all(taskFns);

  if (steps.includes('transcribe')) {
    const kwMap = new Map();
    for (const r of results) {
      if (r.analyze.status === 'success' && r.analyze.file) {
        kwMap.set(`${r.sheet}|${r.id_val}`, r.analyze.file);
      }
    }
    writeAllContentsToExcel(results, kwMap.size ? kwMap : null);
  }

  const config = { retry_from: reportPath, steps, max_retries: maxRetries,
    retry_delay: retryDelay, concurrency, force };
  const reportPaths = generateReport(results, config);
  printReportSummary(results);
  logInfo(`all done! reports: ${Array.isArray(reportPaths) ? reportPaths.join(', ') : reportPaths}`);
}

// ============================== CLI ==============================
if (process.argv[1] === __filename || process.argv[1]?.endsWith('process_videos.js')) {
  program
    .name('process_videos')
    .description('视频下载、转码、文本识别、AI分析一体化流程')
    .option('--sheet <name>', '指定 sheet 名称')
    .option('--id <id>', '指定 extra.id 或 title（单条测试）')
    .option('--offset <n>', '跳过前 N 条任务（从 0 开始），默认 0', v => parseInt(v, 10), 0)
    .option('--limit <n>', '最多处理 N 条任务，默认无限制', v => parseInt(v, 10), 0)
    .option('--step <step>', '指定执行步骤（可多次指定），如 --step transcode --step transcribe', (val, prev) => {
      const allowed = ['download', 'transcode', 'transcribe', 'analyze'];
      if (!allowed.includes(val)) {
        console.error(`Invalid step: ${val}. Must be one of: ${allowed.join(', ')}`);
        process.exit(1);
      }
      return [...(prev || []), val];
    })
    .option('--force', '强制重做下载+转码（忽略已有文件）')
    .option('--concurrency <n>', '并发数，默认 1', v => parseInt(v, 10), 1)
    .option('--retry <n>', '每步失败最大重试次数，默认 0', v => parseInt(v, 10), 0)
    .option('--retry-delay <n>', '重试间隔基数（秒），默认 5', v => parseFloat(v), 5.0)
    .option('--download-timeout <n>', '下载超时（秒），默认 600', v => parseInt(v, 10), 600)
    .option('--transcode-timeout <n>', '转码超时（秒），默认 600', v => parseInt(v, 10), 600)
    .option('--transcribe-timeout <n>', '识别超时（秒），默认 600', v => parseInt(v, 10), 600)
    .option('--analyze-timeout <n>', 'AI 分析超时（秒），默认 300', v => parseInt(v, 10), 300)
    .option('--dry-run', '干跑模式，只列任务不执行')
    .option('--retry-failed <path>', '从报告 JSON 重跑失败项（output/reports/{sheet}/report_xxx.json）')
    .option('--init', '复制 .env.example 到当前目录并重命名为 .env')
    .option('--file <path>', '指定 Excel 文件路径（优先级高于 EXCEL_FILE 环境变量）')
    .option('--input <path>', '指定本地视频文件路径（跳过下载，直接转码→识别→分析）')
    .option('--content <text|path>', '直接提供文本内容（文件路径或内联文本），跳过下载/转码/识别，直接做 AI 分析')
    .option('--content-column <col>', 'Excel 模式：指定包含已爬取文本的列名，批量做 AI 分析')
    .option('--url <url>', '直接指定视频下载链接（跳过 Excel），支持标准链接和内嵌链接')
    .option('--name <name>', '指定输出文件名，不含扩展名（与 --url / --input / --content 配合使用）')
    .option('--env-file <path>', '指定要加载的 .env 文件路径（默认: 当前目录 .env）');

  program.parse();

  const opts = program.opts();

  // ── init 模式 ──
  if (opts.init) {
    const src = path.resolve(__dirname, '.env.example');
    if (!fs.existsSync(src)) {
      console.error(`错误: 找不到 ${src}`);
      process.exit(1);
    }
    let dest = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(dest)) {
      console.log(`\n⚠️  目标文件已存在: ${dest}`);
      const choice = await select({
        message: '如何处理冲突?',
        choices: [
          { name: '覆盖 (overwrite)', value: 'overwrite', description: '用 .env.example 覆盖现有 .env 文件' },
          { name: '保留现有 (keep existing)', value: 'keep', description: '不做任何修改，保留当前 .env' },
          { name: '自定义文件名 (custom name)', value: 'custom', description: '使用自定义文件名创建 .env' },
        ],
      });
      if (choice === 'overwrite') {
        fs.copyFileSync(src, dest);
        console.log(`✅ .env 已覆盖: ${dest}`);
      } else if (choice === 'custom') {
        const customName = await input({
          message: '请输入新文件名',
          default: '.env.prod',
          validate(val) {
            return val ? true : '文件名不能为空';
          },
        });
        if (!customName) {
          console.log('未输入文件名，已取消。');
          process.exit(0);
        }
        dest = path.resolve(process.cwd(), customName);
        if (fs.existsSync(dest)) {
          console.log(`⚠️  文件 "${customName}" 也已存在，保留现有文件。`);
        } else {
          fs.copyFileSync(src, dest);
          console.log(`✅ .env 已创建为: ${dest}`);
        }
      } else {
        console.log('保留现有 .env 文件，未做修改。');
      }
    } else {
      fs.copyFileSync(src, dest);
      console.log(`✅ .env 已从 .env.example 创建: ${dest}`);
    }
    process.exit(0);
  }

  // ── file 覆盖 ──
  if (opts.file) {
    EXCEL_FILE = path.resolve(opts.file);
    logInfo(`Excel 文件覆盖为: ${EXCEL_FILE}`);
  }
  const steps = opts.step?.length ? opts.step : ['download', 'transcode', 'transcribe', 'analyze'];
  // --content-column 模式：默认只跑 AI 分析
  if (opts.contentColumn && !opts.step?.length) {
    steps.length = 0;
    steps.push('analyze');
    logInfo('--content-column 模式：默认 --step analyze');
  }
  // ── --url 模式：直接处理单个视频链接 ──
  if (opts.url) {
    const parsed = parseUrl(opts.url);
    if (!parsed) {
      console.error(c('red', `❌ 无法识别的 URL: ${opts.url}`));
      console.error(c('yellow', '支持的平台: YouTube, B站, 腾讯视频, 优酷'));
      console.error(c('dim', 'URL 格式示例:'));
      console.error(c('dim', '  https://www.bilibili.com/video/BV1xxxyyyzzz'));
      console.error(c('dim', '  https://www.youtube.com/watch?v=xxxxxxxxxxx'));
      console.error(c('dim', '  https://v.qq.com/x/page/x0000xxxxx.html'));
      console.error(c('dim', '  https://v.youku.com/v_show/id_XXXXXXX.html'));
      process.exit(1);
    }

    console.log(c('dim', '\n── URL 任务 ──'));
    console.log(`  平台: ${c('cyan', parsed.platform)}`);
    console.log(`  视频ID: ${c('cyan', parsed.videoId)}`);
    console.log(`  链接: ${c('cyan', parsed.watchUrl)}`);

    // dry-run 模式
    if (opts.dryRun) {
      console.log(c('dim', '\n── 开始执行 (dry-run) ──\n'));
      console.log(`  将执行步骤: ${c('cyan', steps.join(' → '))}`);
      console.log(`  输出名称: ${c('cyan', opts.name || parsed.videoId)}`);
      process.exit(0);
    }

    // 构建文件路径: output/downloads/<platform>/<name>.mp4
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    const dlDir = path.join(DOWNLOADS_DIR, parsed.platform);
    fs.mkdirSync(dlDir, { recursive: true });
    const fileName = safeFilename(opts.name || parsed.videoId);
    const proposedPath = path.join(dlDir, `${fileName}.mp4`);

    // 冲突处理（--force 时直接覆盖）
    let finalPath, finalStem;
    if (opts.force) {
      finalPath = proposedPath;
      finalStem = fileName;
    } else {
      const conflict = await resolveUrlConflict(proposedPath);
      if (conflict.action === 'skip') {
        console.log(c('yellow', '\n⏭️  已跳过\n'));
        process.exit(0);
      }
      finalPath = conflict.path;
      finalStem = path.basename(finalPath, '.mp4');
    }

    console.log(`  文件: ${c('green', finalPath)}`);

    // 检查 whisper 可用性
    let whisperAvailable = false;
    if (steps.includes('transcribe')) {
      whisperAvailable = await checkWhisperAvailable();
      if (!whisperAvailable) {
        const backend = WHISPER_BACKEND === 'local' ? 'local CLI' : WHISPER_SERVICE;
        logWarn(`⚠️ whisper not available (${backend}), transcribe step will fail`);
      }
    }

    // 执行流水线
    const urlResult = await runUrlTask({
      watchUrl: parsed.watchUrl,
      platform: parsed.platform,
      pkey: parsed.pkey,
      videoId: parsed.videoId,
      stem: finalStem,
      dlDir,
      steps,
      maxRetries: opts.retry,
      retryDelay: opts.retryDelay,
      force: opts.force || false,
      downloadTimeout: opts.downloadTimeout,
      transcodeTimeout: opts.transcodeTimeout,
      transcribeTimeout: opts.transcribeTimeout,
      analyzeTimeout: opts.analyzeTimeout,
      whisperAvailable,
    });

    // 生成标准报告 JSON（与 Excel 模式格式一致）
    if (urlResult) {
      const config = { steps, max_retries: opts.retry, retry_delay: opts.retryDelay, concurrency: 1, force: opts.force || false };
      generateReport([urlResult], config, parsed.platform);
      printReportSummary([urlResult]);
    }

    process.exit(0);
  }

  // ── --input 模式：直接处理本地视频文件 ──
  if (opts.input) {
    const inputPath = path.resolve(opts.input);
    console.log(c('dim', '\n── 文件校验 ──'));
    console.log(`  文件: ${c('cyan', inputPath)}`);

    const fileInfo = validateInputFile(inputPath);
    if (!fileInfo.valid) {
      console.log(c('red', `\n❌ 无法处理该文件:`));
      for (const e of fileInfo.errors) {
        console.log(c('red', `   ${e}`));
      }
      process.exit(1);
    }

    // 展示文件信息
    console.log(`  格式: ${c('cyan', fileInfo.format || 'unknown')}`);
    if (fileInfo.hasVideo) {
      console.log(`  视频: ${c('cyan', fileInfo.videoCodec)} ${fileInfo.width}x${fileInfo.height}`);
    }
    if (fileInfo.hasAudio) {
      console.log(`  音频: ${c('cyan', fileInfo.audioCodec)}`);
    }
    if (fileInfo.duration > 0) {
      const dur = fileInfo.duration;
      const mm = Math.floor(dur / 60);
      const ss = Math.floor(dur % 60);
      console.log(`  时长: ${c('cyan', `${mm}:${String(ss).padStart(2, '0')}`)} (${dur.toFixed(1)}s)`);
    }
    if (fileInfo.errors.length > 0) {
      console.log('');
      for (const e of fileInfo.errors) {
        console.log(c('yellow', `  ⚠️  ${e}`));
      }
    }

    // 展示可执行步骤
    const defaultSteps = fileInfo.feasibleSteps;
    // 用户可通过 --step 指定步骤，但只保留可行的
    let steps;
    if (opts.step?.length) {
      steps = opts.step.filter(s => defaultSteps.includes(s));
      if (steps.length === 0) {
        console.log(c('yellow', `\n⚠️  --step ${opts.step.join(', ')} 不可行（文件不支持）\n`));
        process.exit(1);
      }
    } else {
      steps = defaultSteps;
    }
    console.log(`\n  可执行步骤: ${c('green', steps.join(' → '))}`);

    // dry-run 模式
    if (opts.dryRun) {
      console.log(c('dim', '\n── 开始执行 (dry-run) ──\n'));
      console.log(`  [本地文件] 将执行步骤: ${c('cyan', steps.join(' → '))}`);
      console.log(`  输入文件: ${c('cyan', inputPath)}`);
      if (opts.name) {
        console.log(`  输出名称: ${c('cyan', opts.name)}`);
      }
      process.exit(0);
    }

    // 确定输出文件名
    const sheetName = 'local';
    const baseName = safeFilename(opts.name || path.parse(inputPath).name);
    const stem = baseName;

    // 检查转码输出文件是否已有冲突
    if (steps.includes('transcode') && !opts.force) {
      const tcDir = path.join(TRANSCODED_DIR, sheetName);
      const tcPath = path.join(tcDir, stem + TRANSCODE_EXT);
      const conflict = await resolveInputConflict(tcPath);
      if (conflict.action === 'skip') {
        console.log(c('yellow', '\n⏭️  已跳过转码\n'));
        steps = steps.filter(s => s !== 'transcode');
      }
    }

    if (steps.length === 0) {
      console.log(c('yellow', '\n无剩余步骤可执行\n'));
      process.exit(0);
    }

    // 确保目录存在
    if (steps.includes('transcode')) {
      fs.mkdirSync(path.join(TRANSCODED_DIR, sheetName), { recursive: true });
    }

    // 检查 whisper 可用性
    let whisperAvailable = false;
    if (steps.includes('transcribe')) {
      whisperAvailable = await checkWhisperAvailable();
      if (!whisperAvailable) {
        const backend = WHISPER_BACKEND === 'local' ? 'local CLI' : WHISPER_SERVICE;
        logWarn(`⚠️ whisper not available (${backend}), transcribe step will fail`);
      }
    }

    // 执行流水线
    const inputResult = await runInputTask({
      inputPath,
      stem,
      sheetName,
      steps,
      maxRetries: opts.retry,
      retryDelay: opts.retryDelay,
      force: opts.force || false,
      transcodeTimeout: opts.transcodeTimeout,
      transcribeTimeout: opts.transcribeTimeout,
      analyzeTimeout: opts.analyzeTimeout,
      whisperAvailable,
      fileInfo,
    });

    // 生成标准报告 JSON（与 Excel 模式格式一致）
    if (inputResult) {
      const config = { steps, max_retries: opts.retry, retry_delay: opts.retryDelay, concurrency: 1, force: opts.force || false };
      generateReport([inputResult], config, sheetName);
      printReportSummary([inputResult]);
    }

    process.exit(0);
  }

  // ── --content 模式：纯文本 AI 分析 ──
  if (opts.content) {
    await runContentTask({
      content: opts.content,
      name: opts.name || null,
      steps,
      retry: opts.retry,
      retryDelay: opts.retryDelay,
      analyzeTimeout: opts.analyzeTimeout,
      force: opts.force || false,
      dryRun: opts.dryRun || false,
    });
    process.exit(0);
  }

  run({
    targetSheet: opts.sheet || null,
    targetId: opts.id || null,
    contentColumn: opts.contentColumn || null,
    steps,
    offset: opts.offset || 0,
    rowLimit: opts.limit || 0,
    maxRetries: opts.retry,
    retryDelay: opts.retryDelay,
    concurrency: opts.concurrency,
    force: opts.force || false,
    dryRun: opts.dryRun || false,
    retryFailed: opts.retryFailed || null,
    downloadTimeout: opts.downloadTimeout,
    transcodeTimeout: opts.transcodeTimeout,
    transcribeTimeout: opts.transcribeTimeout,
    analyzeTimeout: opts.analyzeTimeout,
  }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });
}
