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
const BASE_DIR = path.resolve(__dirname);

function envPath(key, defaultValue) {
  const val = process.env[key] || defaultValue;
  const p = path.resolve(val);
  return path.isAbsolute(val) ? p : path.resolve(BASE_DIR, val);
}

let EXCEL_FILE = envPath('EXCEL_FILE', 'data/export_2026-06-10_split.xlsx');
const DOWNLOADS_DIR = envPath('DOWNLOADS_DIR', 'downloads');
const TRANSCODED_DIR = envPath('TRANSCODED_DIR', 'transcoded');
const COOKIES_DIR = envPath('COOKIES_DIR', 'cookies');
const REPORTS_DIR = envPath('REPORTS_DIR', 'reports');

const YTDLP = process.env.YTDLP || 'yt-dlp';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const WHISPER_BACKEND = process.env.WHISPER_BACKEND || 'service';
const WHISPER_SERVICE = process.env.WHISPER_SERVICE || 'http://localhost:9588';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base';
const WHISPER_DEVICE = process.env.WHISPER_DEVICE || 'cpu';
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || '';
const WHISPER_SERVICE_MODEL = process.env.WHISPER_SERVICE_MODEL || '';
let _SERVICE_MODEL_LOADED = null;

const TRANSCODE_EXT = process.env.TRANSCODE_EXT || '.wav';
const FFMPEG_TRANSCODE_ARGS = (process.env.TRANSCODE_ARGS || '-ar 16000 -ac 1 -c:a pcm_s16le').split(/\s+/).filter(Boolean);

// ============================== Excel 字段映射 ==============================
const COL_ID = process.env.COL_ID || 'extra.id';
const COL_TITLE = process.env.COL_TITLE || 'title';
const COL_CONTENT = process.env.COL_CONTENT || 'content';
const COL_KEYWORDS = process.env.COL_KEYWORDS || 'keywords';
const COL_TENCENTVID = process.env.COL_TENCENTVID || 'extra.tencentVid';
const COL_BILIBILIBVID = process.env.COL_BILIBILIBVID || 'extra.bilibiliBvid';
const COL_YOUTUBEID = process.env.COL_YOUTUBEID || 'extra.youtubeId';
const COL_YOUKUID = process.env.COL_YOUKUID || 'extra.youkuId';

// ============================== 平台配置 ==============================
const PLATFORM_COL_MAP = {
  tencentVid: COL_TENCENTVID,
  bilibiliBvid: COL_BILIBILIBVID,
  youtubeId: COL_YOUTUBEID,
  youkuId: COL_YOUKUID,
};

const PLATFORM_PRIORITY = (process.env.PLATFORM_PRIORITY || 'bilibiliBvid,youtubeId,tencentVid,youkuId')
  .split(',').map(s => s.trim()).filter(Boolean);

const _VIDEO_SHEETS_RAW = process.env.VIDEO_SHEETS || '';
const VIDEO_SHEETS = _VIDEO_SHEETS_RAW
  ? _VIDEO_SHEETS_RAW.split(',').map(s => s.trim()).filter(Boolean)
  : [];

