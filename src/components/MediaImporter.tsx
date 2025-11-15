import { useRef, useState, DragEvent } from 'react';

interface MediaImporterProps {
  onMediaAdded: (file: File) => void;
}

export function MediaImporter({ onMediaAdded }: MediaImporterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        onMediaAdded(file);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={`media-importer ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*"
        multiple
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      <div className="importer-content">
        <p>📁 Click to import or drag & drop media files</p>
        <p className="hint">Supports video and audio files</p>
      </div>
    </div>
  );
}

