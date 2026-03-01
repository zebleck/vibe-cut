import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Project, RenderSettings, RenderProgress } from '../types';
import { getClipDuration, getClipSourceDuration } from './timelineUtils';
import { isWebCodecsSupported, renderWithWebCodecs } from './webcodecs-renderer';
import { getPythonRendererHealth, renderWithPythonService } from './pythonRenderer';

let ffmpegInstance: FFmpeg | null = null;
let initPromise: Promise<FFmpeg> | null = null;

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/%/g, '\\%');
}

function clampCrop(value: number): number {
  return Math.max(0, Math.min(0.45, value));
}

function buildAtempoFilters(speed: number): string[] {
  // FFmpeg atempo supports 0.5-2.0 per stage, so chain as needed.
  const filters: string[] = [];
  let remaining = speed;

  while (remaining > 2) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }

  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters;
}

export async function initFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  // If initialization is in progress, wait for it
  if (initPromise) return initPromise;

  // Start initialization and store the promise so concurrent calls wait on it
  initPromise = (async () => {
    try {
      const ffmpeg = new FFmpeg();

      // Use the latest stable version from unpkg CDN
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

      // Set up logging
      ffmpeg.on('log', ({ message }) => {
        console.log('FFmpeg log:', message);
      });

      // Load FFmpeg with proper URLs
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          'text/javascript'
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          'application/wasm'
        ),
      });

      ffmpegInstance = ffmpeg;
      console.log('FFmpeg initialized successfully');
      return ffmpeg;
    } catch (error) {
      // Clear the promise so next call can retry
      initPromise = null;
      console.error('Failed to initialize FFmpeg:', error);

      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to initialize FFmpeg: ${errorMsg}\n\n` +
        `Possible solutions:\n` +
        `1. Check your internet connection (ffmpeg.wasm needs to download ~20MB)\n` +
        `2. Try refreshing the page\n` +
        `3. Check browser console for CORS or network errors\n` +
        `4. Make sure you're using a modern browser with WebAssembly support`
      );
    }
  })();

  return initPromise;
}

