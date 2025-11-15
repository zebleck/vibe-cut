export type MediaType = 'video' | 'audio';
export type TransitionType = 'fade-in' | 'fade-out' | 'crossfade' | 'none';
export type EffectType = 'brightness' | 'contrast' | 'saturation' | 'speed' | 'reverse';

export interface MediaFile {
  id: string;
  name: string;
  type: MediaType;
  file: File;
  url: string;
  duration: number; // in seconds
  framerate?: number; // frames per second for video
  width?: number; // video width
  height?: number; // video height
  waveform?: Float32Array; // audio waveform data
  thumbnail?: string; // base64 thumbnail for video
  folder?: string; // folder/group for media bin
  tags?: string[]; // tags for organization
}

export interface Keyframe {
  id: string;
  time: number; // time in seconds relative to clip start
  value: number; // keyframe value
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  keyframes: Keyframe[]; // keyframes for animated effects
  value: number; // base value (0-100 for adjustments, multiplier for speed)
}

export interface Transition {
  id: string;
  type: TransitionType;
  duration: number; // transition duration in seconds
  clipId: string; // clip this transition applies to
  position: 'start' | 'end' | 'between'; // transition position
  targetClipId?: string; // for crossfade, the target clip
}

export interface Clip {
  id: string;
  mediaId: string;
  startTime: number; // position on timeline in seconds
  trimStart: number; // trim offset from start in seconds (frame-quantized)
  trimEnd: number; // trim offset from end in seconds (frame-quantized)
  effects: Effect[]; // applied effects
  opacity: number; // clip opacity (0-1)
  opacityKeyframes?: Keyframe[]; // opacity animation keyframes
  speed: number; // playback speed multiplier (1.0 = normal, 2.0 = 2x speed)
  reverse: boolean; // reverse playback
  transform?: {
    x: number; // position x offset
    y: number; // position y offset
    scaleX: number; // horizontal scale
    scaleY: number; // vertical scale
    rotation: number; // rotation in degrees
    keyframes?: Keyframe[]; // transform animation keyframes
  };
}

export interface Track {
  id: string;
  type: MediaType;
  clips: Clip[];
  locked?: boolean; // lock track from editing
  muted?: boolean; // mute track during playback
  volume: number; // track volume (0-1)
}

export interface Project {
  id: string;
  name: string;
  mediaFiles: MediaFile[];
  tracks: Track[];
  transitions: Transition[]; // global transitions registry
  duration: number; // total project duration in seconds
  framerate?: number; // project framerate (defaults to 30)
  settings?: {
    snapTolerance: number; // magnetic snap tolerance in pixels
    autoSave: boolean; // auto-save enabled
    defaultTransitionDuration: number; // default transition duration
  };
  version: string; // project file version
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
}

export interface TimelineState {
  playhead: number; // current playhead position in seconds
  isPlaying: boolean;
  zoom: number; // pixels per second
  scrollX: number; // horizontal scroll position
  selectedClipIds: string[]; // multi-select support
  snapEnabled: boolean; // snapping toggle
  snapThreshold: number; // pixels threshold for snapping
  selectedTrackId?: string; // selected track
}

export interface Command {
  execute: () => void;
  undo: () => void;
  description: string;
}

export interface RenderSettings {
  width: number;
  height: number;
  bitrate: number; // kbps
  framerate: number;
  format: 'mp4' | 'webm';
  quality?: 'low' | 'medium' | 'high';
}

export interface RenderProgress {
  stage: 'preparing' | 'rendering' | 'encoding' | 'finalizing' | 'complete';
  progress: number; // 0-100
  message: string;
  currentFrame?: number;
  totalFrames?: number;
}

export interface MediaBinGroup {
  id: string;
  name: string;
  mediaIds: string[];
  collapsed?: boolean;
}
