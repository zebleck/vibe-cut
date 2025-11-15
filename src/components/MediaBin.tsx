import { useState, useMemo } from 'react';
import { MediaFile, MediaBinGroup } from '../types';
import { formatTime } from '../utils/mediaUtils';

interface MediaBinProps {
  mediaFiles: MediaFile[];
  onAddToTrack: (mediaId: string, trackType: 'video' | 'audio') => void;
  onDragStart: (mediaFile: MediaFile) => void;
}

export function MediaBin({ mediaFiles, onAddToTrack, onDragStart }: MediaBinProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [groups, setGroups] = useState<MediaBinGroup[]>([]);

  // Group media by folder
  const groupedMedia = useMemo(() => {
    const folders = new Map<string, MediaFile[]>();
    const ungrouped: MediaFile[] = [];

    mediaFiles.forEach(file => {
      if (file.folder) {
        if (!folders.has(file.folder)) {
          folders.set(file.folder, []);
        }
        folders.get(file.folder)!.push(file);
      } else {
        ungrouped.push(file);
      }
    });

    return { folders, ungrouped };
  }, [mediaFiles]);

  // Filter media by search
  const filteredMedia = useMemo(() => {
    let filtered = mediaFiles;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(file =>
        file.name.toLowerCase().includes(query) ||
        file.tags?.some(tag => tag.toLowerCase().includes(query))
      );
    }
    
    if (selectedFolder) {
      filtered = filtered.filter(file => file.folder === selectedFolder);
    }
    
    return filtered;
  }, [mediaFiles, searchQuery, selectedFolder]);

  const handleDragStart = (e: React.DragEvent, mediaFile: MediaFile) => {
    onDragStart(mediaFile);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('mediaId', mediaFile.id);
  };

  return (
    <div className="media-bin">
      <div className="media-bin-header">
        <h3>Media Bin</h3>
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>

      {groupedMedia.folders.size > 0 && (
        <div className="folders-list">
          {Array.from(groupedMedia.folders.keys()).map(folder => (
            <div
              key={folder}
              className={`folder-item ${selectedFolder === folder ? 'active' : ''}`}
              onClick={() => setSelectedFolder(selectedFolder === folder ? null : folder)}
            >
              📁 {folder} ({groupedMedia.folders.get(folder)!.length})
            </div>
          ))}
        </div>
      )}

      <div className="media-grid">
        {filteredMedia.map(mediaFile => (
          <div
            key={mediaFile.id}
            className="media-bin-item"
            draggable
            onDragStart={(e) => handleDragStart(e, mediaFile)}
          >
            {mediaFile.thumbnail ? (
              <div
                className="media-thumbnail"
                style={{ backgroundImage: `url(${mediaFile.thumbnail})` }}
              />
            ) : (
              <div className="media-thumbnail placeholder">
                {mediaFile.type === 'video' ? '🎬' : '🎵'}
              </div>
            )}
            <div className="media-info">
              <div className="media-name">{mediaFile.name}</div>
              <div className="media-meta">
                <span>{formatTime(mediaFile.duration)}</span>
                {mediaFile.type === 'video' && mediaFile.width && mediaFile.height && (
                  <span>{mediaFile.width}x{mediaFile.height}</span>
                )}
              </div>
            </div>
            <div className="media-actions">
              {mediaFile.type === 'video' && (
                <button onClick={() => onAddToTrack(mediaFile.id, 'video')}>
                  Add to Video
                </button>
              )}
              {mediaFile.type === 'audio' && (
                <button onClick={() => onAddToTrack(mediaFile.id, 'audio')}>
                  Add to Audio
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredMedia.length === 0 && (
        <div className="empty-state">
          {searchQuery ? 'No media found' : 'No media imported'}
        </div>
      )}
    </div>
  );
}

