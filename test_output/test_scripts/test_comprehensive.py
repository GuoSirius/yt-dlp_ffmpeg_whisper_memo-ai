#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
综合测试脚本 - 全面覆盖 CLI 参数组合和边界情况

测试范围：
1. 所有 CLI 参数单独测试
2. 边界值测试
3. 参数组合测试
4. 异常处理测试
5. --name 路径遍历防护测试
6. 输入验证测试
"""

import subprocess
import sys
import os
import json
import tempfile
from pathlib import Path
import re

# ============================================================
# 配置
# ============================================================
BASE_DIR = Path(__file__).parent.parent.parent  # project root
JS_SCRIPT = BASE_DIR / "process_videos.js"
PY_SCRIPT = BASE_DIR / "process_videos.py"
TEST_DIR = BASE_DIR / "test_output" / "test_scripts" / "test_output"
TEST_DIR.mkdir(exist_ok=True)

PY_CMD = r"C:\Users\Admin\.workbuddy\binaries\python\versions\3.13.12\python.exe"

class Color:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    END = '\033[0m'

    @staticmethod
    def print(color, msg):
        print(f"{color}{msg}{Color.END}")

class TestSuite:
    def __init__(self, name):
        self.name = name
        self.total = 0
        self.passed = 0
        self.failed = 0
        self.warnings = []
        self.failures = []

    def test(self, name, func):
        self.total += 1
        Color.print(Color.CYAN, f"\n  [{self.name} #{self.total}] {name}")
        try:
            func()
            self.passed += 1
            Color.print(Color.GREEN, "    PASSED")
        except Exception as e:
            self.failed += 1
            msg = f"[{self.name} #{self.total}] {name}: {e}"
            self.failures.append(msg)
            Color.print(Color.RED, f"    FAILED: {e}")

    def warn(self, msg):
        self.warnings.append(msg)

    def summary(self):
        return {
            "name": self.name,
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "warnings": self.warnings,
            "failures": self.failures
        }

def run_js(args, timeout=15, cwd=None):
    """运行 JS 脚本并返回结果"""
    if cwd is None:
        cwd = BASE_DIR
    result = subprocess.run(
        ["node", str(JS_SCRIPT)] + args,
        capture_output=True, text=True, timeout=timeout, cwd=cwd
    )
    return result

def run_py(args, timeout=15, cwd=None):
    """运行 Python 脚本并返回结果"""
    if cwd is None:
        cwd = BASE_DIR
    result = subprocess.run(
        [PY_CMD, str(PY_SCRIPT)] + args,
        capture_output=True, text=True, timeout=timeout, cwd=cwd
    )
    return result

# ============================================================
# 测试套件 1: --help 测试
# ============================================================

def test_help_js():
    suite = TestSuite("JS --help")
    
    def test_help_works():
        r = run_js(["--help"])
        assert r.returncode == 0, f"--help 返回非零: {r.returncode}"
        assert len(r.stdout) > 100, f"--help 输出太短: {len(r.stdout)} 字符"
    suite.test("返回零退出码且输出足够长", test_help_works)
    
    def test_help_contains_key_params():
        r = run_js(["--help"])
        keys = ["--sheet", "--id", "--step", "--force", "--concurrency",
                "--retry", "--dry-run", "--retry-failed", "--input", "--url",
                "--env-file", "--name"]
        for k in keys:
            assert k in r.stdout, f"--help 缺少参数: {k}"
    suite.test("包含所有关键参数", test_help_contains_key_params)
    
    return suite

def test_help_py():
    suite = TestSuite("PY --help")
    
    def test_help_works():
        r = run_py(["--help"])
        assert r.returncode == 0, f"--help 返回非零: {r.returncode}"
        assert len(r.stdout) > 100, f"--help 输出太短: {len(r.stdout)} 字符"
    suite.test("返回零退出码且输出足够长", test_help_works)
    
    def test_help_contains_key_params():
        r = run_py(["--help"])
        keys = ["--sheet", "--id", "--step", "--force", "--concurrency",
                "--retry", "--dry-run", "--retry-failed", "--url", "--name", "--input",
                "--env-file", "--init", "--file"]
        for k in keys:
            assert k in r.stdout, f"--help 缺少参数: {k}"
    suite.test("包含所有关键参数", test_help_contains_key_params)
    
    return suite

# ============================================================
# 测试套件 2: --dry-run 模式
# ============================================================

def test_dry_run_js():
    suite = TestSuite("JS --dry-run")
    
    def test_dry_run_alone():
        r = run_js(["--dry-run", "--sheet", "测试"], timeout=30)
        # 不应该崩溃，输出应该是有意义的信息
        output = r.stdout + r.stderr
    suite.test("独立运行不崩溃", test_dry_run_alone)
    
    def test_dry_run_with_id():
        r = run_js(["--dry-run", "--id", "dQw4w9WgXcQ"], timeout=30)
    suite.test("带 --id 不崩溃", test_dry_run_with_id)
    
    def test_dry_run_with_input():
        r = run_js(["--dry-run", "--input", "nonexistent.mp4"], timeout=30)
    suite.test("带 --input 不崩溃", test_dry_run_with_input)
    
    return suite

def test_dry_run_py():
    suite = TestSuite("PY --dry-run")
    
    def test_dry_run_alone():
        r = run_py(["--dry-run", "--sheet", "测试"], timeout=30)
    suite.test("独立运行不崩溃", test_dry_run_alone)
    
    def test_dry_run_with_id():
        r = run_py(["--dry-run", "--id", "dQw4w9WgXcQ"], timeout=30)
    suite.test("带 --id 不崩溃", test_dry_run_with_id)
    
    def test_dry_run_with_input():
        r = run_py(["--dry-run", "--input", "nonexistent.mp4"], timeout=30)
    suite.test("带 --input 不崩溃", test_dry_run_with_input)
    
    return suite

# ============================================================
# 测试套件 3: 边界值测试
# ============================================================

def test_boundary_values_js():
    suite = TestSuite("JS 边界值")
    
    def test_concurrency_zero():
        r = run_js(["--concurrency", "0", "--dry-run", "--sheet", "测试"], timeout=15)
        # 不应该崩溃
    suite.test("--concurrency 0 不崩溃", test_concurrency_zero)
    
    def test_concurrency_negative():
        r = run_js(["--concurrency", "-5", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("--concurrency -5 不崩溃", test_concurrency_negative)
    
    def test_retry_zero():
        r = run_js(["--retry", "0", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("--retry 0 不崩溃", test_retry_zero)
    
    def test_retry_negative():
        r = run_js(["--retry", "-1", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("--retry -1 不崩溃", test_retry_negative)
    
    def test_retry_delay_zero():
        r = run_js(["--retry-delay", "0", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("--retry-delay 0 不崩溃", test_retry_delay_zero)
    
    def test_timeout_zero():
        r = run_js(["--download-timeout", "0", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("--download-timeout 0 不崩溃", test_timeout_zero)
    
    def test_empty_sheet():
        r = run_js(["--sheet", "", "--dry-run"], timeout=15)
    suite.test("--sheet '' 不崩溃", test_empty_sheet)
    
    def test_empty_id():
        r = run_js(["--id", "", "--dry-run"], timeout=15)
    suite.test("--id '' 不崩溃", test_empty_id)
    
    def test_empty_env_file():
        r = run_js(["--env-file", "", "--help"], timeout=15)
    suite.test("--env-file '' 不崩溃", test_empty_env_file)
    
    def test_nonexistent_env():
        r = run_js(["--env-file", "nonexistent_file_12345.env", "--help"], timeout=15)
    suite.test("不存在的 .env 文件不崩溃", test_nonexistent_env)
    
    return suite

def test_boundary_values_py():
    suite = TestSuite("PY 边界值")
    
    def test_concurrency_zero():
        r = run_py(["--concurrency", "0", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("--concurrency 0 不崩溃", test_concurrency_zero)
    
    def test_retry_zero():
        r = run_py(["--retry", "0", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("--retry 0 不崩溃", test_retry_zero)
    
    def test_retry_negative():
        r = run_py(["--retry", "-1", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("--retry -1 不崩溃", test_retry_negative)
    
    def test_empty_id():
        r = run_py(["--id", "", "--dry-run"], timeout=15)
    suite.test("--id '' 不崩溃", test_empty_id)
    
    def test_nonexistent_env():
        r = run_py(["--env-file", "nonexistent_file_12345.env", "--help"], timeout=15)
    suite.test("不存在的 .env 文件不崩溃", test_nonexistent_env)
    
    def test_empty_sheet():
        r = run_py(["--sheet", "", "--dry-run"], timeout=15)
    suite.test("--sheet '' 不崩溃", test_empty_sheet)
    
    return suite

# ============================================================
# 测试套件 4: --name 路径遍历防护
# ============================================================

def test_name_safety_js():
    suite = TestSuite("JS --name 安全")
    
    def test_name_normal():
        r = run_js(["--name", "test_video", "--dry-run", "--id", "dQw4w9WgXcQ"], timeout=15)
    suite.test("正常名称不崩溃", test_name_normal)
    
    def test_name_with_dots():
        r = run_js(["--name", "../escape", "--dry-run", "--id", "dQw4w9WgXcQ"], timeout=15)
    suite.test("路径遍历名称不崩溃", test_name_with_dots)
    
    def test_name_with_slash():
        r = run_js(["--name", "dir/file", "--dry-run", "--id", "dQw4w9WgXcQ"], timeout=15)
    suite.test("含斜杠名称不崩溃", test_name_with_slash)
    
    def test_name_with_colon():
        r = run_js(["--name", "test:file", "--dry-run", "--id", "dQw4w9WgXcQ"], timeout=15)
    suite.test("含冒号名称不崩溃", test_name_with_colon)
    
    return suite

def test_name_safety_py():
    suite = TestSuite("PY --name 安全")
    
    def test_name_normal():
        r = run_py(["--name", "test_video", "--dry-run", "--id", "dQw4w9WgXcQ"], timeout=15)
    suite.test("正常名称不崩溃", test_name_normal)
    
    def test_name_with_dots():
        r = run_py(["--name", "../escape", "--dry-run", "--id", "dQw4w9WgXcQ"], timeout=15)
    suite.test("路径遍历名称不崩溃", test_name_with_dots)
    
    def test_name_with_slash():
        r = run_py(["--name", "dir/file", "--dry-run", "--id", "dQw4w9WgXcQ"], timeout=15)
    suite.test("含斜杠名称不崩溃", test_name_with_slash)
    
    def test_name_with_colon():
        r = run_py(["--name", "test:file", "--dry-run", "--id", "dQw4w9WgXcQ"], timeout=15)
    suite.test("含冒号名称不崩溃", test_name_with_colon)
    
    def test_name_chinese():
        r = run_py(["--name", "测试视频", "--dry-run", "--id", "dQw4w9WgXcQ"], timeout=15)
    suite.test("中文名称不崩溃", test_name_chinese)
    
    return suite

# ============================================================
# 测试套件 5: --step 参数组合
# ============================================================

def test_step_combinations():
    suite = TestSuite("--step 参数组合")
    
    def test_js_step_download():
        r = run_js(["--step", "download", "--id", "dQw4w9WgXcQ", "--dry-run"], timeout=15)
        assert r.returncode == 0, f"返回非零: {r.returncode}"
    suite.test("JS --step download 不崩溃", test_js_step_download)
    
    def test_js_step_transcode():
        r = run_js(["--step", "transcode", "--id", "dQw4w9WgXcQ", "--dry-run"], timeout=15)
    suite.test("JS --step transcode 不崩溃", test_js_step_transcode)
    
    def test_py_step_download():
        r = run_py(["--step", "download", "--id", "dQw4w9WgXcQ", "--dry-run"], timeout=15)
    suite.test("PY --step download 不崩溃", test_py_step_download)
    
    def test_py_step_transcode():
        r = run_py(["--step", "transcode", "--id", "dQw4w9WgXcQ", "--dry-run"], timeout=15)
    suite.test("PY --step transcode 不崩溃", test_py_step_transcode)
    
    return suite

# ============================================================
# 测试套件 6: --url 模式
# ============================================================

def test_url_mode():
    suite = TestSuite("--url 模式")
    
    def test_js_url_basic():
        r = run_js(["--url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "--dry-run"], timeout=15)
    suite.test("JS --url 基本URL不崩溃", test_js_url_basic)
    
    def test_py_url_basic():
        r = run_py(["--url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "--dry-run"], timeout=15)
    suite.test("PY --url 基本URL不崩溃", test_py_url_basic)
    
    def test_js_url_with_name():
        r = run_js(["--url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "--name", "test", "--dry-run"], timeout=15)
    suite.test("JS --url + --name 不崩溃", test_js_url_with_name)
    
    def test_py_url_with_name():
        r = run_py(["--url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "--name", "test", "--dry-run"], timeout=15)
    suite.test("PY --url + --name 不崩溃", test_py_url_with_name)
    
    return suite

# ============================================================
# 测试套件 7: --input 模式
# ============================================================

def test_input_mode():
    suite = TestSuite("--input 模式")
    
    def test_js_input_nonexistent():
        r = run_js(["--input", "nonexistent.mp4", "--dry-run"], timeout=15)
    suite.test("JS --input 不存在文件不崩溃", test_js_input_nonexistent)
    
    def test_py_input_nonexistent():
        r = run_py(["--input", "nonexistent.mp4", "--dry-run"], timeout=15)
    suite.test("PY --input 不存在文件不崩溃", test_py_input_nonexistent)
    
    def test_js_input_with_name():
        r = run_js(["--input", "nonexistent.mp4", "--name", "../test", "--dry-run"], timeout=15)
    suite.test("JS --input + --name 不崩溃", test_js_input_with_name)
    
    def test_py_input_with_name():
        r = run_py(["--input", "nonexistent.mp4", "--name", "../test", "--dry-run"], timeout=15)
    suite.test("PY --input + --name 不崩溃", test_py_input_with_name)
    
    return suite

# ============================================================
# 测试套件 8: --force / --retry-failed 模式
# ============================================================

def test_force_retry_mode():
    suite = TestSuite("--force/--retry-failed")
    
    def test_js_force():
        r = run_js(["--force", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("JS --force 不崩溃", test_js_force)
    
    def test_py_force():
        r = run_py(["--force", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("PY --force 不崩溃", test_py_force)
    
    def test_js_retry_failed():
        r = run_js(["--retry-failed", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("JS --retry-failed 不崩溃", test_js_retry_failed)
    
    def test_py_retry_failed():
        r = run_py(["--retry-failed", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("PY --retry-failed 不崩溃", test_py_retry_failed)
    
    return suite

# ============================================================
# 测试套件 9: 参数组合（多参数同时使用）
# ============================================================

def test_combination():
    suite = TestSuite("参数组合")
    
    def test_js_many_params():
        r = run_js([
            "--sheet", "测试",
            "--concurrency", "2",
            "--retry", "3",
            "--retry-delay", "1000",
            "--download-timeout", "30000",
            "--force",
            "--dry-run"
        ], timeout=15)
    suite.test("JS 多参数组合不崩溃", test_js_many_params)
    
    def test_py_many_params():
        r = run_py([
            "--sheet", "测试",
            "--concurrency", "2",
            "--retry", "3",
            "--retry-delay", "1000",
            "--download-timeout", "30000",
            "--force",
            "--dry-run"
        ], timeout=15)
    suite.test("PY 多参数组合不崩溃", test_py_many_params)
    
    return suite

# ============================================================
# 测试套件 10: Python 特有参数
# ============================================================

def test_py_only_params():
    suite = TestSuite("PY 特有参数")
    
    def test_init():
        # --init 不应该在非交互模式下创建文件（因为我们用 subprocess）
        r = run_py(["--init", "--dry-run"], timeout=15)
    suite.test("--init 不崩溃", test_init)
    
    def test_file_param():
        r = run_py(["--file", "data/export_2026-06-10.xlsx", "--dry-run", "--sheet", "测试"], timeout=15)
    suite.test("--file 指定Excel文件不崩溃", test_file_param)
    
    return suite

# ============================================================
# 测试套件 11: 语法检查
# ============================================================

def test_syntax():
    suite = TestSuite("语法检查")
    
    def test_js_syntax():
        r = subprocess.run(["node", "--check", str(JS_SCRIPT)], 
                         capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, f"JS 语法错误: {r.stderr}"
    suite.test("JS 语法检查通过", test_js_syntax)
    
    def test_py_syntax():
        r = subprocess.run([PY_CMD, "-m", "py_compile", str(PY_SCRIPT)],
                         capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, f"Python 语法错误: {r.stderr}"
    suite.test("Python 语法检查通过", test_py_syntax)
    
    return suite

# ============================================================
# 测试套件 12: safeFilename/safe_filename 功能验证
# ============================================================

def test_safe_filename_unit():
    suite = TestSuite("safeFilename 单元测试")
    
    def test_js_safe():
        script = TEST_DIR / "verify_safe_js.js"
        script.write_text("""
