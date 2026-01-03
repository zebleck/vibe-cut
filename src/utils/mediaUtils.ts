import { MediaFile, MediaType } from '../types';
import { generateThumbnail } from './thumbnailUtils';
import { loadAudioBuffer, generateWaveform } from './waveformUtils';

export async function createMediaFile(file: File): Promise<MediaFile> {
  const url = URL.createObjectURL(file);
  const type: MediaType = file.type.startsWith('video/') ? 'video' : 'audio';

  // Use the same URL for metadata extraction (no need for a separate temp URL)
  const metadata = await getMediaMetadata(url, type);
  
  const mediaFile: MediaFile = {
    id: crypto.randomUUID(),
    name: file.name,
    type,
    file,
    url,
    duration: metadata.duration,
    framerate: metadata.framerate,
    width: metadata.width,
    height: metadata.height,
  };

  // Generate thumbnail for video
  if (type === 'video') {
    try {
      mediaFile.thumbnail = await generateThumbnail(file, 0);
    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
    }
  }

  // Generate waveform for audio
  if (type === 'audio') {
    try {
      const audioBuffer = await loadAudioBuffer(file);
      mediaFile.waveform = await generateWaveform(audioBuffer, 200); // 200 sample points
    } catch (error) {
      console.warn('Failed to generate waveform:', error);
    }
  }
  
  return mediaFile;
}

interface MediaMetadata {
  duration: number;
  framerate?: number;
  width?: number;
  height?: number;
}

function getMediaMetadata(url: string, type: MediaType): Promise<MediaMetadata> {
  return new Promise((resolve, reject) => {
    if (type === 'video') {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        // Try to get framerate (not always available)
        const framerate = 30; // Default, could try to extract from video if available
        resolve({
          duration: video.duration,
          framerate,
          width: video.videoWidth,
          height: video.videoHeight,
        });
      };
      video.onerror = reject;
      video.src = url;
    } else {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        resolve({
          duration: audio.duration,
        });
      };
      audio.onerror = reject;
      audio.src = url;
    }
  });
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export function timeToPixels(time: number, zoom: number): number {
  return time * zoom;
}

export function pixelsToTime(pixels: number, zoom: number): number {
  return pixels / zoom;
}

