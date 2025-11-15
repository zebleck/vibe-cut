import { MediaFile, Clip } from '../types';

export function quantizeToFrame(time: number, framerate: number): number {
  const frameNumber = Math.round(time * framerate);
  return frameNumber / framerate;
}

export function getClipFramerate(clip: Clip, mediaFile: MediaFile, projectFramerate: number = 30): number {
  return mediaFile.framerate || projectFramerate;
}

export function quantizeClipTime(clip: Clip, mediaFile: MediaFile, projectFramerate: number = 30): Clip {
  const framerate = getClipFramerate(clip, mediaFile, projectFramerate);
  return {
    ...clip,
    startTime: quantizeToFrame(clip.startTime, framerate),
    trimStart: quantizeToFrame(clip.trimStart, framerate),
    trimEnd: quantizeToFrame(clip.trimEnd, framerate),
  };
}

export function timeToFrame(time: number, framerate: number): number {
  return Math.round(time * framerate);
}

export function frameToTime(frame: number, framerate: number): number {
  return frame / framerate;
}

