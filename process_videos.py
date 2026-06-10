#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
视频下载、转码、文本识别一体化流程脚本

用法:
  # 跑全量（两个视频 sheet），3 并发，失败重试 3 次
  python process_videos.py --concurrency 3 --retry 3

  # 指定 sheet 全量
  python process_videos.py --sheet "YouTube视频" --concurrency 2

  # 指定单条（extra.id 或 title）
  python process_videos.py --sheet "YouTube视频" --id 2143

  # 只跑某个阶段
  python process_videos.py --sheet "YouTube视频" --id 2143 --step download
  python process_videos.py --sheet "YouTube视频" --id 2143 --step transcode
  python process_videos.py --sheet "YouTube视频" --id 2143 --step transcribe

  # 强制重新下载
  python process_videos.py --sheet "YouTube视频" --id 2143 --force

  # 重跑上次报告中失败的任务
  python process_videos.py --retry-failed report_20260610_141800.json

  # 干跑（只列任务，不执行）
  python process_videos.py --dry-run
"""

from __future__ import annotations

import os
import sys
import re
import argparse
import subprocess
import logging
import json
import time
import traceback
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field, asdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock, Thread

import requests
import pandas as pd
from openpyxl import load_workbook

# ─────────────────────────────── 路径配置 ───────────────────────────────────

BASE_DIR = Path(__file__).parent.resolve()
EXCEL_FILE = BASE_DIR / "export_2026-06-10_split.xlsx"
DOWNLOADS_DIR = BASE_DIR / "downloads"
TRANSCODED_DIR = BASE_DIR / "transcoded"
COOKIES_DIR = BASE_DIR / "cookies"
REPORTS_DIR = BASE_DIR / "reports"

YTDLP = r"C:\Users\Admin\AppData\Local\Programs\Memo\resources\yt-dlp\yt-dlp.exe"
FFMPEG = r"C:\Users\Admin\AppData\Local\Programs\Memo\resources\addon\ffmpeg\ffmpeg.exe"
WHISPER_SERVICE = "http://localhost:9588"

TRANSCODE_EXT = ".wav"
FFMPEG_TRANSCODE_ARGS = ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]

# ──────────────────────────────── 平台配置 ──────────────────────────────────

PLATFORM_CONFIG = {
    "tencentVid": {
        "url_tpl": "https://v.qq.com/x/page/{tencentVid}.html",
        "cookie_file": None,
        "field": "extra.tencentVid",
    },
    "bilibiliBvid": {
        "url_tpl": "https://www.bilibili.com/video/{bilibiliBvid}/",
        "cookie_file": str(COOKIES_DIR / "bilibili.txt"),
        "field": "extra.bilibiliBvid",
        "extra_headers": [
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
            "--add-header", "Referer:https://www.bilibili.com/",
            "--add-header", "Accept-Language:zh,en;q=0.9",
        ],
        "concurrent_fragments": 4,
        # 720p 优先（音频码率相同，画质够用，下载快 3-5 倍）
        "format": "bestvideo[height<=720]+bestaudio/bestvideo+bestaudio/best",
    },
    "youtubeId": {
        "url_tpl": "https://youtu.be/{youtubeId}",
        "cookie_file": str(COOKIES_DIR / "youtube.txt"),
        "field": "extra.youtubeId",
    },
    "youkuId": {
        "url_tpl": "https://v.youku.com/v_show/id_{youkuId}.html",
        "cookie_file": None,
        "field": "extra.youkuId",
    },
}

PLATFORM_PRIORITY = ["bilibiliBvid", "youtubeId", "tencentVid", "youkuId"]
VIDEO_SHEETS = ["YouTube视频", "普诺赛中文站"]

# ─────────────────────────────── 日志配置 ───────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# Excel 写锁（openpyxl 非线程安全）
_excel_lock = Lock()
# 控制台打印锁（并发时防止输出交错）
_print_lock = Lock()


# ─────────────────────────────── 总体进度 ───────────────────────────────────

@dataclass
class OverallProgress:
    """线程安全的总体进度追踪"""
    total: int
    completed: int = 0
    success: int = 0
    failed: int = 0
    partial: int = 0
    no_video: int = 0
    _lock: Lock = field(default_factory=Lock)

    def add_result(self, status: str):
        with self._lock:
            self.completed += 1
            if status == "success":
                self.success += 1
            elif status == "failed":
                self.failed += 1
            elif status == "partial":
                self.partial += 1
            elif status == "no_video":
                self.no_video += 1

    def summary_line(self) -> str:
        with self._lock:
            pct = self.completed / self.total * 100 if self.total else 0
            return (f"[总进度 {self.completed}/{self.total} ({pct:.1f}%)] "
                    f"✅{self.success} ❌{self.failed} ⚠️{self.partial} ⏭️{self.no_video}")

    def position_label(self) -> str:
        """返回当前任务在总体中的序号标签"""
        with self._lock:
            return f"[{self.completed + 1}/{self.total}]"


# ─────────────────────────────── 数据结构 ───────────────────────────────────

@dataclass
class StepResult:
    status: str          # "success" | "failed" | "skipped"
    file: str | None = None
    error: str | None = None
    retries_used: int = 0


@dataclass
class TaskResult:
    sheet: str
    id_val: str          # extra.id 或 title 的字符串表示
    title: str
    platform: str | None
    video_url: str | None
    stem: str
    download: StepResult = field(default_factory=lambda: StepResult("skipped"))
    transcode: StepResult = field(default_factory=lambda: StepResult("skipped"))
    transcribe: StepResult = field(default_factory=lambda: StepResult("skipped"))
    overall_status: str = "pending"   # "success" | "partial" | "failed" | "no_video"
    error: str | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


# ─────────────────────────────── 工具函数 ───────────────────────────────────

def safe_filename(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', '_', str(name)).strip()


def get_video_id(row: pd.Series) -> tuple[str | None, str | None]:
    for pkey in PLATFORM_PRIORITY:
        cfg = PLATFORM_CONFIG[pkey]
        val = row.get(cfg["field"])
        if pd.notna(val) and str(val).strip():
            return pkey, str(val).strip()
    return None, None


def build_url(pkey: str, vid: str) -> str:
    return PLATFORM_CONFIG[pkey]["url_tpl"].replace(f"{{{pkey}}}", vid)


def stem_name(row: pd.Series) -> str:
    eid = row.get("extra.id")
    if pd.notna(eid) and str(eid).strip():
        return safe_filename(str(int(float(eid))))
    return safe_filename(str(row.get("title", "unknown")))


def row_key(row: pd.Series) -> str:
    """返回行的唯一键 (extra.id 或 title)"""
    eid = row.get("extra.id")
    if pd.notna(eid) and str(eid).strip():
        return str(int(float(eid)))
    return str(row.get("title", "unknown"))


def find_downloaded_file(dl_dir: Path, stem: str) -> Path | None:
    for p in dl_dir.iterdir():
        if p.stem == stem:
            return p
    return None


# ─────────────────────────────── 重试机制 ───────────────────────────────────

RETRYABLE_ERRORS = (
    subprocess.TimeoutExpired,
    requests.exceptions.Timeout,
    requests.exceptions.ConnectionError,
    requests.exceptions.HTTPError,
    ConnectionError,
    TimeoutError,
    OSError,            # 网络层面的错误
)

NON_RETRYABLE_ERRORS = (
    FileNotFoundError,
    PermissionError,
    ValueError,
    KeyError,
    TypeError,
)


def is_retryable(error: Exception) -> bool:
    """判断异常是否可重试"""
    if isinstance(error, NON_RETRYABLE_ERRORS):
        return False
    if isinstance(error, RETRYABLE_ERRORS):
        return True
    # subprocess.CalledProcessError：检查 stderr 是否包含永久错误
    if isinstance(error, subprocess.CalledProcessError):
        stderr_lower = (error.stderr or "").lower()
        non_retry_keywords = {
            "404", "403", "401", "unavailable", "private video",
            "video is not available", "this video is no longer",
            "removed", "deleted", "invalid url", "unsupported url",
        }
        for kw in non_retry_keywords:
            if kw in stderr_lower:
                return False
        return True
    return False  # 未知异常默认不重试


def retry_call(fn, *args, max_retries: int = 3, base_delay: float = 5.0,
               task_label: str = "", **kwargs) -> tuple[any, int, str | None]:
    """
    带重试的函数调用。
    返回 (返回值, 已用重试次数, 错误信息)。
    成功时 error 为 None；全部重试失败后抛出最后一个异常。
    """
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            result = fn(*args, **kwargs)
            return result, attempt, None
        except Exception as e:
            last_error = str(e)
            if not is_retryable(e):
                raise
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt)  # 5, 10, 20...
                log.warning(
                    f"[{task_label}] 第 {attempt + 1}/{max_retries + 1} 次尝试失败，{delay:.0f}s 后重试: {e}"
                )
                time.sleep(delay)
            else:
                raise
    # 理论上不会到这里
    raise RuntimeError(last_error or "unknown")


# ─────────────────────────────── 进度显示 ───────────────────────────────────

def run_with_progress(cmd: list[str], label: str, parser_fn, timeout: int = 600):
    """
    执行命令并实时输出进度。
    parser_fn 接收 stderr 的每一行，返回进度字符串或 None。
    返回 (完整 stderr, returncode)。
    """
    proc = subprocess.Popen(
        cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace",
    )

    stderr_lines: list[str] = []
    last_progress = ""
    last_print_time = 0.0

    def _read():
        nonlocal last_progress, last_print_time
        for line in iter(proc.stderr.readline, ""):
            stderr_lines.append(line)
            progress = parser_fn(line)
            if progress:
                now = time.time()
                # 进度变化或距上次打印超过 2s 时输出
                if progress != last_progress or now - last_print_time > 2:
                    with _print_lock:
                        print(f"  [{label}] {progress}", flush=True)
                    last_progress = progress
                    last_print_time = now

    reader = Thread(target=_read, daemon=True)
    reader.start()

    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        reader.join(timeout=2)
        raise

    reader.join(timeout=3)
    return "".join(stderr_lines), proc.returncode


def parse_ytdlp_progress(line: str) -> str | None:
    """解析 yt-dlp 进度行。返回进度描述，非进度行返回 None。"""
    # [download]  15.2% of ~50.00MiB at 2.50MiB/s ETA 00:17
    m = re.search(r'\[download\]\s+([\d.]+%)\s+of', line)
    if m:
        pct = m.group(1)
        parts = [pct]
        speed_m = re.search(r'at\s+(\S+\s*\S*/s)', line)
        if speed_m:
            parts.append(speed_m.group(1))
        eta_m = re.search(r'ETA\s+(\S+)', line)
        if eta_m:
            parts.append(f"ETA {eta_m.group(1)}")
        return " ".join(parts) if parts else pct
    if "[download] 100% of" in line or "has already been downloaded" in line:
        return "100%"
    if "[download] Destination:" in line:
        return "写入文件..."
    if "[ExtractAudio]" in line or "[Merger]" in line or "[ffmpeg]" in line:
        return "合并音视频..."
    if "Downloading webpage" in line.lower() or "[youtube]" in line:
        return "解析页面..."
    return None


def get_duration(filepath: Path) -> float | None:
    """用 ffprobe 获取媒体时长（秒）。失败返回 None。"""
    try:
        result = subprocess.run(
            [FFMPEG, "-i", str(filepath)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
        )
        # ffmpeg 把信息输出到 stderr
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", result.stderr)
        if m:
            h, mm, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
            return h * 3600 + mm * 60 + s
    except Exception:
        pass
    return None


def make_ffmpeg_parser(total_duration: float | None) -> callable:
    """根据总时长创建 ffmpeg 进度解析器。"""
    def _parse(line: str) -> str | None:
        m = re.search(r"time=(\d+):(\d+):(\d+\.?\d*)", line)
        if m:
            h, mm, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
            elapsed = h * 3600 + mm * 60 + s
            if total_duration and total_duration > 0:
                pct = min(100, elapsed / total_duration * 100)
                return f"{pct:.1f}% ({int(elapsed)}s/{int(total_duration)}s)"
            else:
                return f"{elapsed:.1f}s"
        # ffmpeg 转码完成时 silence 等最后一行
        if "size=" in line and "time=" in line:
            # 这是最后的状态行
            pass
        return None
    return _parse

def step_download(
    row: pd.Series, sheet_name: str,
    max_retries: int, retry_delay: float, force: bool,
) -> tuple[Path | None, int, str | None]:
    """下载视频。返回 (文件路径, 重试次数, 错误信息)"""
    pkey, vid = get_video_id(row)
    stem = stem_name(row)

    if not pkey:
        return None, 0, "无可用视频 ID"

    dl_dir = DOWNLOADS_DIR / sheet_name
    dl_dir.mkdir(parents=True, exist_ok=True)

    if not force:
        existing = find_downloaded_file(dl_dir, stem)
        if existing:
            with _print_lock:
                print(f"  [{stem}] 已存在 {existing.name}，跳过下载", flush=True)
            return existing, 0, None

    url = build_url(pkey, vid)
    with _print_lock:
        print(f"  [{stem}] 开始下载 (平台={pkey})", flush=True)
        print(f"  [{stem}] {url}", flush=True)

    cmd = [
        YTDLP, url,
        "-o", str(dl_dir / f"{stem}.%(ext)s"),
        "--no-playlist",
        "--ffmpeg-location", str(Path(FFMPEG).parent),
        "--merge-output-format", "mp4",
        "-f", PLATFORM_CONFIG[pkey].get("format", "bestvideo+bestaudio/best"),
    ]

    # 平台级并发分片（加速下载）
    cf = PLATFORM_CONFIG[pkey].get("concurrent_fragments")
    if cf:
        cmd += ["--concurrent-fragments", str(cf)]

    cookie_file = PLATFORM_CONFIG[pkey]["cookie_file"]
    if cookie_file and Path(cookie_file).exists():
        cmd += ["--cookies", cookie_file]

    extra_headers = PLATFORM_CONFIG[pkey].get("extra_headers", [])
    if extra_headers:
        cmd += extra_headers

    def _run():
        stderr_text, rc = run_with_progress(cmd, stem, parse_ytdlp_progress, timeout=600)
        if rc != 0:
            raise subprocess.CalledProcessError(rc, cmd, stderr=stderr_text)

    try:
        _run, retries_used, err = retry_call(
            _run, max_retries=max_retries, base_delay=retry_delay, task_label=stem,
        )
        if err:
            return None, retries_used, err
    except Exception as e:
        stderr_text = ""
        if isinstance(e, subprocess.CalledProcessError):
            stderr_text = (e.stderr or "")[-2000:]
        log.error(f"[{stem}] yt-dlp 下载失败:\n{stderr_text or str(e)}")
        retries = max_retries if isinstance(e, subprocess.CalledProcessError) else 0
        return None, retries, (stderr_text or str(e))[:500]

    downloaded = find_downloaded_file(dl_dir, stem)
    if downloaded:
        with _print_lock:
            print(f"  [{stem}] 下载完成 -> {downloaded.name}", flush=True)
    else:
        log.error(f"[{stem}] 下载后找不到文件")
        return None, retries_used, "下载后找不到文件"
    return downloaded, 0, None


def step_transcode(
    src_file: Path, sheet_name: str,
    max_retries: int, retry_delay: float, force: bool,
) -> tuple[Path | None, int, str | None]:
    """转码。返回 (转码文件路径, 重试次数, 错误信息)"""
    tc_dir = TRANSCODED_DIR / sheet_name
    tc_dir.mkdir(parents=True, exist_ok=True)
    out_file = tc_dir / (src_file.stem + TRANSCODE_EXT)
    stem = src_file.stem

    if not force and out_file.exists() and out_file.stat().st_size > 0:
        with _print_lock:
            print(f"  [{stem}] 已存在转码文件，跳过", flush=True)
        return out_file, 0, None

    with _print_lock:
        print(f"  [{stem}] 开始转码 -> {out_file.name}", flush=True)

    # 获取源文件时长用于百分比计算
    total_dur = get_duration(src_file)

    def _run():
        parser = make_ffmpeg_parser(total_dur)
        cmd = [FFMPEG, "-y", "-i", str(src_file)] + FFMPEG_TRANSCODE_ARGS + [str(out_file)]
        stderr_text, rc = run_with_progress(cmd, stem, parser, timeout=300)
        if rc != 0:
            raise subprocess.CalledProcessError(rc, cmd, stderr=stderr_text)
        return out_file

    try:
        result, retries_used, err = retry_call(
            _run, max_retries=max_retries, base_delay=retry_delay, task_label=stem,
        )
        if err:
            return None, retries_used, err
        with _print_lock:
            print(f"  [{stem}] 转码完成", flush=True)
        return result, 0, None
    except Exception as e:
        stderr_text = ""
        if isinstance(e, subprocess.CalledProcessError):
            stderr_text = (e.stderr or "")[-2000:]
        log.error(f"[{stem}] ffmpeg 转码失败:\n{stderr_text or str(e)}")
        return None, max_retries, (stderr_text or str(e))[:500]


def _check_whisper_service() -> bool:
    """检测 whisper 服务是否可达"""
    try:
        r = requests.get(WHISPER_SERVICE, timeout=3)
        return True
    except Exception:
        return False


def step_transcribe(
    audio_file: Path,
    max_retries: int, retry_delay: float,
) -> tuple[str | None, int, str | None]:
    """调用 whisper 服务识别。返回 (文本, 重试次数, 错误信息)"""
    stem = audio_file.stem

    if not _check_whisper_service():
        msg = f"whisper 服务不可达 ({WHISPER_SERVICE})"
        log.warning(f"[{stem}] {msg}")
        return None, 0, msg

    file_size_mb = audio_file.stat().st_size / (1024 * 1024)
    with _print_lock:
        print(f"  [{stem}] 开始识别 (文件 {file_size_mb:.1f}MB)...", flush=True)

    start_time = time.time()
    done = [False]  # 用列表实现闭包内可变

    def _progress_reporter():
        """每隔 5 秒打印已用时间"""
        while not done[0]:
            time.sleep(5)
            if not done[0]:
                elapsed = time.time() - start_time
                with _print_lock:
                    print(f"  [{stem}] 识别中... {elapsed:.0f}s", flush=True)

    reporter = Thread(target=_progress_reporter, daemon=True)

    def _run():
        reporter.start()
        try:
            with open(audio_file, "rb") as f:
                resp = requests.post(
                    f"{WHISPER_SERVICE}/inference",
                    files={"file": (audio_file.name, f, "audio/wav")},
                    data={"temperature": "0.0", "temperature_inc": "0.2", "response_format": "json"},
                    timeout=600,
                )
            resp.raise_for_status()
            data = resp.json()
            text = data.get("text", "").strip()
            if not text:
                raise ValueError("whisper 返回空文本")
            return text
        finally:
            done[0] = True

    try:
        text, retries_used, err = retry_call(
            _run, max_retries=max_retries, base_delay=retry_delay, task_label=stem,
        )
        elapsed = time.time() - start_time
        if err:
            return None, retries_used, err
        with _print_lock:
            print(f"  [{stem}] 识别完成 ({elapsed:.0f}s, {len(text)} 字符)", flush=True)
        return text, 0, None
    except Exception as e:
        done[0] = True
        log.error(f"[{stem}] whisper 识别失败: {e}")
        return None, max_retries, str(e)[:500]


# ─────────────────────────────── Excel 批量写回 ─────────────────────────────

def write_all_contents_to_excel(results: list[TaskResult]):
    """
    将所有识别文本批量写回 Excel。
    使用 openpyxl 直接操作，单线程安全。
    参数 results 中只处理 transcribe.status == "success" 且 transcribe.text 非空的结果。
    """
    if not results:
        return

    # 收集需要写入的数据：{(sheet_name, key): text}
    updates: dict[tuple[str, str], str] = {}
    for tr in results:
        if tr.transcribe.status == "success" and tr.transcribe.file:
            text = tr.transcribe.file  # 这里 file 字段存的是识别文本（为兼容 StepResult 结构）
            if text.strip():
                updates[(tr.sheet, tr.id_val)] = text

    if not updates:
        return

    log.info(f"批量写入 {len(updates)} 条识别文本到 Excel...")
    wb = load_workbook(str(EXCEL_FILE))

    for (sheet_name, key), text in updates.items():
        if sheet_name not in wb.sheetnames:
            log.warning(f"Sheet [{sheet_name}] 不存在，跳过写入")
            continue

        ws = wb[sheet_name]
        headers = {cell.value: cell.column for cell in ws[1]}

        if "content" not in headers:
            log.warning(f"[{sheet_name}] 找不到 content 列，跳过写入")
            continue

        content_col = headers["content"]
        id_col = headers.get("extra.id")
        title_col = headers.get("title")

        matched = False
        for row in ws.iter_rows(min_row=2):
            id_val = row[id_col - 1].value if id_col else None
            title_val = row[title_col - 1].value if title_col else None

            if id_col and id_val is not None:
                try:
                    if str(int(float(id_val))) == str(key):
                        matched = True
                except (ValueError, TypeError):
                    pass
            if not matched and title_col:
                if str(title_val) == str(key):
                    matched = True

            if matched:
                row[content_col - 1].value = text
                log.info(f"[{sheet_name}/{key}] content 已写入（{len(text)} 字符）")
                break

        if not matched:
            log.warning(f"[{sheet_name}] 未找到匹配行 key={key}")

    wb.save(str(EXCEL_FILE))
    wb.close()
    log.info("Excel 写入完成")


# ─────────────────────────────── 报告生成 ───────────────────────────────────

def generate_report(results: list[TaskResult], config: dict) -> Path:
    """生成执行报告 JSON 文件，返回报告路径"""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_file = REPORTS_DIR / f"report_{timestamp}.json"

    success_count = sum(1 for r in results if r.overall_status == "success")
    partial_count = sum(1 for r in results if r.overall_status == "partial")
    failed_count = sum(1 for r in results if r.overall_status == "failed")
    no_video_count = sum(1 for r in results if r.overall_status == "no_video")

    report = {
        "timestamp": datetime.now().isoformat(),
        "config": config,
        "summary": {
            "total": len(results),
            "success": success_count,
            "partial": partial_count,
            "failed": failed_count,
            "no_video": no_video_count,
        },
        "items": [r.to_dict() for r in results],
        "failed_items": [
            {
                "sheet": r.sheet,
                "id": r.id_val,
                "title": r.title,
                "stem": r.stem,
                "error": r.error,
                "download_error": r.download.error,
                "transcode_error": r.transcode.error,
                "transcribe_error": r.transcribe.error,
            }
            for r in results if r.overall_status in ("failed", "partial")
        ],
    }

    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    log.info(f"报告已生成: {report_file}")
    return report_file


def print_report_summary(results: list[TaskResult]):
    """打印控制台摘要"""
    success = sum(1 for r in results if r.overall_status == "success")
    partial = sum(1 for r in results if r.overall_status == "partial")
    failed = sum(1 for r in results if r.overall_status == "failed")
    no_vid = sum(1 for r in results if r.overall_status == "no_video")

    print(f"\n{'='*60}")
    print(f"  执行摘要")
    print(f"{'='*60}")
    print(f"  总计: {len(results)}")
    print(f"  ✅ 成功: {success}")
    print(f"  ⚠️ 部分成功: {partial}")
    print(f"  ❌ 失败: {failed}")
    print(f"  ⏭️ 无视频ID: {no_vid}")
    print(f"{'='*60}")

    # 列出所有非成功项
    failures = [r for r in results if r.overall_status != "success"]
    if failures:
        print(f"\n失败/异常详情:")
        for r in failures:
            icon = {"partial": "⚠️", "failed": "❌", "no_video": "⏭️"}.get(r.overall_status, "?")
            print(f"  {icon} [{r.sheet}] {r.id_val} ({r.title[:30] if r.title else 'N/A'})")
            if r.error:
                print(f"       错误: {r.error[:120]}")
            if r.download.status == "failed":
                print(f"       下载失败: {r.download.error[:120] if r.download.error else 'N/A'}")
            if r.transcode.status == "failed":
                print(f"       转码失败: {r.transcode.error[:120] if r.transcode.error else 'N/A'}")
            if r.transcribe.status == "failed":
                print(f"       识别失败: {r.transcribe.error[:120] if r.transcribe.error else 'N/A'}")


# ─────────────────────────────── 单任务处理 ─────────────────────────────────

def process_one_task(
    row: pd.Series, sheet_name: str, steps: list[str],
    max_retries: int, retry_delay: float, force: bool,
    whisper_available: bool,
    position_label: str = "",
) -> TaskResult:
    """处理单个视频的全流程（在独立线程中执行）"""
    pkey, vid = get_video_id(row)
    stem = stem_name(row)
    key = row_key(row)
    title = str(row.get("title", ""))
    url = build_url(pkey, vid) if pkey else None

    result = TaskResult(
        sheet=sheet_name, id_val=key, title=title,
        platform=pkey, video_url=url, stem=stem,
    )

    # 打印总体进度位置 + 当前任务标识
    tag = f"{position_label} " if position_label else ""
    with _print_lock:
        print(f"{tag}[{stem}] 开始处理 (sheet={sheet_name}, platform={pkey or 'N/A'}, title={title[:40]})", flush=True)
    log.info(f"[{stem}] 开始处理 (sheet={sheet_name}, platform={pkey or 'N/A'})")

    # ── 下载 ──
    if "download" in steps:
        if not pkey:
            result.download = StepResult("skipped")
            result.overall_status = "no_video"
            result.error = "无可用视频 ID"
            log.warning(f"[{stem}] 无可用视频 ID，标记为 no_video")
            return result

        try:
            dl_file, retries, err = step_download(row, sheet_name, max_retries, retry_delay, force)
        except Exception as e:
            dl_file, retries, err = None, max_retries, str(e)[:500]

        result.download = StepResult(
            status="success" if dl_file else "failed",
            file=str(dl_file) if dl_file else None,
            error=err,
            retries_used=retries,
        )

        if not dl_file:
            result.overall_status = "failed"
            result.error = f"下载失败: {err}"
            return result
    else:
        dl_dir = DOWNLOADS_DIR / sheet_name
        dl_file = find_downloaded_file(dl_dir, stem)
        if dl_file:
            result.download = StepResult("success", file=str(dl_file))
        else:
            result.download = StepResult("skipped")

    # ── 转码 ──
    if "transcode" in steps and dl_file:
        try:
            tc_file, retries, err = step_transcode(dl_file, sheet_name, max_retries, retry_delay, force)
        except Exception as e:
            tc_file, retries, err = None, max_retries, str(e)[:500]

        result.transcode = StepResult(
            status="success" if tc_file else "failed",
            file=str(tc_file) if tc_file else None,
            error=err,
            retries_used=retries,
        )

        if not tc_file:
            result.overall_status = "partial"
            result.error = f"下载成功但转码失败: {err}"
            return result
    else:
        tc_dir = TRANSCODED_DIR / sheet_name
        tc_path = tc_dir / (stem + TRANSCODE_EXT)
        if tc_path.exists():
            result.transcode = StepResult("success", file=str(tc_path))
            tc_file = tc_path
        else:
            result.transcode = StepResult("skipped")
            tc_file = None

    # ── 识别 ──
    if "transcribe" in steps and tc_file:
        if not whisper_available:
            result.transcribe = StepResult("failed", error=f"whisper 服务不可达 ({WHISPER_SERVICE})")
            result.overall_status = "partial"
            result.error = "下载+转码成功但 whisper 服务不可达"
            return result

        try:
            text, retries, err = step_transcribe(tc_file, max_retries, retry_delay)
        except Exception as e:
            text, retries, err = None, max_retries, str(e)[:500]

        # 注意：StepResult.file 在这里存的是识别文本（为兼容 find_downloaded_file 等逻辑）
        result.transcribe = StepResult(
            status="success" if text else "failed",
            file=text if text else None,  # 借用 file 字段存文本
            error=err,
            retries_used=retries,
        )

        if not text:
            result.overall_status = "partial"
            result.error = f"下载+转码成功但识别失败: {err}"
        else:
            result.overall_status = "success"
    elif "transcribe" in steps and not tc_file:
        result.transcribe = StepResult("skipped")
        result.overall_status = "partial"
        result.error = "缺少转码文件，无法识别"

    if result.overall_status == "pending":
        result.overall_status = "success"

    return result


# ─────────────────────────────── 主控流程 ───────────────────────────────────

def run(
    target_sheet: str | None,
    target_id: str | None,
    steps: list[str],
    max_retries: int,
    retry_delay: float,
    concurrency: int,
    force: bool,
    dry_run: bool,
    retry_failed: str | None,
):
    """主执行流程"""
    # ── 重跑失败模式 ──
    if retry_failed:
        return run_from_report(retry_failed, steps, max_retries, retry_delay,
                               concurrency, force, dry_run)

    # ── 构建任务列表 ──
    sheets = [target_sheet] if target_sheet else VIDEO_SHEETS
    tasks = []
    for sheet_name in sheets:
        df = pd.read_excel(str(EXCEL_FILE), sheet_name=sheet_name)
        if target_id:
            mask = pd.Series([False] * len(df))
            if "extra.id" in df.columns:
                try:
                    mask = mask | (df["extra.id"].apply(
                        lambda x: str(int(float(x))) if pd.notna(x) else ""
                    ) == str(target_id))
                except Exception:
                    pass
            if "title" in df.columns:
                mask = mask | (df["title"].astype(str) == str(target_id))
            df = df[mask]
            if df.empty:
                log.error(f"Sheet [{sheet_name}] 中找不到 id/title = {target_id}")
                continue
        for _, row in df.iterrows():
            tasks.append((row, sheet_name))

    log.info(f"任务数量: {len(tasks)}，并发数: {concurrency}，最大重试: {max_retries}")

    # ── 干跑模式 ──
    if dry_run:
        print(f"\n{'='*60}")
        print(f"  干跑模式 - 任务清单 ({len(tasks)} 条)")
        print(f"{'='*60}")
        for i, (row, sheet_name) in enumerate(tasks):
            pkey, vid = get_video_id(row)
            stem = stem_name(row)
            url = build_url(pkey, vid) if pkey else "N/A"
            dl_exists = (DOWNLOADS_DIR / sheet_name / stem).with_suffix(".mp4").exists()
            tc_exists = (TRANSCODED_DIR / sheet_name / (stem + TRANSCODE_EXT)).exists()
            print(f"  {i + 1}. [{sheet_name}] {stem}")
            print(f"     platform={pkey}, url={url}")
            print(f"     下载={dl_exists}, 转码={tc_exists}")
            if not pkey:
                print(f"     ⚠️ 无可用视频 ID")
        return

    # ── 检测 whisper ──
    whisper_available = _check_whisper_service() if "transcribe" in steps else False
    if "transcribe" in steps and not whisper_available:
        log.warning(f"⚠️ whisper 服务不可达 ({WHISPER_SERVICE})，识别步骤将跳过")

    # ── 并发执行 ──
    results: list[TaskResult] = []
    overall = OverallProgress(total=len(tasks))

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as executor:
        future_map = {}
        for idx, (row, sheet_name) in enumerate(tasks):
            pos_label = f"[{idx + 1}/{len(tasks)}]"
            future_map[
                executor.submit(
                    process_one_task, row, sheet_name, steps,
                    max_retries, retry_delay, force, whisper_available,
                    pos_label,
                )
            ] = (row, sheet_name)

        for future in as_completed(future_map):
            try:
                result = future.result()
                results.append(result)
                overall.add_result(result.overall_status)
            except Exception as e:
                row, sheet_name = future_map[future]
                stem = stem_name(row)
                log.error(f"[{stem}] 任务执行异常: {e}\n{traceback.format_exc()}")
                tr = TaskResult(
                    sheet=sheet_name, id_val=row_key(row),
                    title=str(row.get("title", "")), stem=stem,
                    overall_status="failed", error=f"未捕获异常: {str(e)[:500]}",
                )
                results.append(tr)
                overall.add_result("failed")

            # 每次完成打印总体进度
            with _print_lock:
                print(f"\n{overall.summary_line()}\n", flush=True)

    # ── 批量写回 Excel ──
    if "transcribe" in steps:
        write_all_contents_to_excel(results)

    # ── 生成报告 ──
    config = {
        "sheets": sheets,
        "target_id": target_id,
        "steps": steps,
        "max_retries": max_retries,
        "retry_delay": retry_delay,
        "concurrency": concurrency,
        "force": force,
    }
    report_path = generate_report(results, config)
    print_report_summary(results)

    log.info(f"全部完成！报告: {report_path}")


def run_from_report(
    report_path: str, steps: list[str],
    max_retries: int, retry_delay: float,
    concurrency: int, force: bool, dry_run: bool,
):
    """从报告加载失败项，重新执行"""
    with open(report_path, "r", encoding="utf-8") as f:
        report = json.load(f)

    failed_items = report.get("failed_items", [])
    if not failed_items:
        log.info("报告中没有失败项，无需重跑")
        return

    log.info(f"从报告加载 {len(failed_items)} 条失败项")

    tasks = []
    for item in failed_items:
        sheet_name = item["sheet"]
        key = str(item["id"])
        df = pd.read_excel(str(EXCEL_FILE), sheet_name=sheet_name)

        # 匹配行
        mask = pd.Series([False] * len(df))
        if "extra.id" in df.columns:
            try:
                mask = mask | (df["extra.id"].apply(
                    lambda x: str(int(float(x))) if pd.notna(x) else ""
                ) == key)
            except Exception:
                pass
        if "title" in df.columns:
            mask = mask | (df["title"].astype(str) == key)

        df = df[mask]
        if df.empty:
            log.warning(f"[{sheet_name}] 找不到 {key}，跳过")
            continue
        tasks.append((df.iloc[0], sheet_name))

    if not tasks:
        log.info("无有效失败项可重跑")
        return

    if dry_run:
        print(f"\n  干跑模式 - 重跑 {len(tasks)} 条失败项")
        for i, (row, sheet_name) in enumerate(tasks):
            print(f"  {i + 1}. [{sheet_name}] {stem_name(row)}")
        return

    whisper_available = _check_whisper_service() if "transcribe" in steps else False

    results: list[TaskResult] = []
    overall = OverallProgress(total=len(tasks))

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as executor:
        future_map = {}
        for idx, (row, sheet_name) in enumerate(tasks):
            pos_label = f"[{idx + 1}/{len(tasks)}]"
            future_map[
                executor.submit(
                    process_one_task, row, sheet_name, steps,
                    max_retries, retry_delay, force, whisper_available,
                    pos_label,
                )
            ] = (row, sheet_name)

        for future in as_completed(future_map):
            try:
                result = future.result()
                results.append(result)
                overall.add_result(result.overall_status)
            except Exception as e:
                row, sheet_name = future_map[future]
                stem = stem_name(row)
                log.error(f"[{stem}] 任务执行异常: {e}")
                tr = TaskResult(
                    sheet=sheet_name, id_val=row_key(row),
                    title=str(row.get("title", "")), stem=stem,
                    overall_status="failed", error=str(e)[:500],
                )
                results.append(tr)
                overall.add_result("failed")

            with _print_lock:
                print(f"\n{overall.summary_line()}\n", flush=True)

    if "transcribe" in steps:
        write_all_contents_to_excel(results)

    config = {
        "mode": "retry-failed",
        "source_report": report_path,
        "steps": steps,
        "max_retries": max_retries,
        "concurrency": concurrency,
        "force": force,
    }
    report_path_new = generate_report(results, config)
    print_report_summary(results)
    log.info(f"重跑完成！报告: {report_path_new}")


# ─────────────────────────────── 入口 ───────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="视频下载/转码/识别流程（支持并发、重试、报告）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python process_videos.py --concurrency 3 --retry 3
  python process_videos.py --sheet "YouTube视频" --id 2143
  python process_videos.py --retry-failed reports/report_20260610_141800.json
  python process_videos.py --dry-run
        """,
    )
    parser.add_argument("--sheet", help="指定 sheet 名称（默认全部视频 sheet）")
    parser.add_argument("--id", dest="vid_id", help="指定 extra.id 或 title（单条测试）")
    parser.add_argument(
        "--step", choices=["download", "transcode", "transcribe"],
        help="只执行指定步骤（默认全跑）",
    )
    parser.add_argument("--force", action="store_true", help="强制重新执行，忽略已有文件")
    parser.add_argument(
        "--concurrency", type=int, default=1,
        help="并发数，默认 1（仅配置 >1 时多线程并行，建议 2~3）",
    )
    parser.add_argument(
        "--retry", type=int, default=0,
        help="每个步骤失败后最大重试次数，默认 0",
    )
    parser.add_argument(
        "--retry-delay", type=float, default=5.0,
        help="重试间隔基数（秒），指数退避，默认 5s",
    )
    parser.add_argument("--dry-run", action="store_true", help="干跑模式，仅列出任务不执行")
    parser.add_argument(
        "--retry-failed",
        help="从指定报告 JSON 重跑失败项（reports/report_xxx.json）",
    )
    args = parser.parse_args()

    steps = [args.step] if args.step else ["download", "transcode", "transcribe"]
    run(
        target_sheet=args.sheet,
        target_id=args.vid_id,
        steps=steps,
        max_retries=args.retry,
        retry_delay=args.retry_delay,
        concurrency=args.concurrency,
        force=args.force,
        dry_run=args.dry_run,
        retry_failed=args.retry_failed,
    )
