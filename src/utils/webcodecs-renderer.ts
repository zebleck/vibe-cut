import { createFile as createMP4File, DataStream } from 'mp4box';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { Project, RenderSettings, RenderProgress, Clip, MediaFile } from '../types';
import { getClipDuration } from './timelineUtils';

export function isWebCodecsSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined'
  );
}

// ---------------------------------------------------------------------------
// MP4 Demuxer — extracts encoded video samples using MP4Box.js
// ---------------------------------------------------------------------------

interface DemuxedFile {
  samples: Array<{
    data: Uint8Array;
    timestamp: number; // microseconds
    duration: number;
    isKey: boolean;
  }>;
  codec: string;
  codedWidth: number;
  codedHeight: number;
  description?: Uint8Array;
}

async function demuxMP4(url: string): Promise<DemuxedFile> {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();

  return new Promise((resolve, reject) => {
    const mp4 = createMP4File();
    const samples: DemuxedFile['samples'] = [];

    mp4.onError = (e: string) => reject(new Error(String(e)));

    mp4.onReady = (info: any) => {
      const vt = info.videoTracks?.[0];
      if (!vt) { reject(new Error('No video track found')); return; }

      mp4.onSamples = (_id: number, _user: any, rawSamples: any[]) => {
        for (const s of rawSamples) {
          samples.push({
            data: new Uint8Array(s.data),
            timestamp: Math.round((s.cts / s.timescale) * 1_000_000),
            duration: Math.round((s.duration / s.timescale) * 1_000_000),
            isKey: s.is_sync,
          });
        }
      };

      mp4.setExtractionOptions(vt.id);
      mp4.start();

      // Extract codec-specific description (avcC / hvcC / vpcC)
      const trak = mp4.getTrackById(vt.id);
      const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
      const box = entry?.avcC || entry?.hvcC || entry?.vpcC || entry?.av1C;
      let description: Uint8Array | undefined;
      if (box) {
        try {
          const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
          box.write(stream);
          // Slice to actual written length (skip 8-byte box header), copy to clean buffer
          const writePos = (stream as unknown as { position: number }).position;
          description = new Uint8Array(stream.buffer.slice(8, writePos));
        } catch (e) {
          console.warn('Failed to extract codec description, decoding may fail:', e);
        }
      }

      console.log(`Demuxed: codec=${vt.codec}, ${vt.video.width}x${vt.video.height}, ${samples.length} samples, description=${description?.byteLength ?? 0} bytes`);
      resolve({ samples, codec: vt.codec, codedWidth: vt.video.width, codedHeight: vt.video.height, description });
    };

    (buffer as any).fileStart = 0;
    mp4.appendBuffer(buffer);
    mp4.flush();
  });
}

