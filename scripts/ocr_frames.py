#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ocr_frames.py — 视频抽帧 + PaddleOCR 文字识别（OCR 抽帧分支的单一实现点）

设计要点：
- 抽帧：ffmpeg 场景切换抽帧（select='gt(scene,THRESH)'）+ 关键帧兜底 + max-frames 放宽阈值保护，
  确保 1~2 小时长视频完整处理且不丢字幕帧。
- 识别：PaddleOCR 逐帧识别，置信度 < conf_thresh 的文本块丢弃，按帧序排序、相邻重复去重拼接。
- 双端共用：process_videos.js 与 process_videos.py 都通过 subprocess 调用本脚本，行为 100% 一致。
- 模型位置：读取 PADDLE_OCR_BASE_DIR 环境变量（或 --model-dir）透传给 PaddleOCR，避免占 C 盘。

产物：
- --out  : 最终 OCR 文本（transcripts/{sheet}/{stem}.ocr.txt）
- --meta : 元数据 JSON（chars / avg_conf / frames / ok / note），供调用方做 OCR/ASR 择优
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile


def _probe_duration(video):
    """返回视频时长（秒），失败返回 0.0。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video],
            capture_output=True, text=True, timeout=60,
        )
        val = out.stdout.strip()
        return float(val) if val else 0.0
    except Exception:
        return 0.0


def _has_audio(video):
    """视频是否含音轨。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=index", "-of", "csv=p=0", video],
            capture_output=True, text=True, timeout=60,
        )
        return bool(out.stdout.strip())
    except Exception:
        return False


def extract_frames(video, out_dir, scene_thresh, max_frames, duration=0.0):
    """抽帧，返回按时间序排列的帧路径列表。

    策略：
    1. 场景切换抽帧 select='gt(scene,THRESH)' + scale 保清晰。
    2. 0 帧（完全静止）→ 退化为均匀抽帧（每 interval 秒 1 帧）。
    3. 超 max_frames → 放宽阈值重抽；仍超 → 按步长抽稀（不盲目跳帧丢文字）。
    """
    os.makedirs(out_dir, exist_ok=True)
    pat = os.path.join(out_dir, "%06d.png")

    def _run(thresh):
        vf = f"select='gt(scene,{thresh})',scale=-1:720"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", video, "-vf", vf,
             "-fps_mode", "passthrough", "-f", "image2", pat],
            capture_output=True, text=True, timeout=600,
        )
        frames = sorted(
            os.path.join(out_dir, f) for f in os.listdir(out_dir) if f.endswith(".png")
        )
        return frames

    frames = _run(scene_thresh)
    if not frames:
        # 完全静止视频：均匀抽帧，interval = max(1, duration/max_frames) 秒
        interval = max(1, int(duration / max_frames)) if duration else 3
        vf = f"fps=1/{interval},scale=-1:720"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", video, "-vf", vf,
             "-fps_mode", "passthrough", "-f", "image2", pat],
            capture_output=True, text=True, timeout=600,
        )
        frames = sorted(
            os.path.join(out_dir, f) for f in os.listdir(out_dir) if f.endswith(".png")
        )

    if len(frames) > max_frames:
        # 放宽场景阈值重抽
        frames = _run(max(scene_thresh * 0.6, 0.05))
        if len(frames) > max_frames:
            # 按步长抽稀，保留首尾，避免丢关键帧
            stride = (len(frames) + max_frames - 1) // max_frames
            frames = frames[::stride]
    return frames


