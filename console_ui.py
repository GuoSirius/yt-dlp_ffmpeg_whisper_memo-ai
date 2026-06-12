# -*- coding: utf-8 -*-
"""
控制台单行动态显示工具
提供：单行刷新、进度条、旋转动画、yt-dlp/ffmpeg 进度解析
"""

import re
import sys
import time
import math
from threading import Thread, Event


# ── 旋转动画帧 ───────────────────────────────────────────────────────────────────
SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']


# ── 单行刷新（覆盖当前行）────────────────────────────────────────────────────────
def update_line(text: str) -> None:
    """\x1b[2K = 清除整行, \r = 回到行首"""
    sys.stderr.write(f"\x1b[2K\r{text}")
    sys.stderr.flush()


def clear_line() -> None:
    """清除当前行"""
    sys.stderr.write('\x1b[2K\r')
    sys.stderr.flush()


# ── 格式化工具 ───────────────────────────────────────────────────────────────────
def fmt_size(bytes_val: float) -> str:
    if bytes_val < 1024:
        return f"{bytes_val:.0f}B"
    if bytes_val < 1024 * 1024:
        return f"{bytes_val / 1024:.1f}KiB"
    if bytes_val < 1024 * 1024 * 1024:
        return f"{bytes_val / 1024 / 1024:.1f}MiB"
    return f"{bytes_val / 1024 / 1024 / 1024:.1f}GiB"


def fmt_time(sec: float) -> str:
    if not math.isfinite(sec) or sec < 0:
        return '--:--'
    m = int(sec) // 60
    s = int(sec) % 60
    return f"{m:02d}:{s:02d}"


def fmt_speed(bps: float) -> str:
    if not bps or not math.isfinite(bps):
        return '---'
    if bps < 1024:
        return f"{bps:.0f}B/s"
    if bps < 1024 * 1024:
        return f"{bps / 1024:.1f}KiB/s"
    return f"{bps / 1024 / 1024:.1f}MiB/s"


# ── 文本进度条 ───────────────────────────────────────────────────────────────────
def text_bar(percent: float, width: int = 18) -> str:
    filled = round(percent / 100 * width)
    empty = width - filled
    return f"[{'█' * filled}{'░' * max(0, empty)}]"


# ── 旋转动画 Spinner ───────────────────────────────────────────────────────────
class Spinner:
    """线程安全的旋转动画。
    用法:
        spinner = Spinner()
        spinner.start("处理中")
        # ... 执行耗时操作 ...
        spinner.stop("处理完成")
    """

    def __init__(self):
        self._thread: Thread | None = None
        self._stop_event = Event()
        self._label = ''
        self._start_time = 0.0
        self._final_text = ''

    def start(self, label: str) -> None:
        self.stop()
        self._label = label
        self._start_time = time.monotonic()
        self._stop_event.clear()
        self._final_text = ''

        def _spin():
            frame = 0
            while not self._stop_event.is_set():
                elapsed = int(time.monotonic() - self._start_time)
                s = f"  {SPINNER[frame % len(SPINNER)]} {self._label}... {elapsed}s"
                update_line(s)
                frame += 1
                self._stop_event.wait(0.16)

        self._thread = Thread(target=_spin, daemon=True)
        self._thread.start()

    def stop(self, final_text: str = '') -> None:
        if self._thread and self._thread.is_alive():
            self._stop_event.set()
            self._thread.join(timeout=1)
            self._thread = None
        if final_text:
            clear_line()
            sys.stderr.write(f"  {final_text}\n")
            sys.stderr.flush()


# ── yt-dlp 进度行解析 ────────────────────────────────────────────────────────
# 输入示例：
#   [download]  45.2% of  100.00MiB at  12.34MiB/s ETA 00:04
#   [download] Destination: xxx.f248.mp4
#   [download] Merging formats into "xxx.mp4"
# 返回：dict 或 None
def parse_ytdlp_line(line: str) -> dict | None:
    """解析 yt-dlp 输出行，返回结构化的进度信息或 None"""
    if '[download] Destination:' in line:
        m = re.search(r'Destination:.*\.(mp4|webm|mkv|flv|f\d+)', line)
        if m:
            return {'type': 'dest', 'ext': m.group(1)}
    if 'Merging formats into' in line:
        return {'type': 'merge'}
    # 解析进度：允许 ~ 前缀和 ETA 格式
    m = re.search(
        r'\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(MiB|KiB|GiB)\s+at\s+([\d.]+)(MiB|KiB|GiB)/s(?:\s+ETA\s+(\d+:\d+))?',
        line,
    )
    if m:
        return {
            'type': 'progress',
            'percent': float(m.group(1)),
            'downloaded': float(m.group(2)),
            'downloaded_unit': m.group(3),
            'speed': float(m.group(4)),
            'speed_unit': m.group(5),
            'eta': m.group(6) or '',
        }
    return None


# ── ffmpeg 进度解析（需配合 -progress pipe:1 -nostats）────────────────
# 输入为 key=value 行，如：out_time_us=12345678
_ffmpeg_state = {'duration_us': 0, 'out_time_us': 0, 'speed': 0, 'total_size': 0}


def parse_ffmpeg_progress(line: str, total_duration_sec: float = 0) -> dict | None:
    """解析 ffmpeg -progress pipe:1 输出行，返回进度对象或 None"""
    line = line.strip()
    if not line or line.startswith('['):
        return None
    m = re.match(r'^(\w+)=(.+)$', line)
    if not m:
        return None
    key, val = m.group(1), m.group(2).strip()
    if key == 'out_time_us':
        _ffmpeg_state['out_time_us'] = int(val) if val else 0
    elif key == 'speed':
        speed_m = re.match(r'([\d.]+)x', val)
        _ffmpeg_state['speed'] = float(speed_m.group(1)) if speed_m else 0
    elif key == 'total_size':
        _ffmpeg_state['total_size'] = int(val) if val else 0
    elif key == 'duration_us':
        _ffmpeg_state['duration_us'] = int(val) if val else 0
    # 计算进度
    dur = total_duration_sec * 1e6 if total_duration_sec > 0 else (_ffmpeg_state['duration_us'] or 1)
    percent = min(100, (_ffmpeg_state['out_time_us'] / dur) * 100)
    return {
        'type': 'progress',
        'percent': round(percent * 10) / 10,
        'elapsed': _ffmpeg_state['out_time_us'] / 1e6,
        'speed': _ffmpeg_state['speed'],
        'total_size': _ffmpeg_state['total_size'],
    }


def reset_ffmpeg_state() -> None:
    """重置 ffmpeg 进度状态"""
    _ffmpeg_state.update({'duration_us': 0, 'out_time_us': 0, 'speed': 0, 'total_size': 0})
