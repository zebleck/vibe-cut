import { useEffect, useState } from 'react';
import { RenderSettings } from '../types';

interface RenderPanelProps {
  onRender: (settings: RenderSettings) => void;
  onCancel: () => void;
  isRendering: boolean;
  progress?: any;
  onSettingsChange?: (settings: RenderSettings) => void;
}

export function RenderPanel({ onRender, onCancel, isRendering, progress, onSettingsChange }: RenderPanelProps) {
  const [settings, setSettings] = useState<RenderSettings>({
    width: 1920,
    height: 1080,
    bitrate: 5000,
    framerate: 30,
    format: 'mp4',
    renderEngine: 'python',
  });

  const handleRender = () => {
    onRender(settings);
  };

  useEffect(() => {
    onSettingsChange?.(settings);
  }, [settings, onSettingsChange]);

  return (
    <div className="render-panel">
      <h3>Render Settings</h3>
      <div className="render-settings">
        <div className="setting-group">
          <label>Resolution:</label>
          <select
            value={`${settings.width}x${settings.height}`}
            onChange={(e) => {
              const [w, h] = e.target.value.split('x').map(Number);
              setSettings({ ...settings, width: w, height: h });
            }}
          >
            <option value="1920x1080">1920x1080 (Full HD)</option>
            <option value="1280x720">1280x720 (HD)</option>
            <option value="854x480">854x480 (SD)</option>
            <option value="640x360">640x360</option>
          </select>
        </div>
        <div className="setting-group">
          <label>Bitrate (kbps):</label>
          <input
            type="number"
            value={settings.bitrate}
            onChange={(e) => setSettings({ ...settings, bitrate: parseInt(e.target.value) })}
            min="1000"
            max="20000"
            step="500"
          />
        </div>
        <div className="setting-group">
          <label>Framerate:</label>
          <select
            value={settings.framerate}
            onChange={(e) => setSettings({ ...settings, framerate: parseInt(e.target.value) })}
          >
            <option value="24">24 fps</option>
            <option value="30">30 fps</option>
            <option value="60">60 fps</option>
          </select>
        </div>
        <div className="setting-group">
          <label>Format:</label>
          <select
            value={settings.format}
            onChange={(e) => setSettings({ ...settings, format: e.target.value as 'mp4' | 'webm' })}
          >
            <option value="mp4">MP4</option>
            <option value="webm">WebM</option>
          </select>
        </div>
        <div className="setting-group">
          <label>Render Engine:</label>
          <select
            value={settings.renderEngine || 'auto'}
            onChange={(e) =>
              setSettings({
                ...settings,
                renderEngine: e.target.value as 'auto' | 'python' | 'gpu' | 'compatibility',
              })
            }
          >
            <option value="python">Python + native FFmpeg (recommended)</option>
            <option value="auto">Auto (fallback chain)</option>
            <option value="gpu">GPU/WebCodecs (fast)</option>
            <option value="compatibility">FFmpeg (stable)</option>
          </select>
        </div>
      </div>
      <div className="render-actions">
        <button onClick={handleRender} disabled={isRendering} className="render-button">
          {isRendering ? 'Rendering...' : 'Render Video'}
        </button>
        {isRendering && (
          <button onClick={onCancel} className="cancel-render-button">
            Cancel
          </button>
        )}
      </div>
      {isRendering && progress && (
        <div className="render-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
          <div className="progress-info">
            <span>{progress.message}</span>
            {progress.currentFrame !== undefined && progress.totalFrames !== undefined && (
              <span>
                Frame {progress.currentFrame} / {progress.totalFrames}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
