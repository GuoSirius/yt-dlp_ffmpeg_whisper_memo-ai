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
import { spawn, execSync } from 'child_process';
import readline from 'readline';
import XLSX from 'xlsx';
import pLimit from 'p-limit';
import { fileURLToPath } from 'url';
import os from 'os';
import { program } from 'commander';
import { select, input } from '@inquirer/prompts';

// 控制台单行动态显示
import {
  updateLine, clearLine, fmtSize, fmtTime, textBar,
  startSpinner, stopSpinner,
  parseYtdlpLine, parseFfmpegProgress, resetFfmpegState,
} from './console-ui.mjs';

// --env-file 需在 dotenv 加载前解析
let _dotenvPath = '.env';
const _envFileIdx = process.argv.indexOf('--env-file');
if (_envFileIdx !== -1 && _envFileIdx + 1 < process.argv.length) {
  _dotenvPath = process.argv[_envFileIdx + 1];
}
dotenv.config({ path: _dotenvPath, override: true });

// ============================== 路径配置 ==============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = process.cwd();

function envPath(key, defaultValue) {
  const val = process.env[key] || defaultValue;
  const p = path.resolve(val);
  return path.isAbsolute(val) ? p : path.resolve(BASE_DIR, val);
}

let EXCEL_FILE = envPath('EXCEL_FILE', 'data/examples/website_split.xlsx');
const COOKIES_DIR = envPath('COOKIES_DIR', 'data/cookies');

// ── 输出根目录 + 7 个固定子目录（子目录名不可通过 env 覆盖）──
let OUTPUT_DIR = envPath('OUTPUT_DIR', 'output');
let DOWNLOADS_DIR    = path.join(OUTPUT_DIR, 'downloads');   // yt-dlp 原始下载
let TRANSCODED_DIR   = path.join(OUTPUT_DIR, 'transcoded');  // ffmpeg 转出的音频
let TRANSCRIPTS_DIR  = path.join(OUTPUT_DIR, 'transcripts'); // whisper 识别文本（断点续跑校验依据）
let KEYWORDS_DIR     = path.join(OUTPUT_DIR, 'keywords');    // AI 关键词
let REPORTS_DIR      = path.join(OUTPUT_DIR, 'reports');     // 执行报告 JSON
let PROGRESS_DIR     = path.join(OUTPUT_DIR, 'progress');    // 增量进度 JSON
let LOGS_DIR         = path.join(OUTPUT_DIR, 'logs');        // 运行日志/console-ui 输出

/**
 * 用 --output / OUTPUT_DIR 指定的根目录覆盖所有 7 个子目录常量。
 * 子目录名固定；调用后立即 mkdirSync。
 */
