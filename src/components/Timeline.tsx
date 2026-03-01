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
  onReorderTracks: (fromIndex: number, toIndex: number) => void;
  onMoveClipToTrack: (clipId: string, targetTrackId: string, newStartTime?: number) => void;
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
  onReorderTracks,
  onMoveClipToTrack,
  draggedMedia,
  onAddClipToTrack,
}: TimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const snapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScrollbarSyncing = useRef(false);
  const [draggingClip, setDraggingClip] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [resizingClip, setResizingClip] = useState<{
    clipId: string;
    side: 'left' | 'right';
    initialStartTime: number;
    initialTrimStart: number;
    initialTrimEnd: number;
    initialEndTime: number;
  } | null>(null);
  const [snapIndicator, setSnapIndicator] = useState<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    time: number;
    trackId: string;
    duration: number;
  } | null>(null);
  const [draggingTrackIndex, setDraggingTrackIndex] = useState<number | null>(null);
  const [dragOverTrackIndex, setDragOverTrackIndex] = useState<number | null>(null);
  const [clipTargetTrackId, setClipTargetTrackId] = useState<string | null>(null);

  // Track label width offset (matches CSS .track-label width)
  const TRACK_LABEL_WIDTH = 120;

  // Cleanup snap timeout on unmount
  useEffect(() => {
    return () => {
      if (snapTimeoutRef.current) {
        clearTimeout(snapTimeoutRef.current);
      }
    };
  }, []);

  // Sync scrollbar position when scrollX changes programmatically (wheel, etc.)
  useEffect(() => {
    if (scrollbarRef.current && !isScrollbarSyncing.current) {
      scrollbarRef.current.scrollLeft = scrollX;
    }
  }, [scrollX]);

  // Handle native scrollbar scroll events
  useEffect(() => {
    const scrollbar = scrollbarRef.current;
    if (!scrollbar) return;

    const handleScrollbarScroll = () => {
      isScrollbarSyncing.current = true;
      onScrollChange(scrollbar.scrollLeft);
      requestAnimationFrame(() => {
        isScrollbarSyncing.current = false;
      });
    };

    scrollbar.addEventListener('scroll', handleScrollbarScroll);
    return () => scrollbar.removeEventListener('scroll', handleScrollbarScroll);
  }, [onScrollChange]);

  // Handle wheel events with { passive: false } to prevent browser zoom
  useEffect(() => {
    const element = timelineRef.current;
    if (!element) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        // Zoom with wheel
        const delta = e.deltaY > 0 ? -5 : 5;
        const newZoom = Math.max(1, Math.min(500, zoom + delta));
        onZoomChange(newZoom);
      } else {
        // Scroll horizontally (support both vertical wheel and horizontal trackpad)
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        // Clamp scroll to valid range (0 to content width)
        const maxScroll = Math.max(0, timeToPixels(project.duration || 10, zoom) - 200);
        const newScrollX = Math.max(0, Math.min(maxScroll, scrollX + delta));
        onScrollChange(newScrollX);
      }
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [zoom, scrollX, onZoomChange, onScrollChange, project.duration]);

  const handleTimelineClick = (e: MouseEvent<HTMLDivElement>) => {
    // Only set playhead when clicking on empty space (track background), not on clips
    const target = e.target as HTMLElement;
    const isClickOnClip = target.closest('.timeline-clip') !== null;

    if (timelineRef.current && !draggingClip && !resizingClip && !isClickOnClip) {
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - TRACK_LABEL_WIDTH + scrollX;
      let time = pixelsToTime(x, zoom);

      if (snapEnabled) {
        const snapPoints = findSnapPoints(project.tracks, playhead);
        const snapped = snapTime(time, snapPoints, snapThreshold, zoom);
        time = snapped.time;
        if (snapped.snapped) {
          setSnapIndicator(time);
          if (snapTimeoutRef.current) clearTimeout(snapTimeoutRef.current);
          snapTimeoutRef.current = setTimeout(() => setSnapIndicator(null), 200);
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
        // Mouse position relative to track content area (accounting for track label)
        const mouseX = e.clientX - rect.left - TRACK_LABEL_WIDTH + scrollX;
        const clipX = timeToPixels(clip.startTime, zoom);
        setDragOffset(mouseX - clipX);
      }
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (draggingClip && timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      // Mouse position relative to track content area
      const mouseX = e.clientX - rect.left - TRACK_LABEL_WIDTH + scrollX;
      const mouseY = e.clientY - rect.top;
      const x = mouseX - dragOffset;
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

      // Calculate which track the clip is being dragged over
      const trackIndex = Math.floor(mouseY / trackHeight);
      const targetTrack = project.tracks[trackIndex];
      const currentClip = project.tracks.flatMap(t => t.clips).find(c => c.id === draggingClip);
      const currentTrack = project.tracks.find(t => t.clips.some(c => c.id === draggingClip));

      if (targetTrack && currentTrack && targetTrack.type === currentTrack.type) {
        setClipTargetTrackId(targetTrack.id);
      } else {
        setClipTargetTrackId(currentTrack?.id || null);
      }

      onClipUpdate(draggingClip, { startTime: newStartTime });
    } else if (resizingClip && timelineRef.current) {
      const mediaFile = project.mediaFiles.find(m => {
        const clip = project.tracks.flatMap(t => t.clips).find(c => c.id === resizingClip.clipId);
        return clip && m.id === clip.mediaId;
      });
      if (mediaFile) {
        const rect = timelineRef.current.getBoundingClientRect();
        // Mouse position relative to track content area
        const x = e.clientX - rect.left - TRACK_LABEL_WIDTH + scrollX;
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

        const { initialStartTime, initialTrimStart, initialTrimEnd, initialEndTime } = resizingClip;
        const clip = project.tracks.flatMap(t => t.clips).find(c => c.id === resizingClip.clipId);
        const speed = clip?.speed && clip.speed > 0 ? clip.speed : 1;

        if (resizingClip.side === 'left') {
          // Left resize: move left edge, keep right edge fixed
          // Clamp time to valid range
          const minTime = initialStartTime - (initialTrimStart / speed); // Can't go before media start
          const maxTime = initialEndTime - 0.01; // Can't go past right edge
          const clampedTime = Math.max(minTime, Math.min(maxTime, time));

          const newStartTime = clampedTime;
          const newTrimStart = initialTrimStart + ((clampedTime - initialStartTime) * speed);

          onClipUpdate(resizingClip.clipId, { startTime: newStartTime, trimStart: newTrimStart });
        } else {
          // Right resize: move right edge, keep left edge fixed
          // Clamp time to valid range
          const minTime = initialStartTime + 0.01; // Can't go before left edge
          const maxTime = initialStartTime + ((mediaFile.duration - initialTrimStart) / speed); // Can't extend past media end
          const clampedTime = Math.max(minTime, Math.min(maxTime, time));

          const newTrimEnd = mediaFile.duration - initialTrimStart - ((clampedTime - initialStartTime) * speed);

          onClipUpdate(resizingClip.clipId, { trimEnd: Math.max(0, newTrimEnd) });
        }
      }
    }
  };

  const handleMouseUp = () => {
    // If dragging a clip and there's a target track, move it
    if (draggingClip && clipTargetTrackId) {
      const currentTrack = project.tracks.find(t => t.clips.some(c => c.id === draggingClip));
      if (currentTrack && currentTrack.id !== clipTargetTrackId) {
        const clip = currentTrack.clips.find(c => c.id === draggingClip);
        if (clip) {
          onMoveClipToTrack(draggingClip, clipTargetTrackId, clip.startTime);
        }
      }
    }
    setDraggingClip(null);
    setResizingClip(null);
    setSnapIndicator(null);
    setClipTargetTrackId(null);
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

  return (
    <div
      className="timeline-container"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="timeline-ruler"
        style={{ height: rulerHeight }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left - TRACK_LABEL_WIDTH + scrollX;
          const time = Math.max(0, pixelsToTime(x, zoom));
          onPlayheadChange(time);
        }}
      >
        <div
          className="ruler-content"
          style={{
            width: timelineWidth + TRACK_LABEL_WIDTH,
            transform: `translateX(-${scrollX}px)`,
            marginLeft: TRACK_LABEL_WIDTH,
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
            left: TRACK_LABEL_WIDTH + timeToPixels(playhead, zoom) - scrollX,
          }}
        />
        {snapIndicator !== null && (
          <div
            className="snap-indicator"
            style={{
              left: TRACK_LABEL_WIDTH + timeToPixels(snapIndicator, zoom) - scrollX,
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
              const x = e.clientX - rect.left - TRACK_LABEL_WIDTH + scrollX;
              const y = e.clientY - rect.top;
              const trackIndex = Math.floor(y / trackHeight);
              const track = project.tracks[trackIndex];

              if (track && track.type === draggedMedia.type && onAddClipToTrack) {
                let time = pixelsToTime(x, zoom);
                if (snapEnabled) {
                  const snapPoints = findSnapPoints(project.tracks, playhead);
                  const snapped = snapTime(time, snapPoints, snapThreshold, zoom);
                  time = snapped.time;
                }
                onAddClipToTrack(track.id, draggedMedia.id, Math.max(0, time));
              }
            }
            setDropIndicator(null);
          }
        }}
        onDragOver={(e) => {
          if (draggedMedia) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            const rect = timelineRef.current?.getBoundingClientRect();
            if (rect) {
              const x = e.clientX - rect.left - TRACK_LABEL_WIDTH + scrollX;
              const y = e.clientY - rect.top;
              const trackIndex = Math.floor(y / trackHeight);
              const track = project.tracks[trackIndex];

              if (track && track.type === draggedMedia.type) {
                let time = pixelsToTime(x, zoom);
                if (snapEnabled) {
                  const snapPoints = findSnapPoints(project.tracks, playhead);
                  const snapped = snapTime(time, snapPoints, snapThreshold, zoom);
                  time = snapped.time;
                }
                setDropIndicator({
                  time: Math.max(0, time),
                  trackId: track.id,
                  duration: draggedMedia.duration,
                });
              } else {
                setDropIndicator(null);
              }
            }
          }
        }}
        onDragLeave={(e) => {
          // Only clear if leaving the tracks area entirely
          const rect = timelineRef.current?.getBoundingClientRect();
          if (rect) {
            const { clientX, clientY } = e;
            if (
              clientX < rect.left ||
              clientX > rect.right ||
              clientY < rect.top ||
              clientY > rect.bottom
            ) {
              setDropIndicator(null);
            }
          }
        }}
      >
        {project.tracks.map((track, index) => (
          <TimelineTrack
            key={track.id}
            track={track}
            trackIndex={index}
            mediaFiles={project.mediaFiles}
            zoom={zoom}
            scrollX={scrollX}
            trackHeight={trackHeight}
            selectedClipIds={selectedClipIds}
            playhead={playhead}
            dropIndicator={dropIndicator?.trackId === track.id ? dropIndicator : null}
            isDragging={draggingTrackIndex === index}
            isDragOver={dragOverTrackIndex === index}
            isClipDropTarget={clipTargetTrackId === track.id && draggingClip !== null}
            onTrackDragStart={() => setDraggingTrackIndex(index)}
            onTrackDragEnd={() => {
              if (draggingTrackIndex !== null && dragOverTrackIndex !== null) {
                onReorderTracks(draggingTrackIndex, dragOverTrackIndex);
              }
              setDraggingTrackIndex(null);
              setDragOverTrackIndex(null);
            }}
            onTrackDragOver={() => setDragOverTrackIndex(index)}
            onClipSelect={onClipSelect}
            onClipDragStart={handleClipDragStart}
            onClipResizeStart={(clipId, side) => {
              const clip = project.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
              const mediaFile = clip ? project.mediaFiles.find(m => m.id === clip.mediaId) : null;
              if (clip && mediaFile) {
                setResizingClip({
                  clipId,
                  side,
                  initialStartTime: clip.startTime,
                  initialTrimStart: clip.trimStart,
                  initialTrimEnd: clip.trimEnd,
                  initialEndTime: getClipEndTime(clip, mediaFile),
                });
              }
            }}
            onClipDelete={onClipDelete}
            onClipDuplicate={onClipDuplicate}
            onClipSplit={onClipSplit}
          />
        ))}
      </div>
      <div
        className="timeline-scrollbar"
        ref={scrollbarRef}
      >
        <div
          className="timeline-scrollbar-content"
          style={{ width: timelineWidth + TRACK_LABEL_WIDTH }}
        />
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
