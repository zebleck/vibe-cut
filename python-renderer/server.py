import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse


app = FastAPI(title="Vibe Python Renderer")
RENDERER_VERSION = "2026-02-19-concat-v1"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_name(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in name)


def _clip_duration(clip: Dict[str, Any], media: Dict[str, Any]) -> float:
    return max(0.0, float(media["duration"]) - float(clip["trimStart"]) - float(clip["trimEnd"]))


def _fmt(v: float) -> str:
    return f"{v:.6f}"


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

        video_tracks = [t for t in project["tracks"] if t["type"] == "video"]
        audio_tracks = [t for t in project["tracks"] if t["type"] == "audio"]

        all_video: List[Dict[str, Any]] = []
        for ti, track in enumerate(video_tracks):
            for clip in track["clips"]:
                media = media_map.get(clip["mediaId"])
                if media:
                    all_video.append({"clip": clip, "media": media, "trackIndex": ti})
        all_video.sort(key=lambda x: float(x["clip"]["startTime"]))

        all_audio: List[Dict[str, Any]] = []
        for ti, track in enumerate(audio_tracks):
            for clip in track["clips"]:
                media = media_map.get(clip["mediaId"])
                if media:
                    all_audio.append({"clip": clip, "media": media, "trackIndex": ti})
        all_audio.sort(key=lambda x: float(x["clip"]["startTime"]))

        if not all_video and not all_audio:
            raise HTTPException(status_code=400, detail="No clips to render")

        width = int(settings["width"])
        height = int(settings["height"])
        framerate = int(settings["framerate"])
        duration = float(project["duration"])

        # --------------- Inputs (dedup by file path) ---------------
        args: List[str] = ["ffmpeg", "-y"]
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
                trim_start = float(clip["trimStart"])
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
                filter_parts.append(
                    f"[{src_idx}:v]trim=start={_fmt(trim_start)}:duration={_fmt(clip_dur)},"
                    f"setpts=PTS-STARTPTS,fps={framerate},"
                    f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                    f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
                    f"format=yuv420p,setsar=1[{lbl}]"
                )
                video_segments.append(f"[{lbl}]")
                seg_idx += 1
                current_t = clip_start + clip_dur

                print(f"[V-SEG] clip {clip['id'][:8]} src={src_idx} "
                      f"trim={_fmt(trim_start)}+{_fmt(clip_dur)} @timeline={_fmt(clip_start)}")

            trail = duration - current_t
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

        # --- AUDIO TIMELINE ---
        audio_segments: List[str] = []
        if all_audio:
            current_t = 0.0
            for item in all_audio:
                clip = item["clip"]
                media = item["media"]
                clip_start = float(clip["startTime"])
                clip_dur = _clip_duration(clip, media)
                trim_start = float(clip["trimStart"])
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
                filter_parts.append(
                    f"[{src_idx}:a]atrim=start={_fmt(trim_start)}:duration={_fmt(clip_dur)},"
                    f"asetpts=PTS-STARTPTS,"
                    f"aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[{lbl}]"
                )
                audio_segments.append(f"[{lbl}]")
                seg_idx += 1
                current_t = clip_start + clip_dur

                print(f"[A-SEG] clip {clip['id'][:8]} src={src_idx} "
                      f"trim={_fmt(trim_start)}+{_fmt(clip_dur)} @timeline={_fmt(clip_start)}")

            trail = duration - current_t
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
            args.extend(["-map", "[vout]"])
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

        args.extend(["-t", str(duration), out_path])

        print(f"[CMD] {' '.join(args[:6])} ... ({len(args)} args total)")
        proc = subprocess.run(args, capture_output=True, text=True)
        if proc.returncode != 0 or not os.path.exists(out_path):
            err_tail = (proc.stderr or "Unknown ffmpeg error")[-4000:]
            raise HTTPException(status_code=500, detail=f"FFmpeg failed:\n{err_tail}")

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
