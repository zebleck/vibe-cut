import { useEffect, useState } from 'react';
import { Clip, Effect } from '../types';
import { createEffect } from '../utils/effectUtils';

interface EffectsPanelProps {
  selectedClips: Clip[];
  onUpdateClip: (clipId: string, updates: Partial<Clip>) => void;
}

const MIN_SPEED = 0.1;
const MAX_SPEED = 100;
const SLIDER_MIN = 0;
const SLIDER_MAX = 1000;

function speedToSlider(speed: number): number {
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  const minLog = Math.log10(MIN_SPEED);
  const maxLog = Math.log10(MAX_SPEED);
  const normalized = (Math.log10(clamped) - minLog) / (maxLog - minLog);
  return SLIDER_MIN + normalized * (SLIDER_MAX - SLIDER_MIN);
}

function sliderToSpeed(sliderValue: number): number {
  const clamped = Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, sliderValue));
  const normalized = (clamped - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN);
  const minLog = Math.log10(MIN_SPEED);
  const maxLog = Math.log10(MAX_SPEED);
  const speed = Math.pow(10, minLog + normalized * (maxLog - minLog));
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

export function EffectsPanel({ selectedClips, onUpdateClip }: EffectsPanelProps) {
  const clip = selectedClips[0] || null; // Edit first selected clip
  const [activeEffect, setActiveEffect] = useState<Effect | null>(null);
  const transform = clip?.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  const crop = clip?.crop ?? { left: 0, right: 0, top: 0, bottom: 0 };

  useEffect(() => {
    setActiveEffect(clip?.effects[0] || null);
  }, [clip?.id]);

  const handleAddEffect = (type: Effect['type']) => {
    if (!clip) return;
    const effect = createEffect(type);
    onUpdateClip(clip.id, {
      effects: [...clip.effects, effect],
    });
    setActiveEffect(effect);
  };

  const handleUpdateEffect = (effectId: string, updates: Partial<Effect>) => {
    if (!clip) return;
    onUpdateClip(clip.id, {
      effects: clip.effects.map(eff =>
        eff.id === effectId ? { ...eff, ...updates } : eff
      ),
    });
  };

  const handleRemoveEffect = (effectId: string) => {
    if (!clip) return;
    onUpdateClip(clip.id, {
      effects: clip.effects.filter(eff => eff.id !== effectId),
    });
    if (activeEffect?.id === effectId) {
      setActiveEffect(null);
    }
  };

  const handleSpeedChange = (speed: number) => {
    if (!clip) return;
    const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
    onUpdateClip(clip.id, { speed: clamped });
  };

  const handleReverseToggle = () => {
    if (!clip) return;
    onUpdateClip(clip.id, { reverse: !clip.reverse });
  };

  const handleOpacityChange = (opacity: number) => {
    if (!clip) return;
    onUpdateClip(clip.id, { opacity });
  };

  const handleTransformChange = (updates: Partial<NonNullable<Clip['transform']>>) => {
    if (!clip) return;
    onUpdateClip(clip.id, {
      transform: {
        ...transform,
        ...updates,
      },
    });
  };

  const handleCropChange = (updates: Partial<NonNullable<Clip['crop']>>) => {
    if (!clip) return;
    const next = {
      ...crop,
      ...updates,
    };
    const maxPerSide = 0.45;
    const clamped = {
      left: Math.max(0, Math.min(maxPerSide, next.left)),
      right: Math.max(0, Math.min(maxPerSide, next.right)),
      top: Math.max(0, Math.min(maxPerSide, next.top)),
      bottom: Math.max(0, Math.min(maxPerSide, next.bottom)),
    };
    onUpdateClip(clip.id, { crop: clamped });
  };

  const handleResetTransformAndCrop = () => {
    if (!clip) return;
    onUpdateClip(clip.id, {
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      crop: { left: 0, right: 0, top: 0, bottom: 0 },
    });
  };

  if (!clip) {
    return (
      <div className="effects-panel">
        <h3>Effects</h3>
        <p className="empty-message">Select a clip to apply effects</p>
      </div>
    );
  }

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
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step="1"
            value={speedToSlider(clip.speed || 1)}
            onChange={(e) => handleSpeedChange(sliderToSpeed(parseFloat(e.target.value)))}
          />
          <input
            type="number"
            min={MIN_SPEED}
            max={MAX_SPEED}
            step="0.01"
            value={(clip.speed || 1).toFixed(2)}
            onChange={(e) => {
              const next = parseFloat(e.target.value);
              if (Number.isFinite(next)) {
                handleSpeedChange(next);
              }
            }}
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
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={(clip.opacity || 1).toFixed(2)}
            onChange={(e) => {
              const next = parseFloat(e.target.value);
              if (Number.isFinite(next)) {
                handleOpacityChange(Math.max(0, Math.min(1, next)));
              }
            }}
          />
          <span>{Math.round((clip.opacity || 1) * 100)}%</span>
        </div>
      </div>

      {!clip.textOverlay && (
        <div className="effect-section">
          <h4>Transform</h4>
          <div className="control-group">
            <label>X:</label>
            <input
              type="range"
              min="-1000"
              max="1000"
              step="1"
              value={transform.x}
              onChange={(e) => handleTransformChange({ x: parseFloat(e.target.value) })}
            />
            <input
              type="number"
              min="-1000"
              max="1000"
              step="1"
              value={Math.round(transform.x)}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                if (Number.isFinite(next)) handleTransformChange({ x: next });
              }}
            />
            <span>{Math.round(transform.x)}px</span>
          </div>
          <div className="control-group">
            <label>Y:</label>
            <input
              type="range"
              min="-1000"
              max="1000"
              step="1"
              value={transform.y}
              onChange={(e) => handleTransformChange({ y: parseFloat(e.target.value) })}
            />
            <input
              type="number"
              min="-1000"
              max="1000"
              step="1"
              value={Math.round(transform.y)}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                if (Number.isFinite(next)) handleTransformChange({ y: next });
              }}
            />
            <span>{Math.round(transform.y)}px</span>
          </div>
          <div className="control-group">
            <label>Scale X:</label>
            <input
              type="range"
              min="0.1"
              max="4"
              step="0.01"
              value={transform.scaleX}
              onChange={(e) => handleTransformChange({ scaleX: parseFloat(e.target.value) })}
            />
            <input
              type="number"
              min="0.1"
              max="4"
              step="0.01"
              value={transform.scaleX.toFixed(2)}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                if (Number.isFinite(next)) {
                  handleTransformChange({ scaleX: Math.max(0.1, Math.min(4, next)) });
                }
              }}
            />
            <span>{transform.scaleX.toFixed(2)}x</span>
          </div>
          <div className="control-group">
            <label>Scale Y:</label>
            <input
              type="range"
              min="0.1"
              max="4"
              step="0.01"
              value={transform.scaleY}
              onChange={(e) => handleTransformChange({ scaleY: parseFloat(e.target.value) })}
            />
            <input
              type="number"
              min="0.1"
              max="4"
              step="0.01"
              value={transform.scaleY.toFixed(2)}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                if (Number.isFinite(next)) {
                  handleTransformChange({ scaleY: Math.max(0.1, Math.min(4, next)) });
                }
              }}
            />
            <span>{transform.scaleY.toFixed(2)}x</span>
          </div>
          <div className="control-group">
            <label>Rotation:</label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={transform.rotation}
              onChange={(e) => handleTransformChange({ rotation: parseFloat(e.target.value) })}
            />
            <input
              type="number"
              min="-180"
              max="180"
              step="1"
              value={Math.round(transform.rotation)}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                if (Number.isFinite(next)) {
                  handleTransformChange({ rotation: Math.max(-180, Math.min(180, next)) });
                }
              }}
            />
            <span>{Math.round(transform.rotation)}°</span>
          </div>
          <div className="control-group">
            <button type="button" onClick={handleResetTransformAndCrop}>Reset Transform/Crop</button>
          </div>
        </div>
      )}

      {!clip.textOverlay && (
        <div className="effect-section">
          <h4>Crop</h4>
          <div className="control-group">
            <label>Left:</label>
            <input
              type="range"
              min="0"
              max="0.45"
              step="0.01"
              value={crop.left}
              onChange={(e) => handleCropChange({ left: parseFloat(e.target.value) })}
            />
            <input
              type="number"
              min="0"
              max="45"
              step="1"
              value={Math.round(crop.left * 100)}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                if (Number.isFinite(next)) handleCropChange({ left: next / 100 });
              }}
            />
            <span>{Math.round(crop.left * 100)}%</span>
          </div>
          <div className="control-group">
            <label>Right:</label>
            <input
              type="range"
              min="0"
              max="0.45"
              step="0.01"
              value={crop.right}
              onChange={(e) => handleCropChange({ right: parseFloat(e.target.value) })}
            />
            <input
              type="number"
              min="0"
              max="45"
              step="1"
              value={Math.round(crop.right * 100)}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                if (Number.isFinite(next)) handleCropChange({ right: next / 100 });
              }}
            />
            <span>{Math.round(crop.right * 100)}%</span>
          </div>
          <div className="control-group">
            <label>Top:</label>
            <input
              type="range"
              min="0"
              max="0.45"
              step="0.01"
              value={crop.top}
              onChange={(e) => handleCropChange({ top: parseFloat(e.target.value) })}
            />
            <input
              type="number"
              min="0"
              max="45"
              step="1"
              value={Math.round(crop.top * 100)}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                if (Number.isFinite(next)) handleCropChange({ top: next / 100 });
              }}
            />
            <span>{Math.round(crop.top * 100)}%</span>
          </div>
          <div className="control-group">
            <label>Bottom:</label>
            <input
              type="range"
              min="0"
              max="0.45"
              step="0.01"
              value={crop.bottom}
              onChange={(e) => handleCropChange({ bottom: parseFloat(e.target.value) })}
            />
            <input
              type="number"
              min="0"
              max="45"
              step="1"
              value={Math.round(crop.bottom * 100)}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                if (Number.isFinite(next)) handleCropChange({ bottom: next / 100 });
              }}
            />
            <span>{Math.round(crop.bottom * 100)}%</span>
          </div>
        </div>
      )}

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
              <input
                type="number"
                min="-100"
                max="100"
                step="1"
                value={effect.value}
                onChange={(e) => {
                  const next = parseFloat(e.target.value);
                  if (Number.isFinite(next)) {
                    handleUpdateEffect(effect.id, { value: Math.max(-100, Math.min(100, next)) });
                  }
                }}
              />
              <span>{effect.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

