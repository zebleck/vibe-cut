import { useEffect, useRef, useState, useMemo } from 'react';
import { Project, Clip, MediaFile } from '../types';
import { findClipAtTime } from '../utils/timelineUtils';

interface VideoPreviewProps {
  project: Project;
  currentTime: number;
  isPlaying: boolean;
}

// During playback, only seek if drift exceeds this (avoids fighting the native decoder)
const DRIFT_THRESHOLD = 0.3;
// When scrubbing (paused), seek more precisely
const SCRUB_THRESHOLD = 0.05;

function getPreviewTime(
  clip: Clip,
  mediaFile: MediaFile,
  timelineTime: number
): { clipTime: number; speed: number } {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const timelineOffset = Math.max(0, timelineTime - clip.startTime);
  const sourceOffset = timelineOffset * speed;
  const sourceStart = clip.trimStart;
  const sourceEnd = Math.max(sourceStart, mediaFile.duration - clip.trimEnd);
  const clipTime = clip.reverse
    ? Math.max(sourceStart, sourceEnd - sourceOffset)
    : Math.min(sourceEnd, sourceStart + sourceOffset);
  return { clipTime, speed };
}

export function VideoPreview({ project, currentTime, isPlaying }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [hasVideoAtTime, setHasVideoAtTime] = useState(false);
  const currentMediaIdRef = useRef<string | null>(null);
  const currentAudioIdRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingAudioSeekRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);

  // Pre-build a media lookup map to avoid .find() on every frame
  const mediaMap = useMemo(() => {
    const map = new Map<string, MediaFile>();
    for (const mf of project.mediaFiles) {
      map.set(mf.id, mf);
    }
    return map;
  }, [project.mediaFiles]);
  const clipMap = useMemo(() => {
    const map = new Map<string, Clip>();
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        map.set(clip.id, clip);
      }
    }
    return map;
  }, [project.tracks]);

  // Memoize track lists
  const videoTracks = useMemo(
    () => project.tracks.filter(t => t.type === 'video'),
    [project.tracks]
  );
  const audioTracks = useMemo(
    () => project.tracks.filter(t => t.type === 'audio'),
    [project.tracks]
  );

  // Find the current video clip and compute the clip-local time
  const videoClipInfo = useMemo(() => {
    for (const track of videoTracks) {
      const clip = findClipAtTime(track, currentTime, project.mediaFiles);
      if (clip) {
        const mediaFile = mediaMap.get(clip.mediaId);
        if (mediaFile) {
          const { clipTime, speed } = getPreviewTime(clip, mediaFile, currentTime);
          return { clip, mediaFile, clipTime, speed };
        }
      }
    }
    return null;
  }, [videoTracks, currentTime, project.mediaFiles, mediaMap]);

  const audioClipInfo = useMemo(() => {
    // Prefer linked audio for the active video clip to keep preview deterministic.
    if (videoClipInfo?.clip.linkedClipId) {
      const linked = clipMap.get(videoClipInfo.clip.linkedClipId);
      if (linked) {
        const linkedMedia = mediaMap.get(linked.mediaId);
        if (linkedMedia && linkedMedia.type === 'audio') {
          const linkedSpeed = linked.speed && linked.speed > 0 ? linked.speed : 1;
          const linkedDuration = Math.max(0, linkedMedia.duration - linked.trimStart - linked.trimEnd) / linkedSpeed;
          const inLinkedRange =
            currentTime >= linked.startTime &&
            currentTime < linked.startTime + linkedDuration;
          if (inLinkedRange) {
            const { clipTime, speed } = getPreviewTime(linked, linkedMedia, currentTime);
            return { clip: linked, mediaFile: linkedMedia, clipTime, speed };
          }
        }
      }
    }

    // Fallback: first audio clip covering current time.
    for (const track of audioTracks) {
      const clip = findClipAtTime(track, currentTime, project.mediaFiles);
      if (clip) {
        const mediaFile = mediaMap.get(clip.mediaId);
        if (mediaFile && mediaFile.type === 'audio') {
          const { clipTime, speed } = getPreviewTime(clip, mediaFile, currentTime);
          return { clip, mediaFile, clipTime, speed };
        }
      }
    }

    return null;
  }, [audioTracks, currentTime, project.mediaFiles, mediaMap, videoClipInfo, clipMap]);

  // Handle video source changes and seeking
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (videoClipInfo) {
      const { mediaFile, clipTime, speed } = videoClipInfo;
      setHasVideoAtTime(true);

      try {
        // Source changed - load new media
        if (currentMediaIdRef.current !== mediaFile.id) {
          currentMediaIdRef.current = mediaFile.id;
          pendingSeekRef.current = clipTime;
          video.src = mediaFile.url;
          video.load();
        } else if (video.readyState >= 1) {
          const drift = Math.abs(video.currentTime - clipTime);
          const threshold = isPlaying ? DRIFT_THRESHOLD : SCRUB_THRESHOLD;
          if (drift > threshold) {
            video.currentTime = clipTime;
          }
        } else {
          pendingSeekRef.current = clipTime;
        }
        video.playbackRate = speed;
      } catch (error) {
        console.warn('Error updating video preview:', error);
      }
    } else {
      setHasVideoAtTime(false);
      currentMediaIdRef.current = null;
      pendingSeekRef.current = null;
      if (video.src) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    }
  }, [videoClipInfo, isPlaying]);

  // Handle audio source changes and seeking
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audioClipInfo) {
      const { mediaFile, clipTime, speed } = audioClipInfo;

      try {
        if (currentAudioIdRef.current !== mediaFile.id) {
          currentAudioIdRef.current = mediaFile.id;
          pendingAudioSeekRef.current = clipTime;
          audio.src = mediaFile.url;
          audio.load();
        } else if (audio.readyState >= 1) {
          const drift = Math.abs(audio.currentTime - clipTime);
          const threshold = isPlaying ? DRIFT_THRESHOLD : SCRUB_THRESHOLD;
          if (drift > threshold) {
            audio.currentTime = clipTime;
          }
        } else {
          pendingAudioSeekRef.current = clipTime;
        }
        audio.playbackRate = speed;
      } catch (error) {
        console.warn('Error updating audio preview:', error);
      }
    } else {
      currentAudioIdRef.current = null;
      pendingAudioSeekRef.current = null;
      if (audio.src) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    }
  }, [audioClipInfo, isPlaying]);

  // Handle pending seek when video metadata loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (pendingSeekRef.current !== null) {
        video.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
      // If we were playing when the source changed, resume playback
      if (wasPlayingRef.current) {
        video.play().catch(console.error);
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, []);

  // Handle pending seek when audio metadata loads
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      if (pendingAudioSeekRef.current !== null) {
        audio.currentTime = pendingAudioSeekRef.current;
        pendingAudioSeekRef.current = null;
      }
      if (wasPlayingRef.current) {
        audio.play().catch(console.error);
      }
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, []);

  // Play/pause control
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    wasPlayingRef.current = isPlaying;

    if (isPlaying) {
      if (video && videoClipInfo && video.readyState >= 1) {
        // Sync position before starting playback
        const drift = Math.abs(video.currentTime - videoClipInfo.clipTime);
        if (drift > SCRUB_THRESHOLD) {
          video.currentTime = videoClipInfo.clipTime;
        }
        video.play().catch(console.error);
      }
      if (audio && audioClipInfo && audio.readyState >= 1) {
        const drift = Math.abs(audio.currentTime - audioClipInfo.clipTime);
        if (drift > SCRUB_THRESHOLD) {
          audio.currentTime = audioClipInfo.clipTime;
        }
        audio.play().catch(console.error);
      }
    } else {
      video?.pause();
      audio?.pause();
    }
  }, [isPlaying]); // intentionally only depend on isPlaying

  return (
    <div className="video-preview">
      {!hasVideoAtTime && <div className="video-preview-black" />}
      <video ref={videoRef} muted style={{ display: hasVideoAtTime ? 'block' : 'none' }} />
      <audio ref={audioRef} />
    </div>
  );
}
