import { Clip, Track, MediaFile } from '../types';

export function getClipDuration(clip: Clip, mediaFile: MediaFile): number {
  const totalDuration = mediaFile.duration;
  const trimStart = clip.trimStart || 0;
  const trimEnd = clip.trimEnd || 0;
  return totalDuration - trimStart - trimEnd;
}

export function getClipEndTime(clip: Clip, mediaFile: MediaFile): number {
  return clip.startTime + getClipDuration(clip, mediaFile);
}

export function findClipAtTime(track: Track, time: number, mediaFiles: MediaFile[]): Clip | null {
  return track.clips.find(clip => {
    const mediaFile = mediaFiles.find(m => m.id === clip.mediaId);
    if (!mediaFile) return false;
    const endTime = getClipEndTime(clip, mediaFile);
    return time >= clip.startTime && time < endTime;
  }) || null;
}

export function getTrackDuration(track: Track, mediaFiles: MediaFile[]): number {
  if (track.clips.length === 0) return 0;
  return Math.max(...track.clips.map(clip => {
    const mediaFile = mediaFiles.find(m => m.id === clip.mediaId);
    if (!mediaFile) return 0;
    return getClipEndTime(clip, mediaFile);
  }));
}

export function getProjectDuration(tracks: Track[], mediaFiles: MediaFile[]): number {
  if (tracks.length === 0) return 0;
  return Math.max(...tracks.map(track => getTrackDuration(track, mediaFiles)));
}