function applyOutputDir(newRoot, logFn) {
  OUTPUT_DIR = newRoot;
  DOWNLOADS_DIR    = path.join(OUTPUT_DIR, 'downloads');
  TRANSCODED_DIR   = path.join(OUTPUT_DIR, 'transcoded');
  TRANSCRIPTS_DIR  = path.join(OUTPUT_DIR, 'transcripts');
  KEYWORDS_DIR     = path.join(OUTPUT_DIR, 'keywords');
  REPORTS_DIR      = path.join(OUTPUT_DIR, 'reports');
  PROGRESS_DIR     = path.join(OUTPUT_DIR, 'progress');
  LOGS_DIR         = path.join(OUTPUT_DIR, 'logs');
  for (const d of [DOWNLOADS_DIR, TRANSCODED_DIR, TRANSCRIPTS_DIR, KEYWORDS_DIR, REPORTS_DIR, PROGRESS_DIR, LOGS_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
  if (logFn) logFn(`输出根目录覆盖为: ${OUTPUT_DIR}`);
}

applyOutputDir(OUTPUT_DIR);

// 断点续跑：产物最小长度阈值
const MIN_TRANSCRIPT_CHARS = parseInt(process.env.MIN_TRANSCRIPT_CHARS || '50', 10);
const MIN_KEYWORDS_CHARS = parseInt(process.env.MIN_KEYWORDS_CHARS || '5', 10);

const YTDLP = process.env.YTDLP || 'yt-dlp';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
// ── Whisper 共享参数（local、faster-whisper 和 service 通用） ──
const WHISPER_BACKEND = process.env.WHISPER_BACKEND || 'local';
const WHISPER_TEMPERATURE = process.env.WHISPER_TEMPERATURE || '0.0';
const WHISPER_TEMPERATURE_INC = process.env.WHISPER_TEMPERATURE_INC || '0.2';
const WHISPER_OUTPUT_FORMAT = process.env.WHISPER_OUTPUT_FORMAT || 'json'; // 输出格式: txt/vtt/srt/tsv/json/all (服务端映射到 response_format)

// ── Whisper 服务模式参数（独有） ──
const WHISPER_SERVICE = process.env.WHISPER_SERVICE || 'http://localhost:9588';
const WHISPER_SERVICE_MODEL = process.env.WHISPER_SERVICE_MODEL || '';  // ggml 模型路径 (/load)，留空=使用服务端默认

// ── Whisper 本地模式参数（local / faster-whisper 通用） ──
const WHISPER_TASK = process.env.WHISPER_TASK || 'transcribe';            // 任务类型: transcribe/translate
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'medium';            // 模型名: tiny/base/small/medium/large-v3/turbo
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || '';           // 语言: 设 zh 避免繁体混入; 留空=自动检测
const WHISPER_MODEL_DIR = process.env.WHISPER_MODEL_DIR || '';          // 模型下载目录，留空=~/.cache/whisper（或 $XDG_CACHE_HOME/whisper）
const WHISPER_DEVICE = process.env.WHISPER_DEVICE || 'cpu';             // cpu / cuda
const WHISPER_BEAM_SIZE = process.env.WHISPER_BEAM_SIZE || '5';         // beam 宽度 (温度=0 时生效, 越大越准)
const WHISPER_BEST_OF = process.env.WHISPER_BEST_OF || '5';             // 候选数 (温度>0 时生效)
let WHISPER_INITIAL_PROMPT = process.env.WHISPER_INITIAL_PROMPT || '';// 初始提示词: 给首段音频提供词汇上下文, 提升专有名词识别; 示例见 .env.example
// WHISPER_INITIAL_PROMPT 在 CLI 解析后通过 applyCliOverrides() 用 resolvePromptValue 归一化
const WHISPER_CONDITION_ON_PREV = process.env.WHISPER_CONDITION_ON_PREV || 'False'; // 推荐 False: 每段独立解码, 避免长视频错误累积; True=前段文本传入(仅适合短音频)
const WHISPER_FP16 = process.env.WHISPER_FP16 || 'False';              // CPU 应设为 False
const WHISPER_THREADS = process.env.WHISPER_THREADS || '0';            // 线程数 (0=自动)

// ── faster-whisper 专用参数（backend=faster-whisper 时生效） ──
const WHISPER_COMPUTE_TYPE = process.env.WHISPER_COMPUTE_TYPE || 'int8';   // 计算精度: int8/float16/int8_float16/default/auto
const WHISPER_VAD_FILTER = process.env.WHISPER_VAD_FILTER || 'True';      // VAD 静音过滤 (True/False)
const WHISPER_VAD_ONSET = process.env.WHISPER_VAD_ONSET || '0.5';         // VAD 灵敏度阈值 (0.0~1.0)
const WHISPER_NUM_WORKERS = process.env.WHISPER_NUM_WORKERS || '1';       // CTranslate2 并行 worker 数

// ── FunASR 专用参数（backend=funasr 时生效） ──
// FunASR 专攻中文场景，WER ~5%（Whisper 中文 ~15%）。
// 需先安装: pip install funasr modelscope (cli)  或  pip install funasr vllm fastapi uvicorn python-multipart (service, GPU 推荐)
const FUNASR_MODE = process.env.FUNASR_MODE || 'cli';                      // "cli" = 本地 AutoModel; "service" = 远程 funasr-server (OpenAI 兼容 API)
const FUNASR_MODEL = process.env.FUNASR_MODEL || 'paraformer-zh';          // 主 ASR 模型: paraformer-zh / SenseVoiceSmall / Fun-ASR-Nano / Qwen3-ASR ...
const FUNASR_VAD_MODEL = process.env.FUNASR_VAD_MODEL || 'fsmn-vad';       // VAD 模型（留空=用主模型内置）
const FUNASR_PUNC_MODEL = process.env.FUNASR_PUNC_MODEL || 'ct-punc';      // 标点恢复（留空=不做）
const FUNASR_SPK_MODEL = process.env.FUNASR_SPK_MODEL || '';               // 说话人分离（留空=不做）
const FUNASR_EMOTION_MODEL = process.env.FUNASR_EMOTION_MODEL || '';       // 情感识别（留空=不做）
const FUNASR_DEVICE = process.env.FUNASR_DEVICE || 'cpu';                  // cpu / cuda（GPU 强烈推荐）
const FUNASR_QUANTIZE = process.env.FUNASR_QUANTIZE || 'True';             // int8 量化（省 50% 内存, GPU 设 False）
const FUNASR_BATCH_SIZE_S = process.env.FUNASR_BATCH_SIZE_S || '300';      // 动态批处理音频秒数 (60-600)
const FUNASR_HOTWORD = process.env.FUNASR_HOTWORD || '';                   // 热词（空格分隔, 显著提升专有名词）
const FUNASR_LANGUAGE = process.env.FUNASR_LANGUAGE || 'zh';               // 主语言（中文 zh, SenseVoice 配 auto 可自动检测 50+ 语种）
const FUNASR_VAD_MAX_SEGMENT = process.env.FUNASR_VAD_MAX_SEGMENT || '20000'; // VAD 最大单段长度 (ms, 0=不切分)
const FUNASR_SERVICE_URL = process.env.FUNASR_SERVICE_URL || 'http://localhost:8899'; // funasr-server 地址
const FUNASR_SERVICE_MODEL = process.env.FUNASR_SERVICE_MODEL || 'iic/SenseVoiceSmall'; // 服务侧加载的模型 ID

let _SERVICE_MODEL_LOADED = null;

// ── CLI 覆盖占位（CLI 解析后由 applyCliOverrides 填充）──
let _cliAiPrompt = null;              // --ai-prompt
let _resolvedWhisperExtraArgs = [];   // 解析后的参数数组
let _resolvedFunasrExtraArgs = [];    // FunASR 额外参数（CLI > .env）

/**
 * 应用 CLI 覆盖：CLI > .env > 内置默认
 * 在 program.parse() 后调用
 */
function applyCliOverrides(cliOpts) {
  // whisper-initial-prompt: CLI > .env > 内置默认
  if (cliOpts.whisperInitialPrompt !== undefined) {
    WHISPER_INITIAL_PROMPT = resolvePromptValue(cliOpts.whisperInitialPrompt);
  } else {
    // .env 值也需要 resolvePromptValue 处理（可能指向文件）
    WHISPER_INITIAL_PROMPT = resolvePromptValue(WHISPER_INITIAL_PROMPT);
  }

  // ai-prompt: CLI > .env > 内置默认（存入全局供 stepAnalyze 使用）
  if (cliOpts.aiPrompt !== undefined) {
    _cliAiPrompt = resolvePromptValue(cliOpts.aiPrompt);
  }

  // whisper-extra-args: CLI > .env
  const rawExtra = cliOpts.whisperExtraArgs || process.env.WHISPER_EXTRA_ARGS || '';
  _resolvedWhisperExtraArgs = parseExtraArgs(rawExtra);
  if (_resolvedWhisperExtraArgs.length) {
    lockedPrint(styleInfo(`whisper extra args: ${_resolvedWhisperExtraArgs.join(' ')}`));
  }

  // funasr-extra-args: CLI > .env
  const rawFunasrExtra = cliOpts.funasrExtraArgs || process.env.FUNASR_EXTRA_ARGS || '';
  _resolvedFunasrExtraArgs = parseExtraArgs(rawFunasrExtra);
  if (_resolvedFunasrExtraArgs.length) {
    lockedPrint(styleInfo(`funasr extra args: ${_resolvedFunasrExtraArgs.join(' ')}`));
  }
}

const TRANSCODE_EXT = process.env.TRANSCODE_EXT || '.wav';
const FFMPEG_TRANSCODE_ARGS = (process.env.TRANSCODE_ARGS || '-vn -map_metadata -1 -map 0:a:0 -af loudnorm=I=-16:TP=-1.5:LRA=11:linear=true,aresample=resampler=soxr:osr=16000:osf=s16:dither_method=shibata -ac 1 -c:a pcm_s16le').split(/ +/).filter(Boolean);

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
/**
 * 解析提示词值：自动检测是文件路径还是内联文本。
 * 如果值对应的文件存在，读取文件内容；否则当文本直接返回。
 * 读取后自动将字面量 \n \t 转义为真正的换行/制表符。
 */
function resolvePromptValue(val) {
  if (!val) return val || '';
  const p = path.resolve(BASE_DIR, val);
  if (fs.existsSync(p)) {
    const content = fs.readFileSync(p, 'utf-8').trim();
    return content.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  return val.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

/**
 * 解析 whisper 额外参数 shell 字符串为参数数组。
 * 例如 "--beam_size 5 --best_of 5" → ["--beam_size", "5", "--best_of", "5"]
 * 空字符串或 undefined 返回空数组。
 */
function parseExtraArgs(str) {
  if (!str || !str.trim()) return [];
  return str.trim().split(/\s+/).filter(Boolean);
}

/**
 * 合并 whisper 参数：基础参数 + 额外参数去重。
 * 额外参数优先级最高，如果基础参数中存在同名 key（--xxx），则移除基础参数中的该 key-value 对。
 * 返回合并后的参数数组。
 */
function mergeWhisperArgs(baseArgs, extraArgs) {
  if (!extraArgs || !extraArgs.length) return baseArgs;
  const extraKeys = new Set();
  for (const arg of extraArgs) {
    if (arg.startsWith('--')) extraKeys.add(arg);
  }
  const merged = [];
  for (let i = 0; i < baseArgs.length; i++) {
    const arg = baseArgs[i];
    if (arg.startsWith('--') && extraKeys.has(arg)) {
      // 跳过冲突的 key 及其 value
      if (i + 1 < baseArgs.length && !baseArgs[i + 1].startsWith('-')) i++;
      continue;
    }
    merged.push(arg);
  }
  return [...merged, ...extraArgs];
}

function c(color, text) {
  const codes = {
    // styles
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    underline: '\x1b[4m',
    // foreground
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    // background
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m',
    bgGray: '\x1b[100m',
    // reset
    reset: '\x1b[0m',
  };
  if (Array.isArray(color)) {
    return color.map(cl => codes[cl] || '').join('') + text + codes.reset;
  }
  return (codes[color] || '') + text + codes.reset;
}

// 日志样式辅助
function styleStart(msg) { return c(['bold', 'cyan'], `► ${msg}`); }
function styleDone(msg) { return c(['bold', 'green'], `✔ ${msg}`); }
function styleFail(msg) { return c(['bold', 'red'], `✘ ${msg}`); }
function styleWarn(msg) { return c(['bold', 'yellow'], `⚠ ${msg}`); }
function styleSkip(msg) { return c(['dim', 'yellow'], `⏭ ${msg}`); }
function styleInfo(msg) { return c('cyan', `  ${msg}`); }
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
function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

// Node.js 单线程模型下 console.log 是原子的，不会出现行内交错
function lockedPrint(s) {
  console.log(s);
}

function printLong(msg, indent = '       ') {
  if (!msg) return;
  const s = String(msg);
  const label = s.length > 800 ? s.slice(0, 800) + `...(truncated, total ${s.length} chars)` : s;
  for (const ln of label.split('\n')) {
    if (ln.trim()) console.log(`${indent}${c('red', ln)}`);
    else console.log(indent);
  }
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

// ============================== 断点续跑工具 ==============================

function transcriptPath(sheetName, stem) {
  const d = path.join(TRANSCRIPTS_DIR, sheetName);
  fs.mkdirSync(d, { recursive: true });
  return path.join(d, `${stem}.txt`);
}

function keywordsPath(sheetName, stem) {
  const d = path.join(KEYWORDS_DIR, sheetName);
  fs.mkdirSync(d, { recursive: true });
  return path.join(d, `${stem}.txt`);
}

function progressPath(sheetName, stem) {
  const d = path.join(PROGRESS_DIR, sheetName);
  fs.mkdirSync(d, { recursive: true });
  return path.join(d, `task_${stem}.json`);
}

function safeRemove(p) {
  if (!p) return;
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { logWarn(`清理文件失败 ${p}: ${e.message}`); }
}

function validateTranscriptText(text) {
  if (!text || !String(text).trim()) return { ok: false, err: '识别文本为空' };
  if (String(text).trim().length < MIN_TRANSCRIPT_CHARS) {
    return { ok: false, err: `识别文本过短(${String(text).trim().length}<${MIN_TRANSCRIPT_CHARS})` };
  }
  return { ok: true, err: null };
}

function validateKeywordsText(text) {
  if (!text || !String(text).trim()) return { ok: false, err: '关键词为空' };
  if (String(text).trim().length < MIN_KEYWORDS_CHARS) {
    return { ok: false, err: `关键词过短(${String(text).trim().length}<${MIN_KEYWORDS_CHARS})` };
  }
  return { ok: true, err: null };
}

function loadTaskProgress(sheetName, stem) {
  const p = progressPath(sheetName, stem);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    logWarn(`progress JSON 解析失败 ${p}: ${e.message}`);
    return null;
  }
}

/**
 * 按 id/title key 匹配行号，写入指定列（断点续跑实时写 Excel）。
 * XLSX.writeFile 非线程安全，本函数假定外层已用 _excel_lock 串行化（JS 中用 await + 队列）。
 */
function writeExcelCellByKey(sheetName, key, colName, value) {
  if (!value || !String(value).trim()) return false;
  const wb = XLSX.readFile(EXCEL_FILE);
  if (!wb.SheetNames.includes(sheetName)) {
    logWarn(`Sheet [${sheetName}] not found, skip write`);
    return false;
  }
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
  if (!aoa.length) return false;
  const headers = aoa[0];
  const colIdx = headers.indexOf(colName);
  if (colIdx === -1) {
    logWarn(`[${sheetName}] column "${colName}" not found, skip write`);
    return false;
  }
  const idIdx = headers.indexOf(COL_ID);
  const titleIdx = headers.indexOf(COL_TITLE);

  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    let matched = false;
    if (idIdx >= 0 && row[idIdx] != null) {
      const v = String(row[idIdx]);
      if (/^\d+(\.\d+)?$/.test(v) && String(parseInt(v, 10)) === String(key)) matched = true;
      else if (v === String(key)) matched = true;
    }
    if (!matched && titleIdx >= 0) {
      if (String(row[titleIdx]) === String(key)) matched = true;
    }
    if (matched) {
      aoa[r][colIdx] = value;
      const newWs = XLSX.utils.aoa_to_sheet(aoa);
      wb.Sheets[sheetName] = newWs;
      XLSX.writeFile(wb, EXCEL_FILE, { cellDates: true });
      return true;
    }
  }
  logWarn(`[${sheetName}] 未找到匹配行 key=${key}`);
  return false;
}

// Excel 写锁（XLSX.writeFile 非线程安全）
let _excelWriteLock = null;
function acquireExcelLock() {
  if (!_excelWriteLock) _excelWriteLock = Promise.resolve();
  const release = _excelWriteLock;
  let resolveNext;
  _excelWriteLock = new Promise(r => { resolveNext = r; });
  return release.then(() => () => resolveNext());
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
  // HTTP 5xx server errors are retryable (AI API transient failures)
  const http5xx = err.message?.match(/^HTTP\s+5\d{2}/);
  if (http5xx) return true;
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
  // whisper / whisper-ctranslate2 / funasr 等 Python CLI 的 --help 均会触发框架初始化
  // （Hydra / CTranslate2 等），耗时 5-30 秒，不适合用作预检。
  // 统一改用 where/which 检查可执行文件存在即视为可用（< 0.3 秒）。
  const cliBinaries = {
    'local': 'whisper',
    'faster-whisper': 'whisper-ctranslate2',
  };
  if (WHISPER_BACKEND === 'local' || WHISPER_BACKEND === 'faster-whisper') {
    const binName = cliBinaries[WHISPER_BACKEND];
    const installHint = WHISPER_BACKEND === 'local'
      ? 'pip install openai-whisper'
      : 'pip install whisper-ctranslate2';
    try {
      const locateCmd = process.platform === 'win32' ? `where ${binName}` : `which ${binName}`;
      const binPath = execSync(locateCmd, { stdio: 'pipe', timeout: 3000 })
        .toString().split('\n')[0].trim();
      if (binPath && fs.existsSync(binPath)) return true;
      logError(`${binName} CLI 不可用，请确认: ${installHint}`);
      return false;
    } catch {
      logError(`${binName} CLI 不可用，请确认: ${installHint}`);
      return false;
    }
  } else if (WHISPER_BACKEND === 'funasr') {
    if (FUNASR_MODE === 'service') {
      try {
        await fetch(FUNASR_SERVICE_URL, { signal: AbortSignal.timeout(3000) });
        return true;
      } catch {
        logError(`funasr-server 不可用（${FUNASR_SERVICE_URL}），请确认服务已启动: funasr-server`);
        return false;
      }
    }
    // funasr 同理：--help / import 均需 15-30 秒，改用 where/which 检测可执行文件。
    try {
      const locateCmd = process.platform === 'win32' ? 'where funasr' : 'which funasr';
      const funasrPath = execSync(locateCmd, { stdio: 'pipe', timeout: 3000 })
        .toString().split('\n')[0].trim();
      if (funasrPath && fs.existsSync(funasrPath)) return true;
      logError('funasr CLI 不可用，请确认: pip install funasr modelscope');
      return false;
    } catch {
      logError('funasr CLI 不可用，请确认: pip install funasr modelscope');
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
      let backend;
      if (WHISPER_BACKEND === 'local') backend = 'local CLI';
      else if (WHISPER_BACKEND === 'faster-whisper') backend = 'faster-whisper (whisper-ctranslate2)';
      else if (WHISPER_BACKEND === 'funasr') {
        backend = FUNASR_MODE === 'service'
          ? `funasr/service (${FUNASR_SERVICE_URL})`
          : `funasr/cli (${FUNASR_MODEL})`;
      } else backend = `service ${WHISPER_SERVICE}`;
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
    let timer;
    if (timeout > 0) {
      timer = setTimeout(() => {
        child.kill();
        reject(Object.assign(new Error(`Timeout after ${timeout}s`), { name: 'TimeoutError', code: 'ETIMEDOUT' }));
      }, timeout * 1000);
    }

    if (onProgress) {
      // 同时监听 stdout 和 stderr — yt-dlp --newline 的 [download] 进度输出在 stdout
      const onLine = (buf, line) => { try { onProgress(line); } catch { } };
      const rlOut = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      rlOut.on('line', line => { stdout += line + '\n'; onLine('stdout', line); });
      const rlErr = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
      rlErr.on('line', line => { stderr += line + '\n'; onLine('stderr', line); });
    } else {
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
    }

    child.on('close', code => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        // 把 stderr 末尾也写进 message，方便直接打印 e.message 就能看到原因
        const preview = stderr.trim().slice(-3000);
        const msg = `Exit code ${code}` + (preview ? `\nstderr:\n${preview}` : '');
        reject(Object.assign(new Error(msg), { code, stderr }));
      }
    });
    child.on('error', err => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

// ============================== AI 分析 ==============================
async function stepAnalyze(text, maxRetries, retryDelay, timeout = 300, label = 'analyze') {
  if (!text || !text.trim()) {
    return { text: null, retries: 0, error: 'content empty, skip AI analysis' };
  }
  const aiStart = Date.now();

  const apiKey = process.env.AI_API_KEY || '';
  const baseUrl = (process.env.AI_BASE_URL || '').replace(/\/$/, '');
  const model = process.env.AI_MODEL || '';
  // CLI > .env > 内置默认；resolvePromptValue 自动处理文件路径和 \n 转义
  const promptTpl = _cliAiPrompt
    || resolvePromptValue(process.env.AI_PROMPT_TPL)
    || '你是生物医药多语言内容分析与ASR纠错专家。对以下视频转录文本提取搜索关键词。\n\n【第一步：语义修正与术语消歧】语音识别（Whisper）在处理专业内容时极易出错。请在理解上下文的基础上，激活生物医药专业词典进行以下修正（仅内部推理使用，不改变原文语义，不添加新内容）：\n- 同音/近音错字：如"冻存"误为"洞存"、"储存"误为"铸存"、"传代"误为"传带"、"复苏"误为"复舒"、"抗体"误为"康体"、"细胞株"误为"细胞珠"、"培养基"误为"培养鸡"、"质粒"误为"智力"、"表达量"误为"表大量"。\n- 形近字混淆：如"印迹"误为"印记"、"缓冲液"误为"缓冲夜"、"核酸"误为"核算"、"测序"误为"侧序"。\n- 英文缩写与发音误判：如将"PCR"误识为中文或乱码，将"CRISPR"误识为"克里斯普"，需根据上下文还原为标准英文缩写。\n边界约束：仅修正确实存在明显错误的词汇，保持原文行文逻辑不变。\n\n【第二步：提取关键词】\n请遵循以下规则：\n\n【语言判定】\n- 先统计内容的中文字符数和英文字母数\n- 中文占比 > 60% → 按纯中文处理\n- 英文占比 > 60% → 按纯英文处理\n- 两者都不满足 → 按中英混合处理\n\n【纯中文内容】\n- 提取全部有价值的关键词，不限定数量，用英文逗号分隔\n- 关键词必须全部是中文，绝对不能翻译成英文\n- 优先提取 2-8 字的有实际搜索价值的专有名词或技术短语\n- 避免单字和泛词（如"的""是""这个""一个"等）\n\n【纯英文内容】\n- 提取全部有价值的关键词，用英文逗号分隔\n- 关键词必须全部是英文，绝对不能翻译成中文\n- 优先提取 2-8 词的专业术语、基因/蛋白名称或实验方法等\n- 避免单字和泛词（如"the""this""is""a"等）\n\n【中英混合内容】\n- 提取全部有价值的关键词，不限定数量\n- 语种隔离原则：中文关键词必须是中文，英文关键词必须是英文，互不翻译且严禁中英混杂\n- 排序原则：中文关键词放在前面，英文关键词放在后面，统一用英文逗号分隔\n\n通用规则：全面覆盖内容主题，确保关键词具有检索价值，不遗漏不重复，不要凭空编造内容中没有的概念。最终只输出以英文逗号分隔的关键词列表，不要包含任何解释性文字。这是内容：{content}';
  const aiTemperature = parseFloat(process.env.AI_TEMPERATURE || '0.3');
  const aiTimeout = timeout;

  if (!apiKey || !baseUrl || !model) {
    return { text: null, retries: 0, error: 'AI config incomplete' };
  }

  // 注意：不能用 replace('{content}', text)，因为 text 中的 $& $` $' $$ 会被特殊解释，
  // 导致发给 AI 的转录文本被损坏。改用函数替换，规避 $ 特殊语义。
  const prompt = promptTpl.replace('{content}', () => text);
  const apiUrl = `${baseUrl}/chat/completions`;
  const payload = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: aiTemperature,
  });

  // AI_DEBUG=true 时打印实际发送的 prompt 和返回内容，排查关键词质量问题
  const aiDebug = (process.env.AI_DEBUG || '').toLowerCase() === 'true';
  if (aiDebug) {
    lockedPrint(`  [${label}] 🔍 AI_DEBUG prompt(${prompt.length} chars): ${prompt.slice(0, 500)}...`);
    lockedPrint(`  [${label}] 🔍 AI_DEBUG transcript(${text.length} chars): ${text.slice(0, 200)}...`);
  }

  lockedPrint(`  [${label}] AI 请求 URL: ${apiUrl}`);
  startSpinner(`[${label}] AI 分析中`);
  let result;
  try {
    // retryCall 返回 { result: fnReturn, retriesUsed, error }
    // fn 返回 { text, retries, error } — 需要先解包再提取 text
    const ret = await retryCall(
      async () => {
        const controller = new AbortController();
        let timer;
        if (aiTimeout > 0) {
          timer = setTimeout(() => controller.abort(), aiTimeout * 1000);
        }
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
          const errBody = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 300)}`);
        }
        const body = await resp.json();
        const content = body.choices?.[0]?.message?.content || '';
        return { text: content.trim(), retries: 0, error: null };
      },
      maxRetries,
      retryDelay,
      label
    );
    // 解包 retryCall 的嵌套结构
    const fnResult = ret.result;
    const aiText = (fnResult && fnResult.text) ? String(fnResult.text) : '';
    if (aiText) {
      result = { text: aiText, retries: ret.retriesUsed, error: null };
      if (aiDebug) {
        lockedPrint(`  [${label}] 🔍 AI_DEBUG response(${aiText.length} chars): ${aiText.slice(0, 500)}`);
      }
    } else {
      result = { text: null, retries: ret.retriesUsed, error: 'AI returned empty content, possible API error or invalid response format' };
    }
  } catch (e) {
    const errMsg = (e && e.message) ? String(e.message) : (e ? String(e) : 'unknown error');
    // fetch failed 时真正原因在 e.cause.code (ENOTFOUND/ECONNREFUSED/ETIMEDOUT etc.)
    const cause = e && e.cause;
    const causeParts = [];
    if (cause) {
      if (cause.code) causeParts.push(`code=${cause.code}`);
      if (cause.errno) causeParts.push(`errno=${cause.errno}`);
      if (cause.syscall) causeParts.push(`syscall=${cause.syscall}`);
      if (cause.hostname) causeParts.push(`hostname=${cause.hostname}`);
      if (cause.port) causeParts.push(`port=${cause.port}`);
      if (cause.message && cause.message !== errMsg) causeParts.push(`msg=${cause.message}`);
    }
    const causeMsg = causeParts.length > 0 ? ` (cause: ${causeParts.join(', ')})` : '';
    const urlHint = apiUrl ? ` [url: ${apiUrl}]` : '';
    result = { text: null, retries: maxRetries, error: `${errMsg}${causeMsg}${urlHint}`.slice(0, 500) };
  } finally {
    stopSpinner();
  }

  if (result.text) {
    lockedPrint(styleDone(`[${label}] AI 分析完成 (${fmtElapsed(Date.now() - aiStart)}, ${result.text.length} 字符)`));
  } else {
    lockedPrint(styleFail(`[${label}] AI 分析失败: ${result.error}`));
  }
  return result;
}

// ============================== 下载 ==============================
function fmtElapsed(ms) {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m${s}s`;
}

function fmtDuration(sec) {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}:${String(rm).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function stepDownload(row, sheetName, maxRetries, retryDelay, force, timeout = 1800) {
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

  const downloadStart = Date.now();
  let lastPercent = -1;
  async function doDownload() {
    const { stdout, stderr } = await spawnWithTimeout(YTDLP, args, timeout, {
      env,
      onProgress: line => {
        const parsed = parseYtdlpLine(line);
        if (!parsed) return;
        if (parsed.type === 'dest') {
          updateLine(`  [${stem}] ↓ 下载 ${parsed.ext}...`);
        } else if (parsed.type === 'merge') {
          updateLine(`  [${stem}] ↔ 合并中...`);
        } else if (parsed.type === 'progress') {
          const pct = Math.round(parsed.percent);
          if (pct === lastPercent) return; // skip duplicate updates
          lastPercent = pct;
          const bar = textBar(parsed.percent, 20);
          const sizeStr = `${parsed.downloaded}${parsed.downloadedUnit}`;
          const speedStr = parsed.speed > 0 ? `${parsed.speed}${parsed.speedUnit}/s` : '---';
          const etaStr = parsed.eta || '--:--';
          updateLine(`  [${stem}] ${bar} ${parsed.percent}% | ${sizeStr} @ ${speedStr} | ETA ${etaStr}`);
        }
      },
    });
  }

  try {
    await retryCall(doDownload, maxRetries, retryDelay, stem);
  } catch (e) {
    clearLine();
    process.stderr.write('\n');
    const errMsg = (e.stderr || e.message || '').slice(-2000);
    lockedPrint(styleFail(`[${stem}] 下载失败: ${errMsg.slice(0, 200)}`));
    return { file: null, retries: maxRetries, error: errMsg.slice(0, 500) };
  }

  clearLine();
  process.stderr.write('\n');

  const elapsed = Date.now() - downloadStart;
  const downloaded = findDownloadedFile(dlDir, stem);
  if (downloaded) {
    const sizeMB = (fs.statSync(downloaded).size / 1024 / 1024).toFixed(1);
    const dur = getDuration(downloaded);
    const durStr = dur ? `, ${fmtDuration(dur)}` : '';
    lockedPrint(styleDone(`[${stem}] 下载完成 -> ${path.basename(downloaded)} (${sizeMB} MB, ${fmtElapsed(elapsed)}${durStr})`));
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

async function stepTranscode(srcFile, sheetName, maxRetries, retryDelay, force, timeout = 1200) {
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

  const transcodeStart = Date.now();
  resetFfmpegState();

  async function doTranscode() {
    const args = [
      '-y', '-i', srcFile,
      '-progress', 'pipe:1', '-nostats',
      ...FFMPEG_TRANSCODE_ARGS, outFile,
    ];
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let lastPct = -1;

    // Parse stdout for progress ( pipe:1 sends progress to stdout)
    const rlOut = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rlOut.on('line', line => {
      const prog = parseFfmpegProgress(line, totalDur);
      if (prog && prog.percent !== lastPct) {
        lastPct = prog.percent;
        const bar = textBar(prog.percent, 20);
        const elapsedStr = fmtTime(prog.elapsed);
        const sizeStr = prog.totalSize > 0 ? fmtSize(prog.totalSize) : '';
        const speedStr = prog.speed > 0 ? `${prog.speed.toFixed(1)}x` : '';
        updateLine(`  [${stem}] ${bar} ${prog.percent}% | ${elapsedStr} ${sizeStr} ${speedStr}`);
      }
    });

    child.stderr.on('data', d => { stderr += d.toString(); });

    return new Promise((resolve, reject) => {
      let timer;
      if (timeout > 0) {
        timer = setTimeout(() => {
          child.kill();
          reject(Object.assign(new Error(`Transcode timeout after ${timeout}s`), { name: 'TimeoutError' }));
        }, timeout * 1000);
      }

      child.on('close', code => {
        if (timer) clearTimeout(timer);
        if (code === 0) resolve();
        else reject(Object.assign(new Error(`ffmpeg exit code ${code}`), { stderr }));
      });
      child.on('error', err => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  try {
    await retryCall(doTranscode, maxRetries, retryDelay, stem);
    clearLine();
    process.stderr.write('\n');
    const elapsed = Date.now() - transcodeStart;
    const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
    const durStr = totalDur ? `, ${fmtDuration(totalDur)}` : '';
    lockedPrint(styleDone(`[${stem}] 转码完成 -> ${path.basename(outFile)} (${sizeMB} MB, ${fmtElapsed(elapsed)}${durStr})`));
    return { file: outFile, retries: 0, error: null };
  } catch (e) {
    clearLine();
    process.stderr.write('\n');
    const errMsg = (e.stderr || e.message || '').slice(-2000);
    lockedPrint(styleFail(`[${stem}] 转码失败: ${errMsg.slice(0, 200)}`));
    return { file: null, retries: maxRetries, error: errMsg.slice(0, 500) };
  }
}

// ============================== 识别 ==============================
async function stepTranscribe(audioFile, maxRetries, retryDelay, timeout = 0) {
  const stem = path.parse(audioFile).name;
  const transcribeStart = Date.now();

  const whisperOk = await checkWhisperAvailable();
    if (!whisperOk) {
    let backend;
    if (WHISPER_BACKEND === 'local') backend = 'local CLI';
    else if (WHISPER_BACKEND === 'faster-whisper') backend = 'faster-whisper (whisper-ctranslate2)';
    else if (WHISPER_BACKEND === 'funasr') backend = `funasr/${FUNASR_MODE}`;
    else backend = WHISPER_SERVICE;
    logWarn(`[${stem}] whisper not available (${backend})`);
    return { text: null, retries: 0, error: `whisper not available (${backend})` };
  }

  const fileSizeMB = (fs.statSync(audioFile).size / (1024 * 1024)).toFixed(1);
  const dur = getDuration(audioFile);
  const durStr = dur ? `, 时长 ${Math.floor(dur / 60)}:${(dur % 60).toFixed(0).padStart(2, '0')}` : '';
  let modeLabel, modelLabel, langLabel;
  if (WHISPER_BACKEND === 'local') {
    modeLabel = 'local';
    modelLabel = WHISPER_MODEL;
    langLabel = WHISPER_LANGUAGE || 'auto';
  } else if (WHISPER_BACKEND === 'faster-whisper') {
    modeLabel = 'faster-whisper';
    modelLabel = `${WHISPER_MODEL}/${WHISPER_COMPUTE_TYPE}`;
    langLabel = WHISPER_LANGUAGE || 'auto';
  } else if (WHISPER_BACKEND === 'funasr') {
    modeLabel = `funasr/${FUNASR_MODE}`;
    if (FUNASR_MODE === 'service') {
      modelLabel = path.basename(FUNASR_SERVICE_MODEL) || '(server default)';
    } else {
      const _m = [FUNASR_MODEL];
      if (FUNASR_VAD_MODEL)  _m.push(FUNASR_VAD_MODEL);
      if (FUNASR_PUNC_MODEL) _m.push(FUNASR_PUNC_MODEL);
      modelLabel = _m.join('+');
    }
    langLabel = FUNASR_LANGUAGE || 'auto';
  } else {
    modeLabel = 'service';
    modelLabel = WHISPER_SERVICE_MODEL ? path.basename(WHISPER_SERVICE_MODEL) : '(default)';
    langLabel = 'auto';
  }
  lockedPrint(styleStart(`[${stem}] 开始语音识别 [${modeLabel}/${modelLabel}/${langLabel}/T${WHISPER_TEMPERATURE}] (${fileSizeMB}MB${durStr})`));

  startSpinner(`[${stem}] 识别中`);
  let result;
  try {
    if (WHISPER_BACKEND === 'local') {
      result = await transcribeLocal(audioFile, stem, maxRetries, retryDelay);
    } else if (WHISPER_BACKEND === 'faster-whisper') {
      result = await transcribeFasterWhisper(audioFile, stem, maxRetries, retryDelay);
    } else if (WHISPER_BACKEND === 'funasr') {
      result = await transcribeFunasr(audioFile, stem, maxRetries, retryDelay, timeout);
    } else {
      result = await transcribeService(audioFile, stem, maxRetries, retryDelay, timeout);
    }
  } finally {
    stopSpinner();
  }

  const transcribeElapsed = Date.now() - transcribeStart;
  if (result.text) {
    lockedPrint(styleDone(`[${stem}] 识别完成 (${fmtElapsed(transcribeElapsed)}, ${result.text.length} 字符)`));
  } else {
    lockedPrint(styleFail(`[${stem}] 识别失败: ${result.error}`));
  }
  return result;
}

async function transcribeLocal(audioFile, stem, maxRetries, retryDelay, timeout = 0) {
  const outDir = path.dirname(audioFile);

  async function doTranscribe() {
    const args = [
      audioFile,
      '--task', WHISPER_TASK,
      '--model', WHISPER_MODEL,
      '--device', WHISPER_DEVICE,
      '--beam_size', WHISPER_BEAM_SIZE,
      '--best_of', WHISPER_BEST_OF,
      '--fp16', WHISPER_FP16,
      '--condition_on_previous_text', WHISPER_CONDITION_ON_PREV,
    ];
    if (WHISPER_MODEL_DIR) args.push('--model_dir', WHISPER_MODEL_DIR);
    if (WHISPER_LANGUAGE) args.push('--language', WHISPER_LANGUAGE);
    args.push('--temperature', WHISPER_TEMPERATURE);
    if (WHISPER_TEMPERATURE_INC) args.push('--temperature_increment_on_fallback', WHISPER_TEMPERATURE_INC);
    if (WHISPER_INITIAL_PROMPT) args.push('--initial_prompt', WHISPER_INITIAL_PROMPT);
    if (WHISPER_THREADS && WHISPER_THREADS !== '0') args.push('--threads', WHISPER_THREADS);
    args.push('--output_format', WHISPER_OUTPUT_FORMAT, '--output_dir', outDir);

    // 合并 WHISPER_EXTRA_ARGS（CLI > .env），去重后追加
    const finalArgs = mergeWhisperArgs(args, _resolvedWhisperExtraArgs);

    const { stderr } = await spawnWithTimeout('whisper', finalArgs, timeout, {
      onProgress: (_src, line) => {
        if (line.trim()) {
          // whisper progress: "[00:00.000 --> 00:30.000]  text..." → show end timestamp
          const m = line.match(/^\[[\d:.]+\s*-->\s*([\d:.]+)\]/);
          if (m) updateLine(`[${stem}] 识别中... ${m[1]}`);
        }
      }
    });
    // whisper writes output to {stem}.{ext}
    const outExt = WHISPER_OUTPUT_FORMAT === 'json' ? 'json' : 'txt';
    const outFile = path.join(outDir, `${stem}.${outExt}`);
    if (!fs.existsSync(outFile)) {
      throw new Error('whisper output file not generated');
    }
    const raw = fs.readFileSync(outFile, 'utf-8').trim();
    if (WHISPER_OUTPUT_FORMAT === 'json') {
      // Extract text from JSON output
      try {
        return JSON.parse(raw).text || '';
      } catch {
        return raw; // fallback to raw
      }
    }
    return raw;
  }

  try {
    const { result: text, retriesUsed, error } = await retryCall(doTranscribe, maxRetries, retryDelay, stem);
    if (error) return { text: null, retries: retriesUsed, error };
    return { text, retries: 0, error: null };
  } catch (e) {
    // e.stderr 来自 spawnWithTimeout（已包含 stderr 预览）
    // e.message 在 spawnWithTimeout 修复后也已包含 stderr
    const _detail = String(e.stderr || e.message || e).slice(0, 5000);
    logError(_detail);
    return { text: null, retries: maxRetries, error: _detail };
  }
}

/**
 * faster-whisper 后端识别（使用 whisper-ctranslate2 CLI）。
 * 构建命令行参数，与 Python 版保持一致的参数语义和识别效果。
 */
async function transcribeFasterWhisper(audioFile, stem, maxRetries, retryDelay, timeout = 0) {
  const outDir = path.dirname(audioFile);

  async function doTranscribe() {
    // 注意：whisper-ctranslate2 CLI 参数与 faster-whisper Python API 有差异：
    //   · 没有 --num_workers（Python API 参数，CLI 用 --threads 控制并行）
    //   · VAD 阈值参数名是 --vad_threshold（Python API 用 vad_parameters.onset）
    const args = [
      audioFile,
      '--task', WHISPER_TASK,
      '--model', WHISPER_MODEL,
      '--device', WHISPER_DEVICE,
      '--compute_type', WHISPER_COMPUTE_TYPE,
      '--beam_size', WHISPER_BEAM_SIZE,
      '--best_of', WHISPER_BEST_OF,
      '--condition_on_previous_text', WHISPER_CONDITION_ON_PREV,
      '--vad_filter', WHISPER_VAD_FILTER,
    ];
    if (WHISPER_VAD_FILTER.toLowerCase() === 'true' && WHISPER_VAD_ONSET) {
      args.push('--vad_threshold', WHISPER_VAD_ONSET);
    }
    if (WHISPER_MODEL_DIR) args.push('--model_directory', WHISPER_MODEL_DIR);
    if (WHISPER_LANGUAGE) args.push('--language', WHISPER_LANGUAGE);
    args.push('--temperature', WHISPER_TEMPERATURE);
    if (WHISPER_TEMPERATURE_INC) args.push('--temperature_increment_on_fallback', WHISPER_TEMPERATURE_INC);
    if (WHISPER_INITIAL_PROMPT) args.push('--initial_prompt', WHISPER_INITIAL_PROMPT);
    if (WHISPER_THREADS && WHISPER_THREADS !== '0') args.push('--threads', WHISPER_THREADS);
    args.push('--output_format', WHISPER_OUTPUT_FORMAT, '--output_dir', outDir);

    // 合并 WHISPER_EXTRA_ARGS（CLI > .env），去重后追加
    const finalArgs = mergeWhisperArgs(args, _resolvedWhisperExtraArgs);

    // whisper-ctranslate2 的 stderr 进度格式与 openai-whisper 一致，直接复用解析
    const { stderr } = await spawnWithTimeout('whisper-ctranslate2', finalArgs, timeout, {
      onProgress: (_src, line) => {
        if (line.trim()) {
          const m = line.match(/^\[[\d:.]+\s*-->\s*([\d:.]+)\]/);
          if (m) updateLine(`[${stem}] 识别中... ${m[1]}`);
        }
      }
    });
    // whisper-ctranslate2 输出文件: {stem}.{ext}
    const outExt = WHISPER_OUTPUT_FORMAT === 'json' ? 'json' : 'txt';
    const outFile = path.join(outDir, `${stem}.${outExt}`);
    if (!fs.existsSync(outFile)) {
      throw new Error('whisper-ctranslate2 output file not generated');
    }
    const raw = fs.readFileSync(outFile, 'utf-8').trim();
    if (WHISPER_OUTPUT_FORMAT === 'json') {
      try {
        return JSON.parse(raw).text || '';
      } catch {
        return raw;
      }
    }
    return raw;
  }

  try {
    const { result: text, retriesUsed, error } = await retryCall(doTranscribe, maxRetries, retryDelay, stem);
    if (error) return { text: null, retries: retriesUsed, error };
    return { text, retries: 0, error: null };
  } catch (e) {
    // e.stderr 来自 spawnWithTimeout（已包含 stderr 预览）
    // e.message 在 spawnWithTimeout 修复后也已包含 stderr
    const _detail = String(e.stderr || e.message || e).slice(0, 5000);
    logError(_detail);
    return { text: null, retries: maxRetries, error: _detail };
  }
}

/**
 * FunASR 后端识别（funasr CLI 模式或 funasr-server 模式）。
 * - FUNASR_MODE=cli      → 本地 funasr CLI (funasr ++model=... ++input=...)
 * - FUNASR_MODE=service  → 远程 funasr-server (OpenAI 兼容 API /v1/audio/transcriptions)
 */
async function transcribeFunasr(audioFile, stem, maxRetries, retryDelay, timeout = 0) {
  if (FUNASR_MODE === 'service') {
    return await transcribeFunasrService(audioFile, stem, maxRetries, retryDelay, timeout);
  }
  return await transcribeFunasrCli(audioFile, stem, maxRetries, retryDelay, timeout);
}

/**
 * FunASR CLI 模式：funasr ++model ++input 直接调用。
 * 首次会自动从 ModelScope 下载模型（~/.cache/modelscope/hub）。
 *
 * 注意：funasr CLI 基于 Hydra 框架，其 override 解析器不支持非 ASCII 字符（如中文路径）。
 * 当音频路径包含非 ASCII 字符时，先复制到临时 ASCII 路径再执行。
 */
async function transcribeFunasrCli(audioFile, stem, maxRetries, retryDelay, timeout = 0) {
  // 检测路径是否含非 ASCII 字符，需要时复制到临时路径
  const hasNonAscii = /[^\x00-\x7F]/.test(audioFile);
  let actualInput = audioFile;
  let tempDir = null;
  let tempInput = null;
  let tempJson = null;
  let tempTxt = null;
  if (hasNonAscii) {
    tempDir = path.join(os.tmpdir(), `funasr_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const ext = path.extname(audioFile);
    tempInput = path.join(tempDir, `input${ext}`);
    fs.copyFileSync(audioFile, tempInput);
    actualInput = tempInput;
    tempJson = `${tempInput}.json`;
    tempTxt = `${tempInput}.txt`;
    lockedPrint(`  [${stem}] funasr: 路径含非 ASCII 字符，已复制到临时路径 ${tempInput}`);
  }

  const jsonFile = hasNonAscii ? tempJson : `${audioFile}.json`;
  const txtFile = hasNonAscii ? tempTxt : `${audioFile}.txt`;

  async function doTranscribe() {
    const args = [
      `++model=${FUNASR_MODEL}`,
      `++input=${actualInput}`,
    ];
    if (FUNASR_VAD_MODEL)    args.push(`++vad_model=${FUNASR_VAD_MODEL}`);
    if (FUNASR_PUNC_MODEL)   args.push(`++punc_model=${FUNASR_PUNC_MODEL}`);
    if (FUNASR_SPK_MODEL)    args.push(`++spk_model=${FUNASR_SPK_MODEL}`);
    if (FUNASR_EMOTION_MODEL) args.push(`++emotion_model=${FUNASR_EMOTION_MODEL}`);
    if (FUNASR_HOTWORD)      args.push(`++hotword=${FUNASR_HOTWORD}`);
    if (FUNASR_LANGUAGE)     args.push(`++language=${FUNASR_LANGUAGE}`);
    if (FUNASR_DEVICE === 'cuda') args.push('++device=cuda');

    // 合并 FUNASR_EXTRA_ARGS（CLI > .env），去重后追加
    const finalArgs = mergeWhisperArgs(args, _resolvedFunasrExtraArgs);

    // funasr CLI 把结果 print 到 stdout（不写文件），格式通常是：
    //   [{'key': 'value', 'text': '识别文本...'}, ...]  （Python repr 格式，非标准 JSON）
    // 也可能输出纯文本。优先从 stdout 解析，回退到文件（兼容旧版行为）。
    const { stdout, stderr } = await spawnWithTimeout('funasr', finalArgs, timeout, {
      onProgress: (_src, line) => {
        if (line.trim()) updateLine(`[${stem}] funasr 加载/识别中... ${line.trim().slice(-40)}`);
      }
    });

    let text = '';
    // 1. 优先从 stdout 解析
    const stdoutTrim = (stdout || '').trim();
    if (stdoutTrim) {
      // 尝试 JSON 解析（funasr 输出的 Python repr 可能不是合法 JSON）
      try {
        const arr = JSON.parse(stdoutTrim);
        if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object') {
          text = (arr[0].text || '').trim();
        } else if (typeof arr === 'string') {
          text = arr.trim();
        } else {
          text = String(arr).trim();
        }
      } catch {
        // JSON 解析失败，尝试从 stdout 提取 text 字段（Python dict repr 格式）
        const m = stdoutTrim.match(/['"]text['"]\s*:\s*['"](.+?)['"]/s);
        if (m) {
          text = m[1].trim();
        } else {
          // 直接当纯文本用
          text = stdoutTrim;
        }
      }
    }
    // 2. 回退：检查输出文件（某些 funasr 版本可能写文件）
    if (!text && jsonFile && fs.existsSync(jsonFile)) {
      const raw = fs.readFileSync(jsonFile, 'utf-8').trim();
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object') {
          text = (arr[0].text || '').trim();
        } else if (typeof arr === 'string') {
          text = arr.trim();
        } else {
          text = String(arr).trim();
        }
      } catch {
        text = raw;
      }
    }
    if (!text && txtFile && fs.existsSync(txtFile)) {
      text = fs.readFileSync(txtFile, 'utf-8').trim();
    }
    if (!text) throw new Error('funasr 返回空文本（stdout 和文件均无内容）');
    return text;
  }

  try {
    const { result: text, retriesUsed, error } = await retryCall(doTranscribe, maxRetries, retryDelay, stem);
    if (error) return { text: null, retries: retriesUsed, error };
    return { text, retries: 0, error: null };
  } catch (e) {
    const _detail = String(e.stderr || e.message || e).slice(0, 5000);
    logError(_detail);
    return { text: null, retries: maxRetries, error: _detail };
  } finally {
    // 清理临时文件（非 ASCII 路径复制场景）
    if (tempDir) {
      for (const f of [tempInput, tempJson, tempTxt]) {
        if (f) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
      }
      try { fs.rmdirSync(tempDir); } catch { /* ignore */ }
    }
  }
}

/**
 * FunASR 服务模式：调用 funasr-server 的 OpenAI 兼容 API。
 * funasr-server 默认端口 8899, 接口: POST {URL}/v1/audio/transcriptions
 */
async function transcribeFunasrService(audioFile, stem, maxRetries, retryDelay, timeout = 0) {
  async function doTranscribe() {
    const fileBlob = await fs.openAsBlob(audioFile);
    const form = new FormData();
    form.append('file', fileBlob, path.basename(audioFile));
    form.append('model', FUNASR_SERVICE_MODEL);
    form.append('response_format', 'json');
    if (FUNASR_HOTWORD) form.append('prompt', FUNASR_HOTWORD);
    if (FUNASR_LANGUAGE) form.append('language', FUNASR_LANGUAGE);

    const controller = new AbortController();
    let timer;
    if (timeout > 0) timer = setTimeout(() => controller.abort(), timeout * 1000);
    const resp = await fetch(`${FUNASR_SERVICE_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`/v1/audio/transcriptions failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const text = (data.text || '').trim();
    if (!text) throw new Error('funasr-server returned empty text');
    return text;
  }

  try {
    const { result: text, retriesUsed, error } = await retryCall(doTranscribe, maxRetries, retryDelay, stem);
    if (error) return { text: null, retries: retriesUsed, error };
    return { text, retries: 0, error: null };
  } catch (e) {
    // e.stderr 来自 spawnWithTimeout（已包含 stderr 预览）
    // e.message 在 spawnWithTimeout 修复后也已包含 stderr
    const _detail = String(e.stderr || e.message || e).slice(0, 5000);
    logError(_detail);
    return { text: null, retries: maxRetries, error: _detail };
  }
}

async function transcribeService(audioFile, stem, maxRetries, retryDelay, timeout = 0) {
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
      form.append('response_format', WHISPER_OUTPUT_FORMAT);

      const controller = new AbortController();
      let timer;
      if (timeout > 0) {
        timer = setTimeout(() => controller.abort(), timeout * 1000);
      }
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
    if (error) return { text: null, retries: retriesUsed, error };
    return { text, retries: 0, error: null };
  } catch (e) {
    // e.stderr 来自 spawnWithTimeout（已包含 stderr 预览）
    // e.message 在 spawnWithTimeout 修复后也已包含 stderr
    const _detail = String(e.stderr || e.message || e).slice(0, 5000);
    logError(_detail);
    return { text: null, retries: maxRetries, error: _detail };
  }
}

// ============================== 增量进度写回 ==============================

/**
 * 每完成一个任务立即写入 progress JSON + 实时回写 Excel。
 *
 * 目录结构: output/progress/{sheet}/task_{stem}.json
 * 文件包含 content（识别文本）和 keywords（AI 分析）等关键字段。
 */
async function saveTaskProgress(result) {
  const progressDir = path.join(PROGRESS_DIR, result.sheet);
  fs.mkdirSync(progressDir, { recursive: true });
  const progressFile = path.join(progressDir, `task_${result.stem}.json`);

  const content = (result.transcribe.status === 'success' && typeof result.transcribe.file === 'string')
    ? result.transcribe.file : null;
  const keywords = (result.analyze.status === 'success' && typeof result.analyze.file === 'string')
    ? result.analyze.file : null;

  const data = {
    sheet: result.sheet,
    id_val: result.id_val,
    title: result.title,
    stem: result.stem,
    platform: result.platform,
    video_url: result.video_url,
    overall_status: result.overall_status,
    error: result.error,
    content,
    keywords,
    download: {
      status: result.download.status,
      file: result.download.file,
      error: result.download.error,
      retries_used: result.download.retries_used,
    },
    transcode: {
      status: result.transcode.status,
      file: result.transcode.file,
      error: result.transcode.error,
      retries_used: result.transcode.retries_used,
    },
    transcribe: {
      status: result.transcribe.status,
      error: result.transcribe.error,
      retries_used: result.transcribe.retries_used,
    },
    analyze: {
      status: result.analyze.status,
      error: result.analyze.error,
      retries_used: result.analyze.retries_used,
    },
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(progressFile, JSON.stringify(data, null, 2), 'utf-8');

  // 打印简短提示（使用动态 PROGRESS_DIR 而非硬编码路径）
  const relPath = path.relative(BASE_DIR, progressFile).replace(/\\/g, '/');
  const infoParts = [result.overall_status];
  if (content) infoParts.push(`content(${content.length} chars)`);
  if (keywords) infoParts.push(`keywords(${keywords.length} chars)`);
  lockedPrint(
    c('dim', `  📄 进度已保存: ${relPath}`)
    + c('dim', `  [${infoParts.join(', ')}]`)
  );

  // 释放内存：content / keywords 已持久化到 JSON，可安全清空
  result.transcribe.file = null;
  result.analyze.file = null;

  // ── 断点续跑：实时回写 Excel（断电时仍能保留已完成的识别/分析结果）──
  if (content) {
    try {
      const release = await acquireExcelLock();
      try { writeExcelCellByKey(result.sheet, String(result.id_val), COL_CONTENT, content); }
      finally { release(); }
    } catch (e) {
      logWarn(`[${result.stem}] 实时写 Excel content 失败（不影响 progress JSON）: ${e.message}`);
    }
  }
  if (keywords) {
    try {
      const release = await acquireExcelLock();
      try { writeExcelCellByKey(result.sheet, String(result.id_val), COL_KEYWORDS, keywords); }
      finally { release(); }
    } catch (e) {
      logWarn(`[${result.stem}] 实时写 Excel keywords 失败（不影响 progress JSON）: ${e.message}`);
    }
  }
}

// ============================== Excel 批量写回 ==============================
function writeAllContentsToExcel(results, keywordsDict = null, contentDict = null) {
  if (!results.length) return;

  // 优先使用预先收集的 contentDict（run 阶段已从 result 对象提取，避免大文本驻留内存）
  const updates = contentDict || new Map();
  if (!contentDict) {
    for (const r of results) {
      if (r.transcribe.status === 'success' && r.transcribe.file) {
        const text = r.transcribe.file;
        if (text.trim()) {
          updates.set(`${r.sheet}|${r.id_val}`, text);
        }
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
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
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
      if (r.error) { console.log(`    ${c('red', '错误:')}`); printLong(r.error); }
      if (r.download.status === 'failed') { console.log(`    ${c('red', '下载失败:')}`); printLong(r.download.error); }
      if (r.transcode.status === 'failed') { console.log(`    ${c('red', '转码失败:')}`); printLong(r.transcode.error); }
      if (r.transcribe.status === 'failed') { console.log(`    ${c('red', '识别失败:')}`); printLong(r.transcribe.error); }
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
  whisperAvailable, positionLabel = '', downloadTimeout = 1800, transcodeTimeout = 1200,
  transcribeTimeout = 0, analyzeTimeout = 300) {

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

  // ── 断点续跑：读取上次 progress，按 status=success 跳过已完成 step ──
  const prior = force ? null : loadTaskProgress(sheetName, stem);
  const skipSteps = new Set();
  if (prior) {
    if (prior.download && prior.download.status === 'success' && prior.download.file
        && fs.existsSync(prior.download.file) && fs.statSync(prior.download.file).size > 0) {
      skipSteps.add('download');
      result.download = new StepResult('success', prior.download.file, null, 0);
    }
    if (prior.transcode && prior.transcode.status === 'success' && prior.transcode.file
        && fs.existsSync(prior.transcode.file) && fs.statSync(prior.transcode.file).size > 0) {
      skipSteps.add('transcode');
      result.transcode = new StepResult('success', prior.transcode.file, null, 0);
    }
    if (prior.transcribe && prior.transcribe.status === 'success') {
      const tp = transcriptPath(sheetName, stem);
      if (fs.existsSync(tp)) {
        const cachedText = fs.readFileSync(tp, 'utf-8');
        if (validateTranscriptText(cachedText).ok) {
          skipSteps.add('transcribe');
          result.transcribe = new StepResult('success', cachedText, null, 0);
        }
      }
    }
    if (prior.analyze && prior.analyze.status === 'success') {
      const kp = keywordsPath(sheetName, stem);
      if (fs.existsSync(kp)) {
        const cachedKw = fs.readFileSync(kp, 'utf-8');
        if (validateKeywordsText(cachedKw).ok) {
          skipSteps.add('analyze');
          result.analyze = new StepResult('success', cachedKw, null, 0);
        }
      }
    }
    if (skipSteps.size) {
      lockedPrint(c('cyan', `  ♻️ 断点续跑：跳过已完成步骤 ${[...skipSteps].sort()}`)
        + c('dim', `  [来源: progress JSON]`));
    }
  }

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
    if (skipSteps.has('download')) {
      dlFile = result.download.file;
      lockedPrint(c('dim', `  [${stem}] ♻️ 跳过 download，复用 ${path.basename(dlFile)}`));
    } else {
      try {
        const { file, retries, error } = await stepDownload(row, sheetName, maxRetries, retryDelay, force, downloadTimeout);
        dlFile = file;
        result.download = new StepResult(file ? 'success' : 'failed', file, error, retries);
      } catch (e) {
        result.download = new StepResult('failed', null, String(e.message).slice(0, 500), maxRetries);
        // 失败清理残留
        safeRemove(path.join(DOWNLOADS_DIR, sheetName, `${stem}.part`));
        safeRemove(path.join(DOWNLOADS_DIR, sheetName, `${stem}.ytdl`));
      }
      if (!dlFile) {
        result.overall_status = 'failed';
        result.error = `download failed: ${result.download.error}`;
        return result;
      }
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
    if (skipSteps.has('transcode')) {
      tcFile = result.transcode.file;
      lockedPrint(c('dim', `  [${stem}] ♻️ 跳过 transcode，复用 ${path.basename(tcFile)}`));
    } else {
      try {
        const { file, retries, error } = await stepTranscode(dlFile, sheetName, maxRetries, retryDelay, force, transcodeTimeout);
        tcFile = file;
        result.transcode = new StepResult(file ? 'success' : 'failed', file, error, retries);
      } catch (e) {
        result.transcode = new StepResult('failed', null, String(e.message).slice(0, 500), maxRetries);
        // 失败清理损坏的转码文件
        const bad = path.join(TRANSCODED_DIR, sheetName, stem + TRANSCODE_EXT);
        if (fs.existsSync(bad) && fs.statSync(bad).size === 0) safeRemove(bad);
      }
      if (!tcFile) {
        result.overall_status = 'partial';
        result.error = `download success but transcode failed: ${result.transcode.error}`;
        return result;
      }
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
    if (skipSteps.has('transcribe')) {
      const cached = result.transcribe.file;
      lockedPrint(c('dim', `  [${stem}] ♻️ 跳过 transcribe，复用缓存文本(${cached.length}字符)`));
    } else {
      let text = null, retries = 0, error = null;
      try {
        const r = await stepTranscribe(tcFile, maxRetries, retryDelay, transcribeTimeout);
        text = r.text; retries = r.retries; error = r.error;
      } catch (e) {
        error = String(e.message).slice(0, 500);
      }
      const v = validateTranscriptText(text);
      if (!v.ok) {
        text = null;
        error = error || v.err;
        safeRemove(transcriptPath(sheetName, stem));
      }
      result.transcribe = new StepResult(text ? 'success' : 'failed', text, error, retries);
      if (!text) {
        result.overall_status = 'partial';
        result.error = `download+transcode success but transcribe failed: ${error}`;
        return result;
      }
    }
    // 落盘 transcript（断点续跑校验依据）
    try { fs.writeFileSync(transcriptPath(sheetName, stem), result.transcribe.file, 'utf-8'); }
    catch (e) { logWarn(`[${stem}] 写入 transcript 失败: ${e.message}`); }
  }

  // ── AI analyze ──
  if (steps.includes('analyze') && result.transcribe.status === 'success') {
    const aiEnabled = (process.env.AI_ENABLED || 'true').toLowerCase() === 'true';
    if (aiEnabled) {
      if (skipSteps.has('analyze')) {
        const cached = result.analyze.file;
        lockedPrint(c('dim', `  [${stem}] ♻️ 跳过 analyze，复用缓存关键词(${cached.length}字符)`));
        result.analyze = new StepResult('success', cached, null, 0);
      } else {
        const txt = result.transcribe.file;
        if (txt) {
          let kw = null, retries = 0, error = null;
          try {
            const aiStart = Date.now();
            const r = await stepAnalyze(txt, maxRetries, retryDelay, analyzeTimeout, result.stem);
            kw = r.text; retries = r.retries; error = r.error;
            if (kw) {
              lockedPrint(`  [${result.stem}] ${c('green', 'AI analysis done')} (${fmtElapsed(Date.now() - aiStart)}, ${kw.length} chars)`);
            } else {
              lockedPrint(`  [${result.stem}] ${c('red', 'AI analysis failed')}: ${error}`);
            }
          } catch (e) {
            error = String(e.message).slice(0, 500);
            retries = maxRetries;
          }
          const v = validateKeywordsText(kw);
          if (!v.ok) {
            kw = null;
            error = error || v.err;
            safeRemove(keywordsPath(sheetName, stem));
          }
          result.analyze = new StepResult(kw ? 'success' : 'failed', kw, error, retries);
        } else {
          result.analyze = new StepResult('skipped', null, 'content empty');
        }
      }
      // 落盘 keywords
      if (result.analyze.status === 'success' && result.analyze.file) {
        try { fs.writeFileSync(keywordsPath(sheetName, stem), result.analyze.file, 'utf-8'); }
        catch (e) { logWarn(`[${stem}] 写入 keywords 失败: ${e.message}`); }
      }
    } else {
      result.analyze = new StepResult('skipped');
    }
  } else if (steps.includes('analyze') && result.transcribe.status !== 'success') {
    result.analyze = new StepResult('skipped', null, 'transcribe not successful, skip AI analysis');
  }

  // ── 统一判定整体状态（和本地文件模式一致）──
  if (result.transcode.status === 'failed') {
    result.overall_status = 'failed';
  } else if (result.transcribe.status === 'failed' && steps.includes('transcribe')) {
    result.overall_status = 'partial';
  } else if (result.analyze.status === 'failed') {
    result.overall_status = 'partial';
  } else if (result.overall_status === 'pending') {
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
        const dur = getDuration(file);
        const durStr = dur ? `, ${fmtDuration(dur)}` : '';
        lockedPrint(styleDone(`[${usedStem}] 转码完成: ${path.basename(file)} (${size} MB${durStr})`));
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
          lockedPrint(styleFail(`[${usedStem}] 识别失败:`));
          printLong(error);
          result.transcribe = new StepResult('failed', null, error);
        }
      } catch (e) {
        lockedPrint(styleFail(`[${usedStem}] 识别异常:`));
        printLong(e.message || e);
        result.transcribe = new StepResult('failed', null, String(e.stderr || e.message || e));
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
        const aiStart = Date.now();
        const { text: kw, error } = await stepAnalyze(transcribeText, maxRetries, retryDelay, analyzeTimeout, usedStem);
        if (kw && typeof kw === 'string') {
          analyzeText = kw;
          lockedPrint(styleDone(`[${usedStem}] AI 分析完成 (${fmtElapsed(Date.now() - aiStart)}, ${kw.length} 字符)`));
          result.analyze = new StepResult('success', kw);
        } else {
          lockedPrint(styleFail(`[${usedStem}] AI 分析失败:`));
          printLong(error);
          result.analyze = new StepResult('failed', null, error);
        }
      } catch (e) {
        lockedPrint(styleFail(`[${usedStem}] AI 分析异常:`));
        printLong(e.stderr || e.message || e);
        result.analyze = new StepResult('failed', null, String(e.stderr || e.message || e));
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
        const aiStart = Date.now();
        const { text: kw, retries, error } = await stepAnalyze(
          contentText, maxRetries, retryDelay, analyzeTimeout, stem
        );
        result.analyze = new StepResult(kw ? 'success' : 'failed', kw, error, retries);
        if (kw) {
          lockedPrint(styleDone(`[${stem}] AI 分析完成 (${fmtElapsed(Date.now() - aiStart)}, ${kw.length} 字符)`));
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
      let backend;
    if (WHISPER_BACKEND === 'local') backend = 'local CLI';
    else if (WHISPER_BACKEND === 'faster-whisper') backend = 'faster-whisper (whisper-ctranslate2)';
    else if (WHISPER_BACKEND === 'funasr') backend = `funasr/${FUNASR_MODE}`;
    else backend = WHISPER_SERVICE;
      logWarn(`⚠️ whisper not available (${backend}), transcribe step will fail`);
    }
  }

  // ── 断点续跑：扫描 progress JSON，统计将跳过的任务/步骤数 ──
  if (!force) {
    let skippedTasks = 0, resumeTasks = 0;
    for (const { row, sheetName } of tasks) {
      const prior = loadTaskProgress(sheetName, stemName(row, sheetName));
      if (!prior) continue;
      if (prior.overall_status === 'success') skippedTasks++;
      else resumeTasks++;
    }
    if (skippedTasks || resumeTasks) {
      console.log('');
      console.log(c('cyan', `  ♻️ 断点续跑扫描: 完整跳过 ${skippedTasks} 条 / 部分续跑 ${resumeTasks} 条 / 全量重跑 ${tasks.length - skippedTasks - resumeTasks} 条`));
      console.log('');
    }
  }

  // ── 并发执行 ──
  const results = [];
  const contentMap = new Map();   // "sheet|id" → text（提前收集，saveTaskProgress 后会释放内存）
  const kwMap = new Map();        // "sheet|id" → keywords
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
      // ── 收集 content / keywords 再保存进度（保存后会释放内存）──
      if (result.transcribe.status === 'success' && typeof result.transcribe.file === 'string') {
        contentMap.set(`${result.sheet}|${result.id_val}`, result.transcribe.file);
      }
      if (result.analyze.status === 'success' && typeof result.analyze.file === 'string') {
        kwMap.set(`${result.sheet}|${result.id_val}`, result.analyze.file);
      }
      saveTaskProgress(result).catch(e => logWarn(`saveTaskProgress failed: ${e.message}`));
      lockedPrint('');
      lockedPrint(c('dim', '─'.repeat(62)));
      console.log(`\n${overall.summaryLine()}\n`);
      return result;
    })
  );

  await Promise.all(taskFns);

  // ── 批量写回 Excel ──
  if (steps.includes('transcribe') || contentColumn) {
    writeAllContentsToExcel(results, kwMap.size ? kwMap : null,
                            contentMap.size ? contentMap : null);
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
    let backend;
    if (WHISPER_BACKEND === 'local') backend = 'local CLI';
    else if (WHISPER_BACKEND === 'faster-whisper') backend = 'faster-whisper (whisper-ctranslate2)';
    else if (WHISPER_BACKEND === 'funasr') {
      backend = FUNASR_MODE === 'service'
        ? `funasr/service (${FUNASR_SERVICE_URL})`
        : `funasr/cli (${FUNASR_MODEL})`;
    } else backend = `service ${WHISPER_SERVICE}`;
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
  const contentMap = new Map();   // "sheet|id" → text（提前收集，saveTaskProgress 后会释放内存）
  const kwMap = new Map();        // "sheet|id" → keywords
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
      // ── 收集 content / keywords 再保存进度（保存后会释放内存）──
      if (result.transcribe.status === 'success' && typeof result.transcribe.file === 'string') {
        contentMap.set(`${result.sheet}|${result.id_val}`, result.transcribe.file);
      }
      if (result.analyze.status === 'success' && typeof result.analyze.file === 'string') {
        kwMap.set(`${result.sheet}|${result.id_val}`, result.analyze.file);
      }
      saveTaskProgress(result).catch(e => logWarn(`saveTaskProgress failed: ${e.message}`));
      lockedPrint('');
      lockedPrint(c('dim', '─'.repeat(62)));
      console.log(`\n${overall.summaryLine()}\n`);
      return result;
    })
  );

  await Promise.all(taskFns);

  if (steps.includes('transcribe')) {
    writeAllContentsToExcel(results, kwMap.size ? kwMap : null,
                            contentMap.size ? contentMap : null);
  }

  const config = {
    retry_from: reportPath, steps, max_retries: maxRetries,
    retry_delay: retryDelay, concurrency, force
  };
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
    .option('--download-timeout <n>', '下载超时（秒），默认 1800（30分钟），设为 0 则不限制', v => parseInt(v, 10), 1800)
    .option('--transcode-timeout <n>', '转码超时（秒），默认 1200（20分钟），设为 0 则不限制', v => parseInt(v, 10), 1200)
    .option('--transcribe-timeout <n>', '识别超时（秒），默认 0（不限制），设为 >0 则启用超时', v => parseInt(v, 10), 0)
    .option('--analyze-timeout <n>', 'AI 分析超时（秒），默认 300（5分钟），设为 0 则不限制', v => parseInt(v, 10), 300)
    .option('--dry-run', '干跑模式，只列任务不执行')
    .option('--retry-failed <path>', '从报告 JSON 重跑失败项（output/reports/{sheet}/report_xxx.json）')
    .option('--init', '复制 .env.example 到当前目录并重命名为 .env')
    .option('--file <path>', '指定 Excel 文件路径（优先级高于 EXCEL_FILE 环境变量）')
    .option('--input <path>', '指定本地视频文件路径（跳过下载，直接转码→识别→分析）')
    .option('--content <text|path>', '直接提供文本内容（文件路径或内联文本），跳过下载/转码/识别，直接做 AI 分析')
    .option('--content-column <col>', 'Excel 模式：指定包含已爬取文本的列名，批量做 AI 分析')
    .option('--url <url>', '直接指定视频下载链接（跳过 Excel），支持标准链接和内嵌链接')
    .option('--name <name>', '指定输出文件名，不含扩展名（与 --url / --input / --content 配合使用）')
    .option('--env-file <path>', '指定要加载的 .env 文件路径（默认: 当前目录 .env）')
    .option('--output <dir>', '指定输出根目录（覆盖 OUTPUT_DIR 环境变量；子目录 downloads/transcoded/transcripts/keywords/reports/progress/logs 自动创建）')
    .option('--whisper-initial-prompt <text|path>', 'Whisper 初始提示词（文本或文件路径，CLI 优先级最高）')
    .option('--ai-prompt <text|path>', 'AI 分析提示词模板（文本或文件路径，CLI 优先级最高）')
    .option('--whisper-extra-args <args>', 'Whisper 额外参数（shell 字符串，如 "--beam_size 5 --best_of 5"，最高优先级且自动去重）')
    .option('--funasr-extra-args <args>', 'FunASR 额外参数（shell 字符串，如 "--batch_size_s 600"，最高优先级且自动去重）');

  program.parse();

  const opts = program.opts();

  // ── CLI 覆盖：提示词文件/文本归一化 + whisper extra args ──
  applyCliOverrides(opts);

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

  // ── output 覆盖（CLI > env > 默认 "output"）──
  if (opts.output) {
    const newRoot = path.isAbsolute(opts.output)
      ? path.resolve(opts.output)
      : path.resolve(BASE_DIR, opts.output);
    if (newRoot !== OUTPUT_DIR) {
      applyOutputDir(newRoot, logInfo);
    }
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
        let backend;
    if (WHISPER_BACKEND === 'local') backend = 'local CLI';
    else if (WHISPER_BACKEND === 'faster-whisper') backend = 'faster-whisper (whisper-ctranslate2)';
    else if (WHISPER_BACKEND === 'funasr') backend = `funasr/${FUNASR_MODE}`;
    else backend = WHISPER_SERVICE;
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
        let backend;
    if (WHISPER_BACKEND === 'local') backend = 'local CLI';
    else if (WHISPER_BACKEND === 'faster-whisper') backend = 'faster-whisper (whisper-ctranslate2)';
    else if (WHISPER_BACKEND === 'funasr') backend = `funasr/${FUNASR_MODE}`;
    else backend = WHISPER_SERVICE;
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
