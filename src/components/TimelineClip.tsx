import { MouseEvent, useState } from 'react';
import { Clip, MediaFile } from '../types';
import { formatTime } from '../utils/mediaUtils';
import { getClipDuration } from '../utils/timelineUtils';

interface TimelineClipProps {
  clip: Clip;
  mediaFile: MediaFile;
  left: number;
  width: number;
  height: number;
  isSelected: boolean;
  onSelect: (e: MouseEvent) => void;
  onDragStart: (e: MouseEvent) => void;
  onResizeStart: (side: 'left' | 'right') => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSplit: () => void;
}

export function TimelineClip({
  clip,
  mediaFile,
  left,
  width,
  height,
  isSelected,
  onSelect,
  onDragStart,
  onResizeStart,
  onDelete,
  onDuplicate,
  onSplit,
}: TimelineClipProps) {
  const clipDuration = getClipDuration(clip, mediaFile);
  const [showMenu, setShowMenu] = useState(false);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(true);
  };

  const handleMenuAction = (action: () => void) => {
    action();
    setShowMenu(false);
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0) { // Left click
      onSelect(e);
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        onDragStart(e);
      }
    }
  };

  return (
    <div
      className={`timeline-clip ${isSelected ? 'selected' : ''}`}
      style={{
        left: `${left}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      {mediaFile.type === 'video' && mediaFile.thumbnail && width > 60 && (
        <div
          className="clip-thumbnail"
          style={{
            backgroundImage: `url(${mediaFile.thumbnail})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      <div className="clip-content">
        <span className="clip-name">{mediaFile.name}</span>
        <span className="clip-duration">{formatTime(clipDuration)}</span>
      </div>
      <div
        className="clip-resize-handle left"
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart('left');
        }}
      />
      <div
        className="clip-resize-handle right"
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart('right');
        }}
      />
      {showMenu && (
        <div className="clip-menu" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => handleMenuAction(onDuplicate)}>Duplicate</button>
          <button onClick={() => handleMenuAction(onSplit)}>Split at Playhead</button>
          <button onClick={() => handleMenuAction(onDelete)}>Delete</button>
          <button onClick={() => setShowMenu(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
