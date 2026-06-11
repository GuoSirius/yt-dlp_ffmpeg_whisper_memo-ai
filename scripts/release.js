#!/usr/bin/env node
/**
 * Release script - 一键发布流程
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
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');

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

function getChanges(version) {
  // Get commits since last tag
  const lastTag = runSilent('git describe --tags --abbrev=0 2>/dev/null');
  let range;
  if (lastTag) {
    range = `${lastTag}..HEAD`;
  } else {
    range = 'HEAD';
  }
  const log = runSilent(`git log --oneline --no-merges ${range}`);
  return log;
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ==================== Main ====================
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  console.log(c('bold', '\n🚀 Video Processor Release Tool\n'));

  // ── 1. Check prerequisites ──
  console.log(c('dim', '── Step 1: Pre-flight checks ──'));

  // Check git status
  const status = runSilent('git status --porcelain');
  if (status) {
    console.log(c('yellow', '\n⚠️  Uncommitted changes detected:\n'));
    console.log(runSilent('git status --short'));
    console.log('');

    const commitNow = await ask(c('cyan', 'Commit these changes now? (enter message, or press Enter to skip): '));
    if (commitNow) {
      run(`git add -A`);
      run(`git commit -m "${commitNow}"`);
      console.log(c('green', '✅ Changes committed.\n'));
    } else {
      console.log(c('yellow', '⚠️  Proceeding with uncommitted changes...\n'));
    }
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

  // ── 2. Version selection ──
  console.log(c('dim', '── Step 2: Version bump ──'));
  const current = getVersion();

  // Try to determine version from args
  let bumpType = null;
  for (const arg of args) {
    if (['--patch', '--minor', '--major'].includes(arg)) {
      bumpType = arg.replace('--', '');
      break;
    }
  }

  if (!bumpType) {
    // Show preview of each option
    const patchVer = bumpVersion(current, 'patch');
    const minorVer = bumpVersion(current, 'minor');
    const majorVer = bumpVersion(current, 'major');

    console.log(`\n  Current version: ${c('bold', current)}\n`);
    console.log(`  ${c('cyan', '[1]')} patch: ${current} → ${c('green', patchVer)}`);
    console.log(`  ${c('cyan', '[2]')} minor: ${current} → ${c('green', minorVer)}`);
    console.log(`  ${c('cyan', '[3]')} major: ${current} → ${c('green', majorVer)}`);

    const choice = await ask(`\n${c('cyan', 'Select version type [1/2/3] (default: 1): ')}`);

    if (choice === '3') bumpType = 'major';
    else if (choice === '2') bumpType = 'minor';
    else bumpType = 'patch';
  }

  const newVersion = bumpVersion(current, bumpType);
  console.log(`\n  → New version: ${c('bold', c('green', newVersion))}\n`);

  // ── 3. Show changes ──
  console.log(c('dim', '── Step 3: Changes in this release ──'));
  const changes = getChanges();
  if (changes) {
    console.log('\n' + changes + '\n');
  } else {
    console.log(c('dim', '  (no changes detected)\n'));
  }

  if (isDryRun) {
    console.log(c('yellow', '🏁 Dry-run complete. No changes made.\n'));
    return;
  }

  // ── 4. Confirm ──
  const confirm = await ask(c('cyan', `Ready to release v${newVersion}? [y/N]: `));
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
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

  // Generate changelog (using auto-changelog if installed)
  try {
    run('npx auto-changelog -p --commit-limit false --template ./scripts/changelog-template.hbs', { silent: true });
    console.log(c('green', '✅ Changelog updated'));
  } catch {
    // auto-changelog might not be installed yet
    const lastTag = runSilent('git describe --tags --abbrev=0 2>/dev/null');
    let range;
    if (lastTag) range = `${lastTag}..HEAD`;
    else range = 'HEAD';

    const log = runSilent(`git log --oneline --no-merges ${range}`);
    const changelogPath = path.join(ROOT, 'CHANGELOG.md');
    const newEntry = `## ${newVersion}\n\n${log ? log.split('\n').map(l => `- ${l}`).join('\n') : '- Initial release'}\n\n`;
    const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf-8') : '# Changelog\n\n';
    fs.writeFileSync(changelogPath, existing.replace('# Changelog\n\n', `# Changelog\n\n${newEntry}`));
    console.log(c('green', '✅ Changelog updated (manual mode)'));
  }

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

  console.log(`\n  Detected ${c('bold', String(remoteNames.length))} remote(s):`);
  for (const name of remoteNames) {
    const url = remotes[name].push || remotes[name].fetch;
    const isGitee = url.includes('gitee.com');
    const isGitHub = url.includes('github.com');
    const label = isGitee ? 'Gitee' : isGitHub ? 'GitHub' : 'Other';
    console.log(`    ${c('cyan', name)} → ${label} (${url})`);
  }

  for (const name of remoteNames) {
    try {
      run(`git push ${name} main --tags`, { silent: true });
      console.log(c('green', `✅ Pushed to ${name}`));
    } catch {
      console.log(c('yellow', `⚠️  Failed to push to ${name}, continuing...`));
    }
  }

  // ── 7. Summary ──
  console.log(c('bold', c('green', '\n🎉 Release v' + newVersion + ' completed!\n')));

  // Check if GitHub remote exists
  const hasGithub = remoteNames.some(name => {
    const url = remotes[name].push || remotes[name].fetch || '';
    return url.includes('github.com');
  });

  if (hasGithub) {
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
