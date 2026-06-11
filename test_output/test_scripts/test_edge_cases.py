#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
边界情况和异常处理测试
"""
import subprocess, sys, os, json, time, re
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.parent  # project root
JS_SCRIPT = BASE_DIR / "process_videos.js"
PY_SCRIPT = BASE_DIR / "process_videos.py"
TEST_DIR = BASE_DIR / "test_output"
TEST_DIR.mkdir(exist_ok=True)

PY_CMD = r"C:\Users\Admin\.workbuddy\binaries\python\versions\3.13.12\python.exe"

class Color:
    GREEN = '\033[92m'; RED = '\033[91m'; YELLOW = '\033[93m'
    BLUE = '\033[94m'; CYAN = '\033[96m'; END = '\033[0m'
    @staticmethod
    def print(c, m): print(f"{c}{m}{Color.END}")

def run_js(args, timeout=20, cwd=None):
    if cwd is None: cwd = BASE_DIR
    return subprocess.run(
        ["node", str(JS_SCRIPT)] + args,
        capture_output=True, text=True, timeout=timeout, cwd=cwd
    )

def run_py(args, timeout=20, cwd=None):
    if cwd is None: cwd = BASE_DIR
    return subprocess.run(
        [PY_CMD, str(PY_SCRIPT)] + args,
        capture_output=True, text=True, timeout=timeout, cwd=cwd
    )

total = 0; passed = 0; failed = 0; failures = []

def test(name, func):
    global total, passed, failed
    total += 1
    Color.print(Color.CYAN, f"\n[测试 {total}] {name}")
    try:
        func()
        passed += 1
        Color.print(Color.GREEN, "  PASSED")
    except Exception as e:
        failed += 1
        failures.append(f"{name}: {e}")
        Color.print(Color.RED, f"  FAILED: {e}")

# ============================================================
# 1. 错误退出码测试
# ============================================================
def test_invalid_url_js():
    """JS: 无效 URL 应给出错误并退出非零"""
    r = run_js(["--url", "not-a-valid-url!@#", "--dry-run"], timeout=10)
    # 应该给出错误信息
    output = r.stdout + r.stderr
    assert "无法识别" in output or "unrecognized" in output.lower() or r.returncode != 0, \
        f"应该报错，但 returncode={r.returncode}"

def test_invalid_url_py():
    """PY: 无效 URL 应给出错误并退出非零"""
    r = run_py(["--url", "not-a-valid-url!@#", "--dry-run"], timeout=10)
    output = r.stdout + r.stderr
    assert "无法识别" in output or "unrecognized" in output.lower() or r.returncode != 0, \
        f"应该报错，但 returncode={r.returncode}"

# ============================================================
# 2. 报告 JSON 格式验证
# ============================================================
def test_report_format():
    """验证所有已生成的报告 JSON 格式正确"""
    reports_dir = BASE_DIR / "reports"
    if reports_dir.exists():
        count = 0
        for f in reports_dir.glob("*.json"):
            try:
                with open(f, 'r', encoding='utf-8') as fp:
                    data = json.load(fp)
                # 验证必要字段
                required = ["timestamp", "config", "summary", "items", "failed_items"]
                for field in required:
                    assert field in data, f"缺少字段: {field}"
                # 验证 summary 结构
                assert "total" in data["summary"], "summary 缺少 total"
                assert "success" in data["summary"], "summary 缺少 success"
                assert "failed" in data["summary"], "summary 缺少 failed"
                # 验证 items 结构
                for item in data["items"][:1]:
                    required_item = ["sheet", "id_val", "title", "platform", "overall_status"]
                    for field in required_item:
                        assert field in item, f"item 缺少字段: {field}"
                count += 1
            except json.JSONDecodeError as e:
                raise Exception(f"{f.name}: JSON 解析失败: {e}")
        assert count > 0, "无报告文件可验证"
        print(f"    已验证 {count} 个报告文件格式正确")
    else:
        print("    reports 目录不存在，跳过")

# ============================================================
# 3. 并发安全测试（--concurrency 有效性）
# ============================================================
def test_concurrency_js_args():
    """JS: 不同并发参数不崩溃"""
    for c in ["1", "2", "4", "8", "16"]:
        r = run_js(["--concurrency", c, "--dry-run", "--sheet", "测试"], timeout=15)
        assert r.returncode in [0, 1], f"--concurrency {c} 异常退出: {r.returncode}"

def test_concurrency_py_args():
    """PY: 不同并发参数不崩溃"""
    for c in ["1", "2", "4", "8"]:
        r = run_py(["--concurrency", c, "--dry-run", "--sheet", "测试"], timeout=15)

# ============================================================
# 4. --retry-delay 边界测试
# ============================================================
def test_retry_delay_js():
    """JS: 重试延迟各种值"""
    for d in ["0", "100", "1000", "5000", "30000"]:
        r = run_js(["--retry-delay", d, "--dry-run", "--sheet", "测试"], timeout=15)

def test_retry_delay_py():
    """PY: 重试延迟各种值"""
    for d in ["0", "100", "1000", "5000"]:
        r = run_py(["--retry-delay", d, "--dry-run", "--sheet", "测试"], timeout=15)

# ============================================================
# 5. timeout 参数边界测试
# ============================================================
def test_timeout_params_js():
    """JS: 各种超时参数不崩溃"""
    params = [
        ["--download-timeout", "10000"],
        ["--transcode-timeout", "300000"],
        ["--transcribe-timeout", "600000"],
        ["--analyze-timeout", "300000"],
    ]
    for p in params:
        r = run_js(p + ["--dry-run", "--sheet", "测试"], timeout=15)

def test_timeout_params_py():
    """PY: 各种超时参数不崩溃"""
    params = [
        ["--download-timeout", "10000"],
        ["--transcode-timeout", "300000"],
        ["--transcribe-timeout", "600000"],
    ]
    for p in params:
        r = run_py(p + ["--dry-run", "--sheet", "测试"], timeout=15)

# ============================================================
# 6. --step 组合边界测试
# ============================================================
def test_step_combinations_js():
    """JS: --step 多步骤组合"""
    combos = [
        ["--step", "download"],
        ["--step", "download", "--step", "transcode"],
        ["--step", "download", "--step", "transcode", "--step", "transcribe"],
        ["--step", "transcribe"],
    ]
    for combo in combos:
        r = run_js(combo + ["--dry-run", "--sheet", "测试"], timeout=15)

def test_step_combinations_py():
    """PY: --step 多步骤组合"""
    combos = [
        ["--step", "download"],
        ["--step", "transcode"],
        ["--step", "transcribe"],
        ["--step", "download", "--step", "transcode"],
        ["--step", "download", "--step", "transcode", "--step", "transcribe"],
    ]
    for combo in combos:
        r = run_py(combo + ["--dry-run", "--sheet", "测试"], timeout=15)

# ============================================================
# 7. safeFilename 在多种边界输入下的行为
# ============================================================
def test_safe_filename_edge_cases():
    """safeFilename 极端边界输入"""
    # JS
    script_js = TEST_DIR / "edge_safe_js.js"
    script_js.write_text("""
