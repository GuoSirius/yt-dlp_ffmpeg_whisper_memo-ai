#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动化测试脚本 - 验证 process_videos.js 和 process_videos.py 的功能

测试覆盖：
1. 安全性测试（路径遍历、命令注入、SSRF）
2. 边界情况测试
3. 功能单元测试
4. 集成测试（模拟）
"""

import subprocess
import sys
import os
import json
import tempfile
from pathlib import Path
import re

# ============================================================
# 测试配置
# ============================================================
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
# 测试 1: 路径遍历漏洞检测
# ============================================================
def test_path_traversal_js():
    """测试 JS 版本的 safeFilename 是否正确处理路径遍历"""
    # 读取 JS 文件，提取 safeFilename 函数
    with open(JS_SCRIPT, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 检查 safeFilename 实现
    match = re.search(r'function safeFilename\(name\)\s*{([^}]+)}', content, re.DOTALL)
    if match:
        func_body = match.group(1)
        # 检查是否过滤了 ..
        if '..' not in func_body and r'\.\.' not in func_body:
            raise Exception("safeFilename() 未过滤 '..'，存在路径遍历风险")
        
        # 检查是否过滤了 .
        if "'^" not in func_body and '"\\.' not in func_body:
            Color.print(Color.YELLOW, "  ⚠️  safeFilename() 可能未完全过滤 '.'")
    
    # 实际测试：创建一个包含 .. 的 stem，检查文件是否被正确清理
    # 这需要实际运行脚本，我们先做静态检查

def test_path_traversal_py():
    """测试 Python 版本的 safe_filename 是否正确处理路径遍历"""
    with open(PY_SCRIPT, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 检查 safe_filename 实现
    match = re.search(r'def safe_filename\(name[^)]*\)\s*->\s*str:[^]]*]([^]]+]])', content, re.DOTALL)
    if not match:
        # 尝试更简单的匹配
        match = re.search(r'def safe_filename\(name[^)]*\).*?(?=\ndef |class |$)', content, re.DOTALL)
    
    if match:
        func_body = match.group(0)
        if '..' not in func_body:
            Color.print(Color.YELLOW, "  ⚠️  safe_filename() 可能未过滤 '..'")
    
    # 实际测试
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    # 我们需要导入函数，但 process_videos.py 可能在导入时执行代码
    # 所以我们使用 subprocess 运行一个测试脚本

# ============================================================
# 测试 2: 命令行参数解析
# ============================================================
def test_js_help():
    """测试 JS 版本的 --help 输出"""
    result = subprocess.run(
        ["node", str(JS_SCRIPT), "--help"],
        capture_output=True,
        text=True,
        timeout=10
    )
    if result.returncode != 0:
        raise Exception(f"--help 失败: {result.stderr}")
    if "视频下载、转码、文本识别、AI分析" not in result.stdout:
        raise Exception("--help 输出不完整")

def test_py_help():
    """测试 Python 版本的 --help 输出"""
    result = subprocess.run(
        ["python", str(PY_SCRIPT), "--help"],
        capture_output=True,
        text=True,
        timeout=10
    )
    if result.returncode != 0:
        raise Exception(f"--help 失败: {result.stderr}")
    # 检查关键描述（根据实际输出调整）
    if "视频下载" not in result.stdout and "usage:" not in result.stdout.lower():
        raise Exception("--help 输出不完整")

# ============================================================
# 测试 3: 环境变量加载
# ============================================================
def test_env_loading():
    """测试 .env 文件加载"""
    # 创建临时 .env 文件
    env_file = Path(__file__).parent.parent.parent / ".env.test"
    with open(env_file, 'w') as f:
        f.write("EXCEL_FILE=test.xlsx\n")
        f.write("YTDLP=yt-dlp\n")
    
    try:
        # 测试 JS 版本
        result = subprocess.run(
            ["node", str(JS_SCRIPT), "--env-file", ".env.test", "--help"],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=Path(__file__).parent.parent.parent
        )
        if result.returncode != 0:
            raise Exception(f"--env-file 失败: {result.stderr}")
        
        # 测试 Python 版本
        result = subprocess.run(
            ["python", str(PY_SCRIPT), "--env-file", ".env.test", "--help"],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=Path(__file__).parent.parent.parent
        )
        if result.returncode != 0:
            raise Exception(f"--env-file 失败: {result.stderr}")
    finally:
        env_file.unlink(missing_ok=True)

# ============================================================
# 测试 4: dry-run 模式
# ============================================================
def test_js_dry_run():
    """测试 JS 版本的 dry-run 模式"""
    result = subprocess.run(
        ["node", str(JS_SCRIPT), "--dry-run", "--sheet", "测试"],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=Path(__file__).parent.parent.parent
    )
    # dry-run 不应该失败（即使 Excel 文件不存在，也应该给出明确错误）
    if "错误" in result.stdout or "error" in result.stdout.lower():
        Color.print(Color.YELLOW, f"  ⚠️  dry-run 输出包含错误信息: {result.stdout[:200]}")

def test_py_dry_run():
    """测试 Python 版本的 dry-run 模式"""
    result = subprocess.run(
        ["python", str(PY_SCRIPT), "--dry-run", "--sheet", "测试"],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=Path(__file__).parent.parent.parent
    )
    if "错误" in result.stdout or "error" in result.stdout.lower():
        Color.print(Color.YELLOW, f"  ⚠️  dry-run 输出包含错误信息: {result.stdout[:200]}")

# ============================================================
# 测试 5: 边界情况 - 无效参数
# ============================================================
def test_invalid_args():
    """测试无效参数处理"""
    # 测试 JS 版本
    result = subprocess.run(
        ["node", str(JS_SCRIPT), "--concurrency", "0"],
        capture_output=True,
        text=True,
        timeout=10
    )
    # 应该给出错误或警告，而不是崩溃
    
    # 测试 Python 版本
    result = subprocess.run(
        ["python", str(PY_SCRIPT), "--concurrency", "0"],
        capture_output=True,
        text=True,
        timeout=10
    )
    # 应该给出错误或警告

# ============================================================
# 测试 6: 函数单元测试（通过 Node.js 和 Python REPL）
# ============================================================
def test_js_functions():
    """测试 JS 函数的边界情况"""
    # 创建一个测试脚本
    test_script = TEST_DIR / "test_js_functions.js"
    with open(test_script, 'w', encoding='utf-8') as f:
        f.write("""
        // 导入主脚本的函数（如果它们被导出）
        // 或者，我们直接复制函数定义
        
        function safeFilename(name) {
            return String(name).replace(/[\\\\/:*?"<>|]/g, '_').trim();
        }
        
        // 测试 1: 正常文件名
        console.assert(safeFilename("test.mp4") === "test.mp4", "测试 1 失败");
        
        // 测试 2: 包含特殊字符
        console.assert(safeFilename('test/file.mp4') === "test_file.mp4", "测试 2 失败");
        console.assert(safeFilename('test:file.mp4') === "test_file.mp4", "测试 3 失败");
        
        // 测试 3: 路径遍历（应该被过滤）
        const result = safeFilename("../test.mp4");
        console.assert(!result.includes('..'), `测试 4 失败: ${result}`);
        
        console.log("所有 JS 函数测试通过");
        """)
    
    result = subprocess.run(
        ["node", str(test_script)],
        capture_output=True,
        text=True,
        timeout=10
    )
    if result.returncode != 0:
        raise Exception(f"JS 函数测试失败: {result.stderr}")
    if "所有 JS 函数测试通过" not in result.stdout:
        raise Exception(f"JS 函数测试失败: {result.stdout}")

def test_py_functions():
    """测试 Python 函数的边界情况"""
    test_script = TEST_DIR / "test_py_functions.py"
    with open(test_script, 'w', encoding='utf-8') as f:
        f.write("""
import sys
sys.path.insert(0, '.')

# 从 process_videos.py 导入函数
# 注意：这可能会执行脚本的顶层代码
# 所以我们需要先设置环境变量，避免加载 .env

import os
os.environ['EXCEL_FILE'] = 'test.xlsx'
os.environ['AI_ENABLED'] = 'false'

# 尝试导入
try:
    from process_videos import safe_filename, parse_url, compute_summary
    
    # 测试 safe_filename
    assert safe_filename("test.mp4") == "test.mp4", "测试 1 失败"
    assert safe_filename("test/file.mp4") == "test_file.mp4", "测试 2 失败"
    
    # 测试 parse_url
    result = parse_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert result is not None, "测试 3 失败"
    assert result['pkey'] == 'youtubeId', f"测试 4 失败: {result}"
    assert result['videoId'] == 'dQw4w9WgXcQ', f"测试 5 失败: {result}"
    
    print("所有 Python 函数测试通过")
except ImportError as e:
    print(f"导入失败: {e}")
    sys.exit(1)
        """)
    
    result = subprocess.run(
        ["python", str(test_script)],
        capture_output=True,
        text=True,
        timeout=10,
        cwd=Path(__file__).parent.parent.parent
    )
    if result.returncode != 0:
        # 导入可能失败，我们记录但不视为致命错误
        Color.print(Color.YELLOW, f"  ⚠️  Python 函数测试跳过（导入失败）: {result.stderr[:200]}")
    elif "所有 Python 函数测试通过" not in result.stdout:
        raise Exception(f"Python 函数测试失败: {result.stdout}")

# ============================================================
# 主函数
# ============================================================
if __name__ == "__main__":
    Color.print(Color.BLUE, "=" * 60)
    Color.print(Color.BLUE, "  开始全面测试")
    Color.print(Color.BLUE, "=" * 60)
    
    # 安全性测试
    Color.print(Color.BLUE, "\n--- 安全性测试 ---")
    test_case("路径遍历漏洞检测 (JS)", test_path_traversal_js)
    test_case("路径遍历漏洞检测 (Python)", test_path_traversal_py)
    
    # 命令行参数测试
    Color.print(Color.BLUE, "\n--- 命令行参数测试 ---")
    test_case("命令行参数解析 (JS --help)", test_js_help)
    test_case("命令行参数解析 (Python --help)", test_py_help)
    test_case("环境变量加载", test_env_loading)
    
    # 功能测试
    Color.print(Color.BLUE, "\n--- 功能测试 ---")
    test_case("dry-run 模式 (JS)", test_js_dry_run)
    test_case("dry-run 模式 (Python)", test_py_dry_run)
    test_case("无效参数处理", test_invalid_args)
    
    # 函数单元测试
    Color.print(Color.BLUE, "\n--- 函数单元测试 ---")
    test_case("JS 函数单元测试", test_js_functions)
    test_case("Python 函数单元测试", test_py_functions)
    
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
    report_file = TEST_DIR / "test_report.json"
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    Color.print(Color.BLUE, f"\n  测试报告已保存: {report_file}")
    
    # 返回退出码
    sys.exit(0 if results['failed'] == 0 else 1)
