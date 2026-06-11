#!/usr/bin/env node
/**
 * 按正确的 tag 增量范围重建 CHANGELOG.md
 * 用法：node scripts/regenerate-changelog.js
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');

const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
function c(color, text) { return `${COLORS[color]}${text}${COLORS.reset}`; }

function runSilent(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' }).trim();
  } catch { return ''; }
}

// ── 正确的 getLastTag（纯 JS 处理，避免 Windows cmd 下 head/tail 不可用）──
function getLastTag() {
  const tags = runSilent('git tag --sort=-v:refname --merged HEAD');
  if (!tags) return '';
  return tags.split('\n').filter(Boolean)[0] || '';
}

const SECTION_MAP = {
  feat:      { label: '✨ Features',        emoji: '✨' },
  fix:       { label: '🐛 Bug Fixes',       emoji: '🐛' },
  perf:      { label: '⚡ Performance',      emoji: '⚡' },
  refactor:  { label: '♻️ Refactoring',      emoji: '♻️' },
  docs:      { label: '📝 Documentation',    emoji: '📝' },
  style:     { label: '💄 Styles',           emoji: '💄' },
  test:      { label: '✅ Tests',            emoji: '✅' },
  ci:        { label: '🔄 CI/CD',            emoji: '🔄' },
  build:     { label: '📦 Build',            emoji: '📦' },
  chore:     { label: '🔧 Chores',           emoji: '🔧' },
  revert:    { label: '⏪ Reverts',          emoji: '⏪' },
};

function parseConventionalCommit(line) {
  const m = line.match(/^([a-f0-9]+)\s+(?:(\w+)(?:\([^)]*\))?[!]?:\s+)?(.+)/);
  if (!m) return { hash: line.slice(0, 7), type: 'other', subject: line };
  let type = m[2] || 'other';
  if (line.includes('BREAKING CHANGE') || line.includes('BREAKING:')) type = 'BREAKING';
  return { hash: m[1].slice(0, 7), type, subject: m[3].trim() };
}

/**
 * 为指定 tag 生成 changelog 条目
 * @param {string} tag        当前 tag（如 "v1.0.2"）
 * @param {string} date       tag 对应的日期
 * @param {string} prevTag   前一个 tag（可用于增量范围）
 * @param {string} range     git log 范围
 */
function generateEntry(tag, date, range) {
  const log = runSilent(`git log --oneline --no-merges ${range}`);
  if (!log) return `## ${tag.replace(/^v/, '')} — ${date}\n\n_No changes._\n`;

  const commits = log.split('\n').filter(Boolean).map(parseConventionalCommit)
    .filter(c => !(c.type === 'chore' && /^v\d+\.\d+\.\d+/.test(c.subject)));

  if (!commits.length) return `## ${tag.replace(/^v/, '')} — ${date}\n\n_No changes._\n`;

  const groups = {};
  const BREAKING = [];
  for (const c of commits) {
    if (c.type === 'BREAKING') { BREAKING.push(c); continue; }
    if (!groups[c.type]) groups[c.type] = [];
    groups[c.type].push(c);
  }

  const lines = [];
  lines.push(`## ${tag.replace(/^v/, '')} — ${date}`);
  lines.push('');

  if (BREAKING.length) {
    lines.push('### ⚠️ BREAKING CHANGES');
    lines.push('');
    for (const c of BREAKING) lines.push(`- ${c.subject} (\`${c.hash}\`)`);
    lines.push('');
  }

  const orderedTypes = ['feat','fix','perf','refactor','docs','style','test','ci','build','chore','revert','other'];
  for (const type of orderedTypes) {
    if (!groups[type] || !groups[type].length) continue;
    const section = SECTION_MAP[type] || { label: 'Other' };
    lines.push(`### ${section.label}`);
    lines.push('');
    for (const c of groups[type]) lines.push(`- ${c.subject} (\`${c.hash}\`)`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── 主逻辑 ──
console.log(c('bold', '\n🔄 Regenerating CHANGELOG.md...\n'));

// 1. 获取所有 tag（升序）
const allTagsAsc = runSilent('git tag --sort=v:refname').split('\n').filter(Boolean);
console.log(`Found ${c('bold', String(allTagsAsc.length))} tag(s): ${allTagsAsc.join(', ')}`);

// 2. 获取每个 tag 的日期
function getTagDate(tag) {
  const d = runSilent(`git log -1 --format=%ai ${tag}`);
  return d ? d.slice(0, 10) : '2099-01-01';
}

// 3. 按「从旧到新」的顺序生成每个 tag 的条目
const entries = [];

for (let i = 0; i < allTagsAsc.length; i++) {
  const tag = allTagsAsc[i];
  const prevTag = i === 0 ? null : allTagsAsc[i - 1];
  const range = prevTag ? `${prevTag}..${tag}` : tag;
  const date = getTagDate(tag);

  console.log(`  → Processing ${tag} (range: ${range}, date: ${date})`);
  const entry = generateEntry(tag, date, range);
  entries.push(entry);
}

// 4. 未发布的提交（HEAD vs 最新 tag）
const latestTag = allTagsAsc[allTagsAsc.length - 1];
if (latestTag) {
  const unreleasedRange = `${latestTag}..HEAD`;
  const unreleasedLog = runSilent(`git log --oneline --no-merges ${unreleasedRange}`);
  if (unreleasedLog) {
    const date = new Date().toISOString().slice(0, 10);
    console.log(`  → Processing unreleased (range: ${unreleasedRange})`);
    const entry = generateEntry('HEAD', date, unreleasedRange);
    // 替换标题中的 "HEAD" 为 "Unreleased"
    entries.push(entry.replace(/^## HEAD — .+/, `## Unreleased — ${date}`));
  }
}

// 5. 写入文件（新 → 旧，即最新在最上面）
const output = ['# Changelog', '', ...entries.reverse().join('\n').split('\n')].join('\n');
fs.writeFileSync(CHANGELOG_PATH, output);
console.log(c('green', `\n✅ CHANGELOG.md regenerated (${allTagsAsc.length} tag(s) + unreleased)`));
console.log(c('dim', '\nPreview (first 40 lines):\n'));
console.log(output.split('\n').slice(0, 40).join('\n'));
