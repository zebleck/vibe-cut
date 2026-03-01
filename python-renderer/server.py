import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Set

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse


app = FastAPI(title="Vibe Python Renderer")
RENDERER_VERSION = "2026-03-01-text-v1"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_name(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in name)


def _probe_stream_types(path: str) -> Set[str]:
    """Return stream codec types (e.g. {'video', 'audio'}) for a media file."""
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout:
            return set()
        data = json.loads(proc.stdout)
        streams = data.get("streams", [])
        return {
            s.get("codec_type")
            for s in streams
            if isinstance(s, dict) and isinstance(s.get("codec_type"), str)
        }
    except Exception:
        return set()


def _clip_duration(clip: Dict[str, Any], media: Dict[str, Any]) -> float:
    speed = max(0.01, float(clip.get("speed", 1.0)))
    source_duration = max(0.0, float(media["duration"]) - float(clip["trimStart"]) - float(clip["trimEnd"]))
    return source_duration / speed


def _clip_source_duration(clip: Dict[str, Any], media: Dict[str, Any]) -> float:
    return max(0.0, float(media["duration"]) - float(clip["trimStart"]) - float(clip["trimEnd"]))


def _atempo_chain(speed: float) -> List[str]:
    # FFmpeg atempo supports 0.5..2.0 per stage, so chain factors when needed.
    filters: List[str] = []
    remaining = speed

    while remaining > 2.0:
        filters.append("atempo=2")
        remaining /= 2.0
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5

    filters.append(f"atempo={_fmt(remaining)}")
    return filters


def _fmt(v: float) -> str:
    return f"{v:.6f}"


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _escape_drawtext_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("%", "\\%")
    )


def _escape_drawtext_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "version": RENDERER_VERSION}