const _PKEY_ENV_PREFIX = {
  tencentVid: 'TENCENT',
  bilibiliBvid: 'BILIBILI',
  youtubeId: 'YOUTUBE',
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
    if (pkey === 'bilibiliBvid') {
      const referer = process.env[`${prefix}_REFERER`] || '';
      if (referer) extraHeaders.push('--add-header', `Referer:${referer}`);
    }
    if (ua || (pkey === 'bilibiliBvid' && process.env[`${prefix}_REFERER`])) {
      extraHeaders.push('--add-header', 'Accept-Language:zh,en;q=0.9');
    }
    if (extraHeaders.length) cfg.extra_headers = extraHeaders;

    // Concurrent fragments
    const cf = process.env[`${prefix}_CONCURRENT_FRAGMENTS`] || '';
    if (cf) cfg.concurrent_fragments = parseInt(cf, 10);

    // Extra args (YouTube)
    if (pkey === 'youtubeId') {
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
  console.log(`${timestamp()} [INFO] ${msg}`);
}
function logWarn(msg) {
  console.log(`${timestamp()} [WARN] ${msg}`);
}
function logError(msg) {
  console.log(`${timestamp()} [ERROR] ${msg}`);
}
function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

// ============================== 锁 / 并发控制 ==============================
let _printLock = false;
const _printQueue = [];
function printLock(fn) {
  return new Promise(resolve => {
    _printQueue.push(async () => {
      _printLock = true;
      try { fn(); } finally { _printLock = false; }
      resolve();
    });
    if (_printQueue.length === 1) processQueue();
  });
}
async function processQueue() {
  while (_printQueue.length) {
    await _printQueue[0]();
    _printQueue.shift();
  }
}

// 简化：Node.js 单线程，简单场景下不需要锁
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
    return `[总进度 ${this.completed}/${this.total} (${pct}%)] 成功:${this.success} 失败:${this.failed} 部分:${this.partial} 无视频:${this.noVideo}`;
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
  return String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
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

    if (onProgress && child.stderr) {
      const rl = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
      rl.on('line', line => {
        stderr += line + '\n';
        try { onProgress(line); } catch {}
      });
      child.stderr.on('end', () => rl.close());
    } else {
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
    }

    child.on('close', code => {
      clearTimeout(timer);
      if (!onProgress) {
        // Without onProgress, stderr was captured by the 'data' handler
      }
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
async function stepAnalyze(text, maxRetries, retryDelay, timeout = 300) {
  if (!text || !text.trim()) {
    return { text: null, retries: 0, error: 'content empty, skip AI analysis' };
  }

  const apiKey = process.env.AI_API_KEY || '';
  const baseUrl = (process.env.AI_BASE_URL || '').replace(/\/$/, '');
  const model = process.env.AI_MODEL || '';
  const promptTpl = process.env.AI_PROMPT_TPL || '帮我归纳总结一下Keywords，尽可能全一点，这是内容：{content}';
  const aiTimeout = parseInt(process.env.AI_TIMEOUT || String(timeout), 10);

  if (!apiKey || !baseUrl || !model) {
    return { text: null, retries: 0, error: 'AI config incomplete' };
  }

  const prompt = promptTpl.replace('{content}', text);
  const apiUrl = `${baseUrl}/chat/completions`;
  const payload = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  });

  let lastErr = null;
  const maxAttempts = maxRetries + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
      }
      const body = await resp.json();
      const content = body.choices?.[0]?.message?.content || '';
      return { text: content.trim(), retries: attempt, error: null };
    } catch (e) {
      lastErr = String(e.message).slice(0, 500);
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(retryDelay * Math.pow(2, attempt), 30);
        lockedPrint(`  [analyze] attempt ${attempt + 1} failed: ${lastErr.slice(0, 100)}, retrying in ${delay}s...`);
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
  // Parse yt-dlp progress line like "[download]  12.3% of ~50.00MiB at  2.5MiB/s ETA 00:15"
  const m = line.match(/\[download\]\s+([\d.]+%)\s+of\s+~?([\d.]+[KMG]iB)\s+at\s+([\d.]+[KMG]iB\/s)\s+ETA\s+([\d:]+)/);
  if (m) return `DL ${m[1]} of ${m[2]} @ ${m[3]} ETA ${m[4]}`;
  // Also try: "[download] 100% of 50.00MiB"
  const m2 = line.match(/\[download\]\s+([\d.]+%)\s+of\s+([\d.]+[KMG]iB)/);
  if (m2) return `DL ${m2[1]} of ${m2[2]}`;
  return null;
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
      lockedPrint(`  [${stem}] exists ${path.basename(existing)}, skip download`);
      return { file: existing, retries: 0, error: null };
    }
  }

  const videoUrl = buildUrl(pkey, vid);
  lockedPrint(`  [${stem}] start download (platform=${pkey})`);
  lockedPrint(`  [${stem}] ${videoUrl}`);

  const cfg = PLATFORM_CONFIG[pkey];
  const args = [
    videoUrl,
    '-o', path.join(dlDir, `${stem}.%(ext)s`),
    '--no-playlist',
    '--newline',
    '--merge-output-format', 'mp4',
    '-f', cfg.format || 'bestvideo+bestaudio/best',
  ];

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
    const { result, retriesUsed, error } = await retryCall(doDownload, maxRetries, retryDelay, stem);
  } catch (e) {
    logError(`[${stem}] yt-dlp download failed: ${(e.stderr || e.message).slice(-2000)}`);
    return { file: null, retries: maxRetries, error: (e.stderr || e.message).slice(0, 500) };
  }

  const downloaded = findDownloadedFile(dlDir, stem);
  if (downloaded) {
    lockedPrint(`  [${stem}] download done -> ${path.basename(downloaded)}`);
    return { file: downloaded, retries: 0, error: null };
  }
  logError(`[${stem}] file not found after download`);
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
      lockedPrint(`  [${stem}] source updated (re-downloaded), re-transcoding`);
    } else {
      lockedPrint(`  [${stem}] transcode file exists, skip`);
      return { file: outFile, retries: 0, error: null };
    }
  }

  lockedPrint(`  [${stem}] start transcode -> ${path.basename(outFile)}`);

  const totalDur = getDuration(srcFile);

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
            lockedPrint(`  [${stem}] transcode: ${progress}`);
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
    lockedPrint(`  [${stem}] transcode done`);
    return { file: outFile, retries: 0, error: null };
  } catch (e) {
    logError(`[${stem}] ffmpeg transcode failed: ${(e.stderr || e.message).slice(-2000)}`);
    return { file: null, retries: maxRetries, error: (e.stderr || e.message).slice(0, 500) };
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
  if (WHISPER_BACKEND === 'local') {
    const langLabel = WHISPER_LANGUAGE || 'auto';
    lockedPrint(`  [${stem}] start transcribe [local(${WHISPER_MODEL}/${langLabel})] (${fileSizeMB}MB)...`);
  } else {
    const modelLabel = WHISPER_SERVICE_MODEL || WHISPER_MODEL || '(server default)';
    lockedPrint(`  [${stem}] start transcribe [service(${modelLabel})] (${fileSizeMB}MB)...`);
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
    lockedPrint(`  [${stem}] transcribe done (${elapsed}s, ${text.length} chars)`);
    return { text, retries: 0, error: null };
  } catch (e) {
    logError(`[${stem}] local whisper transcribe failed: ${e.message}`);
    return { text: null, retries: maxRetries, error: String(e.message).slice(0, 500) };
  }
}

