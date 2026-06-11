
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
        