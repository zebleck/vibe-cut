import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Project, RenderSettings, RenderProgress } from '../types';
import { getClipDuration } from './timelineUtils';
import { isWebCodecsSupported, renderWithWebCodecs } from './webcodecs-renderer';

let ffmpegInstance: FFmpeg | null = null;
let initPromise: Promise<FFmpeg> | null = null;

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
  // Try GPU-accelerated WebCodecs first, fall back to FFmpeg.
  // MP4 with audio is kept on FFmpeg for robust A/V sync on trimmed clips.
  const hasAudioClips = project.tracks.some(
    t => t.type === 'audio' && t.clips.length > 0,
  );
  const useWebCodecs = isWebCodecsSupported() && !(settings.format === 'mp4' && hasAudioClips);
  if (useWebCodecs) {
    try {
      console.log('Using GPU-accelerated WebCodecs renderer');
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

    if (allVideoClips.length === 0 && allAudioClips.length === 0) {
      throw new Error('No clips to render');
    }

    onProgress?.({
      stage: 'encoding',
      progress: 30,
      message: 'Building filter graph...',
    });

    // Build FFmpeg command with complex filter for proper clip handling
    const outputFormat = settings.format === 'mp4' ? 'mp4' : 'webm';
    const videoCodec = settings.format === 'mp4' ? 'libx264' : 'libvpx-vp9';
    const audioCodec = 'aac';
    const outputFileName = `output.${outputFormat}`;

    const args: string[] = [];
    const inputMap = new Map<string, number>(); // mediaFile.id -> input index
    let inputIndex = 0;

    // Add unique media files as inputs
    const usedMediaIds = new Set<string>();
    [...allVideoClips, ...allAudioClips].forEach(({ mediaFile }) => {
      if (!usedMediaIds.has(mediaFile.id)) {
        usedMediaIds.add(mediaFile.id);
        const safeName = mediaFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        args.push('-i', safeName);
        inputMap.set(mediaFile.id, inputIndex);
        inputIndex++;
      }
    });

    // Build complex filter graph
    const filterParts: string[] = [];
    const videoOutputs: string[] = [];
    const audioOutputs: string[] = [];

    // Process video clips
    allVideoClips.forEach((item, idx) => {
      const inputIdx = inputMap.get(item.mediaFile.id)!;
      const clipDuration = getClipDuration(item.clip, item.mediaFile);
      const trimStart = item.clip.trimStart;
      const trimEnd = trimStart + clipDuration;

      // Trim and scale video
      filterParts.push(
        `[${inputIdx}:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS,` +
        `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,` +
        `pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2,` +
        `tpad=start_duration=${item.clip.startTime}:start_mode=clone[v${idx}]`
      );
      videoOutputs.push(`[v${idx}]`);
    });

    // Process audio clips
    allAudioClips.forEach((item, idx) => {
      const inputIdx = inputMap.get(item.mediaFile.id)!;
      const clipDuration = getClipDuration(item.clip, item.mediaFile);
      const trimStart = item.clip.trimStart;
      const trimEnd = trimStart + clipDuration;

      // Trim audio and add delay for timeline position
      filterParts.push(
        `[${inputIdx}:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS,` +
        `adelay=${Math.round(item.clip.startTime * 1000)}|${Math.round(item.clip.startTime * 1000)}[a${idx}]`
      );
      audioOutputs.push(`[a${idx}]`);
    });

    // Concatenate or overlay videos
    if (videoOutputs.length > 0) {
      if (videoOutputs.length === 1) {
        filterParts.push(`${videoOutputs[0]}null[vout]`);
      } else {
        // Overlay videos (later clips overlay earlier ones)
        let currentOutput = videoOutputs[0];
        for (let i = 1; i < videoOutputs.length; i++) {
          const nextOutput = i === videoOutputs.length - 1 ? '[vout]' : `[vtmp${i}]`;
          filterParts.push(`${currentOutput}${videoOutputs[i]}overlay=eof_action=pass${nextOutput}`);
          currentOutput = nextOutput;
        }
      }
    }

    // Mix audio tracks
    if (audioOutputs.length > 0) {
      if (audioOutputs.length === 1) {
        filterParts.push(`${audioOutputs[0]}anull[aout]`);
      } else {
        filterParts.push(`${audioOutputs.join('')}amix=inputs=${audioOutputs.length}:duration=longest[aout]`);
      }
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
    if (videoOutputs.length > 0) {
      args.push('-map', '[vout]');
    }
    if (audioOutputs.length > 0) {
      args.push('-map', '[aout]');
    }

    // Encoding options
    if (videoOutputs.length > 0) {
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

    if (audioOutputs.length > 0) {
      args.push(
        '-c:a', audioCodec,
        '-b:a', '128k'
      );
    }

    args.push('-t', project.duration.toString()); // Limit to project duration
    args.push('-y'); // Overwrite output file
    args.push(outputFileName);

    ffmpeg.on('log', ({ message }) => {
      console.log('FFmpeg:', message);
    });

    ffmpeg.on('progress', ({ progress, time }) => {
      const progressPercent = Math.min(90, 50 + (progress * 0.4));
      onProgress?.({
        stage: 'encoding',
        progress: progressPercent,
        message: `Encoding... ${Math.round(progress * 100)}%`,
      });
    });

    await ffmpeg.exec(args);

    onProgress?.({
      stage: 'finalizing',
      progress: 95,
      message: 'Finalizing...',
    });

    const data = await ffmpeg.readFile(outputFileName);
    const blob = new Blob([data], { type: `video/${outputFormat}` });

    // Clean up all files in parallel
    try {
      await Promise.all([
        ffmpeg.deleteFile(outputFileName),
        ...project.mediaFiles.map(mf =>
          ffmpeg.deleteFile(mf.name.replace(/[^a-zA-Z0-9._-]/g, '_'))
        )
      ]);
    } catch (error) {
      console.warn('Failed to clean up files:', error);
    }

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