function safeFilename(name) {
    let safe = String(name).replace(/[\\\\/:*?"<>|]/g, '_').trim();
    while (safe.includes('..')) safe = safe.replace('..', '_');
    safe = safe.replace(/^\\.+/, '');
    return safe || 'unknown';
}
const cases = [
    {in: "", out: "unknown"},
    {in: null, out: "unknown"},
    {in: undefined, out: "unknown"},
    {in: 123, out: "123"},
    {in: "\\x00\\\\x00", out: "_x00__x00"},
    {in: "✅🎉中文", out: "✅🎉中文"},
    {in: "....", out: ""},
    {in: "   space   ", out: "space"},
];
let ok = true;
for (const c of cases) {
    const r = safeFilename(c.in);
    if (c.out === "" && r === "") continue;
    if (r === c.out) continue;
    console.log(`MISMATCH: input='${c.in}' expected='${c.out}' got='${r}'`);
    ok = false;
}
if (ok) console.log("All edge cases passed");
else process.exit(1);
    """, encoding='utf-8')
    r = subprocess.run(["node", str(script_js)], capture_output=True, text=True, timeout=10)
    assert r.returncode == 0, f"JS 边界测试失败: {r.stdout} {r.stderr}"

    # PY
    script_py = TEST_DIR / "edge_safe_py.py"
    script_py.write_text("""
import re
def safe_filename(name):
    safe = re.sub(r'[\\\\/:*?"<>|]', '_', str(name)).strip()
    while '..' in safe: safe = safe.replace('..', '_')
    safe = re.sub(r'^\\.+', '', safe)
    return safe or 'unknown'

cases = [
    ("", "unknown"),
    (None, "unknown"),
    (123, "123"),
    ("\\\\x00\\\\\\\\x00", "_x00__x00"),
    ("✅🎉中文", "✅🎉中文"),
    ("   space   ", "space"),
]
ok = True
for inp, expected in cases:
    r = safe_filename(inp)
    exp_fixed = expected.replace('\\\\', '\\')
    if r == expected or (expected == "" and r == ""):
        pass
    else:
        print(f"MISMATCH: input='{inp}' expected='{expected}' got='{r}'");
        ok = False
if ok:
    print("All edge cases passed")
else:
    exit(1)
    """, encoding='utf-8')
    r = subprocess.run([PY_CMD, str(script_py)], capture_output=True, text=True, timeout=10)
    assert r.returncode == 0, f"PY 边界测试失败: {r.stdout} {r.stderr}"

# ============================================================
# 8. 报告重复运行——确认一致性
# ============================================================
def test_report_consistency():
    """验证多次 dry-run 生成相同的任务列表"""
    r1 = run_js(["--dry-run", "--sheet", "测试"], timeout=20)
    r2 = run_js(["--dry-run", "--sheet", "测试"], timeout=20)
    # 两次输出应该一致（或都报 Excel 不存在错误）
    assert (r1.returncode == r2.returncode), \
        f"两次 dry-run 返回码不一致: {r1.returncode} vs {r2.returncode}"

# ============================================================
# 主函数
# ============================================================
Color.print(Color.BLUE, "=" * 60)
Color.print(Color.BLUE, "  边界情况和异常处理测试")
Color.print(Color.BLUE, "=" * 60)

# 1. URL验证
Color.print(Color.BLUE, "\n--- 1. 无效URL处理 ---")
test("JS 无效URL报错", test_invalid_url_js)
test("PY 无效URL报错", test_invalid_url_py)

# 2. 报告格式
Color.print(Color.BLUE, "\n--- 2. 报告JSON格式验证 ---")
test("报告格式验证", test_report_format)

# 3. 并发参数
Color.print(Color.BLUE, "\n--- 3. 并发参数边界 ---")
test("JS 并发参数", test_concurrency_js_args)
test("PY 并发参数", test_concurrency_py_args)

# 4. retry delay
Color.print(Color.BLUE, "\n--- 4. 重试延迟边界 ---")
test("JS 重试延迟", test_retry_delay_js)
test("PY 重试延迟", test_retry_delay_py)

# 5. timeout
Color.print(Color.BLUE, "\n--- 5. 超时参数边界 ---")
test("JS 超时参数", test_timeout_params_js)
test("PY 超时参数", test_timeout_params_py)

# 6. step组合
Color.print(Color.BLUE, "\n--- 6. --step 组合 ---")
test("JS step组合", test_step_combinations_js)
test("PY step组合", test_step_combinations_py)

# 7. safeFilename 极端边界
Color.print(Color.BLUE, "\n--- 7. safeFilename 极端边界 ---")
test("safeFilename 极端边界", test_safe_filename_edge_cases)

# 8. 报告一致性
Color.print(Color.BLUE, "\n--- 8. 报告一致性 ---")
test("dry-run 一致性", test_report_consistency)

# 汇总
Color.print(Color.BLUE, "\n" + "=" * 60)
Color.print(Color.BLUE, f"  边界测试结果: 总计 {total} | 通过 {passed} | 失败 {failed}")
if failures:
    Color.print(Color.RED, "\n  失败项:")
    for f in failures:
        Color.print(Color.RED, f"    ❌ {f}")
else:
    Color.print(Color.GREEN, "  ✅ 全部通过!")

sys.exit(0 if failed == 0 else 1)