export async function renderProject(
  project: Project,
  settings: RenderSettings,
  onProgress?: (progress: RenderProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  // Engine selection:
  // - python: local Python service + native FFmpeg
  // - auto: python -> webcodecs (when safe) -> ffmpeg.wasm
  // - gpu: force WebCodecs when available
  // - compatibility: force ffmpeg.wasm
  const hasAudioClips = project.tracks.some(
    t => t.type === 'audio' && t.clips.length > 0,
  );
  const hasTextOverlays = project.tracks.some(
    t => t.type === 'video' && t.clips.some(c => Boolean(c.textOverlay))
  );
  const hasClipTransforms = project.tracks.some(
    t => t.type === 'video' && t.clips.some(c => {
      const transform = c.transform;
      const crop = c.crop;
      const hasTransform = Boolean(
        transform &&
        (Math.abs(transform.x) > 0.0001 ||
          Math.abs(transform.y) > 0.0001 ||
          Math.abs(transform.scaleX - 1) > 0.0001 ||
          Math.abs(transform.scaleY - 1) > 0.0001 ||
          Math.abs(transform.rotation) > 0.0001)
      );
      const hasCrop = Boolean(
        crop &&
        (crop.left > 0.0001 || crop.right > 0.0001 || crop.top > 0.0001 || crop.bottom > 0.0001)
      );
      return hasTransform || hasCrop;
    })
  );
  const requestedEngine = settings.renderEngine ?? 'auto';
  const webCodecsSupported = isWebCodecsSupported();
  const canUseWebCodecs = webCodecsSupported && !(settings.format === 'mp4' && hasAudioClips);

  const shouldTryPython =
    (requestedEngine === 'python' || requestedEngine === 'auto') &&
    !hasClipTransforms;
  if (requestedEngine === 'python' && hasClipTransforms) {
    throw new Error('Python renderer does not yet support transform/crop clips. Use Auto/GPU/Compatibility render engines.');
  }
  if (shouldTryPython) {
    const health = await getPythonRendererHealth(signal);
    if (health) {
      try {
        console.log(`Using Python renderer (engine=${requestedEngine})`);
        return await renderWithPythonService(project, settings, onProgress, signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        if (requestedEngine === 'python') throw error;
        console.warn('Python render failed, falling back:', error);
      }
    } else if (requestedEngine === 'python') {
      throw new Error(
        'Python renderer is not running. Start it with:\n' +
        'python python-renderer/server.py'
      );
    }
  }

  let useWebCodecs = false;
  if (requestedEngine === 'gpu') {
    useWebCodecs = canUseWebCodecs;
  } else if (requestedEngine === 'auto') {
    useWebCodecs = canUseWebCodecs;
  }

  if (useWebCodecs) {
    try {
      console.log(`Using WebCodecs renderer (engine=${requestedEngine})`);
      return await renderWithWebCodecs(project, settings, onProgress, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      console.warn('WebCodecs render failed, falling back to FFmpeg:', error);
    }
  }

  try {
    onProgress?.({
      stage: 'preparing',
      progress: 0,
      message: 'Initializing FFmpeg...',
    });

    const ffmpeg = await initFFmpeg();
    
    onProgress?.({
      stage: 'preparing',
      progress: 10,
      message: 'Loading media files...',
    });

    // Write input files in parallel
    const fileLoadPromises = project.mediaFiles.map(async (mediaFile) => {
      const fileData = await fetchFile(mediaFile.url);
      const safeName = mediaFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      return { safeName, fileData, name: mediaFile.name };
    });

    let loaded = 0;
    const fileResults = await Promise.all(
      fileLoadPromises.map(p => p.then(result => {
        loaded++;
        onProgress?.({
          stage: 'preparing',
          progress: 10 + (loaded / project.mediaFiles.length) * 10,
          message: `Loading ${result.name}...`,
        });
        return result;
      }).catch(error => {
        console.error(`Failed to load media file:`, error);
        throw error;
      }))
    );

    // Write fetched files to FFmpeg filesystem
    for (const { safeName, fileData, name } of fileResults) {
      try {
        await ffmpeg.writeFile(safeName, fileData);
      } catch (error) {
        console.error(`Failed to write ${name}:`, error);
        throw new Error(`Failed to load media file: ${name}`);
      }
    }

    onProgress?.({
      stage: 'rendering',
      progress: 20,
      message: 'Building timeline...',
    });

    // Build media file lookup map for O(1) access
    const mediaMap = new Map(project.mediaFiles.map(m => [m.id, m]));

    // Collect all clips from all tracks
    const videoTracks = project.tracks.filter(t => t.type === 'video');
    const audioTracks = project.tracks.filter(t => t.type === 'audio');

    // Gather all video clips with their media files, sorted by start time
    const allVideoClips: Array<{
      clip: typeof videoTracks[0]['clips'][0];
      mediaFile: typeof project.mediaFiles[0];
      trackIndex: number;
    }> = [];
    const textOverlays = videoTracks
      .flatMap(track => track.clips)
      .filter(clip => Boolean(clip.textOverlay))
      .map(clip => ({
        startTime: clip.startTime,
        endTime: clip.startTime + (clip.textOverlay?.duration ?? 0),
        overlay: clip.textOverlay!,
      }))
      .filter(item => item.endTime > item.startTime)
      .sort((a, b) => a.startTime - b.startTime);

    videoTracks.forEach((track, trackIndex) => {
      track.clips.forEach(clip => {
        const mediaFile = mediaMap.get(clip.mediaId);
        if (mediaFile) {
          allVideoClips.push({ clip, mediaFile, trackIndex });
        }
      });
    });

    // Sort by start time, then by track index (lower track index = higher priority)
    allVideoClips.sort((a, b) => {
      if (a.clip.startTime !== b.clip.startTime) {
        return a.clip.startTime - b.clip.startTime;
      }
      return a.trackIndex - b.trackIndex;
    });

    // Gather all audio clips
    const allAudioClips: Array<{
      clip: typeof audioTracks[0]['clips'][0];
      mediaFile: typeof project.mediaFiles[0];
      trackIndex: number;
    }> = [];

    audioTracks.forEach((track, trackIndex) => {
      track.clips.forEach(clip => {
        const mediaFile = mediaMap.get(clip.mediaId);
        if (mediaFile) {
          allAudioClips.push({ clip, mediaFile, trackIndex });
        }
      });
    });

    allAudioClips.sort((a, b) => a.clip.startTime - b.clip.startTime);

    if (allVideoClips.length === 0 && allAudioClips.length === 0 && textOverlays.length === 0) {
      throw new Error('No clips to render');
    }

    onProgress?.({
      stage: 'encoding',
      progress: 30,
      message: 'Building filter graph...',
    });

    // Build FFmpeg command with complex filter for proper clip handling.
    // Uses concat-based timeline assembly: each clip is trimmed and concatenated
    // with black/silence gap segments. This avoids the overlay filter bug where
    // frames are consumed while the overlay is disabled, causing A/V desync.
    const outputFormat = settings.format === 'mp4' ? 'mp4' : 'webm';
    const videoCodec = settings.format === 'mp4' ? 'libx264' : 'libvpx-vp9';
    const audioCodec = 'aac';
    const outputFileName = `output.${outputFormat}`;

    const args: string[] = [];
    const inputMap = new Map<string, number>();
    let inputIndex = 0;

    const urlToInputIndex = new Map<string, number>();
    [...allVideoClips, ...allAudioClips].forEach(({ mediaFile }) => {
      const existing = urlToInputIndex.get(mediaFile.url);
      if (existing !== undefined) {
        inputMap.set(mediaFile.id, existing);
        return;
      }

      const safeName = mediaFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      args.push('-i', safeName);
      inputMap.set(mediaFile.id, inputIndex);
      urlToInputIndex.set(mediaFile.url, inputIndex);
      inputIndex++;
    });

    const filterParts: string[] = [];
    const frameDur = 1 / settings.framerate;
    const outputDuration = Math.max(project.duration, frameDur);
    let segIdx = 0;

    // --- VIDEO TIMELINE (concat) ---
    const videoSegments: string[] = [];
    if (allVideoClips.length > 0) {
      let currentT = 0;
      for (const item of allVideoClips) {
        const clipDuration = getClipDuration(item.clip, item.mediaFile);
        const sourceDuration = getClipSourceDuration(item.clip, item.mediaFile);
        const speed = item.clip.speed && item.clip.speed > 0 ? item.clip.speed : 1;
        const clipStart = item.clip.startTime;
        const trimStart = item.clip.trimStart;
        const inputIdx = inputMap.get(item.mediaFile.id)!;
        const transform = item.clip.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
        const crop = item.clip.crop ?? { left: 0, right: 0, top: 0, bottom: 0 };
        const cropLeft = clampCrop(crop.left);
        const cropRight = clampCrop(crop.right);
        const cropTop = clampCrop(crop.top);
        const cropBottom = clampCrop(crop.bottom);
        const cropWExpr = `iw*(1-${cropLeft.toFixed(6)}-${cropRight.toFixed(6)})`;
        const cropHExpr = `ih*(1-${cropTop.toFixed(6)}-${cropBottom.toFixed(6)})`;
        const cropXExpr = `iw*${cropLeft.toFixed(6)}`;
        const cropYExpr = `ih*${cropTop.toFixed(6)}`;
        const scaleX = Math.max(0.1, transform.scaleX || 1);
        const scaleY = Math.max(0.1, transform.scaleY || 1);
        const transX = Number.isFinite(transform.x) ? transform.x : 0;
        const transY = Number.isFinite(transform.y) ? transform.y : 0;
        const rotation = Number.isFinite(transform.rotation) ? transform.rotation : 0;

        const gap = clipStart - currentT;
        if (gap > frameDur) {
          const lbl = `s${segIdx++}`;
          filterParts.push(
            `color=c=black:s=${settings.width}x${settings.height}:r=${settings.framerate}:d=${gap.toFixed(6)},` +
            `format=yuv420p[${lbl}]`
          );
          videoSegments.push(`[${lbl}]`);
        }

        const baseLbl = `s${segIdx++}`;
        const fgLbl = `s${segIdx++}`;
        const lbl = `s${segIdx++}`;
        const videoEffects: string[] = [];
        if (item.clip.reverse) {
          videoEffects.push('reverse');
        }
        videoEffects.push(`setpts=(PTS-STARTPTS)/${speed.toFixed(6)}`);
        filterParts.push(
          `[${inputIdx}:v]trim=start=${trimStart.toFixed(6)}:duration=${sourceDuration.toFixed(6)},` +
          `${videoEffects.join(',')},fps=${settings.framerate},` +
          `crop=${cropWExpr}:${cropHExpr}:${cropXExpr}:${cropYExpr},` +
          `scale=iw*${scaleX.toFixed(6)}:ih*${scaleY.toFixed(6)},` +
          `rotate=${(rotation * Math.PI / 180).toFixed(8)}:ow=rotw(iw):oh=roth(ih):c=none,` +
          `format=rgba[${fgLbl}]`
        );
        filterParts.push(
          `color=c=black:s=${settings.width}x${settings.height}:r=${settings.framerate}:d=${clipDuration.toFixed(6)},` +
          `format=rgba[${baseLbl}]`
        );
        filterParts.push(
          `[${baseLbl}][${fgLbl}]overlay=x=(W-w)/2+${transX.toFixed(4)}:y=(H-h)/2+${transY.toFixed(4)}:format=auto,` +
          `format=yuv420p,setsar=1[${lbl}]`
        );
        videoSegments.push(`[${lbl}]`);
        currentT = clipStart + clipDuration;
      }

      const trail = outputDuration - currentT;
      if (trail > frameDur) {
        const lbl = `s${segIdx++}`;
        filterParts.push(
          `color=c=black:s=${settings.width}x${settings.height}:r=${settings.framerate}:d=${trail.toFixed(6)},` +
          `format=yuv420p[${lbl}]`
        );
        videoSegments.push(`[${lbl}]`);
      }

      filterParts.push(
        `${videoSegments.join('')}concat=n=${videoSegments.length}:v=1:a=0[vout]`
      );
    } else if (textOverlays.length > 0) {
      filterParts.push(
        `color=c=black:s=${settings.width}x${settings.height}:r=${settings.framerate}:d=${outputDuration.toFixed(6)},` +
        `format=yuv420p[vout]`
      );
      videoSegments.push('[vout]');
    }

    // --- TEXT OVERLAYS ---
    if (textOverlays.length > 0) {
      let sourceLabel = 'vout';
      textOverlays.forEach((item, index) => {
        const text = escapeDrawtext(item.overlay.content);
        const color = escapeDrawtext(item.overlay.color || '#ffffff');
        const bg = item.overlay.backgroundColor ? `:box=1:boxcolor=${escapeDrawtext(item.overlay.backgroundColor)}:boxborderw=8` : '';
        const drawX = item.overlay.align === 'left'
          ? `w*${Math.max(0, Math.min(1, item.overlay.x)).toFixed(4)}`
          : item.overlay.align === 'right'
            ? `w*${Math.max(0, Math.min(1, item.overlay.x)).toFixed(4)}-text_w`
            : `w*${Math.max(0, Math.min(1, item.overlay.x)).toFixed(4)}-text_w/2`;
        const drawY = `h*${Math.max(0, Math.min(1, item.overlay.y)).toFixed(4)}-text_h/2`;
        const outLabel = index === textOverlays.length - 1 ? 'vout_text' : `vtxt${index}`;
        filterParts.push(
          `[${sourceLabel}]drawtext=text='${text}':fontcolor=${color}:fontsize=${Math.max(8, Math.round(item.overlay.fontSize))}:` +
          `x=${drawX}:y=${drawY}:font='${escapeDrawtext(item.overlay.fontFamily)}':` +
          `enable='between(t,${item.startTime.toFixed(6)},${item.endTime.toFixed(6)})'${bg}[${outLabel}]`
        );
        sourceLabel = outLabel;
      });
    }

    // --- AUDIO TIMELINE (concat) ---
    const audioSegments: string[] = [];
    if (allAudioClips.length > 0) {
      let currentT = 0;
      for (const item of allAudioClips) {
        const clipDuration = getClipDuration(item.clip, item.mediaFile);
        const sourceDuration = getClipSourceDuration(item.clip, item.mediaFile);
        const speed = item.clip.speed && item.clip.speed > 0 ? item.clip.speed : 1;
        const clipStart = item.clip.startTime;
        const trimStart = item.clip.trimStart;
        const inputIdx = inputMap.get(item.mediaFile.id)!;

        const gap = clipStart - currentT;
        if (gap > 0.001) {
          const lbl = `s${segIdx++}`;
          filterParts.push(
            `anullsrc=r=48000:cl=stereo:d=${gap.toFixed(6)},` +
            `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[${lbl}]`
          );
          audioSegments.push(`[${lbl}]`);
        }

        const lbl = `s${segIdx++}`;
        const audioEffects: string[] = [];
        if (item.clip.reverse) {
          audioEffects.push('areverse');
        }
        audioEffects.push(...buildAtempoFilters(speed));
        filterParts.push(
          `[${inputIdx}:a]atrim=start=${trimStart.toFixed(6)}:duration=${sourceDuration.toFixed(6)},` +
          `asetpts=PTS-STARTPTS,${audioEffects.join(',')},` +
          `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[${lbl}]`
        );
        audioSegments.push(`[${lbl}]`);
        currentT = clipStart + clipDuration;
      }

      const trail = outputDuration - currentT;
      if (trail > 0.001) {
        const lbl = `s${segIdx++}`;
        filterParts.push(
          `anullsrc=r=48000:cl=stereo:d=${trail.toFixed(6)},` +
          `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[${lbl}]`
        );
        audioSegments.push(`[${lbl}]`);
      }

      filterParts.push(
        `${audioSegments.join('')}concat=n=${audioSegments.length}:v=0:a=1[aout]`
      );
    }

    onProgress?.({
      stage: 'encoding',
      progress: 50,
      message: 'Encoding video...',
    });

    // Add filter complex
    if (filterParts.length > 0) {
      args.push('-filter_complex', filterParts.join(';'));
    }

    // Map outputs
    if (videoSegments.length > 0) {
      args.push('-map', textOverlays.length > 0 ? '[vout_text]' : '[vout]');
    }
    if (audioSegments.length > 0) {
      args.push('-map', '[aout]');
    }

    // Encoding options
    if (videoSegments.length > 0) {
      args.push(
        '-c:v', videoCodec,
        '-b:v', `${settings.bitrate}k`,
        '-r', settings.framerate.toString()
      );

      // Speed-optimized encoding settings
      if (videoCodec === 'libx264') {
        args.push(
          '-preset', 'ultrafast',
          '-tune', 'fastdecode',
          '-movflags', '+faststart'
        );
      } else if (videoCodec === 'libvpx-vp9') {
        args.push(
          '-speed', '4',
          '-row-mt', '1'
        );
      }
    }

    if (audioSegments.length > 0) {
      args.push(
        '-c:a', audioCodec,
        '-b:a', '128k'
      );
    }

    args.push('-t', outputDuration.toString()); // Limit to project duration
    args.push('-y'); // Overwrite output file
    args.push(outputFileName);

    let bestEncodedSeconds = 0;
    const parseTimestampSeconds = (stamp: string): number => {
      const [hh, mm, ss] = stamp.split(':');
      return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
    };

    // Some ffmpeg.wasm runs (especially with filter_complex) don't emit useful
    // progress events. Parse "time=HH:MM:SS.xx" from log lines as a fallback.
    ffmpeg.on('log', ({ message }) => {
      const m = message.match(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
      if (!m) return;
      const seconds = parseTimestampSeconds(m[1]);
      if (!Number.isFinite(seconds) || seconds <= bestEncodedSeconds) return;
      bestEncodedSeconds = seconds;

      const progressRatio = project.duration > 0
        ? Math.min(1, bestEncodedSeconds / project.duration)
        : 0;
      const progressPercent = Math.min(92, 50 + progressRatio * 42);
      onProgress?.({
        stage: 'encoding',
        progress: progressPercent,
        message: `Encoding video... ${Math.round(progressRatio * 100)}%`,
      });
    });

    ffmpeg.on('progress', ({ progress }) => {
      const progressPercent = Math.min(90, 50 + (progress * 0.4));
      onProgress?.({
        stage: 'encoding',
        progress: progressPercent,
        message: `Encoding video... ${Math.round(progress * 100)}%`,
      });
    });

    await ffmpeg.exec(args);

    onProgress?.({
      stage: 'finalizing',
      progress: 95,
      message: 'Finalizing...',
    });

    const data = await ffmpeg.readFile(outputFileName);
    const sourceBytes = data instanceof Uint8Array ? data : new Uint8Array();
    const bytes = new Uint8Array(sourceBytes.byteLength);
    bytes.set(sourceBytes);
    const blob = new Blob([bytes], { type: `video/${outputFormat}` });

    // Clean up files in background. In ffmpeg.wasm, aggressive parallel deletes
    // can occasionally trigger an "Aborted()" even after a successful encode.
    const cleanupTargets = [
      outputFileName,
      ...new Set(project.mediaFiles.map(mf => mf.name.replace(/[^a-zA-Z0-9._-]/g, '_'))),
    ];
    void (async () => {
      for (const file of cleanupTargets) {
        try {
          await ffmpeg.deleteFile(file);
        } catch (error) {
          console.warn(`Failed to clean up file "${file}":`, error);
        }
      }
    })();

    onProgress?.({
      stage: 'complete',
      progress: 100,
      message: 'Render complete!',
    });

    return blob;
  } catch (error) {
    console.error('Rendering error:', error);
    onProgress?.({
      stage: 'complete',
      progress: 0,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
    throw error;
  }
}
