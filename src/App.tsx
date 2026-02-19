import { useState, useEffect, useCallback, useRef } from 'react';
import { MediaImporter } from './components/MediaImporter';
import { MediaBin } from './components/MediaBin';
import { Timeline } from './components/Timeline';
import { PlaybackControls } from './components/PlaybackControls';
import { VideoPreview } from './components/VideoPreview';
import { RecordingPanel } from './components/RecordingPanel';
import { RenderPanel } from './components/RenderPanel';
import { EffectsPanel } from './components/EffectsPanel';
import { TransitionsPanel } from './components/TransitionsPanel';
import { useProject } from './hooks/useProject';
import { useUndoRedo } from './hooks/useUndoRedo';
import { getClipEndTime } from './utils/timelineUtils';
import { matchShortcut, defaultShortcuts } from './utils/shortcuts';
import { renderProject } from './utils/renderer';
import { RenderSettings, Clip, MediaFile, Project } from './types';
import { listProjects, loadProject as loadFromIndexedDB } from './utils/indexedDB';
import './App.css';

function isValidProject(data: unknown): data is Project {
  if (!data || typeof data !== 'object') return false;
  const p = data as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    Array.isArray(p.mediaFiles) &&
    Array.isArray(p.tracks) &&
    typeof p.duration === 'number'
  );
}

