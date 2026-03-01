import { Track, MediaFile } from '../types';
import { TimelineClip } from './TimelineClip';
import { WaveformDisplay } from './WaveformDisplay';
import { getClipDuration } from '../utils/timelineUtils';
import { timeToPixels } from '../utils/mediaUtils';

interface TimelineTrackProps {
  track: Track;
  trackIndex: number;
  mediaFiles: MediaFile[];
  zoom: number;
  scrollX: number;
  trackHeight: number;
  selectedClipIds: string[];
  playhead: number;
  dropIndicator: { time: number; duration: number } | null;
  isDragging: boolean;
  isDragOver: boolean;
  isClipDropTarget: boolean;
  onTrackDragStart: () => void;
  onTrackDragEnd: () => void;
  onTrackDragOver: () => void;
  onClipSelect: (clipId: string, multi: boolean) => void;
  onClipDragStart: (clipId: string, e: React.MouseEvent) => void;
  onClipResizeStart: (clipId: string, side: 'left' | 'right') => void;
  onClipDelete: (clipId: string) => void;
  onClipDuplicate: (clipId: string) => void;
  onClipSplit: (clipId: string, time: number) => void;
}

export function TimelineTrack({
  track,
  trackIndex,
  mediaFiles,
  zoom,
  scrollX,
  trackHeight,
  selectedClipIds,
  playhead,
  dropIndicator,
  isDragging,
  isDragOver,
  isClipDropTarget,
  onTrackDragStart,
  onTrackDragEnd,
  onTrackDragOver,
  onClipSelect,
  onClipDragStart,
  onClipResizeStart,
  onClipDelete,
  onClipDuplicate,
  onClipSplit,
}: TimelineTrackProps) {
  const duration = Math.max(...track.clips.map(clip => {
    const mediaFile = mediaFiles.find(m => m.id === clip.mediaId);
    return clip.startTime + getClipDuration(clip, mediaFile);
  }), 10);
  const timelineWidth = timeToPixels(duration, zoom);

  const trackClasses = [
    'timeline-track',
    isDragging ? 'dragging' : '',
    isDragOver ? 'drag-over' : '',
    isClipDropTarget ? 'clip-drop-target' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={trackClasses} style={{ height: trackHeight }}>
      <div
        className="track-label"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(trackIndex));
          onTrackDragStart();
        }}
        onDragEnd={onTrackDragEnd}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          onTrackDragOver();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onTrackDragEnd();
        }}
      >
        <span className="drag-handle">⋮⋮</span>
        <span>{track.type === 'video' ? '🎬' : '🎵'}</span>
        <span>{track.type === 'video' ? 'Video' : 'Audio'}</span>
        {track.locked && <span className="lock-icon">🔒</span>}
        {track.muted && <span className="mute-icon">🔇</span>}
      </div>
      <div className="track-content-wrapper">
        <div
          className="track-content"
          style={{
            width: timelineWidth,
            transform: `translateX(-${scrollX}px)`,
          }}
        >
          {track.type === 'audio' && track.clips.length > 0 && (
            <WaveformDisplay
              track={track}
              mediaFiles={mediaFiles}
              zoom={zoom}
              height={trackHeight - 4}
            />
          )}
          {track.clips.map(clip => {
            const mediaFile = mediaFiles.find(m => m.id === clip.mediaId);
            if (!mediaFile && !clip.textOverlay) return null;

            const clipDuration = getClipDuration(clip, mediaFile);
            const clipWidth = timeToPixels(clipDuration, zoom);
            const clipLeft = timeToPixels(clip.startTime, zoom);
            const isSelected = selectedClipIds.includes(clip.id);

            return (
              <TimelineClip
                key={clip.id}
                clip={clip}
                mediaFile={mediaFile}
                left={clipLeft}
                width={clipWidth}
                height={trackHeight - 4}
                isSelected={isSelected}
                onSelect={(e) => onClipSelect(clip.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                onDragStart={(e) => onClipDragStart(clip.id, e)}
                onResizeStart={(side) => onClipResizeStart(clip.id, side)}
                onDelete={() => onClipDelete(clip.id)}
                onDuplicate={() => onClipDuplicate(clip.id)}
                onSplit={() => onClipSplit(clip.id, playhead)}
              />
            );
          })}
          {dropIndicator && (
            <div
              className="drop-indicator"
              style={{
                left: timeToPixels(dropIndicator.time, zoom),
                width: timeToPixels(dropIndicator.duration, zoom),
                height: trackHeight - 4,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

