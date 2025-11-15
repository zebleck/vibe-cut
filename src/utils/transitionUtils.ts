import { Transition, Clip } from '../types';

export function getTransitionOpacity(
  transition: Transition,
  clipTime: number,
  clipDuration: number
): number {
  if (transition.type === 'none') return 1;
  
  if (transition.position === 'start') {
    // Fade in at start
    if (transition.type === 'fade-in') {
      const progress = Math.min(clipTime / transition.duration, 1);
      return progress;
    }
  } else if (transition.position === 'end') {
    // Fade out at end
    if (transition.type === 'fade-out') {
      const timeFromEnd = clipDuration - clipTime;
      const progress = Math.min(timeFromEnd / transition.duration, 1);
      return progress;
    }
  }
  
  return 1;
}

export function getCrossfadeOpacity(
  transition: Transition,
  clipTime: number,
  clipDuration: number,
  targetClipTime: number
): { sourceOpacity: number; targetOpacity: number } {
  if (transition.type !== 'crossfade' || transition.position !== 'between') {
    return { sourceOpacity: 1, targetOpacity: 0 };
  }
  
  // Crossfade happens at the end of source clip
  const timeFromEnd = clipDuration - clipTime;
  const fadeProgress = Math.min(timeFromEnd / transition.duration, 1);
  
  return {
    sourceOpacity: fadeProgress,
    targetOpacity: 1 - fadeProgress,
  };
}

export function createTransition(
  type: TransitionType,
  clipId: string,
  duration: number,
  position: 'start' | 'end' | 'between' = 'start',
  targetClipId?: string
): Transition {
  return {
    id: crypto.randomUUID(),
    type,
    duration,
    clipId,
    position,
    targetClipId,
  };
}