function App() {
  const {
    project,
    addMediaFile,
    addTrack,
    reorderTracks,
    addClipToTrack,
    addVideoWithLinkedAudio,
    updateClip,
    moveClipToTrack,
    deleteClip,
    deleteClips,
    closeGaps,
    duplicateClip,
    splitClip,
    addTransition,
    updateTransition,
    removeTransition,
    loadProject,
    exportProject,
  } = useProject();

  const { executeCommand, undo, redo, canUndo, canRedo } = useUndoRedo();

  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [scrollX, setScrollXState] = useState(0);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);

  // Wrapper to enforce scroll bounds (never go below 0)
  const setScrollX = useCallback((value: number) => {
    setScrollXState(Math.max(0, value));
  }, []);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapThreshold] = useState(10);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<any>(null);
  const renderAbortRef = useRef<AbortController | null>(null);
  const [activeTab, setActiveTab] = useState<'media' | 'effects' | 'transitions'>('media');
  const [draggedMedia, setDraggedMedia] = useState<MediaFile | null>(null);
  const [previewHeight, setPreviewHeight] = useState(450);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Handle preview resize
  useEffect(() => {
    if (!isResizingPreview) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (mainContentRef.current) {
        const rect = mainContentRef.current.getBoundingClientRect();
        const newHeight = e.clientY - rect.top;
        setPreviewHeight(Math.max(200, Math.min(rect.height - 150, newHeight)));
      }
    };

    const handleMouseUp = () => {
      setIsResizingPreview(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingPreview]);

  // Playback loop using requestAnimationFrame for smooth timing
  useEffect(() => {
    if (!isPlaying) return;

    let rafId: number;
    let lastTimestamp: number | null = null;

    const tick = (timestamp: number) => {
      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
        rafId = requestAnimationFrame(tick);
        return;
      }

      const delta = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      setPlayhead(prev => {
        const newTime = prev + delta;
        if (newTime >= project.duration) {
          setIsPlaying(false);
          return project.duration;
        }
        return newTime;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, project.duration]);

  // Enhanced keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const shortcut = matchShortcut(e, defaultShortcuts);
      if (!shortcut) return;

      e.preventDefault();

      switch (shortcut.action) {
        case 'split':
          if (selectedClipIds.length > 0) {
            selectedClipIds.forEach(id => splitClip(id, playhead));
          }
          break;
        case 'duplicate':
          selectedClipIds.forEach(id => duplicateClip(id));
          break;
        case 'delete':
          if (selectedClipIds.length > 0) {
            selectedClipIds.forEach(id => deleteClip(id));
            setSelectedClipIds([]);
          }
          break;
        case 'play-pause':
          setIsPlaying(prev => !prev);
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'zoom-in':
          setZoom(prev => Math.min(500, prev + 10));
          break;
        case 'zoom-out':
          setZoom(prev => Math.max(1, prev - 10));
          break;
        case 'frame-left': {
          const framerate = project.framerate || 30;
          const frameTime = 1 / framerate;
          setPlayhead(prev => Math.max(0, prev - frameTime));
          break;
        }
        case 'frame-right': {
          const framerate = project.framerate || 30;
          const frameTime = 1 / framerate;
          setPlayhead(prev => Math.min(project.duration, prev + frameTime));
          break;
        }
        case 'home':
          setPlayhead(0);
          break;
        case 'end':
          setPlayhead(project.duration);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedClipIds,
    playhead,
    project.duration,
    project.framerate,
    splitClip,
    duplicateClip,
    deleteClip,
    undo,
    redo,
  ]);

  const handleMediaAdded = useCallback(async (file: File) => {
    const mediaFile = await addMediaFile(file);
    return mediaFile;
  }, [addMediaFile]);

  const handleRecordingComplete = useCallback(async (file: File) => {
    const mediaFile = await handleMediaAdded(file);
    if (mediaFile) {
      let audioTrack = project.tracks.find(t => t.type === 'audio');
      if (!audioTrack) {
        addTrack('audio');
        audioTrack = project.tracks.find(t => t.type === 'audio');
      }
      if (audioTrack) {
        const trackClips = audioTrack.clips;
        let startTime = 0;
        if (trackClips.length > 0) {
          const lastClip = trackClips[trackClips.length - 1];
          const lastMediaFile = project.mediaFiles.find(m => m.id === lastClip.mediaId);
          if (lastMediaFile) {
            startTime = getClipEndTime(lastClip, lastMediaFile);
          }
        }
        addClipToTrack(audioTrack.id, mediaFile.id, startTime);
      }
    }
  }, [handleMediaAdded, project, addTrack, addClipToTrack]);

  // Wrapper: adds a clip to a track, automatically linking audio when a video with audio is added to a video track
  const handleAddClipToTrack = useCallback((trackId: string, mediaId: string, startTime: number) => {
    const track = project.tracks.find(t => t.id === trackId);
    const mediaFile = project.mediaFiles.find(m => m.id === mediaId);
    if (track?.type === 'video' && mediaFile?.hasAudio) {
      addVideoWithLinkedAudio(trackId, mediaId, startTime);
    } else {
      addClipToTrack(trackId, mediaId, startTime);
    }
  }, [project, addClipToTrack, addVideoWithLinkedAudio]);

  const handleAddToTrack = useCallback((mediaId: string, trackType: 'video' | 'audio') => {
    const track = project.tracks.find(t => t.type === trackType);
    if (!track) {
      addTrack(trackType);
      return;
    }

    const trackClips = track.clips;
    let startTime = 0;
    if (trackClips.length > 0) {
      const mediaFile = project.mediaFiles.find(m => m.id === trackClips[trackClips.length - 1].mediaId);
      if (mediaFile) {
        startTime = getClipEndTime(trackClips[trackClips.length - 1], mediaFile);
      }
    }

    const mediaFile = project.mediaFiles.find(m => m.id === mediaId);
    if (trackType === 'video' && mediaFile?.hasAudio) {
      addVideoWithLinkedAudio(track.id, mediaId, startTime);
    } else {
      addClipToTrack(track.id, mediaId, startTime);
    }
  }, [project, addTrack, addClipToTrack, addVideoWithLinkedAudio]);

  const handleClipSelect = useCallback((clipId: string, multi: boolean) => {
    setSelectedClipIds(prev => {
      if (multi) {
        if (prev.includes(clipId)) {
          return prev.filter(id => id !== clipId);
        }
        return [...prev, clipId];
      }
      return [clipId];
    });
  }, []);

  const handleClipUpdate = useCallback((clipId: string, updates: Partial<Clip>) => {
    executeCommand({
      execute: () => updateClip(clipId, updates),
      undo: () => {
        const clip = project.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
        if (clip) {
          updateClip(clipId, clip);
        }
      },
      description: 'Update clip',
    });
  }, [executeCommand, updateClip, project]);

  const handleClipDelete = useCallback((clipId: string) => {
    executeCommand({
      execute: () => deleteClip(clipId),
      undo: () => {
        // Simplified - would need to restore clip
      },
      description: 'Delete clip',
    });
    setSelectedClipIds(prev => prev.filter(id => id !== clipId));
  }, [executeCommand, deleteClip]);

  const handleRippleDelete = useCallback(() => {
    if (selectedClipIds.length === 0) return;
    executeCommand({
      execute: () => deleteClips(selectedClipIds, true),
      undo: () => {},
      description: 'Ripple delete',
    });
    setSelectedClipIds([]);
  }, [selectedClipIds, executeCommand, deleteClips]);

  const handleJumpToCut = useCallback((direction: 'prev' | 'next') => {
    const allCuts: number[] = [];
    project.tracks.forEach(track => {
      track.clips.forEach(clip => {
        allCuts.push(clip.startTime);
        const mediaFile = project.mediaFiles.find(m => m.id === clip.mediaId);
        if (mediaFile) {
          allCuts.push(getClipEndTime(clip, mediaFile));
        }
      });
    });

    const sortedCuts = [...new Set(allCuts)].sort((a, b) => a - b);
    const currentIndex = sortedCuts.findIndex(cut => cut >= playhead);

    if (direction === 'prev') {
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : sortedCuts.length - 1;
      setPlayhead(sortedCuts[prevIndex] || 0);
    } else {
      const nextIndex = currentIndex < sortedCuts.length - 1 ? currentIndex + 1 : 0;
      setPlayhead(sortedCuts[nextIndex] || 0);
    }
  }, [project, playhead]);

  const handleRender = useCallback(async (settings: RenderSettings) => {
    if (project.mediaFiles.length === 0) {
      alert('Please import at least one media file before rendering.');
      return;
    }

    const abortController = new AbortController();
    renderAbortRef.current = abortController;

    setIsRendering(true);
    setRenderProgress({
      stage: 'preparing',
      progress: 0,
      message: 'Initializing renderer...',
    });

    try {
      const blob = await renderProject(project, settings, (progress) => {
        setRenderProgress(progress);
      }, abortController.signal);

      // Download rendered video
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name || 'output'}.${settings.format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setIsRendering(false);
      setRenderProgress(null);
      alert('Rendering complete! Video downloaded.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setIsRendering(false);
        setRenderProgress(null);
        return;
      }
      console.error('Rendering error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`Rendering failed: ${errorMessage}\n\nCheck browser console for details.`);
      setIsRendering(false);
      setRenderProgress({
        stage: 'complete',
        progress: 0,
        message: `Error: ${errorMessage}`,
      });
    } finally {
      renderAbortRef.current = null;
    }
  }, [project]);

  const handleCancelRender = useCallback(() => {
    renderAbortRef.current?.abort();
  }, []);

  const handleSave = useCallback(() => {
    const json = exportProject();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name || 'project'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportProject, project.name]);

  const handleLoad = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const projectData = JSON.parse(e.target?.result as string);
            if (!isValidProject(projectData)) {
              throw new Error('Invalid project file structure');
            }

            // Check if media files need re-linking (no File objects in JSON)
            const needsMedia = projectData.mediaFiles.length > 0 &&
              !projectData.mediaFiles.some((mf: any) => mf.file instanceof File);

            if (needsMedia) {
              const mediaNames = projectData.mediaFiles.map((mf: any) => mf.name).join('\n  ');
              const doRelink = confirm(
                `This project references ${projectData.mediaFiles.length} media file(s):\n  ${mediaNames}\n\nSelect the original media files to restore preview and playback.`
              );

              if (doRelink) {
                const mediaInput = document.createElement('input');
                mediaInput.type = 'file';
                mediaInput.multiple = true;
                mediaInput.accept = 'video/*,audio/*';
                mediaInput.onchange = (me) => {
                  const files = (me.target as HTMLInputElement).files;
                  const relinkedFiles = new Map<string, File>();

                  if (files) {
                    // Match by filename
                    for (const f of Array.from(files)) {
                      for (const mf of projectData.mediaFiles) {
                        if (mf.name === f.name) {
                          relinkedFiles.set(mf.id, f);
                          relinkedFiles.set(mf.name, f);
                        }
                      }
                    }
                  }

                  loadProject(projectData, relinkedFiles);
                };
                mediaInput.click();
              } else {
                // Load without media - timeline structure will show but no preview
                loadProject(projectData);
              }
            } else {
              loadProject(projectData);
            }
          } catch (error) {
            console.error('Error loading project:', error);
            alert('Failed to load project file: ' + (error instanceof Error ? error.message : 'Unknown error'));
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, [loadProject]);

  const selectedClips = project.tracks
    .flatMap(t => t.clips)
    .filter(c => selectedClipIds.includes(c.id));

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎬 Vibe Video Editor Pro</h1>
        <div className="header-actions">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶ Undo</button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↷ Redo</button>
          <button onClick={handleSave}>💾 Save Project</button>
          <button onClick={handleLoad}>📂 Load Project</button>
        </div>
      </header>

      <div className="app-content">
        <div className="sidebar">
          <div className="sidebar-tabs">
            <button
              className={activeTab === 'media' ? 'active' : ''}
              onClick={() => setActiveTab('media')}
            >
              Media
            </button>
            <button
              className={activeTab === 'effects' ? 'active' : ''}
              onClick={() => setActiveTab('effects')}
            >
              Effects
            </button>
            <button
              className={activeTab === 'transitions' ? 'active' : ''}
              onClick={() => setActiveTab('transitions')}
            >
              Transitions
            </button>
          </div>

          {activeTab === 'media' && (
            <>
              <MediaImporter onMediaAdded={handleMediaAdded} />
              <MediaBin
                mediaFiles={project.mediaFiles}
                onAddToTrack={handleAddToTrack}
                onDragStart={setDraggedMedia}
              />
              <RecordingPanel onRecordingComplete={handleRecordingComplete} />
            </>
          )}

          {activeTab === 'effects' && (
            <EffectsPanel
              selectedClips={selectedClips}
              onUpdateClip={handleClipUpdate}
            />
          )}

          {activeTab === 'transitions' && (
            <TransitionsPanel
              project={project}
              selectedClips={selectedClips}
              onAddTransition={addTransition}
              onUpdateTransition={updateTransition}
              onRemoveTransition={removeTransition}
            />
          )}
        </div>

        <div className="main-content" ref={mainContentRef}>
          <div className="preview-section" style={{ height: previewHeight }}>
            <VideoPreview project={project} currentTime={playhead} isPlaying={isPlaying} />
            <PlaybackControls
              isPlaying={isPlaying}
              currentTime={playhead}
              duration={project.duration}
              tracks={project.tracks}
              mediaFiles={project.mediaFiles}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onStop={() => {
                setIsPlaying(false);
                setPlayhead(0);
              }}
              onSeek={setPlayhead}
              onHome={() => setPlayhead(0)}
              onEnd={() => setPlayhead(project.duration)}
              onJumpToCut={handleJumpToCut}
            />
          </div>

          <div
            className={`resize-handle-horizontal ${isResizingPreview ? 'active' : ''}`}
            onMouseDown={() => setIsResizingPreview(true)}
          />

          <Timeline
            project={project}
            playhead={playhead}
            zoom={zoom}
            scrollX={scrollX}
            selectedClipIds={selectedClipIds}
            snapEnabled={snapEnabled}
            snapThreshold={snapThreshold}
            onPlayheadChange={setPlayhead}
            onClipUpdate={handleClipUpdate}
            onClipDelete={handleClipDelete}
            onClipDuplicate={duplicateClip}
            onClipSplit={splitClip}
            onClipSelect={handleClipSelect}
            onZoomChange={setZoom}
            onScrollChange={setScrollX}
            onAddTrack={addTrack}
            onReorderTracks={reorderTracks}
            onMoveClipToTrack={moveClipToTrack}
            draggedMedia={draggedMedia}
            onAddClipToTrack={handleAddClipToTrack}
          />

          <div className="timeline-actions">
            <button onClick={() => addTrack('video')}>+ Video Track</button>
            <button onClick={() => addTrack('audio')}>+ Audio Track</button>
            <button
              onClick={() => {
                selectedClipIds.forEach(id => splitClip(id, playhead));
              }}
              disabled={selectedClipIds.length === 0}
            >
              Split at Playhead
            </button>
            <button onClick={handleRippleDelete} disabled={selectedClipIds.length === 0}>
              Ripple Delete
            </button>
            <button
              onClick={() => {
                const audioTrack = project.tracks.find(t => t.type === 'audio');
                if (audioTrack) {
                  closeGaps(audioTrack.id);
                }
              }}
            >
              Close Gaps
            </button>
            <label>
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={(e) => setSnapEnabled(e.target.checked)}
              />
              Snap
            </label>
          </div>
        </div>

        <div className="sidebar-right">
          <RenderPanel
            onRender={handleRender}
            onCancel={handleCancelRender}
            isRendering={isRendering}
            progress={renderProgress}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
