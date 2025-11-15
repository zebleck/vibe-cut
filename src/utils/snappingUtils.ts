import { Track, Clip, MediaFile } from '../types';
import { getClipEndTime } from './timelineUtils';
import { pixelsToTime, timeToPixels } from './mediaUtils';

export interface SnapPoint {
  time: number;
  type: 'clip-start' | 'clip-end' | 'playhead';
}

export function findSnapPoints(
  tracks: Track[],
  playhead: number,
  excludeClipId?: string
): SnapPoint[] {
  const points: SnapPoint[] = [{ time: playhead, type: 'playhead' }];

  tracks.forEach(track => {
    track.clips.forEach(clip => {
      if (clip.id === excludeClipId) return;
      points.push({ time: clip.startTime, type: 'clip-start' });
    });
  });

  return points;
}

export function snapTime(
  time: number,
  snapPoints: SnapPoint[],
  threshold: number,
  zoom: number
): { snapped: boolean; time: number } {
  const thresholdTime = pixelsToTime(threshold, zoom);
  
  for (const point of snapPoints) {
    const distance = Math.abs(time - point.time);
    if (distance < thresholdTime) {
      return { snapped: true, time: point.time };
    }
  }
  
  return { snapped: false, time };
}

