import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Project, RenderSettings, RenderProgress } from '../types';
import { getClipDuration, getClipEndTime } from './timelineUtils';

let ffmpegInstance: FFmpeg | null = null;
let isInitializing = false;

export async function initFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (isInitializing) {
    // Wait for initialization to complete
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (ffmpegInstance) return ffmpegInstance;
  }

  isInitializing = true;
  
  try {
    const ffmpeg = new FFmpeg();
    
    // Use the latest stable version from unpkg CDN
    // Try using the publicPath approach which works better with Vite
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    
    // Set up logging
    ffmpeg.on('log', ({ message }) => {
      console.log('FFmpeg log:', message);
    });

    // Load FFmpeg with proper URLs
    // Using the ESM version which works better with modern bundlers
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
    isInitializing = false;
    console.log('FFmpeg initialized successfully');
    return ffmpeg;
  } catch (error) {
    isInitializing = false;
    console.error('Failed to initialize FFmpeg:', error);
    
    // Provide helpful error message
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
}

export async function renderProject(
  project: Project,
  settings: RenderSettings,
  onProgress?: (progress: RenderProgress) => void
): Promise<Blob> {
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

    // Write input files
    for (let i = 0; i < project.mediaFiles.length; i++) {
      const mediaFile = project.mediaFiles[i];
      try {
        const fileData = await fetchFile(mediaFile.url);
        // Use a safe filename (remove special characters)
        const safeName = mediaFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        await ffmpeg.writeFile(safeName, fileData);
        onProgress?.({
          stage: 'preparing',
          progress: 10 + (i + 1) / project.mediaFiles.length * 10,
          message: `Loading ${mediaFile.name}...`,
        });
      } catch (error) {
        console.error(`Failed to load ${mediaFile.name}:`, error);
        throw new Error(`Failed to load media file: ${mediaFile.name}`);
      }
    }

    onProgress?.({
      stage: 'rendering',
      progress: 20,
      message: 'Building timeline...',
    });

    // Find the first video file for video track
    const videoTracks = project.tracks.filter(t => t.type === 'video');
    const audioTracks = project.tracks.filter(t => t.type === 'audio');
    
    if (project.mediaFiles.length === 0) {
      throw new Error('No media files to render');
    }

    // Find video input file
    let videoInputFile: typeof project.mediaFiles[0] | null = null;
    let videoInputIndex = -1;
    
    if (videoTracks.length > 0 && videoTracks[0].clips.length > 0) {
      const firstVideoClip = videoTracks[0].clips[0];
      videoInputFile = project.mediaFiles.find(m => m.id === firstVideoClip.mediaId);
      if (videoInputFile) {
        videoInputIndex = project.mediaFiles.indexOf(videoInputFile);
      }
    }
    
    // If no video, use first file
    if (!videoInputFile) {
      videoInputFile = project.mediaFiles[0];
      videoInputIndex = 0;
    }

    // Find audio input file
    let audioInputFile: typeof project.mediaFiles[0] | null = null;
    let audioInputIndex = -1;
    
    if (audioTracks.length > 0 && audioTracks[0].clips.length > 0) {
      const firstAudioClip = audioTracks[0].clips[0];
      audioInputFile = project.mediaFiles.find(m => m.id === firstAudioClip.mediaId);
      if (audioInputFile) {
        audioInputIndex = project.mediaFiles.indexOf(audioInputFile);
      }
    } else if (videoInputFile && videoInputFile.type === 'video') {
      // Use audio from video file if no separate audio track
      audioInputFile = videoInputFile;
      audioInputIndex = videoInputIndex;
    }

    onProgress?.({
      stage: 'encoding',
      progress: 50,
      message: 'Encoding video...',
    });

    // Build FFmpeg command
    const outputFormat = settings.format === 'mp4' ? 'mp4' : 'webm';
    const videoCodec = settings.format === 'mp4' ? 'libx264' : 'libvpx-vp9';
    const audioCodec = 'aac';
    
    const videoInputName = videoInputFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const outputFileName = `output.${outputFormat}`;

    // Build FFmpeg arguments
    const args: string[] = [];
    
    // Add video input
    args.push('-i', videoInputName);
    
    // Add audio input if different from video
    let hasSeparateAudio = false;
    if (audioInputFile && audioInputIndex !== videoInputIndex) {
      const audioInputName = audioInputFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      args.push('-i', audioInputName);
      hasSeparateAudio = true;
    }
    
    // Video encoding options
    args.push(
      '-c:v', videoCodec,
      '-b:v', `${settings.bitrate}k`,
      '-r', settings.framerate.toString(),
      '-s', `${settings.width}x${settings.height}`,
      '-map', '0:v' // Map video from first input
    );
    
    // Audio encoding options
    if (audioInputFile) {
      if (audioInputIndex === videoInputIndex) {
        // Audio is from the same file as video
        args.push(
          '-c:a', audioCodec,
          '-b:a', '128k',
          '-map', '0:a?' // Map audio from first input (optional if no audio stream)
        );
      } else {
        // Audio is from a separate file
        args.push(
          '-c:a', audioCodec,
          '-b:a', '128k',
          '-map', '1:a?' // Map audio from second input (optional)
        );
      }
    }
    
    args.push('-shortest'); // Finish encoding when shortest stream ends
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

    // Clean up
    try {
      await ffmpeg.deleteFile(outputFileName);
      for (const mediaFile of project.mediaFiles) {
        const safeName = mediaFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        await ffmpeg.deleteFile(safeName);
      }
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
