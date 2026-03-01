import { useMemo } from 'react';
import { Clip, TextOverlay } from '../types';

interface TextPanelProps {
  selectedClips: Clip[];
  onUpdateClip: (clipId: string, updates: Partial<Clip>) => void;
}

const defaultText: TextOverlay = {
  content: 'New Text',
  duration: 3,
  x: 0.5,
  y: 0.85,
  fontSize: 48,
  color: '#ffffff',
  fontFamily: 'Arial',
  fontWeight: 'bold',
  fontStyle: 'normal',
  backgroundColor: 'rgba(0, 0, 0, 0.35)',
  align: 'center',
};

export function TextPanel({ selectedClips, onUpdateClip }: TextPanelProps) {
  const textClip = useMemo(
    () => selectedClips.find(clip => clip.textOverlay),
    [selectedClips]
  );

  const overlay = textClip?.textOverlay ?? null;

  const updateOverlay = (updates: Partial<TextOverlay>) => {
    if (!textClip) return;
    onUpdateClip(textClip.id, {
      textOverlay: {
        ...(overlay ?? defaultText),
        ...updates,
      },
    });
  };

  if (!textClip || !overlay) {
    return (
      <div className="effects-panel">
        <h3>Text</h3>
        <p className="empty-message">Select a text clip to customize it</p>
      </div>
    );
  }

  return (
    <div className="effects-panel">
      <h3>Text</h3>
      <div className="effect-section">
        <label>Content</label>
        <textarea
          className="text-panel-input"
          value={overlay.content}
          onChange={(e) => updateOverlay({ content: e.target.value })}
          rows={4}
        />
      </div>

      <div className="effect-section">
        <label>Font Family</label>
        <input
          className="text-panel-input"
          type="text"
          value={overlay.fontFamily}
          onChange={(e) => updateOverlay({ fontFamily: e.target.value })}
        />
      </div>

      <div className="effect-section">
        <div className="control-group">
          <label>Size</label>
          <input
            type="range"
            min="12"
            max="160"
            step="1"
            value={overlay.fontSize}
            onChange={(e) => updateOverlay({ fontSize: Number(e.target.value) })}
          />
          <span>{overlay.fontSize}px</span>
        </div>
        <div className="control-group">
          <label>Color</label>
          <input
            type="color"
            value={overlay.color}
            onChange={(e) => updateOverlay({ color: e.target.value })}
          />
        </div>
        <div className="control-group">
          <label>Background</label>
          <input
            className="text-panel-input"
            type="text"
            value={overlay.backgroundColor ?? ''}
            onChange={(e) => updateOverlay({ backgroundColor: e.target.value || undefined })}
            placeholder="e.g. rgba(0,0,0,0.35)"
          />
        </div>
        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={overlay.fontWeight === 'bold'}
              onChange={(e) => updateOverlay({ fontWeight: e.target.checked ? 'bold' : 'normal' })}
            />
            Bold
          </label>
          <label>
            <input
              type="checkbox"
              checked={overlay.fontStyle === 'italic'}
              onChange={(e) => updateOverlay({ fontStyle: e.target.checked ? 'italic' : 'normal' })}
            />
            Italic
          </label>
        </div>
      </div>

      <div className="effect-section">
        <h4>Placement</h4>
        <div className="control-group">
          <label>X</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={overlay.x}
            onChange={(e) => updateOverlay({ x: Number(e.target.value) })}
          />
          <span>{Math.round(overlay.x * 100)}%</span>
        </div>
        <div className="control-group">
          <label>Y</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={overlay.y}
            onChange={(e) => updateOverlay({ y: Number(e.target.value) })}
          />
          <span>{Math.round(overlay.y * 100)}%</span>
        </div>
        <div className="control-group">
          <label>Align</label>
          <select
            value={overlay.align}
            onChange={(e) => updateOverlay({ align: e.target.value as TextOverlay['align'] })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      </div>
    </div>
  );
}
