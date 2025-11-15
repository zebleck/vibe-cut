import { formatTime } from '../utils/mediaUtils';
import { Clip, Track, MediaFile } from '../types';
import { getClipEndTime } from '../utils/timelineUtils';

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  tracks: Track[];
  mediaFiles: MediaFile[];
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onHome: () => void;
  onEnd: () => void;
  onJumpToCut: (direction: 'prev' | 'next') => void;
}

export function PlaybackControls({
  isPlaying,
  currentTime,
  duration,
  tracks,
  mediaFiles,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onHome,
  onEnd,
  onJumpToCut,
}: PlaybackControlsProps) {
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    onSeek(time);
  };

  return (
    <div className="playback-controls">
      <div className="control-buttons">
        <button onClick={onHome} title="Go to start">⏮️</button>
        <button onClick={isPlaying ? onPause : onPlay} title={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? '⏸️' : '▶️'}
        </button>
        <button onClick={onStop} title="Stop">⏹️</button>
        <button onClick={onEnd} title="Go to end">⏭️</button>
        <button onClick={() => onJumpToCut('prev')} title="Previous cut">⏪</button>
        <button onClick={() => onJumpToCut('next')} title="Next cut">⏩</button>
      </div>
      <div className="time-display">
        <span>{formatTime(currentTime)}</span>
        <span>/</span>
        <span>{formatTime(duration)}</span>
      </div>
      <input
        type="range"
        min="0"
        max={duration || 0}
        step="0.01"
        value={currentTime}
        onChange={handleSeek}
        className="scrubber"
      />
    </div>
  );
}
