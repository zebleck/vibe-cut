import { Keyframe } from '../types';

export function interpolateKeyframes(
  keyframes: Keyframe[],
  time: number,
  defaultValue: number = 0
): number {
  if (keyframes.length === 0) return defaultValue;
  
  // Sort keyframes by time
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  
  // Before first keyframe
  if (time < sorted[0].time) {
    return sorted[0].value;
  }
  
  // After last keyframe
  if (time >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value;
  }
  
  // Find surrounding keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    const kf1 = sorted[i];
    const kf2 = sorted[i + 1];
    
    if (time >= kf1.time && time < kf2.time) {
      const t = (time - kf1.time) / (kf2.time - kf1.time);
      const easedT = applyEasing(t, kf1.easing || 'linear');
      return kf1.value + (kf2.value - kf1.value) * easedT;
    }
  }
  
  return defaultValue;
}

function applyEasing(t: number, easing: string): number {
  switch (easing) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    default:
      return t;
  }
}

export function addKeyframe(keyframes: Keyframe[], time: number, value: number): Keyframe[] {
  const newKeyframe: Keyframe = {
    id: crypto.randomUUID(),
    time,
    value,
    easing: 'linear',
  };
  
  return [...keyframes, newKeyframe].sort((a, b) => a.time - b.time);
}

export function removeKeyframe(keyframes: Keyframe[], keyframeId: string): Keyframe[] {
  return keyframes.filter(kf => kf.id !== keyframeId);
}

export function updateKeyframe(
  keyframes: Keyframe[],
  keyframeId: string,
  updates: Partial<Keyframe>
): Keyframe[] {
  return keyframes.map(kf =>
    kf.id === keyframeId ? { ...kf, ...updates } : kf
  );
}