def run_ocr(frames, lang, conf_thresh, model_dir):
    """逐帧 PaddleOCR，返回 (final_text, avg_conf, kept_blocks)。"""
    # 懒加载：未安装 paddleocr 时给出明确错误，而非 import 期崩溃
    try:
        from paddleocr import PaddleOCR  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "未安装 paddleocr/paddlepaddle，请先执行: "
            "pip install paddlepaddle paddleocr  （国内建议用清华源）"
        ) from e

    det = rec = cls = None
    if model_dir:
        det = os.path.join(model_dir, "det")
        rec = os.path.join(model_dir, "rec")
        cls = os.path.join(model_dir, "cls")

    # 抑制 PaddleOCR/Paddle 的初始化日志噪音
    import logging
    for name in ("ppocr", "paddle", "paddleocr"):
        logging.getLogger(name).setLevel(logging.WARNING)

    ocr = PaddleOCR(
        use_angle_cls=True, lang=lang,
        det_model_dir=det, rec_model_dir=rec, cls_model_dir=cls,
        show_log=False,
    )

    lines = []
    confs = []
    for fp in frames:
        res = ocr.ocr(fp, cls=True)
        if not res or not res[0]:
            lines.append("")
            continue
        parts = []
        for item in res[0]:
            if not item or len(item) < 2:
                continue
            text_conf = item[1]
            if not text_conf or len(text_conf) < 2:
                continue
            text, conf = text_conf[0], float(text_conf[1])
            if conf >= conf_thresh and text.strip():
                parts.append(text.strip())
                confs.append(conf)
        lines.append(" ".join(parts))

    # 相邻重复去重（烧录字幕常跨多帧不变）
    deduped = []
    prev = None
    for ln in lines:
        if ln and ln != prev:
            deduped.append(ln)
        prev = ln
    final_text = "\n".join(deduped).strip()
    avg_conf = (sum(confs) / len(confs)) if confs else 0.0
    return final_text, avg_conf, len(confs)


def main():
    ap = argparse.ArgumentParser(description="视频抽帧 + PaddleOCR 文字识别")
    ap.add_argument("--video", required=True, help="输入视频文件")
    ap.add_argument("--out", required=True, help="输出 OCR 文本路径 (.ocr.txt)")
    ap.add_argument("--meta", default=None, help="输出元数据 JSON 路径（默认 <out>.meta.json）")
    ap.add_argument("--lang", default="en", help="PaddleOCR lang: en / ch")
    ap.add_argument("--scene-thresh", type=float, default=0.3, help="场景切换抽帧阈值")
    ap.add_argument("--max-frames", type=int, default=2000, help="抽帧保护上限")
    ap.add_argument("--conf-thresh", type=float, default=0.6, help="文本块置信度下限")
    ap.add_argument("--model-dir", default=None, help="PaddleOCR 模型目录（覆盖 PADDLE_OCR_BASE_DIR）")
    args = ap.parse_args()

    meta_path = args.meta or (args.out + ".meta.json")
    note = ""
    nframes = 0
    try:
        if not os.path.exists(args.video):
            raise RuntimeError(f"视频文件不存在: {args.video}")

        model_dir = args.model_dir or os.getenv("PADDLE_OCR_BASE_DIR") or None
        duration = _probe_duration(args.video)
        has_audio = _has_audio(args.video)
        note = f"duration={duration:.1f}s audio={has_audio}"

        with tempfile.TemporaryDirectory() as tmp:
            frames = extract_frames(args.video, tmp, args.scene_thresh, args.max_frames, duration)
            nframes = len(frames)
            if not frames:
                final_text, avg_conf = "", 0.0
                note += " no_frames"
            else:
                final_text, avg_conf, _ = run_ocr(frames, args.lang, args.conf_thresh, model_dir)
                note += f" frames={nframes}"

        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(final_text)
        chars = len(final_text.strip())
        meta = {"ok": True, "chars": chars, "avg_conf": round(avg_conf, 4),
                "frames": nframes, "note": note}
    except Exception as e:
        meta = {"ok": False, "chars": 0, "avg_conf": 0.0, "frames": 0,
                "note": f"{note} error={e}"}
        # 仍写出空文本，避免调用方误判为残缺
        try:
            os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
            with open(args.out, "w", encoding="utf-8") as f:
                f.write("")
        except Exception:
            pass

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    # 退出码：ok=0 / fail=1，便于调用方判定
    sys.exit(0 if meta["ok"] else 1)


if __name__ == "__main__":
    main()
