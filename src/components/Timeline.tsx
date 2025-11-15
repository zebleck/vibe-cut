import { useState, useRef, MouseEvent, useEffect } from 'react';
import { Project, Clip, MediaFile } from '../types';
import { timeToPixels, pixelsToTime, formatTime } from '../utils/mediaUtils';
import { getClipDuration, getClipEndTime } from '../utils/timelineUtils';
import { findSnapPoints, snapTime } from '../utils/snappingUtils';
import { TimelineTrack } from './TimelineTrack';

interface TimelineProps {
  project: Project;
  playhead: number;
  zoom: number;
  scrollX: number;
  selectedClipIds: string[];
  snapEnabled: boolean;
  snapThreshold: number;
  onPlayheadChange: (time: number) => void;
  onClipUpdate: (clipId: string, updates: Partial<Clip>) => void;
  onClipDelete: (clipId: string) => void;
  onClipDuplicate: (clipId: string) => void;
  onClipSplit: (clipId: string, time: number) => void;
  onClipSelect: (clipId: string, multi: boolean) => void;
  onZoomChange: (zoom: number) => void;
  onScrollChange: (scrollX: number) => void;
  onAddTrack: (type: 'video' | 'audio') => void;
  draggedMedia?: MediaFile | null;
  onAddClipToTrack?: (trackId: string, mediaId: string, startTime: number) => void;
}

