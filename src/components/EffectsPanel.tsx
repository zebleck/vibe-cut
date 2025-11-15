import { useState } from 'react';
import { Clip, Effect, Keyframe } from '../types';
import { createEffect } from '../utils/effectUtils';
import { addKeyframe, removeKeyframe } from '../utils/keyframeUtils';

interface EffectsPanelProps {
  selectedClips: Clip[];
  onUpdateClip: (clipId: string, updates: Partial<Clip>) => void;
}

export function EffectsPanel({ selectedClips, onUpdateClip }: EffectsPanelProps) {
  const [selectedEffectType, setSelectedEffectType] = useState<Effect['type'] | null>(null);

  if (selectedClips.length === 0) {
    return (
      <div className="effects-panel">
        <h3>Effects</h3>
        <p className="empty-message">Select a clip to apply effects</p>
      </div>
    );
  }

  const clip = selectedClips[0]; // Edit first selected clip
  const [activeEffect, setActiveEffect] = useState<Effect | null>(
    clip.effects[0] || null
  );

  const handleAddEffect = (type: Effect['type']) => {
    const effect = createEffect(type);
    onUpdateClip(clip.id, {
      effects: [...clip.effects, effect],
    });
    setActiveEffect(effect);
  };

  const handleUpdateEffect = (effectId: string, updates: Partial<Effect>) => {
    onUpdateClip(clip.id, {
      effects: clip.effects.map(eff =>
        eff.id === effectId ? { ...eff, ...updates } : eff
      ),
    });
  };

  const handleRemoveEffect = (effectId: string) => {
    onUpdateClip(clip.id, {
      effects: clip.effects.filter(eff => eff.id !== effectId),
    });
    if (activeEffect?.id === effectId) {
      setActiveEffect(null);
    }
  };

  const handleSpeedChange = (speed: number) => {
    onUpdateClip(clip.id, { speed });
  };

  const handleReverseToggle = () => {
    onUpdateClip(clip.id, { reverse: !clip.reverse });
  };

  const handleOpacityChange = (opacity: number) => {
    onUpdateClip(clip.id, { opacity });
  };

  return (
    <div className="effects-panel">
      <h3>Effects & Properties</h3>

      <div className="effect-section">
        <h4>Color Adjustments</h4>
        <div className="effect-buttons">
          <button onClick={() => handleAddEffect('brightness')}>Brightness</button>
          <button onClick={() => handleAddEffect('contrast')}>Contrast</button>
          <button onClick={() => handleAddEffect('saturation')}>Saturation</button>
        </div>
      </div>

      <div className="effect-section">
        <h4>Speed & Playback</h4>
        <div className="control-group">
          <label>Speed:</label>
          <input
            type="range"
            min="0.25"
            max="4"
            step="0.25"
            value={clip.speed || 1}
            onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
          />
          <span>{(clip.speed || 1).toFixed(2)}x</span>
        </div>
        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={clip.reverse || false}
              onChange={handleReverseToggle}
            />
            Reverse
          </label>
        </div>
      </div>

      <div className="effect-section">
        <h4>Opacity</h4>
        <div className="control-group">
          <label>Opacity:</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={clip.opacity || 1}
            onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
          />
          <span>{Math.round((clip.opacity || 1) * 100)}%</span>
        </div>
      </div>

      <div className="effect-section">
        <h4>Applied Effects</h4>
        {clip.effects.map(effect => (
          <div key={effect.id} className="effect-item">
            <div className="effect-header">
              <span>{effect.type}</span>
              <button onClick={() => handleRemoveEffect(effect.id)}>×</button>
            </div>
            <div className="control-group">
              <label>
                <input
                  type="checkbox"
                  checked={effect.enabled}
                  onChange={(e) =>
                    handleUpdateEffect(effect.id, { enabled: e.target.checked })
                  }
                />
                Enabled
              </label>
            </div>
            <div className="control-group">
              <label>Value:</label>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={effect.value}
                onChange={(e) =>
                  handleUpdateEffect(effect.id, { value: parseFloat(e.target.value) })
                }
              />
              <span>{effect.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

