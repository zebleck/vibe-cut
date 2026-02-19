import { MouseEvent, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuWidth = 180;
  const menuHeight = 180;

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(e);
    setMenuPos({ x: e.clientX, y: e.clientY });
    setShowMenu(true);
  };

  const handleMenuAction = (action: () => void) => {
    action();
    setShowMenu(false);
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0) { // Left click
      if (showMenu) setShowMenu(false);
      onSelect(e);
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        onDragStart(e);
      }
    }
  };

  const menuLeft = Math.max(
    8,
    Math.min(menuPos.x, (typeof window !== 'undefined' ? window.innerWidth : menuPos.x) - menuWidth - 8)
  );
  const menuTop = Math.max(
    8,
    Math.min(menuPos.y, (typeof window !== 'undefined' ? window.innerHeight : menuPos.y) - menuHeight - 8)
  );

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
      {showMenu && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
          onMouseDown={() => setShowMenu(false)}
        >
          <div
            className="clip-menu"
            style={{ position: 'fixed', left: menuLeft, top: menuTop, zIndex: 10000 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" onClick={() => handleMenuAction(onDuplicate)}>Duplicate</button>
            <button type="button" onClick={() => handleMenuAction(onSplit)}>Split at Playhead</button>
            <button type="button" onClick={() => handleMenuAction(onDelete)}>Delete</button>
            <button type="button" onClick={() => setShowMenu(false)}>Cancel</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