async function transcribeService(audioFile, stem, maxRetries, retryDelay, timeout = 600) {
  const startTime = Date.now();
  let done = false;
  const progressInterval = setInterval(() => {
    if (!done) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      lockedPrint(`  [${stem}] transcribing... ${elapsed}s`);
    }
  }, 5000);

  async function doTranscribe() {
    try {
      // Switch model if needed
      if (WHISPER_SERVICE_MODEL && WHISPER_SERVICE_MODEL !== _SERVICE_MODEL_LOADED) {
        lockedPrint(`  [${stem}] switch model: ${WHISPER_SERVICE_MODEL}`);
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
      const fileStream = fs.createReadStream(audioFile);
      const fileStat = fs.statSync(audioFile);
      const form = new FormData();
      // Use ReadStream directly - Node.js fetch supports it natively for FormData
      form.append('file', fileStream, path.basename(audioFile));
      form.append('temperature', '0.0');
      form.append('temperature_inc', '0.2');
      form.append('response_format', 'json');

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
    lockedPrint(`  [${stem}] transcribe done (${elapsed}s, ${text.length} chars)`);
    return { text, retries: 0, error: null };
  } catch (e) {
    logError(`[${stem}] whisper transcribe failed: ${e.message}`);
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
  writeColumn(null, COL_CONTENT, updates); // null sheetName means iterate all sheets
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
  const result = {};
  for (const [compositeKey, text] of updates) {
    const [sheetName, key] = compositeKey.split('|');
    if (!result[sheetName]) result[sheetName] = {};
    result[sheetName][key] = text;
  }
  return result;
}

// ============================== 报告 ==============================
function generateReport(results, config) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/(\d{8})(\d{6})/, '$1_$2');
  const reportFile = path.join(REPORTS_DIR, `report_${ts}.json`);

  const success = results.filter(r => r.overall_status === 'success').length;
  const partial = results.filter(r => r.overall_status === 'partial').length;
  const failed = results.filter(r => r.overall_status === 'failed').length;
  const noVideo = results.filter(r => r.overall_status === 'no_video').length;

  const report = {
    timestamp: new Date().toISOString(),
    config,
    summary: { total: results.length, success, partial, failed, no_video: noVideo },
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
  const success = results.filter(r => r.overall_status === 'success').length;
  const partial = results.filter(r => r.overall_status === 'partial').length;
  const failed = results.filter(r => r.overall_status === 'failed').length;
  const noVid = results.filter(r => r.overall_status === 'no_video').length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  执行摘要`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  总计: ${results.length}`);
  console.log(`  ✅ 成功: ${success}`);
  console.log(`  ⚠️ 部分成功: ${partial}`);
  console.log(`  ❌ 失败: ${failed}`);
  console.log(`  ⏭️ 无视频ID: ${noVid}`);
  console.log(`${'='.repeat(60)}`);

  const failures = results.filter(r => r.overall_status !== 'success');
  if (failures.length) {
    console.log(`\n失败/异常详情:`);
    for (const r of failures) {
      const icon = { partial: '⚠️', failed: '❌', no_video: '⏭️' }[r.overall_status] || '?';
      console.log(`  ${icon} [${r.sheet}] ${r.id_val} (${(r.title || 'N/A').slice(0, 30)})`);
      if (r.error) console.log(`       错误: ${r.error.slice(0, 120)}`);
      if (r.download.status === 'failed') console.log(`       下载失败: ${(r.download.error || 'N/A').slice(0, 120)}`);
      if (r.transcode.status === 'failed') console.log(`       转码失败: ${(r.transcode.error || 'N/A').slice(0, 120)}`);
      if (r.transcribe.status === 'failed') console.log(`       识别失败: ${(r.transcribe.error || 'N/A').slice(0, 120)}`);
    }
  }
}