// ---------------------------------------------------------------------------
// Fallback: video element seeking (for non-MP4 sources)
// ---------------------------------------------------------------------------

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.01) { resolve(); return; }
    video.onseeked = () => { video.onseeked = null; resolve(); };
    video.currentTime = time;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.src = url;
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error('Failed to load video'));
  });
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export async function renderWithWebCodecs(
  project: Project,
  settings: RenderSettings,
  onProgress?: (progress: RenderProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const mediaMap = new Map(project.mediaFiles.map(m => [m.id, m]));
  const videoTracks = project.tracks.filter(t => t.type === 'video');
  const audioTracks = project.tracks.filter(t => t.type === 'audio');

  const videoClips = videoTracks
    .flatMap((track, ti) =>
      track.clips
        .map(clip => ({ clip, mediaFile: mediaMap.get(clip.mediaId)!, trackIndex: ti }))
        .filter(item => item.mediaFile),
    )
    .sort((a, b) => (a.clip.startTime !== b.clip.startTime
      ? a.clip.startTime - b.clip.startTime : a.trackIndex - b.trackIndex));

  const audioClips = audioTracks
    .flatMap((track, ti) =>
      track.clips
        .map(clip => ({ clip, mediaFile: mediaMap.get(clip.mediaId)!, trackIndex: ti }))
        .filter(item => item.mediaFile),
    )
    .sort((a, b) => a.clip.startTime - b.clip.startTime);

  const hasVideo = videoClips.length > 0;
  const hasAudio = audioClips.length > 0;
  if (!hasVideo && !hasAudio) throw new Error('No clips to render');
  if (!hasVideo) throw new Error('WebCodecs requires video clips; use FFmpeg for audio-only.');

  const isMp4 = settings.format === 'mp4';
  const totalFrames = Math.ceil(project.duration * settings.framerate);
  const frameDurationSec = 1 / settings.framerate;
  const frameDurationUs = 1_000_000 / settings.framerate;

  // ── Phase 1: Demux source files ──────────────────────────────────────
  onProgress?.({ stage: 'preparing', progress: 0, message: 'Demuxing source files...' });

  const demuxedFiles = new Map<string, DemuxedFile>();
  const fallbackVideos = new Map<string, HTMLVideoElement>();
  const uniqueMediaIds = [...new Set(videoClips.map(c => c.mediaFile.id))];

  await Promise.all(uniqueMediaIds.map(async (id) => {
    const mf = mediaMap.get(id)!;
    try {
      demuxedFiles.set(id, await demuxMP4(mf.url));
    } catch {
      // Non-MP4 source — fall back to video element seeking
      console.warn(`Could not demux ${mf.name}, using video element fallback`);
      fallbackVideos.set(id, await loadVideo(mf.url));
    }
  }));

  const demuxCount = demuxedFiles.size;
  const fallbackCount = fallbackVideos.size;
  console.log(`Demuxed ${demuxCount} files via MP4Box, ${fallbackCount} via video element fallback`);

  // ── Phase 2: Muxer + encoder setup ───────────────────────────────────
  onProgress?.({ stage: 'preparing', progress: 10, message: 'Configuring GPU encoder...' });

  const videoCodecStr = isMp4 ? 'avc1.640028' : 'vp09.00.10.08';
  const encoderConfig: VideoEncoderConfig = {
    codec: videoCodecStr,
    width: settings.width,
    height: settings.height,
    bitrate: settings.bitrate * 1000,
    framerate: settings.framerate,
    hardwareAcceleration: 'prefer-hardware',
  };
  const support = await VideoEncoder.isConfigSupported(encoderConfig);
  if (!support.supported) {
    encoderConfig.hardwareAcceleration = 'prefer-software';
  }
  console.log(`VideoEncoder: ${encoderConfig.codec}, ${encoderConfig.width}x${encoderConfig.height}, hw=${encoderConfig.hardwareAcceleration}`);

  let muxTarget: Mp4Target | WebmTarget;
  let muxer: InstanceType<typeof Mp4Muxer> | InstanceType<typeof WebmMuxer>;
  if (isMp4) {
    muxTarget = new Mp4Target();
    const cfg: ConstructorParameters<typeof Mp4Muxer>[0] = {
      target: muxTarget as Mp4Target,
      video: { codec: 'avc', width: settings.width, height: settings.height },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    };
    if (hasAudio) cfg.audio = { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 };
    muxer = new Mp4Muxer(cfg);
  } else {
    muxTarget = new WebmTarget();
    const cfg: ConstructorParameters<typeof WebmMuxer>[0] = {
      target: muxTarget as WebmTarget,
      video: { codec: 'V_VP9', width: settings.width, height: settings.height },
      firstTimestampBehavior: 'offset',
    };
    if (hasAudio) cfg.audio = { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: 48000 };
    muxer = new WebmMuxer(cfg);
  }

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta ?? undefined),
    error: (e) => { throw e; },
  });
  videoEncoder.configure(encoderConfig);

  const canvas = document.createElement('canvas');
  canvas.width = settings.width;
  canvas.height = settings.height;
  const ctx = canvas.getContext('2d')!;

  // ── Phase 3: Streaming decode → compose → encode ────────────────────
  // One decoder per clip, frames flow through immediately — no buffering,
  // no idle codecs, no reclamation.

  // Set up a streaming decoder for each clip that has demuxed data
  interface ClipDecoder {
    decoder: VideoDecoder;
    samples: DemuxedFile['samples'];
    sampleIdx: number;
    queue: VideoFrame[];     // decoded frames waiting to be drawn
    error: Error | null;
    trimStartUs: number;
    trimEndUs: number;
  }

  const clipDecoders = new Map<string, ClipDecoder>();

  for (const { clip, mediaFile } of videoClips) {
    const demuxed = demuxedFiles.get(mediaFile.id);
    if (!demuxed) continue;

    const clipDur = getClipDuration(clip, mediaFile);
    const trimStartUs = clip.trimStart * 1_000_000;
    const trimEndUs = (clip.trimStart + clipDur) * 1_000_000;

    // Find keyframe before trim start
    let startIdx = 0;
    for (let i = 0; i < demuxed.samples.length; i++) {
      if (demuxed.samples[i].timestamp > trimStartUs) break;
      if (demuxed.samples[i].isKey) startIdx = i;
    }

    const cd: ClipDecoder = {
      decoder: null!,
      samples: demuxed.samples,
      sampleIdx: startIdx,
      queue: [],
      error: null,
      trimStartUs,
      trimEndUs,
    };

    cd.decoder = new VideoDecoder({
      output: (frame) => {
        // Discard pre-trim frames — only keep frames at or after the trim point.
        // One-frame tolerance (~35ms at 30fps) for frame boundary alignment.
        if (frame.timestamp < cd.trimStartUs - 35_000) {
          frame.close();
        } else {
          // Insert in timestamp-sorted order. B-frames may arrive out of
          // presentation order, and pickFrame relies on sorted indices to
          // correctly close only earlier-timestamp frames.
          let insertIdx = cd.queue.length;
          while (insertIdx > 0 && cd.queue[insertIdx - 1].timestamp > frame.timestamp) {
            insertIdx--;
          }
          cd.queue.splice(insertIdx, 0, frame);
        }
      },
      error: (e) => { cd.error = e instanceof Error ? e : new Error(String(e)); },
    });

    const config: VideoDecoderConfig = {
      codec: demuxed.codec,
      codedWidth: demuxed.codedWidth,
      codedHeight: demuxed.codedHeight,
      hardwareAcceleration: 'prefer-hardware',
    };
    if (demuxed.description) config.description = demuxed.description;
    cd.decoder.configure(config);

    clipDecoders.set(clip.id, cd);
    console.log(`Streaming decoder for clip ${clip.id}: codec=${demuxed.codec}, samples=${demuxed.samples.length}, startIdx=${startIdx}`);
  }

  // Helper: advance a clip decoder until it has a frame at/past targetUs
  async function advanceDecoder(cd: ClipDecoder, targetUs: number) {
    // Feed samples past the target. Use generous lookahead so the decoder
    // can resolve B-frame reference dependencies (B-frames need future
    // reference frames before they can be decoded and output).
    while (cd.sampleIdx < cd.samples.length) {
      const s = cd.samples[cd.sampleIdx];
      if (s.timestamp > targetUs + 500_000) break;     // 500ms lookahead for B-frames
      if (s.timestamp > cd.trimEndUs + 1_000_000) break;

      cd.decoder.decode(new EncodedVideoChunk({
        type: s.isKey ? 'key' : 'delta',
        timestamp: s.timestamp,
        duration: s.duration,
        data: s.data,
      }));
      cd.sampleIdx++;

      // Yield periodically to let output callbacks fire
      if (cd.decoder.decodeQueueSize > 10) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Wait for the queue to contain a frame near the target.
    // Don't wait on decodeQueueSize===0 — B-frames keep it >0 indefinitely.
    // If the queue never reaches the target (codec error, etc.), the bounded
    // loop prevents a hang and pickFrame uses the best frame available.
    for (let attempt = 0; attempt < 200; attempt++) {
      // Check if the latest decoded frame covers our target
      if (cd.queue.length > 0) {
        const latest = cd.queue[cd.queue.length - 1].timestamp;
        if (latest >= targetUs - 100_000) break;
      }

      // Feed one more sample if the decoder can accept it — this extends
      // the lookahead for codecs that need extra future references.
      if (cd.sampleIdx < cd.samples.length && cd.decoder.decodeQueueSize < 10) {
        const s = cd.samples[cd.sampleIdx];
        if (s.timestamp <= cd.trimEndUs + 2_000_000) {
          cd.decoder.decode(new EncodedVideoChunk({
            type: s.isKey ? 'key' : 'delta',
            timestamp: s.timestamp,
            duration: s.duration,
            data: s.data,
          }));
          cd.sampleIdx++;
        }
      }

      await new Promise(r => setTimeout(r, 1));
    }
  }

  // Helper: get best frame from queue for a target timestamp, close older ones
  function pickFrame(cd: ClipDecoder, targetUs: number): VideoFrame | null {
    let best: VideoFrame | null = null;
    let bestDiff = Infinity;
    let bestIdx = -1;

    for (let i = 0; i < cd.queue.length; i++) {
      const diff = Math.abs(cd.queue[i].timestamp - targetUs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = cd.queue[i];
        bestIdx = i;
      }
    }

    // Close all frames before the best one (they won't be needed again)
    if (bestIdx > 0) {
      for (let i = 0; i < bestIdx; i++) cd.queue[i].close();
      cd.queue.splice(0, bestIdx);
    }
    return best;
  }

  onProgress?.({ stage: 'encoding', progress: 15, message: 'Encoding (GPU accelerated)...' });

  try {
    // Main frame loop: decode and encode in lockstep
    for (let f = 0; f < totalFrames; f++) {
      if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');

      const time = f * frameDurationSec;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, settings.width, settings.height);

      for (const { clip, mediaFile } of videoClips) {
        const clipDur = getClipDuration(clip, mediaFile);
        if (time < clip.startTime || time >= clip.startTime + clipDur) continue;

        const clipTime = time - clip.startTime + clip.trimStart;
        const clipTimeUs = Math.round(clipTime * 1_000_000);

        // Fast path: streaming VideoDecoder
        const cd = clipDecoders.get(clip.id);
        if (cd) {
          if (cd.error) throw cd.error;
          await advanceDecoder(cd, clipTimeUs);
          const frame = pickFrame(cd, clipTimeUs);
          if (frame) {
            const vw = frame.displayWidth, vh = frame.displayHeight;
            const scale = Math.min(settings.width / vw, settings.height / vh);
            const dw = vw * scale, dh = vh * scale;
            ctx.drawImage(frame as any, (settings.width - dw) / 2, (settings.height - dh) / 2, dw, dh);
          }
          continue;
        }

        // Slow fallback: video element seeking
        const video = fallbackVideos.get(mediaFile.id);
        if (video) {
          await seekVideo(video, clipTime);
          const vw = video.videoWidth, vh = video.videoHeight;
          const scale = Math.min(settings.width / vw, settings.height / vh);
          const dw = vw * scale, dh = vh * scale;
          ctx.drawImage(video, (settings.width - dw) / 2, (settings.height - dh) / 2, dw, dh);
        }
      }

      const outFrame = new VideoFrame(canvas, { timestamp: Math.round(f * frameDurationUs) });
      videoEncoder.encode(outFrame, { keyFrame: f % (settings.framerate * 2) === 0 });
      outFrame.close();

      while (videoEncoder.encodeQueueSize > 8) {
        await new Promise(r => setTimeout(r, 0));
      }

      if (f % 30 === 0) {
        onProgress?.({
          stage: 'encoding',
          progress: 15 + (f / totalFrames) * 70,
          message: `Frame ${f}/${totalFrames} (GPU accelerated)...`,
        });
      }
    }

    await videoEncoder.flush();
    videoEncoder.close();
  } catch (err) {
    // Clean up encoder on error/cancel
    try { videoEncoder.reset(); } catch {}
    videoEncoder.close();
    throw err;
  } finally {
    // Always clean up decoders and fallback videos
    for (const cd of clipDecoders.values()) {
      try { cd.decoder.reset(); } catch {}
      cd.decoder.close();
      cd.queue.forEach(f => f.close());
    }
    fallbackVideos.forEach(v => { v.src = ''; });
  }

  // ── Phase 4: Audio ───────────────────────────────────────────────────
  if (hasAudio) {
    onProgress?.({ stage: 'encoding', progress: 87, message: 'Processing audio...' });
    await encodeAudio(audioClips, project, settings, isMp4, muxer);
  }

  // ── Finalize ─────────────────────────────────────────────────────────
  onProgress?.({ stage: 'finalizing', progress: 95, message: 'Finalizing...' });
  muxer.finalize();

  const mimeType = isMp4 ? 'video/mp4' : 'video/webm';
  onProgress?.({ stage: 'complete', progress: 100, message: 'Render complete! (GPU accelerated)' });
  return new Blob([(muxTarget as Mp4Target | WebmTarget).buffer], { type: mimeType });
}

