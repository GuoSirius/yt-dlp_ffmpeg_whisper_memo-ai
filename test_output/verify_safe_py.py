
import re

def safe_filename(name: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|]', '_', str(name)).strip()
    while '..' in safe:
        safe = safe.replace('..', '_')
    safe = re.sub(r'^\.+', '', safe)
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
        