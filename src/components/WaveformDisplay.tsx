import { useRef, useEffect } from 'react';
import { Track, MediaFile } from '../types';
import { getClipDuration, getClipEndTime } from '../utils/timelineUtils';
import { timeToPixels } from '../utils/mediaUtils';

interface WaveformDisplayProps {
  track: Track;
  mediaFiles: MediaFile[];
  zoom: number;
  height: number;
}

export function WaveformDisplay({ track, mediaFiles, zoom, height }: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const h = canvas.height;
    
    ctx.clearRect(0, 0, width, h);
    ctx.fillStyle = '#4a9eff';
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 1;

    track.clips.forEach(clip => {
      const mediaFile = mediaFiles.find(m => m.id === clip.mediaId);
      if (!mediaFile || !mediaFile.waveform) return;

      const clipStart = timeToPixels(clip.startTime, zoom);
      const clipDuration = getClipDuration(clip, mediaFile);
      const clipWidth = timeToPixels(clipDuration, zoom);
      const waveform = mediaFile.waveform;
      const waveformWidth = Math.min(clipWidth, waveform.length);
      const step = clipWidth / waveformWidth;

      ctx.beginPath();
      for (let i = 0; i < waveformWidth; i++) {
        const x = clipStart + i * step;
        const amplitude = waveform[i] * h * 0.8;
        const centerY = h / 2;
        
        ctx.moveTo(x, centerY - amplitude / 2);
        ctx.lineTo(x, centerY + amplitude / 2);
      }
      ctx.stroke();
    });
  }, [track, mediaFiles, zoom, height]);

  const duration = Math.max(...track.clips.map(clip => {
    const mediaFile = mediaFiles.find(m => m.id === clip.mediaId);
    if (!mediaFile) return 0;
    return getClipEndTime(clip, mediaFile);
  }), 10);
  const width = timeToPixels(duration, zoom);

  return (
    <canvas
      ref={canvasRef}
      className="waveform-canvas"
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', opacity: 0.5 }}
    />
  );
}