export function Timeline({
  project,
  playhead,
  zoom,
  scrollX,
  selectedClipIds,
  snapEnabled,
  snapThreshold,
  onPlayheadChange,
  onClipUpdate,
  onClipDelete,
  onClipDuplicate,
  onClipSplit,
  onClipSelect,
  onZoomChange,
  onScrollChange,
  onAddTrack,
  draggedMedia,
  onAddClipToTrack,
}: TimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [draggingClip, setDraggingClip] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [resizingClip, setResizingClip] = useState<{ clipId: string; side: 'left' | 'right' } | null>(null);
  const [snapIndicator, setSnapIndicator] = useState<number | null>(null);

  const handleTimelineClick = (e: MouseEvent<HTMLDivElement>) => {
    if (timelineRef.current && !draggingClip && !resizingClip && e.target === timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollX;
      let time = pixelsToTime(x, zoom);
      
      if (snapEnabled) {
        const snapPoints = findSnapPoints(project.tracks, playhead);
        const snapped = snapTime(time, snapPoints, snapThreshold, zoom);
        time = snapped.time;
        if (snapped.snapped) {
          setSnapIndicator(time);
          setTimeout(() => setSnapIndicator(null), 200);
        }
      }
      
      onPlayheadChange(Math.max(0, time));
    }
  };

  const handleClipDragStart = (clipId: string, e: MouseEvent) => {
    e.stopPropagation();
    setDraggingClip(clipId);
    const rect = timelineRef.current?.getBoundingClientRect();
    if (rect) {
      const clip = project.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
      if (clip) {
        const clipX = timeToPixels(clip.startTime, zoom) - scrollX;
        setDragOffset(e.clientX - rect.left - clipX);
      }
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (draggingClip && timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - dragOffset + scrollX;
      let newStartTime = Math.max(0, pixelsToTime(x, zoom));
      
      if (snapEnabled) {
        const snapPoints = findSnapPoints(project.tracks, playhead, draggingClip);
        const snapped = snapTime(newStartTime, snapPoints, snapThreshold, zoom);
        newStartTime = snapped.time;
        if (snapped.snapped) {
          setSnapIndicator(newStartTime);
        } else {
          setSnapIndicator(null);
        }
      }
      
      onClipUpdate(draggingClip, { startTime: newStartTime });
    } else if (resizingClip && timelineRef.current) {
      const clip = project.tracks.flatMap(t => t.clips).find(c => c.id === resizingClip.clipId);
      if (clip) {
        const mediaFile = project.mediaFiles.find(m => m.id === clip.mediaId);
        if (mediaFile) {
          const rect = timelineRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left + scrollX;
          let time = pixelsToTime(x, zoom);
          
          if (snapEnabled) {
            const snapPoints = findSnapPoints(project.tracks, playhead, resizingClip.clipId);
            const snapped = snapTime(time, snapPoints, snapThreshold, zoom);
            time = snapped.time;
            if (snapped.snapped) {
              setSnapIndicator(time);
            } else {
              setSnapIndicator(null);
            }
          }
          
          if (resizingClip.side === 'left') {
            const trimStart = Math.max(0, time - clip.startTime);
            const maxTrim = mediaFile.duration - clip.trimEnd;
            const finalTrimStart = Math.min(trimStart, maxTrim);
            onClipUpdate(resizingClip.clipId, { trimStart: finalTrimStart });
          } else {
            const clipEnd = getClipEndTime(clip, mediaFile);
            const trimEnd = Math.max(0, clipEnd - time);
            const maxTrim = mediaFile.duration - clip.trimStart;
            const finalTrimEnd = Math.min(trimEnd, maxTrim);
            onClipUpdate(resizingClip.clipId, { trimEnd: finalTrimEnd });
          }
        }
      }
    }
  };

  const handleMouseUp = () => {
    setDraggingClip(null);
    setResizingClip(null);
    setSnapIndicator(null);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipIds.length > 0 && !draggingClip && !resizingClip) {
          selectedClipIds.forEach(id => onClipDelete(id));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipIds, draggingClip, resizingClip, onClipDelete]);

  const duration = project.duration || 10;
  const timelineWidth = timeToPixels(duration, zoom);
  const rulerHeight = 40;
  const trackHeight = 100;

  // Generate time markers with frame precision
  const framerate = project.framerate || 30;
  const markers = [];
  const markerInterval = zoom < 50 ? 10 : zoom < 100 ? 5 : zoom < 200 ? 1 : 0.5;
  for (let i = 0; i <= duration; i += markerInterval) {
    markers.push(i);
  }

  const videoTracks = project.tracks.filter(t => t.type === 'video');
  const audioTracks = project.tracks.filter(t => t.type === 'audio');

  return (
    <div
      className="timeline-container"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="timeline-ruler" style={{ height: rulerHeight }}>
        <div
          className="ruler-content"
          style={{
            width: timelineWidth,
            transform: `translateX(-${scrollX}px)`,
          }}
        >
          {markers.map(time => (
            <div
              key={time}
              className="ruler-marker"
              style={{
                left: timeToPixels(time, zoom),
              }}
            >
              <span className="marker-label">{formatTime(time)}</span>
            </div>
          ))}
        </div>
        <div
          className="playhead-line"
          style={{
            left: timeToPixels(playhead, zoom) - scrollX,
          }}
        />
        {snapIndicator !== null && (
          <div
            className="snap-indicator"
            style={{
              left: timeToPixels(snapIndicator, zoom) - scrollX,
            }}
          />
        )}
      </div>
      <div
        className="timeline-tracks"
        ref={timelineRef}
        onClick={handleTimelineClick}
        onDrop={(e) => {
          if (draggedMedia) {
            e.preventDefault();
            const rect = timelineRef.current?.getBoundingClientRect();
            if (rect) {
              const x = e.clientX - rect.left + scrollX;
              let time = pixelsToTime(x, zoom);
              if (snapEnabled) {
                const snapPoints = findSnapPoints(project.tracks, playhead);
                const snapped = snapTime(time, snapPoints, snapThreshold, zoom);
                time = snapped.time;
              }
              const track = project.tracks.find(t => t.type === draggedMedia.type);
              if (track && onAddClipToTrack) {
                onAddClipToTrack(track.id, draggedMedia.id, time);
              }
            }
          }
        }}
        onDragOver={(e) => {
          if (draggedMedia) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onWheel={(e) => {
          e.preventDefault();
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            // Zoom with wheel
            const delta = e.deltaY > 0 ? -5 : 5;
            const newZoom = Math.max(1, Math.min(500, zoom + delta));
            onZoomChange(newZoom);
          } else {
            // Scroll horizontally
            const delta = e.deltaY;
            onScrollChange(Math.max(0, scrollX + delta));
          }
        }}
      >
        <div className="tracks-section">
          <div className="tracks-header">
            <h4>Video Tracks</h4>
            <button onClick={() => onAddTrack('video')}>+ Add Video Track</button>
          </div>
          {videoTracks.map(track => (
            <TimelineTrack
              key={track.id}
              track={track}
              mediaFiles={project.mediaFiles}
              zoom={zoom}
              scrollX={scrollX}
              trackHeight={trackHeight}
              selectedClipIds={selectedClipIds}
              playhead={playhead}
              onClipSelect={onClipSelect}
              onClipDragStart={handleClipDragStart}
              onClipResizeStart={(clipId, side) => setResizingClip({ clipId, side })}
              onClipDelete={onClipDelete}
              onClipDuplicate={onClipDuplicate}
              onClipSplit={onClipSplit}
            />
          ))}
        </div>
        <div className="tracks-section">
          <div className="tracks-header">
            <h4>Audio Tracks</h4>
            <button onClick={() => onAddTrack('audio')}>+ Add Audio Track</button>
          </div>
          {audioTracks.map(track => (
            <TimelineTrack
              key={track.id}
              track={track}
              mediaFiles={project.mediaFiles}
              zoom={zoom}
              scrollX={scrollX}
              trackHeight={trackHeight}
              selectedClipIds={selectedClipIds}
              playhead={playhead}
              onClipSelect={onClipSelect}
              onClipDragStart={handleClipDragStart}
              onClipResizeStart={(clipId, side) => setResizingClip({ clipId, side })}
              onClipDelete={onClipDelete}
              onClipDuplicate={onClipDuplicate}
              onClipSplit={onClipSplit}
            />
          ))}
        </div>
      </div>
      <div className="timeline-controls">
        <div className="control-group">
          <button onClick={() => onZoomChange(Math.max(1, zoom - 10))}>-</button>
          <span>Zoom: {zoom.toFixed(0)}px/s</span>
          <button onClick={() => onZoomChange(Math.min(500, zoom + 10))}>+</button>
        </div>
        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={snapEnabled}
              readOnly
            />
            Snap
          </label>
        </div>
      </div>
    </div>
  );
}
