import { useEffect, useRef, useState } from 'react';
import { Project } from '../types';
import { findClipAtTime } from '../utils/timelineUtils';

interface VideoPreviewProps {
  project: Project;
  currentTime: number;
  isPlaying: boolean;
}

export function VideoPreview({ project, currentTime, isPlaying }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [hasVideoAtTime, setHasVideoAtTime] = useState(false);
  const currentMediaIdRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

  useEffect(() => {
    const videoTracks = project.tracks.filter(t => t.type === 'video');
    const audioTracks = project.tracks.filter(t => t.type === 'audio');

    // Find clips at current time - search all tracks (first track with a clip wins)
    let videoClip = null;
    for (const track of videoTracks) {
      const clip = findClipAtTime(track, currentTime, project.mediaFiles);
      if (clip) {
        videoClip = clip;
        break;
      }
    }

    let audioClip = null;
    for (const track of audioTracks) {
      const clip = findClipAtTime(track, currentTime, project.mediaFiles);
      if (clip) {
        audioClip = clip;
        break;
      }
    }

    // Update video
    if (videoRef.current && videoClip) {
      const mediaFile = project.mediaFiles.find(m => m.id === videoClip.mediaId);
      if (mediaFile) {
        setHasVideoAtTime(true);
        const clipTime = currentTime - videoClip.startTime + videoClip.trimStart;

        try {
          // Check if we need to change the source (compare by mediaId, not URL string)
          if (currentMediaIdRef.current !== mediaFile.id) {
            currentMediaIdRef.current = mediaFile.id;
            pendingSeekRef.current = clipTime;
            videoRef.current.src = mediaFile.url;
            videoRef.current.load();
          } else if (videoRef.current.readyState >= 1) {
            // Only seek if video is ready and time difference is significant
            if (Math.abs(videoRef.current.currentTime - clipTime) > 0.05) {
              videoRef.current.currentTime = clipTime;
            }
          } else {
            // Store pending seek for when video loads
            pendingSeekRef.current = clipTime;
          }
        } catch (error) {
          console.warn('Error updating video preview:', error);
        }
      }
    } else {
      setHasVideoAtTime(false);
      currentMediaIdRef.current = null;
      pendingSeekRef.current = null;
      if (videoRef.current && videoRef.current.src) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
    }

    // Update audio
    if (audioRef.current && audioClip) {
      const mediaFile = project.mediaFiles.find(m => m.id === audioClip.mediaId);
      if (mediaFile && mediaFile.type === 'audio') {
        try {
          if (!audioRef.current.src.includes(mediaFile.id)) {
            audioRef.current.src = mediaFile.url;
            audioRef.current.load();
          }
          const clipTime = currentTime - audioClip.startTime + audioClip.trimStart;
          if (audioRef.current.readyState >= 1) {
            if (Math.abs(audioRef.current.currentTime - clipTime) > 0.05) {
              audioRef.current.currentTime = clipTime;
            }
          }
        } catch (error) {
          console.warn('Error updating audio preview:', error);
        }
      }
    } else if (audioRef.current && audioRef.current.src) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
  }, [project, currentTime]);

  // Handle pending seek when video loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (pendingSeekRef.current !== null) {
        video.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play().catch(console.error);
      } else {
        videoRef.current.pause();
      }
    }
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(console.error);
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying]);

  return (
    <div className="video-preview">
      {!hasVideoAtTime && <div className="video-preview-black" />}
      <video ref={videoRef} muted style={{ display: hasVideoAtTime ? 'block' : 'none' }} />
      <audio ref={audioRef} />
    </div>
  );
}