@app.post("/render")
async def render(request: Request, background_tasks: BackgroundTasks):
    form = await request.form()
    project_raw = form.get("project")
    settings_raw = form.get("settings")
    if not project_raw or not settings_raw:
        raise HTTPException(status_code=400, detail="Missing project/settings")

    try:
        project = json.loads(project_raw)  # type: ignore[arg-type]
        settings = json.loads(settings_raw)  # type: ignore[arg-type]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {e}")

    temp_dir = tempfile.mkdtemp(prefix="vibe-render-")
    try:
        media_paths: Dict[str, str] = {}
        for key, value in form.multi_items():
            if not key.startswith("media_"):
                continue
            media_id = key[len("media_"):]
            upload = value
            filename = _safe_name(getattr(upload, "filename", f"{media_id}.bin"))
            target = Path(temp_dir) / f"{media_id}_{filename}"
            data = await upload.read()  # type: ignore[union-attr]
            target.write_bytes(data)
            media_paths[media_id] = str(target)

        media_map = {m["id"]: m for m in project["mediaFiles"]}
        stream_types_by_media: Dict[str, Set[str]] = {}
        for media_id, media_path in media_paths.items():
            stream_types_by_media[media_id] = _probe_stream_types(media_path)

        video_tracks = [t for t in project["tracks"] if t["type"] == "video"]
        audio_tracks = [t for t in project["tracks"] if t["type"] == "audio"]
        text_overlays: List[Dict[str, Any]] = []

        for track in video_tracks:
            for clip in track["clips"]:
                overlay = clip.get("textOverlay")
                if not isinstance(overlay, dict):
                    continue
                start_time = float(clip.get("startTime", 0.0))
                duration = max(0.0, float(overlay.get("duration", 0.0)))
                end_time = start_time + duration
                if end_time <= start_time:
                    continue
                text_overlays.append({
                    "start": start_time,
                    "end": end_time,
                    "overlay": overlay,
                })
        text_overlays.sort(key=lambda item: item["start"])

        all_video: List[Dict[str, Any]] = []
        for ti, track in enumerate(video_tracks):
            for clip in track["clips"]:
                media = media_map.get(clip["mediaId"])
                if media:
                    stream_types = stream_types_by_media.get(media["id"], set())
                    has_video_stream = "video" in stream_types or (not stream_types and media.get("type") == "video")
                    if not has_video_stream:
                        print(f"[SKIP] clip {clip.get('id', '?')} has no video stream in media {media['id']}")
                        continue
                    all_video.append({"clip": clip, "media": media, "trackIndex": ti})
        all_video.sort(key=lambda x: float(x["clip"]["startTime"]))

        all_audio: List[Dict[str, Any]] = []
        for ti, track in enumerate(audio_tracks):
            for clip in track["clips"]:
                media = media_map.get(clip["mediaId"])
                if media:
                    stream_types = stream_types_by_media.get(media["id"], set())
                    has_audio_stream = "audio" in stream_types or (not stream_types and media.get("type") == "audio")
                    if not has_audio_stream:
                        print(f"[SKIP] clip {clip.get('id', '?')} has no audio stream in media {media['id']}")
                        continue
                    all_audio.append({"clip": clip, "media": media, "trackIndex": ti})
        all_audio.sort(key=lambda x: float(x["clip"]["startTime"]))

        if not all_video and not all_audio and not text_overlays:
            raise HTTPException(status_code=400, detail="No clips to render")

        width = int(settings["width"])
        height = int(settings["height"])
        framerate = int(settings["framerate"])
        duration = float(project["duration"])
        output_duration = max(duration, 1.0 / framerate)

        # --------------- Inputs (dedup by file path) ---------------
        args: List[str] = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
        input_index: Dict[str, int] = {}
        path_to_idx: Dict[str, int] = {}
        idx = 0
        for item in [*all_video, *all_audio]:
            media_id = item["media"]["id"]
            media_path = media_paths.get(media_id)
            if not media_path:
                raise HTTPException(status_code=400, detail=f"Missing uploaded media for id {media_id}")
            if media_path not in path_to_idx:
                args.extend(["-i", media_path])
                path_to_idx[media_path] = idx
                idx += 1
            input_index[media_id] = path_to_idx[media_path]

        # --------------- Build filter graph using concat ---------------
        # Instead of overlay (which consumes the overlay stream while disabled,
        # causing desync), we build the timeline by concatenating segments
        # (gaps filled with black/silence, clips trimmed from source) in order.

        filter_parts: List[str] = []
        seg_idx = 0
        frame_dur = 1.0 / framerate

        # --- VIDEO TIMELINE ---
        video_segments: List[str] = []
        if all_video:
            current_t = 0.0
            for item in all_video:
                clip = item["clip"]
                media = item["media"]
                clip_start = float(clip["startTime"])
                clip_dur = _clip_duration(clip, media)
                src_dur = _clip_source_duration(clip, media)
                trim_start = float(clip["trimStart"])
                speed = max(0.01, float(clip.get("speed", 1.0)))
                reverse = bool(clip.get("reverse", False))
                src_idx = input_index[media["id"]]

                gap = clip_start - current_t
                if gap > frame_dur:
                    lbl = f"s{seg_idx}"
                    filter_parts.append(
                        f"color=c=black:s={width}x{height}:r={framerate}:d={_fmt(gap)},"
                        f"format=yuv420p[{lbl}]"
                    )
                    video_segments.append(f"[{lbl}]")
                    seg_idx += 1

                lbl = f"s{seg_idx}"
                video_effects = ["reverse"] if reverse else []
                video_effects.append(f"setpts=(PTS-STARTPTS)/{_fmt(speed)}")
                filter_parts.append(
                    f"[{src_idx}:v]trim=start={_fmt(trim_start)}:duration={_fmt(src_dur)},"
                    f"{','.join(video_effects)},fps={framerate},"
                    f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                    f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
                    f"format=yuv420p,setsar=1[{lbl}]"
                )
                video_segments.append(f"[{lbl}]")
                seg_idx += 1
                current_t = clip_start + clip_dur

                print(f"[V-SEG] clip {clip['id'][:8]} src={src_idx} "
                      f"trim={_fmt(trim_start)}+{_fmt(clip_dur)} @timeline={_fmt(clip_start)}")

            trail = output_duration - current_t
            if trail > frame_dur:
                lbl = f"s{seg_idx}"
                filter_parts.append(
                    f"color=c=black:s={width}x{height}:r={framerate}:d={_fmt(trail)},"
                    f"format=yuv420p[{lbl}]"
                )
                video_segments.append(f"[{lbl}]")
                seg_idx += 1

            filter_parts.append(
                f"{''.join(video_segments)}concat=n={len(video_segments)}:v=1:a=0[vout]"
            )
        elif text_overlays:
            filter_parts.append(
                f"color=c=black:s={width}x{height}:r={framerate}:d={_fmt(output_duration)},"
                f"format=yuv420p[vout]"
            )
            video_segments.append("[vout]")

        # --- TEXT OVERLAYS ---
        has_text_filters = False
        if text_overlays:
            source_label = "vout"
            for i, item in enumerate(text_overlays):
                overlay = item["overlay"]
                content = _escape_drawtext_text(str(overlay.get("content", "")))
                if content == "":
                    continue

                color = _escape_drawtext_value(str(overlay.get("color", "#ffffff")))
                font_family = _escape_drawtext_value(str(overlay.get("fontFamily", "Arial")))
                x_norm = _clamp(float(overlay.get("x", 0.5)), 0.0, 1.0)
                y_norm = _clamp(float(overlay.get("y", 0.85)), 0.0, 1.0)
                font_size = max(8, int(float(overlay.get("fontSize", 48))))
                align = str(overlay.get("align", "center")).lower()

                if align == "left":
                    draw_x = f"w*{x_norm:.4f}"
                elif align == "right":
                    draw_x = f"w*{x_norm:.4f}-text_w"
                else:
                    draw_x = f"w*{x_norm:.4f}-text_w/2"
                draw_y = f"h*{y_norm:.4f}-text_h/2"

                start_t = _fmt(float(item["start"]))
                end_t = _fmt(float(item["end"]))
                bg_color = overlay.get("backgroundColor")
                box_opts = ""
                if isinstance(bg_color, str) and bg_color.strip():
                    box_opts = f":box=1:boxcolor={_escape_drawtext_value(bg_color.strip())}:boxborderw=8"

                out_label = "vout_text" if i == len(text_overlays) - 1 else f"vtxt{i}"
                filter_parts.append(
                    f"[{source_label}]drawtext=text='{content}':fontcolor={color}:fontsize={font_size}:"
                    f"x={draw_x}:y={draw_y}:font='{font_family}':"
                    f"enable='between(t,{start_t},{end_t})'{box_opts}[{out_label}]"
                )
                source_label = out_label
                has_text_filters = True

        # --- AUDIO TIMELINE ---
        audio_segments: List[str] = []
        if all_audio:
            current_t = 0.0
            for item in all_audio:
                clip = item["clip"]
                media = item["media"]
                clip_start = float(clip["startTime"])
                clip_dur = _clip_duration(clip, media)
                src_dur = _clip_source_duration(clip, media)
                trim_start = float(clip["trimStart"])
                speed = max(0.01, float(clip.get("speed", 1.0)))
                reverse = bool(clip.get("reverse", False))
                src_idx = input_index[media["id"]]

                gap = clip_start - current_t
                if gap > 0.001:
                    lbl = f"s{seg_idx}"
                    filter_parts.append(
                        f"anullsrc=r=48000:cl=stereo:d={_fmt(gap)},"
                        f"aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[{lbl}]"
                    )
                    audio_segments.append(f"[{lbl}]")
                    seg_idx += 1

                lbl = f"s{seg_idx}"
                audio_effects = ["areverse"] if reverse else []
                audio_effects.extend(_atempo_chain(speed))
                filter_parts.append(
                    f"[{src_idx}:a]atrim=start={_fmt(trim_start)}:duration={_fmt(src_dur)},"
                    f"asetpts=PTS-STARTPTS,{','.join(audio_effects)},"
                    f"aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[{lbl}]"
                )
                audio_segments.append(f"[{lbl}]")
                seg_idx += 1
                current_t = clip_start + clip_dur

                print(f"[A-SEG] clip {clip['id'][:8]} src={src_idx} "
                      f"trim={_fmt(trim_start)}+{_fmt(clip_dur)} @timeline={_fmt(clip_start)}")

            trail = output_duration - current_t
            if trail > 0.001:
                lbl = f"s{seg_idx}"
                filter_parts.append(
                    f"anullsrc=r=48000:cl=stereo:d={_fmt(trail)},"
                    f"aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[{lbl}]"
                )
                audio_segments.append(f"[{lbl}]")
                seg_idx += 1

            filter_parts.append(
                f"{''.join(audio_segments)}concat=n={len(audio_segments)}:v=0:a=1[aout]"
            )

        # --------------- Assemble command ---------------
        if filter_parts:
            args.extend(["-filter_complex", ";".join(filter_parts)])
        if video_segments:
            args.extend(["-map", "[vout_text]" if has_text_filters else "[vout]"])
        if audio_segments:
            args.extend(["-map", "[aout]"])

        output_format = settings["format"]
        bitrate = int(settings["bitrate"])
        out_name = f"output.{output_format}"
        out_path = str(Path(temp_dir) / out_name)

        if video_segments:
            if output_format == "mp4":
                args.extend(["-c:v", "libx264", "-preset", "ultrafast",
                             "-tune", "fastdecode", "-movflags", "+faststart"])
            else:
                args.extend(["-c:v", "libvpx-vp9", "-speed", "4", "-row-mt", "1"])
            args.extend(["-b:v", f"{bitrate}k", "-r", str(framerate)])

        if audio_segments:
            if output_format == "mp4":
                args.extend(["-c:a", "aac", "-b:a", "128k"])
            else:
                args.extend(["-c:a", "libopus", "-b:a", "128k"])

        args.extend(["-t", str(output_duration), out_path])

        print(f"[CMD] {' '.join(args[:6])} ... ({len(args)} args total)")
        proc = subprocess.run(args, capture_output=True, text=True)
        if proc.returncode != 0 or not os.path.exists(out_path):
            stderr = (proc.stderr or "Unknown ffmpeg error").strip()
            err_lines = "\n".join(stderr.splitlines()[-25:]) if stderr else "Unknown ffmpeg error"
            raise HTTPException(status_code=500, detail=f"FFmpeg failed:\n{err_lines}")

        background_tasks.add_task(shutil.rmtree, temp_dir, True)
        mime = "video/mp4" if output_format == "mp4" else "video/webm"
        return FileResponse(out_path, media_type=mime, filename=f"rendered.{output_format}")
    except HTTPException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
