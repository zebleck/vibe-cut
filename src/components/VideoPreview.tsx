import { useEffect, useRef } from 'react';
import { Project } from '../types';
import { findClipAtTime, getClipDuration } from '../utils/timelineUtils';

interface VideoPreviewProps {
  project: Project;
  currentTime: number;
  isPlaying: boolean;
}

export function VideoPreview({ project, currentTime, isPlaying }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const videoTrack = project.tracks.find(t => t.type === 'video');
    const audioTrack = project.tracks.find(t => t.type === 'audio');

    // Find clips at current time
    const videoClip = videoTrack ? findClipAtTime(videoTrack, currentTime, project.mediaFiles) : null;
    const audioClip = audioTrack ? findClipAtTime(audioTrack, currentTime, project.mediaFiles) : null;

    // Update video
    if (videoRef.current && videoClip) {
      const mediaFile = project.mediaFiles.find(m => m.id === videoClip.mediaId);
      if (mediaFile) {
        if (videoRef.current.src !== mediaFile.url) {
          videoRef.current.src = mediaFile.url;
        }
        const clipTime = currentTime - videoClip.startTime + videoClip.trimStart;
        if (Math.abs(videoRef.current.currentTime - clipTime) > 0.1) {
          videoRef.current.currentTime = clipTime;
        }
      }
    } else if (videoRef.current) {
      videoRef.current.src = '';
    }

    // Update audio
    if (audioRef.current && audioClip) {
      const mediaFile = project.mediaFiles.find(m => m.id === audioClip.mediaId);
      if (mediaFile && mediaFile.type === 'audio') {
        if (audioRef.current.src !== mediaFile.url) {
          audioRef.current.src = mediaFile.url;
        }
        const clipTime = currentTime - audioClip.startTime + audioClip.trimStart;
        if (Math.abs(audioRef.current.currentTime - clipTime) > 0.1) {
          audioRef.current.currentTime = clipTime;
        }
      }
    } else if (audioRef.current) {
      audioRef.current.src = '';
    }
  }, [project, currentTime]);

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
      <video ref={videoRef} muted />
      <audio ref={audioRef} />
    </div>
  );
}