// ============================== 单任务处理 ==============================
async function processOneTask(row, sheetName, steps, maxRetries, retryDelay, force,
  whisperAvailable, positionLabel = '', downloadTimeout = 600, transcodeTimeout = 600,
  transcribeTimeout = 600, analyzeTimeout = 300) {

  const { pkey, vid } = getVideoId(row);
  const stem = stemName(row, sheetName);
  const key = rowKey(row);
  const title = String(row[COL_TITLE] || '');
  const videoUrl = pkey ? buildUrl(pkey, vid) : null;

  const result = new TaskResult(sheetName, key, title, pkey, videoUrl, stem);

  const tag = positionLabel ? `${positionLabel} ` : '';
  lockedPrint(`${tag}[${stem}] start (sheet=${sheetName}, platform=${pkey || 'N/A'}, title=${title.slice(0, 40)})`);
  logInfo(`[${stem}] start (sheet=${sheetName}, platform=${pkey || 'N/A'})`);

  // ── download ──
  let dlFile = null;
  if (steps.includes('download')) {
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
  if (steps.includes('transcode') && dlFile) {
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
  if (steps.includes('transcribe') && tcFile) {
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
          const { text: kw, retries, error } = await stepAnalyze(txt, maxRetries, retryDelay, analyzeTimeout);
          result.analyze = new StepResult(kw ? 'success' : 'failed', kw, error, retries);
          if (kw) {
            lockedPrint(`  [${result.stem}] AI analysis done (${kw.length} chars)`);
          } else {
            lockedPrint(`  [${result.stem}] AI analysis failed: ${error}`);
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
async function run({
  targetSheet, targetId, steps, maxRetries, retryDelay,
  concurrency, force, dryRun, retryFailed,
  downloadTimeout, transcodeTimeout, transcribeTimeout, analyzeTimeout,
}) {
  // ── 重跑失败模式 ──
  if (retryFailed) {
    return runFromReport(retryFailed, steps, maxRetries, retryDelay, concurrency, force, dryRun,
      downloadTimeout, transcodeTimeout, transcribeTimeout, analyzeTimeout);
  }

  // ── 构建任务列表 ──
  const sheets = targetSheet ? [targetSheet] : VIDEO_SHEETS;
  const tasks = [];
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
      tasks.push({ row, sheetName });
    }
  }

  logInfo(`tasks: ${tasks.length}, concurrency: ${concurrency}, max retries: ${maxRetries}`);

  // ── 工具/服务预检 ──
  const envCheck = await checkEnvironmentAsync(steps);
  if (!envCheck.allOk) {
    console.log(`\n${'='.repeat(60)}`);
    console.log('  ⚠️  工具/服务预检：以下依赖不可用');
    console.log('='.repeat(60));
    for (const issue of envCheck.issues) {
      console.log(`  • ${issue}`);
    }
    console.log('\n  涉及的步骤将失败。');
    if (!dryRun) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise(resolve => {
        rl.question('\n  是否继续执行？(输入 yes 继续，其他任意键取消): ', ans => {
          rl.close();
          resolve(ans.trim().toLowerCase());
        });
      });
      if (answer !== 'yes') {
        logInfo('用户取消执行（工具不可用）');
        return;
      }
    }
  }

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
      console.log(`\n${overall.summaryLine()}\n`);
      return result;
    })
  );

  await Promise.all(taskFns);

  // ── 批量写回 Excel ──
  if (steps.includes('transcribe')) {
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
  const reportPath = generateReport(results, config);
  printReportSummary(results);

  logInfo(`all done! report: ${reportPath}`);
}

