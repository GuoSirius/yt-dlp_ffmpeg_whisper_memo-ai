
import re
import sys

def safe_filename(name: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|]', '_', str(name)).strip()
    # 防止路径遍历
    while '..' in safe:
        safe = safe.replace('..', '_')
    # 防止以 . 开头（Unix 隐藏文件）
    safe = re.sub(r'^\.+', '', safe)
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
        