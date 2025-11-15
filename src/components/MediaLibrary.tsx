import { MediaFile } from '../types';
import { formatTime } from '../utils/mediaUtils';

interface MediaLibraryProps {
  mediaFiles: MediaFile[];
  onAddToTrack: (mediaId: string, trackType: 'video' | 'audio') => void;
}

export function MediaLibrary({ mediaFiles, onAddToTrack }: MediaLibraryProps) {
  if (mediaFiles.length === 0) {
    return (
      <div className="media-library empty">
        <p>No media files imported yet</p>
      </div>
    );
  }

  return (
    <div className="media-library">
      <h3>Media Library</h3>
      <div className="media-list">
        {mediaFiles.map(mediaFile => (
          <div key={mediaFile.id} className="media-item">
            <div className="media-info">
              <span className="media-type">{mediaFile.type === 'video' ? '🎬' : '🎵'}</span>
              <span className="media-name">{mediaFile.name}</span>
              <span className="media-duration">{formatTime(mediaFile.duration)}</span>
            </div>
            <div className="media-actions">
              {mediaFile.type === 'video' && (
                <button onClick={() => onAddToTrack(mediaFile.id, 'video')}>
                  Add to Video Track
                </button>
              )}
              {mediaFile.type === 'audio' && (
                <button onClick={() => onAddToTrack(mediaFile.id, 'audio')}>
                  Add to Audio Track
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

