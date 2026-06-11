#!/usr/bin/env node
/**
 * Release script - 一键发布流程
 *
 * 特性:
 * - 上下键选择版本类型
 * - 确认默认 Y
 * - Conventional Commits 分节 changelog
 * - 自动推送到所有 remote
 *
 * 用法:
 *   npm run release              # 交互式发布
 *   npm run release -- --dry-run # 预览（不实际执行）
 *   npm run release -- --patch   # 直接 patch 发布
 *   npm run release -- --minor   # 直接 minor 发布
 *   npm run release -- --major   # 直接 major 发布
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { select, confirm } from '@inquirer/prompts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function c(color, text) { return `${COLORS[color]}${text}${COLORS.reset}`; }

function run(cmd, { silent = false, cwd = ROOT } = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd, stdio: silent ? 'pipe' : 'inherit' });
  } catch (e) {
    if (!silent) console.error(c('red', `\n❌ Command failed: ${cmd}`));
    throw e;
  }
}

function runSilent(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' }).trim();
  } catch { return ''; }
}

// 获取最新的 git tag（比 git describe 更可靠，纯 JS 处理避免 Windows cmd 下 head/tail 不可用）
function getLastTag() {
  const tags = runSilent('git tag --sort=-v:refname --merged HEAD');
  if (!tags) return '';
  return tags.split('\n').filter(Boolean)[0] || '';
}

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  return pkg.version;
}

function bumpVersion(current, type) {
  const parts = current.split('.').map(Number);
  switch (type) {
    case 'major': parts[0]++; parts[1] = 0; parts[2] = 0; break;
    case 'minor': parts[1]++; parts[2] = 0; break;
    case 'patch': parts[2]++; break;
  }
  return parts.join('.');
}

function getRemotes() {
  const output = runSilent('git remote -v');
  const remotes = {};
  for (const line of output.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((push|fetch)\)/);
    if (m) {
      if (!remotes[m[1]]) remotes[m[1]] = {};
      remotes[m[1]][m[3]] = m[2];
    }
  }
  return remotes;
}

// ==================== Changelog 生成（Conventional Commits 分节） ====================

const SECTION_MAP = {
  feat:     { label: 'Features' },
  fix:      { label: 'Bug Fixes' },
  perf:     { label: 'Performance' },
  refactor: { label: 'Refactoring' },
  docs:     { label: 'Documentation' },
  style:    { label: 'Styles' },
  test:     { label: 'Tests' },
  ci:       { label: 'CI/CD' },
  build:    { label: 'Build' },
  chore:    { label: 'Chores' },
  revert:   { label: 'Reverts' },
};

function parseConventionalCommit(line) {
  // Match: <hash> <type>(<scope>): <subject>
  // or just: <hash> <subject>
  const m = line.match(/^([a-f0-9]+)\s+(?:(\w+)(?:\([^)]*\))?[!]?:\s+)?(.+)/);
  if (!m) return { hash: line.slice(0, 7), type: 'other', subject: line };
  let type = m[2] || 'other';
  // Normalize breaking changes
  if (line.includes('BREAKING CHANGE') || line.includes('BREAKING:')) {
    type = 'BREAKING';
  }
  return { hash: m[1].slice(0, 7), type, subject: m[3].trim() };
}

function generateChangelogEntry(version, date) {
  // Get commits since last tag, or all commits if no tag
  const lastTag = getLastTag();
  let range;
  if (lastTag) {
    range = `${lastTag}..HEAD`;
  } else {
    range = 'HEAD';
  }

  const log = runSilent(`git log --oneline --no-merges ${range}`);
  if (!log) return `## [${version}] - ${date}\n\n_No changes._\n`;

  const commits = log.split('\n').filter(Boolean).map(parseConventionalCommit)
    // 过滤 chore(release): vX.Y.Z 提交
    .filter(c => !(c.type === 'chore' && /^v\d+\.\d+\.\d+/.test(c.subject)));
  
  if (!commits.length) return `## ${version} — ${date}\n\n_No changes._\n`;

  // Group by type
  const groups = {};
  const BREAKING = [];
  for (const c of commits) {
    if (c.type === 'BREAKING') {
      BREAKING.push(c);
      continue;
    }
    if (!groups[c.type]) groups[c.type] = [];
    groups[c.type].push(c);
  }

  // Build sections
  const lines = [];
  lines.push(`## [${version}] - ${date}`);
  lines.push('');

  // BREAKING first
  if (BREAKING.length) {
    lines.push('### BREAKING CHANGES');
    lines.push('');
    for (const c of BREAKING) {
      lines.push(`- ${c.subject} (\`${c.hash}\`)`);
    }
    lines.push('');
  }

  // Then each conventional commit type
  const orderedTypes = ['feat', 'fix', 'perf', 'refactor', 'docs', 'style', 'test', 'ci', 'build', 'chore', 'revert', 'other'];
  for (const type of orderedTypes) {
    if (!groups[type] || !groups[type].length) continue;
    const section = SECTION_MAP[type] || { label: 'Other' };
    lines.push(`### ${section.label}`);
    lines.push('');
    for (const c of groups[type]) {
      lines.push(`- ${c.subject} (\`${c.hash}\`)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function updateChangelog(version, date) {
  const entry = generateChangelogEntry(version, date);
  let existing = fs.existsSync(CHANGELOG_PATH)
    ? fs.readFileSync(CHANGELOG_PATH, 'utf-8')
    : '# Changelog\n\n';

  // 移除可能存在的同名版本旧条目（防止重复）
  // 兼容条目在文件开头（无前置 \n）和在中间两种情况
  const esc = version.replace(/\./g, '\\.');
  const re = new RegExp(`(^|\\n)## \\[${esc}\\] - .*?(?=\\n## |$)`, 's');
  existing = existing.replace(re, '');

  // 插入新条目到 header 之后
  const headerEnd = existing.indexOf('\n## ');
  if (headerEnd === -1) {
    fs.writeFileSync(CHANGELOG_PATH, `# Changelog\n\n${entry}\n`);
  } else {
    const before = existing.slice(0, headerEnd);
    const after = existing.slice(headerEnd);
    fs.writeFileSync(CHANGELOG_PATH, `${before}\n${entry}\n${after}`);
  }
}

// ==================== Preview ====================

function showChanges() {
  const lastTag = getLastTag();
  let range;
  if (lastTag) range = `${lastTag}..HEAD`;
  else range = 'HEAD';

  const log = runSilent(`git log --oneline --no-merges ${range}`);
  if (log) {
    const lines = log.split('\n').filter(Boolean);
    const types = {};
    for (const line of lines) {
      const p = parseConventionalCommit(line);
      types[p.type] = (types[p.type] || 0) + 1;
    }
    console.log(`\n  ${c('bold', String(lines.length))} commits since last tag:\n`);
    for (const [type, count] of Object.entries(types)) {
      const icon = (SECTION_MAP[type] || {}).label || type;
      console.log(`    ${icon}: ${count}`);
    }
  } else {
    console.log(c('dim', '  (no commits since last tag)'));
  }
  console.log('');
}

// ==================== Main ====================
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  console.log(c('bold', '\n🚀 Video Processor Release Tool\n'));

  // ── 1. Pre-flight checks ──
  console.log(c('dim', '── Step 1: Pre-flight checks ──'));

  const status = runSilent('git status --porcelain');
  if (status) {
    console.log(c('yellow', '\n⚠️  Uncommitted changes detected:\n'));
    console.log(runSilent('git status --short'));
    console.log('');
  } else {
    console.log(c('green', '✅ Working directory clean\n'));
  }

  // Run tests
  console.log(c('dim', 'Running tests...'));
  try {
    run('npm test', { silent: true });
    console.log(c('green', '✅ Tests passed\n'));
  } catch {
    console.log(c('red', '❌ Tests failed! Fix issues before releasing.\n'));
    process.exit(1);
  }

  // ── 2. Version selection (arrow keys) ──
  console.log(c('dim', '── Step 2: Version bump ──'));
  const current = getVersion();

  let bumpType = null;
  for (const arg of args) {
    if (['--patch', '--minor', '--major'].includes(arg)) {
      bumpType = arg.replace('--', '');
      break;
    }
  }

  if (!bumpType) {
    const patchVer = bumpVersion(current, 'patch');
    const minorVer = bumpVersion(current, 'minor');
    const majorVer = bumpVersion(current, 'major');

    console.log(`\n  Current version: ${c('bold', current)}\n`);

    bumpType = await select({
      message: '选择版本类型 (↑↓ 移动, Enter 确认)',
      choices: [
        { name: `patch: ${current} → ${patchVer} (bug fixes)`, value: 'patch' },
        { name: `minor: ${current} → ${minorVer} (new features)`, value: 'minor' },
        { name: `major: ${current} → ${majorVer} (breaking changes)`, value: 'major' },
      ],
      default: 'patch',
    });
  }

  const newVersion = bumpVersion(current, bumpType);
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n  → New version: ${c('bold', c('green', newVersion))}\n`);

  // ── 3. Show changes preview ──
  console.log(c('dim', '── Step 3: Changes in this release ──'));
  showChanges();

  // Show changelog preview
  console.log(c('dim', '── Changelog preview ──'));
  const changelogPreview = generateChangelogEntry(newVersion, today);
  console.log(changelogPreview);
  console.log('');

  if (isDryRun) {
    console.log(c('yellow', '🏁 Dry-run complete. No changes made.\n'));
    return;
  }

  // ── 4. Confirm (default Y) ──
  const confirmed = await confirm({
    message: `Ready to release v${newVersion}?`,
    default: true,
  });

  if (!confirmed) {
    console.log(c('yellow', '\n❌ Release cancelled.\n'));
    return;
  }

  // ── 5. Execute release ──
  console.log(c('dim', '\n── Step 4: Executing release ──\n'));

  // Update version
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  pkg.version = newVersion;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
  console.log(c('green', `✅ Version bumped to ${newVersion}`));

  // Generate changelog
  updateChangelog(newVersion, today);
  console.log(c('green', '✅ Changelog updated'));

  // Commit and tag
  run(`git add package.json CHANGELOG.md`);
  run(`git commit -m "chore(release): v${newVersion}"`);
  run(`git tag -a v${newVersion} -m "Release v${newVersion}"`);
  console.log(c('green', `✅ Commit & tag created: v${newVersion}`));

  // ── 6. Push to all remotes ──
  console.log(c('dim', '\n── Step 5: Pushing to remotes ──'));
  const remotes = getRemotes();
  const remoteNames = Object.keys(remotes);

  if (remoteNames.length === 0) {
    console.log(c('red', '❌ No git remotes configured!\n'));
    process.exit(1);
  }

  // Identify GitHub remote name
  const githubRemote = remoteNames.find(name => {
    const url = remotes[name].push || remotes[name].fetch || '';
    return url.includes('github.com');
  });

  console.log(`\n  Detected ${c('bold', String(remoteNames.length))} remote(s):`);
  for (const name of remoteNames) {
    const url = remotes[name].push || remotes[name].fetch || '';
    const isGitee = url.includes('gitee.com');
    const isGitHub = url.includes('github.com');
    const label = isGitee ? 'Gitee' : isGitHub ? 'GitHub' : 'Other';
    console.log(`    ${c('cyan', name)} → ${label} (${url})`);
  }

  let githubPushed = false;

  for (const name of remoteNames) {
    const url = remotes[name].push || remotes[name].fetch || '';
    const isGitHub = url.includes('github.com');

    try {
      // Show full output for GitHub push (helps debug auth/network issues)
      run(`git push ${name} main --tags`, { silent: !isGitHub });
      console.log(c('green', `✅ Pushed to ${name}`));
      if (isGitHub) githubPushed = true;
    } catch (e) {
      if (isGitHub) {
        // GitHub push is critical — workflow won't trigger without it
        console.log(c('red', `\n❌ Failed to push to GitHub (${name})!`));
        console.log(c('red', '   GitHub Actions workflow will NOT trigger.'));
        console.log(c('red', `   Error: ${e.stderr || e.message}`));
        console.log(c('yellow', '\n💡 Troubleshooting:'));
        console.log(c('yellow', '  1. Check GitHub credentials:'));
        console.log(c('yellow', '     git config --global credential.helper'));
        console.log(c('yellow', '  2. Try manual push:'));
        console.log(c('yellow', `     git push ${name} main --tags`));
        console.log(c('yellow', '  3. Check network / VPN / proxy settings\n'));
        process.exit(1);
      } else {
        console.log(c('yellow', `⚠️  Failed to push to ${name}, continuing...`));
      }
    }
  }

  // Verify tag on GitHub (ensure workflow will trigger)
  if (githubPushed && githubRemote) {
    console.log(c('dim', '\n  Verifying tag on GitHub...'));
    const remoteTag = runSilent(`git ls-remote --tags ${githubRemote} refs/tags/v${newVersion}`);
    if (remoteTag) {
      console.log(c('green', `  ✅ Tag v${newVersion} confirmed on GitHub`));
    } else {
      console.log(c('yellow', `  ⚠️  Tag v${newVersion} may still be syncing to GitHub`));
    }
  }

  // ── 7. Summary ──
  console.log(c('bold', c('green', '\n🎉 Release v' + newVersion + ' completed!\n')));

  if (githubPushed) {
    console.log(c('dim', 'GitHub Actions will automatically:'));
    console.log(c('dim', '  • Run tests'));
    console.log(c('dim', '  • Publish to npm'));
    console.log(c('dim', '  • Create GitHub Release'));
  } else {
    console.log(c('yellow', '💡 To enable npm auto-publish:'));
    console.log(c('yellow', '  1. Add a GitHub remote:'));
    console.log(c('yellow', '     git remote add github https://github.com/USER/REPO.git'));
    console.log(c('yellow', '  2. Set NPM_TOKEN secret in GitHub repository settings'));
    console.log(c('yellow', '  3. Push tags to trigger the workflow'));
  }

  console.log('');
}

main().catch(err => {
  console.error(c('red', `\n❌ Release failed: ${err.message}\n`));
  process.exit(1);
});
