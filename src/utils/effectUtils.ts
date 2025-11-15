import { Effect, Keyframe } from '../types';
import { interpolateKeyframes } from './keyframeUtils';

export function applyEffect(effect: Effect, time: number): number {
  if (!effect.enabled) {
    return effect.type === 'speed' ? 1.0 : 0; // speed defaults to 1.0, others to 0
  }
  
  if (effect.keyframes.length > 0) {
    return interpolateKeyframes(effect.keyframes, time, effect.value);
  }
  
  return effect.value;
}

export function applyBrightness(value: number): string {
  // CSS filter brightness: 0 = black, 1 = normal, >1 = brighter
  const brightness = 1 + (value / 100);
  return `brightness(${brightness})`;
}

export function applyContrast(value: number): string {
  // CSS filter contrast: 0 = no contrast, 1 = normal, >1 = more contrast
  const contrast = 1 + (value / 100);
  return `contrast(${contrast})`;
}

export function applySaturation(value: number): string {
  // CSS filter saturate: 0 = grayscale, 1 = normal, >1 = more saturated
  const saturation = 1 + (value / 100);
  return `saturate(${saturation})`;
}

export function getEffectCSS(effects: Effect[], time: number): string {
  const filters: string[] = [];
  
  effects.forEach(effect => {
    if (!effect.enabled) return;
    
    const value = applyEffect(effect, time);
    
    switch (effect.type) {
      case 'brightness':
        filters.push(applyBrightness(value));
        break;
      case 'contrast':
        filters.push(applyContrast(value));
        break;
      case 'saturation':
        filters.push(applySaturation(value));
        break;
    }
  });
  
  return filters.join(' ');
}

export function createEffect(type: EffectType, value: number = 0): Effect {
  return {
    id: crypto.randomUUID(),
    type,
    enabled: true,
    keyframes: [],
    value,
  };
}

