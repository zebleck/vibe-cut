import { useRecording } from '../hooks/useRecording';

interface RecordingPanelProps {
  onRecordingComplete: (file: File) => void;
}

export function RecordingPanel({ onRecordingComplete }: RecordingPanelProps) {
  const { isRecording, startRecording, stopRecording, getRecordedFile, clearRecording } = useRecording();

  const handleStop = () => {
    stopRecording();
    setTimeout(() => {
      const file = getRecordedFile();
      if (file) {
        onRecordingComplete(file);
        clearRecording();
      }
    }, 100);
  };

  return (
    <div className="recording-panel">
      <h3>Voice Recording</h3>
      {!isRecording ? (
        <button onClick={startRecording} className="record-button">
          🎤 Start Recording
        </button>
      ) : (
        <div className="recording-active">
          <div className="recording-indicator">
            <span className="pulse">🔴</span>
            <span>Recording...</span>
          </div>
          <button onClick={handleStop} className="stop-button">
            ⏹️ Stop Recording
          </button>
        </div>
      )}
    </div>
  );
}