function printDryRun(tasks, steps, env) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  干跑模式 - 任务清单 (${tasks.length} 条)`);
  console.log('='.repeat(60));

  // 环境检测
  console.log('\n  --- 环境检测 ---');
  if (steps.includes('download')) {
    console.log(`  ${env.ytdlp ? '✅' : '❌'} yt-dlp: ${YTDLP}`);
  } else {
    console.log(`  ⏭ yt-dlp: 未启用（步骤不含 download）`);
  }
  if (steps.includes('transcode')) {
    console.log(`  ${env.ffmpeg ? '✅' : '❌'} ffmpeg: ${FFMPEG}`);
    console.log(`  ${env.ffprobe ? '✅' : '❌'} ffprobe: ${FFPROBE}`);
  } else {
    console.log(`  ⏭ ffmpeg: 未启用（步骤不含 transcode）`);
    console.log(`  ⏭ ffprobe: 未启用（步骤不含 transcode）`);
  }
  if (steps.includes('transcribe')) {
    const backend = WHISPER_BACKEND === 'local' ? 'local CLI' : `service ${WHISPER_SERVICE}`;
    console.log(`  ${env.whisper ? '✅' : '❌'} whisper (${backend})`);
  } else {
    console.log(`  ⏭ whisper: 未启用（步骤不含 transcribe）`);
  }
  if (steps.includes('analyze')) {
    const aiModel = process.env.AI_MODEL || '';
    console.log(`  ${env.ai ? `✅ AI分析 (${aiModel}): 配置完整` : `❌ AI分析: ${env.issues[env.issues.length - 1] || ''}`}`);
  } else {
    console.log(`  ⏭ AI分析: 未启用（步骤不含 analyze）`);
  }

  // 任务列表
  console.log('\n  --- 任务步骤状态 ---');
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

    console.log(`\n  ${i + 1}. [${sheetName}] ${stem}`);
    console.log(`     platform=${pkey}, url=${url}`);

    if (!pkey) {
      console.log('     ⚠️ 无可用视频 ID');
      continue;
    }

    if (steps.includes('download')) {
      let status;
      if (dlExists) status = '[跳过-已有文件]';
      else if (!env.ytdlp) status = '[不可用-yt-dlp]';
      else status = '[待执行]';
      console.log(`      download : ${status}`);
    }
    if (steps.includes('transcode')) {
      let status;
      if (tcExists) status = '[跳过-已有文件]';
      else if (!env.ffmpeg) status = '[不可用-ffmpeg]';
      else if (!dlExists) status = '[等待-需先下载]';
      else status = '[待执行]';
      console.log(`      transcode: ${status}`);
    }
    if (steps.includes('transcribe')) {
      let status;
      if (contentFilled) status = `[跳过-content已有${String(contentVal).length}字符]`;
      else if (!env.whisper) status = '[不可用-whisper]';
      else if (!tcExists) status = '[等待-需先转码]';
      else status = '[待执行]';
      console.log(`      transcribe: ${status}`);
    }
    if (steps.includes('analyze')) {
      let status;
      if (keywordsFilled) status = `[跳过-keywords已有${String(keywordsVal).length}字符]`;
      else if (!env.ai) status = '[不可用-AI未配置]';
      else if (!contentFilled && !tcExists) status = '[等待-需先识别]';
      else status = '[待执行]';
      console.log(`      analyze  : ${status}`);
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

  // ── 工具/服务预检 ──
  const envRfr = await checkEnvironmentAsync(steps);
  if (!envRfr.allOk) {
    console.log(`\n${'='.repeat(60)}`);
    console.log('  ⚠️  工具/服务预检：以下依赖不可用');
    console.log('='.repeat(60));
    for (const issue of envRfr.issues) console.log(`  • ${issue}`);
    console.log('\n  涉及的步骤将失败。');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question('\n  是否继续重跑？(输入 yes 继续，其他任意键取消): ', ans => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      });
    });
    if (answer !== 'yes') {
      logInfo('用户取消重跑（工具不可用）');
      return;
    }
  }

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
  const reportFilePath = generateReport(results, config);
  printReportSummary(results);
  logInfo(`all done! report: ${reportFilePath}`);
}

// ============================== CLI ==============================
if (process.argv[1] === __filename || process.argv[1]?.endsWith('process_videos.js')) {
  program
    .name('process_videos')
    .description('视频下载、转码、文本识别、AI分析一体化流程')
    .option('--sheet <name>', '指定 sheet 名称')
    .option('--id <id>', '指定 extra.id 或 title（单条测试）')
    .option('--step <step>', '只执行某一步：download / transcode / transcribe / analyze', (val) => {
      const allowed = ['download', 'transcode', 'transcribe', 'analyze'];
      if (!allowed.includes(val)) {
        console.error(`Invalid step: ${val}. Must be one of: ${allowed.join(', ')}`);
        process.exit(1);
      }
      return val;
    })
    .option('--force', '强制重做下载+转码（忽略已有文件）')
    .option('--concurrency <n>', '并发数，默认 1', parseInt, 1)
    .option('--retry <n>', '每步失败最大重试次数，默认 0', parseInt, 0)
    .option('--retry-delay <n>', '重试间隔基数（秒），默认 5', parseFloat, 5.0)
    .option('--download-timeout <n>', '下载超时（秒），默认 600', parseInt, 600)
    .option('--transcode-timeout <n>', '转码超时（秒），默认 600', parseInt, 600)
    .option('--transcribe-timeout <n>', '识别超时（秒），默认 600', parseInt, 600)
    .option('--analyze-timeout <n>', 'AI 分析超时（秒），默认 300', parseInt, 300)
    .option('--dry-run', '干跑模式，只列任务不执行')
    .option('--retry-failed <path>', '从报告 JSON 重跑失败项')
    .option('--init', '复制 .env.example 到当前目录并重命名为 .env')
    .option('--file <path>', '指定 Excel 文件路径（优先级高于 EXCEL_FILE 环境变量）')
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
  const steps = opts.step ? [opts.step] : ['download', 'transcode', 'transcribe', 'analyze'];

  run({
    targetSheet: opts.sheet || null,
    targetId: opts.id || null,
    steps,
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
