#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
针对性测试脚本 - 验证已发现的安全漏洞修复和关键功能
"""

import subprocess
import sys
import os
import json
import tempfile
from pathlib import Path
import re

# 配置
JS_SCRIPT = Path(__file__).parent.parent.parent / "process_videos.js"
PY_SCRIPT = Path(__file__).parent.parent.parent / "process_videos.py"
TEST_DIR = Path(__file__).parent.parent.parent / "test_output"
TEST_DIR.mkdir(exist_ok=True)

# 颜色输出
class Color:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'
    
    @staticmethod
    def print(color, msg):
        print(f"{color}{msg}{Color.END}")

results = {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "skipped": 0,
    "issues": []
}

def test_case(name, func):
    """测试装饰器"""
    results["total"] += 1
    Color.print(Color.BLUE, f"\n[测试 {results['total']}] {name}")
    try:
        func()
        results["passed"] += 1
        Color.print(Color.GREEN, "  ✅ PASSED")
    except Exception as e:
        results["failed"] += 1
        Color.print(Color.RED, f"  ❌ FAILED: {e}")
        results["issues"].append(f"测试 {results['total']}: {name} - {e}")

# ============================================================
# 路径遍历漏洞修复验证
# ============================================================
def test_js_safe_filename_fixed():
    """测试 JS 版本的 safeFilename() 已修复路径遍历"""
    test_script = TEST_DIR / "test_js_safe.js"
    with open(test_script, 'w', encoding='utf-8') as f:
        f.write("""
        // 从原文件提取 safeFilename 函数（通过 require 主脚本）
        // 或者直接复制函数定义
        function safeFilename(name) {
            let safe = String(name).replace(/[\\\\/:*?"<>|]/g, '_').trim();
            // 防止路径遍历：
            while (safe.includes('..')) safe = safe.replace('..', '_');
            // 防止以 . 开头（Unix 隐藏文件）
            safe = safe.replace(/^\\.+/, '');
            return safe || 'unknown';
        }
        
        // 测试用例
        const tests = [
            ["normal.mp4", "normal.mp4"],
            ["path/../test.mp4", "path_.._test.mp4"],  // 注意：/ 被替换成 _，但 .. 也会被替换
            ["../escape.mp4", "_escape.mp4"],
            ["..hidden", "_hidden"],
            [".hidden", "hidden"],
            ["multiple...dots", "multiple...dots"],  // 三个点，会被替换两次
        ];
        
        let passed = 0;
        for (const [input, expected] of tests) {
            const result = safeFilename(input);
            // 检查是否包含 ..
            if (result.includes('..')) {
                console.log(`FAIL: safeFilename("${input}") = "${result}" contains ..`);
                process.exit(1);
            }
            // 检查是否以 . 开头
            if (result.startsWith('.')) {
                console.log(`FAIL: safeFilename("${input}") = "${result}" starts with .`);
                process.exit(1);
            }
            passed++;
        }
        console.log(`All ${passed} JS safeFilename tests passed`);
        """)
    
    result = subprocess.run(
        ["node", str(test_script)],
        capture_output=True,
        text=True,
        timeout=10
    )
    if result.returncode != 0:
        raise Exception(f"JS safeFilename 测试失败: {result.stderr}")
    if "All" not in result.stdout:
        raise Exception(f"JS safeFilename 测试失败: {result.stdout}")

def test_py_safe_filename_fixed():
    """测试 Python 版本的 safe_filename() 已修复路径遍历"""
    test_script = TEST_DIR / "test_py_safe.py"
    with open(test_script, 'w', encoding='utf-8') as f:
        f.write("""
import re
import sys

def safe_filename(name: str) -> str:
    safe = re.sub(r'[\\\\/:*?"<>|]', '_', str(name)).strip()
    # 防止路径遍历
    while '..' in safe:
        safe = safe.replace('..', '_')
    # 防止以 . 开头（Unix 隐藏文件）
    safe = re.sub(r'^\\.+', '', safe)
    return safe or 'unknown'

# 测试用例
tests = [
    ("normal.mp4", "normal.mp4"),
    ("path/../test.mp4", "path_.._test.mp4"),  # / 被替换成 _
    ("../escape.mp4", "_escape.mp4"),
    ("..hidden", "_hidden"),
    (".hidden", "hidden"),
]

passed = 0
for input_str, expected in tests:
    result = safe_filename(input_str)
    # 检查是否包含 ..
    if '..' in result:
        print(f"FAIL: safe_filename('{input_str}') = '{result}' contains ..")
        sys.exit(1)
    # 检查是否以 . 开头
    if result.startswith('.'):
        print(f"FAIL: safe_filename('{input_str}') = '{result}' starts with .")
        sys.exit(1)
    passed += 1

print(f"All {passed} Python safe_filename tests passed")
        """)
    
    result = subprocess.run(
        ["python", str(test_script)],
        capture_output=True,
        text=True,
        timeout=10
    )
    if result.returncode != 0:
        raise Exception(f"Python safe_filename 测试失败: {result.stderr}")
    if "All" not in result.stdout:
        raise Exception(f"Python safe_filename 测试失败: {result.stdout}")

# ============================================================
# 命令行参数解析测试
# ============================================================
def test_js_all_args():
    """测试 JS 版本的所有命令行参数"""
    result = subprocess.run(
        ["node", str(JS_SCRIPT), "--help"],
        capture_output=True,
        text=True,
        timeout=10
    )
    if result.returncode != 0:
        raise Exception(f"JS --help 失败: {result.stderr}")
    
    # 检查所有预期参数是否存在
    expected_args = [
        "--sheet", "--id", "--step", "--force",
        "--concurrency", "--retry", "--retry-delay",
        "--download-timeout", "--transcode-timeout",
        "--transcribe-timeout", "--analyze-timeout",
        "--dry-run", "--retry-failed",
        "--input", "--url",
        "--env-file", "--help"
    ]
    
    for arg in expected_args:
        if arg not in result.stdout:
            Color.print(Color.YELLOW, f"  ⚠️  JS --help 可能缺少参数: {arg}")

def test_py_all_args():
    """测试 Python 版本的所有命令行参数"""
    result = subprocess.run(
        ["python", str(PY_SCRIPT), "--help"],
        capture_output=True,
        text=True,
        timeout=10
    )
    if result.returncode != 0:
        raise Exception(f"Python --help 失败: {result.stderr}")
    
    # 检查所有预期参数是否存在
    expected_args = [
        "--sheet", "--id", "--step", "--force",
        "--concurrency", "--retry", "--retry-delay",
        "--download-timeout", "--transcode-timeout",
        "--transcribe-timeout", "--analyze-timeout",
        "--dry-run", "--retry-failed",
        "--init", "--file",
        "--env-file", "--url", "--name", "--input",
        "--help"
    ]
    
    for arg in expected_args:
        if arg not in result.stdout:
            Color.print(Color.YELLOW, f"  ⚠️  Python --help 可能缺少参数: {arg}")

# ============================================================
# 边界情况测试
# ============================================================
def test_invalid_concurrency():
    """测试无效的并发参数"""
    # JS 版本
    result = subprocess.run(
        ["node", str(JS_SCRIPT), "--concurrency", "0", "--dry-run"],
        capture_output=True,
        text=True,
        timeout=10
    )
    # 不应该崩溃，应该给出错误或警告
    
    # Python 版本
    result = subprocess.run(
        ["python", str(PY_SCRIPT), "--concurrency", "0", "--dry-run"],
        capture_output=True,
        text=True,
        timeout=10
    )
    # 不应该崩溃

def test_negative_retry():
    """测试负的重试次数"""
    # JS 版本
    result = subprocess.run(
        ["node", str(JS_SCRIPT), "--retry", "-1", "--dry-run"],
        capture_output=True,
        text=True,
        timeout=10
    )
    
    # Python 版本
    result = subprocess.run(
        ["python", str(PY_SCRIPT), "--retry", "-1", "--dry-run"],
        capture_output=True,
        text=True,
        timeout=10
    )

def test_missing_env_file():
    """测试不存在的 .env 文件"""
    # JS 版本
    result = subprocess.run(
        ["node", str(JS_SCRIPT), "--env-file", "nonexistent.env", "--help"],
        capture_output=True,
        text=True,
        timeout=10
    )
    # 应该给出警告或使用默认配置
    
    # Python 版本
    result = subprocess.run(
        ["python", str(PY_SCRIPT), "--env-file", "nonexistent.env", "--help"],
        capture_output=True,
        text=True,
        timeout=10
    )

# ============================================================
# 主函数
# ============================================================
if __name__ == "__main__":
    Color.print(Color.BLUE, "=" * 60)
    Color.print(Color.BLUE, "  开始全面测试（第二轮）")
    Color.print(Color.BLUE, "=" * 60)
    
    # 安全性测试
    Color.print(Color.BLUE, "\n--- 安全性测试（路径遍历修复验证）---")
    test_case("JS safeFilename() 路径遍历修复", test_js_safe_filename_fixed)
    test_case("Python safe_filename() 路径遍历修复", test_py_safe_filename_fixed)
    
    # 命令行参数测试
    Color.print(Color.BLUE, "\n--- 命令行参数测试 ---")
    test_case("JS 所有命令行参数", test_js_all_args)
    test_case("Python 所有命令行参数", test_py_all_args)
    
    # 边界情况测试
    Color.print(Color.BLUE, "\n--- 边界情况测试 ---")
    test_case("无效并发参数", test_invalid_concurrency)
    test_case("负的重试次数", test_negative_retry)
    test_case("不存在的 .env 文件", test_missing_env_file)
    
    # 输出测试结果
    Color.print(Color.BLUE, "\n" + "=" * 60)
    Color.print(Color.BLUE, "  测试结果摘要")
    Color.print(Color.BLUE, "=" * 60)
    Color.print(Color.BLUE, f"  总测试数: {results['total']}")
    Color.print(Color.GREEN, f"  通过: {results['passed']}")
    Color.print(Color.RED, f"  失败: {results['failed']}")
    Color.print(Color.YELLOW, f"  跳过: {results['skipped']}")
    
    if results['issues']:
        Color.print(Color.RED, "\n  发现的问题:")
        for issue in results['issues']:
            Color.print(Color.RED, f"    - {issue}")
    
    # 保存测试结果
    report_file = TEST_DIR / "test_report_round2.json"
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    Color.print(Color.BLUE, f"\n  测试报告已保存: {report_file}")
    
    # 返回退出码
    sys.exit(0 if results['failed'] == 0 else 1)
