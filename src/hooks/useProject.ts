import { useState, useCallback, useEffect } from 'react';
import { Project, Clip, Track, MediaFile, Transition } from '../types';
import { createMediaFile } from '../utils/mediaUtils';
import { getProjectDuration, getClipEndTime, getClipDuration } from '../utils/timelineUtils';
import { saveProject as saveToIndexedDB } from '../utils/indexedDB';

export function useProject() {
  const [project, setProject] = useState<Project>(() => ({
    id: crypto.randomUUID(),
    name: 'Untitled Project',
    mediaFiles: [],
    tracks: [
      { id: 'track-video-1', type: 'video', clips: [], volume: 1 },
      { id: 'track-audio-1', type: 'audio', clips: [], volume: 1 },
    ],
    transitions: [],
    duration: 0,
    framerate: 30,
    settings: {
      snapTolerance: 10,
      autoSave: true,
      defaultTransitionDuration: 0.5,
    },
    version: '2.0.0',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));

  // Auto-save to IndexedDB
  useEffect(() => {
    if (project.settings?.autoSave && project.mediaFiles.length > 0) {
      const timeoutId = setTimeout(() => {
        saveToIndexedDB(project).catch(console.error);
      }, 2000); // Debounce auto-save

      return () => clearTimeout(timeoutId);
    }
  }, [project]);

  const addMediaFile = useCallback(async (file: File) => {
    const mediaFile = await createMediaFile(file);
    setProject(prev => ({
      ...prev,
      mediaFiles: [...prev.mediaFiles, mediaFile],
      updatedAt: Date.now(),
    }));
    return mediaFile;
  }, []);

  const addTrack = useCallback((type: 'video' | 'audio') => {
    setProject(prev => ({
      ...prev,
      tracks: [
        ...prev.tracks,
        {
          id: `track-${type}-${Date.now()}`,
          type,
          clips: [],
          volume: 1,
        },
      ],
      updatedAt: Date.now(),
    }));
  }, []);

  const deleteTrack = useCallback((trackId: string) => {
    setProject(prev => {
      if (prev.tracks.length <= 1) return prev;
      const updatedTracks = prev.tracks.filter(t => t.id !== trackId);
      const duration = getProjectDuration(updatedTracks, prev.mediaFiles);
      return {
        ...prev,
        tracks: updatedTracks,
        duration,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const reorderTracks = useCallback((fromIndex: number, toIndex: number) => {
    setProject(prev => {
      if (fromIndex === toIndex) return prev;
      if (fromIndex < 0 || fromIndex >= prev.tracks.length) return prev;
      if (toIndex < 0 || toIndex >= prev.tracks.length) return prev;

      const newTracks = [...prev.tracks];
      const [removed] = newTracks.splice(fromIndex, 1);
      newTracks.splice(toIndex, 0, removed);

      return {
        ...prev,
        tracks: newTracks,
        updatedAt: Date.now(),
      };
    });
  }, []);

  // Adds a video clip to a video track and simultaneously adds a linked audio clip
  // (derived from the same file) to the first available audio track.
  const addVideoWithLinkedAudio = useCallback((videoTrackId: string, mediaId: string, startTime: number) => {
    setProject(prev => {
      const videoTrack = prev.tracks.find(t => t.id === videoTrackId);
      const videoMediaFile = prev.mediaFiles.find(m => m.id === mediaId);
      if (!videoTrack || !videoMediaFile) return prev;

      const framerate = videoMediaFile.framerate || prev.framerate || 30;
      const quantizedStart = Math.round(startTime * framerate) / framerate;

      const videoClip: Clip = {
        id: crypto.randomUUID(),
        mediaId,
        startTime: quantizedStart,
        trimStart: 0,
        trimEnd: 0,
        effects: [],
        opacity: 1,
        speed: 1,
        reverse: false,
      };

      // Create a derived audio MediaFile referencing the same file/url
      const audioMediaFile: MediaFile = {
        id: crypto.randomUUID(),
        name: videoMediaFile.name,
        type: 'audio',
        file: videoMediaFile.file,
        url: videoMediaFile.url,
        duration: videoMediaFile.duration,
        waveform: videoMediaFile.waveform,
      };

      const audioClip: Clip = {
        id: crypto.randomUUID(),
        mediaId: audioMediaFile.id,
        startTime: quantizedStart,
        trimStart: 0,
        trimEnd: 0,
        effects: [],
        opacity: 1,
        speed: 1,
        reverse: false,
      };

      // Find the first audio track, or insert a new one after all video tracks
      const existingAudioTrack = prev.tracks.find(t => t.type === 'audio');
      let updatedTracks: Track[];

      if (existingAudioTrack) {
        updatedTracks = prev.tracks.map(t => {
          if (t.id === videoTrackId) return { ...t, clips: [...t.clips, videoClip] };
          if (t.id === existingAudioTrack.id) return { ...t, clips: [...t.clips, audioClip] };
          return t;
        });
      } else {
        const newAudioTrack: Track = {
          id: `track-audio-${Date.now()}`,
          type: 'audio',
          clips: [audioClip],
          volume: 1,
        };
        updatedTracks = [
          ...prev.tracks.map(t =>
            t.id === videoTrackId ? { ...t, clips: [...t.clips, videoClip] } : t
          ),
          newAudioTrack,
        ];
      }

      const duration = getProjectDuration(updatedTracks, [...prev.mediaFiles, audioMediaFile]);

      return {
        ...prev,
        mediaFiles: [...prev.mediaFiles, audioMediaFile],
        tracks: updatedTracks,
        duration,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const addClipToTrack = useCallback((trackId: string, mediaId: string, startTime: number) => {
    setProject(prev => {
      const track = prev.tracks.find(t => t.id === trackId);
      if (!track) return prev;

      const mediaFile = prev.mediaFiles.find(m => m.id === mediaId);
      if (!mediaFile) return prev;

      if (mediaFile.type !== track.type) return prev;

      const framerate = mediaFile.framerate || prev.framerate || 30;
      const quantizedStartTime = Math.round(startTime * framerate) / framerate;

      const newClip: Clip = {
        id: crypto.randomUUID(),
        mediaId,
        startTime: quantizedStartTime,
        trimStart: 0,
        trimEnd: 0,
        effects: [],
        opacity: 1,
        speed: 1,
        reverse: false,
      };

      const updatedTracks = prev.tracks.map(t =>
        t.id === trackId
          ? { ...t, clips: [...t.clips, newClip] }
          : t
      );

      const duration = getProjectDuration(updatedTracks, prev.mediaFiles);

      return {
        ...prev,
        tracks: updatedTracks,
        duration,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const updateClip = useCallback((clipId: string, updates: Partial<Clip>) => {
    setProject(prev => {
      const clip = prev.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
      if (!clip) return prev;

      const mediaFile = prev.mediaFiles.find(m => m.id === clip.mediaId);
      if (!mediaFile) return prev;

      const framerate = mediaFile.framerate || prev.framerate || 30;

      const quantizedUpdates: Partial<Clip> = { ...updates };
      if (updates.startTime !== undefined) {
        quantizedUpdates.startTime = Math.round(updates.startTime * framerate) / framerate;
      }
      if (updates.trimStart !== undefined) {
        quantizedUpdates.trimStart = Math.round(updates.trimStart * framerate) / framerate;
      }
      if (updates.trimEnd !== undefined) {
        quantizedUpdates.trimEnd = Math.round(updates.trimEnd * framerate) / framerate;
      }

      const updatedTracks = prev.tracks.map(track => ({
        ...track,
        clips: track.clips.map(c =>
          c.id === clipId ? { ...c, ...quantizedUpdates } : c
        ),
      }));

      const duration = getProjectDuration(updatedTracks, prev.mediaFiles);

      return {
        ...prev,
        tracks: updatedTracks,
        duration,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const moveClipToTrack = useCallback((clipId: string, targetTrackId: string, newStartTime?: number) => {
    setProject(prev => {
      // Find the clip and its current track
      let sourceTrack: Track | undefined;
      let clip: Clip | undefined;
      for (const track of prev.tracks) {
        const found = track.clips.find(c => c.id === clipId);
        if (found) {
          clip = found;
          sourceTrack = track;
          break;
        }
      }

      if (!clip || !sourceTrack) return prev;

      const targetTrack = prev.tracks.find(t => t.id === targetTrackId);
      if (!targetTrack) return prev;

      // Only allow moving between tracks of the same type
      if (sourceTrack.type !== targetTrack.type) return prev;

      // If already on the target track, just update position if provided
      if (sourceTrack.id === targetTrackId) {
        if (newStartTime !== undefined) {
          return {
            ...prev,
            tracks: prev.tracks.map(track => ({
              ...track,
              clips: track.clips.map(c =>
                c.id === clipId ? { ...c, startTime: newStartTime } : c
              ),
            })),
            updatedAt: Date.now(),
          };
        }
        return prev;
      }

      // Move clip to target track
      const updatedClip = newStartTime !== undefined
        ? { ...clip, startTime: newStartTime }
        : clip;

      const updatedTracks = prev.tracks.map(track => {
        if (track.id === sourceTrack!.id) {
          return { ...track, clips: track.clips.filter(c => c.id !== clipId) };
        }
        if (track.id === targetTrackId) {
          return { ...track, clips: [...track.clips, updatedClip] };
        }
        return track;
      });

      const duration = getProjectDuration(updatedTracks, prev.mediaFiles);

      return {
        ...prev,
        tracks: updatedTracks,
        duration,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const deleteClip = useCallback((clipId: string, ripple: boolean = false) => {
    setProject(prev => {
      const clip = prev.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
      if (!clip) return prev;

      const mediaFile = prev.mediaFiles.find(m => m.id === clip.mediaId);
      if (!mediaFile) return prev;

      const clipDuration = getClipDuration(clip, mediaFile);
      const clipEndTime = getClipEndTime(clip, mediaFile);

      const updatedTracks = prev.tracks.map(track => {
        const clipIndex = track.clips.findIndex(c => c.id === clipId);
        if (clipIndex === -1) return track;

        const newClips = [...track.clips];
        newClips.splice(clipIndex, 1);

        if (ripple) {
          return {
            ...track,
            clips: newClips.map(c => {
              if (c.startTime > clip.startTime) {
                return { ...c, startTime: Math.max(0, c.startTime - clipDuration) };
              }
              return c;
            }),
          };
        }

        return { ...track, clips: newClips };
      });

      // Remove transitions associated with deleted clip
      const updatedTransitions = prev.transitions.filter(
        t => t.clipId !== clipId && t.targetClipId !== clipId
      );

      const duration = getProjectDuration(updatedTracks, prev.mediaFiles);

      return {
        ...prev,
        tracks: updatedTracks,
        transitions: updatedTransitions,
        duration,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const deleteClips = useCallback((clipIds: string[], ripple: boolean = false) => {
    clipIds.forEach(id => deleteClip(id, ripple));
  }, [deleteClip]);

  const closeGaps = useCallback((trackId: string) => {
    setProject(prev => {
      const track = prev.tracks.find(t => t.id === trackId);
      if (!track) return prev;

      const sortedClips = [...track.clips].sort((a, b) => a.startTime - b.startTime);
      let currentTime = 0;

      const newClips = sortedClips.map(clip => {
        const newStartTime = currentTime;
        const mediaFile = prev.mediaFiles.find(m => m.id === clip.mediaId);
        if (mediaFile) {
          currentTime += getClipDuration(clip, mediaFile);
        }
        return { ...clip, startTime: newStartTime };
      });

      const updatedTracks = prev.tracks.map(t =>
        t.id === trackId ? { ...t, clips: newClips } : t
      );

      const duration = getProjectDuration(updatedTracks, prev.mediaFiles);

      return {
        ...prev,
        tracks: updatedTracks,
        duration,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const duplicateClip = useCallback((clipId: string) => {
    setProject(prev => {
      const updatedTracks = prev.tracks.map(track => {
        const clipIndex = track.clips.findIndex(c => c.id === clipId);
        if (clipIndex === -1) return track;

        const clip = track.clips[clipIndex];
        const mediaFile = prev.mediaFiles.find(m => m.id === clip.mediaId);
        if (!mediaFile) return track;

        const newStartTime = getClipEndTime(clip, mediaFile);
        const newClip: Clip = {
          ...clip,
          id: crypto.randomUUID(),
          startTime: newStartTime,
        };

        const newClips = [...track.clips];
        newClips.splice(clipIndex + 1, 0, newClip);

        return { ...track, clips: newClips };
      });

      const duration = getProjectDuration(updatedTracks, prev.mediaFiles);

      return {
        ...prev,
        tracks: updatedTracks,
        duration,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const splitClip = useCallback((clipId: string, splitTime: number) => {
    setProject(prev => {
      const updatedTracks = prev.tracks.map(track => {
        const clipIndex = track.clips.findIndex(c => c.id === clipId);
        if (clipIndex === -1) return track;

        const clip = track.clips[clipIndex];
        const mediaFile = prev.mediaFiles.find(m => m.id === clip.mediaId);
        if (!mediaFile) return track;

        const framerate = mediaFile.framerate || prev.framerate || 30;
        const quantizedSplitTime = Math.round(splitTime * framerate) / framerate;

        const clipDuration = getClipDuration(clip, mediaFile);
        const relativeSplitTime = quantizedSplitTime - clip.startTime;

        if (relativeSplitTime <= 0 || relativeSplitTime >= clipDuration) {
          return track;
        }

        const firstClip: Clip = {
          ...clip,
          trimEnd: clip.trimEnd + (clipDuration - relativeSplitTime),
        };

        const secondClip: Clip = {
          ...clip,
          id: crypto.randomUUID(),
          startTime: quantizedSplitTime,
          trimStart: clip.trimStart + relativeSplitTime,
        };

        const newClips = [...track.clips];
        newClips[clipIndex] = firstClip;
        newClips.splice(clipIndex + 1, 0, secondClip);

        return { ...track, clips: newClips };
      });

      const duration = getProjectDuration(updatedTracks, prev.mediaFiles);

      return {
        ...prev,
        tracks: updatedTracks,
        duration,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const addTransition = useCallback((transition: Transition) => {
    setProject(prev => ({
      ...prev,
      transitions: [...prev.transitions, transition],
      updatedAt: Date.now(),
    }));
  }, []);

  const updateTransition = useCallback((transitionId: string, updates: Partial<Transition>) => {
    setProject(prev => ({
      ...prev,
      transitions: prev.transitions.map(t =>
        t.id === transitionId ? { ...t, ...updates } : t
      ),
      updatedAt: Date.now(),
    }));
  }, []);

  const removeTransition = useCallback((transitionId: string) => {
    setProject(prev => ({
      ...prev,
      transitions: prev.transitions.filter(t => t.id !== transitionId),
      updatedAt: Date.now(),
    }));
  }, []);

  const loadProject = useCallback((projectData: Project, relinkedFiles?: Map<string, File>) => {
    // Recreate blob URLs from stored File objects (blob URLs don't survive page reloads)
    const mediaFiles = projectData.mediaFiles.map(mf => {
      // First try relinked files (from JSON import where File objects are lost)
      if (relinkedFiles) {
        const file = relinkedFiles.get(mf.id) || relinkedFiles.get(mf.name);
        if (file) {
          return { ...mf, file, url: URL.createObjectURL(file) };
        }
      }
      // Then try existing File objects (from IndexedDB where File objects survive)
      if (mf.file instanceof File) {
        return { ...mf, url: URL.createObjectURL(mf.file) };
      }
      return mf;
    });

    setProject({
      ...projectData,
      mediaFiles,
      updatedAt: Date.now(),
    });
  }, []);

  const exportProject = useCallback((): string => {
    const serializable = {
      ...project,
      mediaFiles: project.mediaFiles.map(mf => ({
        id: mf.id,
        name: mf.name,
        type: mf.type,
        url: mf.url,
        duration: mf.duration,
        framerate: mf.framerate,
        width: mf.width,
        height: mf.height,
        thumbnail: mf.thumbnail,
        folder: mf.folder,
        tags: mf.tags,
      })),
    };
    return JSON.stringify(serializable, null, 2);
  }, [project]);

  return {
    project,
    addMediaFile,
    addTrack,
    deleteTrack,
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
  };
}