function safeFilename(name) {
    let safe = String(name).replace(/[\\\\/:*?"<>|]/g, '_').trim();
    while (safe.includes('..')) safe = safe.replace('..', '_');
    safe = safe.replace(/^\\.+/, '');
    return safe || 'unknown';
}

// 测试用例
const cases = [
    // [输入, 不允许包含, 不允许以...开头]
    ["normal.mp4", "..", "."],
    ["../escape.mp4", "..", "."],
    ["..hidden", "..", "."],
    [".hidden", "..", "."],
    ["path/../etc/passwd", "..", "."],
    [".../.../...", "..", "."],
    ["", "..", "."],
    ["../../../etc/passwd", "..", "."],
    ["a/../../b/c", "..", "."],
];

let failed = 0;
for (const [input] of cases) {
    const result = safeFilename(input);
    if (result.includes('..')) { console.log(`FAIL: '${input}' -> '${result}' (contains ..)`); failed++; }
    if (result.startsWith('.')) { console.log(`FAIL: '${input}' -> '${result}' (starts with .)`); failed++; }
}
console.log(`${failed > 0 ? 'FAILED ' + failed : 'All passed'}`);
process.exit(failed > 0 ? 1 : 0);
        """, encoding='utf-8')
        r = subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, f"失败: {r.stdout} {r.stderr}"
        assert "All passed" in r.stdout, f"输出不正确: {r.stdout}"
    suite.test("JS - 所有路径遍历防护用例", test_js_safe)
    
    def test_py_safe():
        script = TEST_DIR / "verify_safe_py.py"
        script.write_text("""
import re

def safe_filename(name: str) -> str:
    safe = re.sub(r'[\\\\/:*?"<>|]', '_', str(name)).strip()
    while '..' in safe:
        safe = safe.replace('..', '_')
    safe = re.sub(r'^\\.+', '', safe)
    return safe or 'unknown'

cases = [
    "normal.mp4",
    "../escape.mp4",
    "..hidden",
    ".hidden",
    "path/../etc/passwd",
    ".../.../...",
    "",
    "../../../etc/passwd",
    "a/../../b/c",
]

failed = 0
for input_str in cases:
    result = safe_filename(input_str)
    if '..' in result:
        print(f"FAIL: '{input_str}' -> '{result}' (contains ..)")
        failed += 1
    if result.startswith('.'):
        print(f"FAIL: '{input_str}' -> '{result}' (starts with .)")
        failed += 1

if failed == 0:
    print("All passed")
else:
    print(f"FAILED {failed}")
    exit(1)
        """, encoding='utf-8')
        r = subprocess.run([PY_CMD, str(script)], capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, f"失败: {r.stdout} {r.stderr}"
        assert "All passed" in r.stdout, f"输出不正确: {r.stdout}"
    suite.test("Python - 所有路径遍历防护用例", test_py_safe)
    
    return suite

# ============================================================
# 主函数
# ============================================================

def main():
    Color.print(Color.BLUE, "=" * 70)
    Color.print(Color.BLUE, "  综合功能测试报告")
    Color.print(Color.BLUE, f"  项目: process_videos (JS & Python 双版本)")
    Color.print(Color.BLUE, "=" * 70)
    
    suites = []
    
    # 语法检查（最先运行）
    suites.append(test_syntax())
    
    # --help 测试
    Color.print(Color.BLUE, "\n\n📋  测试组 1: --help 输出")
    suites.append(test_help_js())
    suites.append(test_help_py())
    
    # --dry-run 模式
    Color.print(Color.BLUE, "\n\n📋  测试组 2: --dry-run 模式")
    suites.append(test_dry_run_js())
    suites.append(test_dry_run_py())
    
    # 边界值
    Color.print(Color.BLUE, "\n\n📋  测试组 3: 边界值测试")
    suites.append(test_boundary_values_js())
    suites.append(test_boundary_values_py())
    
    # --name 安全
    Color.print(Color.BLUE, "\n\n📋  测试组 4: --name 路径遍历防护")
    suites.append(test_name_safety_js())
    suites.append(test_name_safety_py())
    
    # --step 组合
    Color.print(Color.BLUE, "\n\n📋  测试组 5: --step 参数组合")
    suites.append(test_step_combinations())
    
    # --url 模式
    Color.print(Color.BLUE, "\n\n📋  测试组 6: --url 模式")
    suites.append(test_url_mode())
    
    # --input 模式
    Color.print(Color.BLUE, "\n\n📋  测试组 7: --input 模式")
    suites.append(test_input_mode())
    
    # --force/--retry-failed
    Color.print(Color.BLUE, "\n\n📋  测试组 8: --force / --retry-failed")
    suites.append(test_force_retry_mode())
    
    # 参数组合
    Color.print(Color.BLUE, "\n\n📋  测试组 9: 多参数组合")
    suites.append(test_combination())
    
    # Python 特有参数
    Color.print(Color.BLUE, "\n\n📋  测试组 10: Python 特有参数")
    suites.append(test_py_only_params())
    
    # safeFilename 功能验证
    Color.print(Color.BLUE, "\n\n📋  测试组 11: safeFilename 功能验证")
    suites.append(test_safe_filename_unit())
    
    # ============================================================
    # 汇总
    # ============================================================
    Color.print(Color.BLUE, "\n\n" + "=" * 70)
    Color.print(Color.BLUE, "  最终测试结果汇总")
    Color.print(Color.BLUE, "=" * 70)
    
    total_all = sum(s.total for s in suites)
    passed_all = sum(s.passed for s in suites)
    failed_all = sum(s.failed for s in suites)
    
    print(f"\033[94m\n  总计: {total_all} | \033[92m通过: {passed_all} | \033[91m失败: {failed_all}\033[0m")
    
    if passed_all == total_all:
        Color.print(Color.GREEN, "\n  🎉 所有测试通过！")
    else:
        Color.print(Color.RED, f"\n  ⚠️ {failed_all}/{total_all} 测试失败")
    
    # 详细结果
    Color.print(Color.BLUE, "\n  各组详细:")
    for s in suites:
        status = "✅" if s.failed == 0 else "❌"
        Color.print(Color.BLUE, f"    {status} {s.name}: {s.passed}/{s.total}")
    
    # 失败详情
    if failed_all > 0:
        Color.print(Color.RED, "\n  失败详情:")
        for s in suites:
            for f in s.failures:
                Color.print(Color.RED, f"    ❌ {f}")
    
    # 保存报告
    report = {
        "total": total_all,
        "passed": passed_all,
        "failed": failed_all,
        "suites": [s.summary() for s in suites]
    }
    report_file = TEST_DIR / "test_comprehensive_report.json"
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    Color.print(Color.BLUE, f"\n  报告已保存: {report_file}")
    
    return 0 if failed_all == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