// ---------------------------------------------------------------------------
// Audio encoding helper
// ---------------------------------------------------------------------------

async function encodeAudio(
  audioClips: Array<{ clip: Clip; mediaFile: MediaFile }>,
  project: Project,
  _settings: RenderSettings,
  isMp4: boolean,
  muxer: InstanceType<typeof Mp4Muxer> | InstanceType<typeof WebmMuxer>,
) {
  const sampleRate = 48000;
  const channels = 2;
  const offlineCtx = new OfflineAudioContext(channels, Math.ceil(sampleRate * project.duration), sampleRate);

  for (const { clip, mediaFile } of audioClips) {
    try {
      const buf = await (await fetch(mediaFile.url)).arrayBuffer();
      const audioBuf = await offlineCtx.decodeAudioData(buf);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(offlineCtx.destination);
      // decodeAudioData may include encoder priming/delay samples at the start
      // (e.g. AAC encoder delay ≈ 21–24 ms). mediaFile.duration is the true
      // playback duration reported by the browser (priming already excluded),
      // so any excess in audioBuf.duration is preamble that must be skipped.
      const preamble = Math.max(0, audioBuf.duration - mediaFile.duration);
      source.start(clip.startTime, clip.trimStart + preamble, getClipDuration(clip, mediaFile));
    } catch (e) {
      console.warn('Failed to decode audio clip, skipping:', e);
    }
  }

  const rendered = await offlineCtx.startRendering();
  const codecStr = isMp4 ? 'mp4a.40.2' : 'opus';
  const config: AudioEncoderConfig = { codec: codecStr, numberOfChannels: channels, sampleRate, bitrate: 128000 };
  const ok = await AudioEncoder.isConfigSupported(config);
  if (!ok.supported) { console.warn(`AudioEncoder: ${codecStr} not supported`); return; }

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta ?? undefined),
    error: (e) => console.error('Audio encode error:', e),
  });
  audioEncoder.configure(config);

  const chunkSize = 1024;
  for (let offset = 0; offset < rendered.length; offset += chunkSize) {
    const frames = Math.min(chunkSize, rendered.length - offset);
    const data = new Float32Array(frames * channels);
    for (let ch = 0; ch < channels; ch++) {
      data.set(rendered.getChannelData(ch).subarray(offset, offset + frames), ch * frames);
    }
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels: channels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data: data.buffer,
    });
    audioEncoder.encode(audioData);
    audioData.close();
  }

  await audioEncoder.flush();
  audioEncoder.close();
}
