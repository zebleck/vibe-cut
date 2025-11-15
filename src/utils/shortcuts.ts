export type ShortcutAction =
  | 'split'
  | 'select'
  | 'duplicate'
  | 'delete'
  | 'play-pause'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'frame-left'
  | 'frame-right'
  | 'home'
  | 'end';

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: ShortcutAction;
}

export const defaultShortcuts: Shortcut[] = [
  { key: 's', action: 'split' },
  { key: 'v', action: 'select' },
  { key: 'd', action: 'duplicate' },
  { key: 'Delete', action: 'delete' },
  { key: 'Backspace', action: 'delete' },
  { key: ' ', action: 'play-pause' },
  { key: 'z', ctrl: true, action: 'undo' },
  { key: 'y', ctrl: true, action: 'redo' },
  { key: 'z', ctrl: true, shift: true, action: 'redo' },
  { key: '=', ctrl: true, action: 'zoom-in' },
  { key: '-', ctrl: true, action: 'zoom-out' },
  { key: 'ArrowLeft', action: 'frame-left' },
  { key: 'ArrowRight', action: 'frame-right' },
  { key: 'Home', action: 'home' },
  { key: 'End', action: 'end' },
];

export function matchShortcut(
  event: KeyboardEvent,
  shortcuts: Shortcut[]
): Shortcut | null {
  return shortcuts.find(shortcut => {
    const keyMatch = shortcut.key.toLowerCase() === event.key.toLowerCase();
    const ctrlMatch = !!shortcut.ctrl === (event.ctrlKey || event.metaKey);
    const shiftMatch = !!shortcut.shift === event.shiftKey;
    const altMatch = !!shortcut.alt === event.altKey;
    
    return keyMatch && ctrlMatch && shiftMatch && altMatch;
  }) || null;
}

