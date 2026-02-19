# Vibe Video Editor Pro

A professional-grade video editor built with React, TypeScript, and Vite. Edit videos and audio in your browser with advanced timeline-based editing, effects, transitions, and client-side rendering.

## 🎬 Professional Features

### Advanced Timeline & Editing
- **Multiple Tracks**: Unlimited video and audio tracks
- **Frame-Perfect Editing**: All operations quantized to source framerate
- **Magnetic Snapping**: Adjustable snap tolerance for precise alignment
- **Multi-Select**: Select multiple clips with Shift/Ctrl+Click
- **Ripple Delete**: Delete clips and automatically shift remaining content
- **Gap Closing**: Automatically remove gaps in tracks
- **Virtualized Timeline**: Smooth performance with thousands of clips

### Transition System
- **Fade In/Out**: Smooth opacity transitions
- **Crossfade**: Blend between clips
- **Visual Handles**: Adjust transition duration with intuitive controls
- **Transition Metadata**: Transitions stored as timeline nodes

### Effects System
- **Color Adjustments**: Brightness, contrast, and saturation controls
- **Speed Changes**: Time stretch/compress (0.25x to 4x)
- **Reverse Playback**: Play clips backwards
- **Keyframe Animation**: Animate opacity, transforms, and effects over time
- **Real-time Preview**: See effects applied instantly

### Media & Asset Management
- **Media Bin Panel**: Organized media library with thumbnails
- **Folder Grouping**: Organize media into folders
- **Search & Tags**: Find media quickly with search and tags
- **Drag & Drop**: Drop media directly from bin to timeline tracks
- **Metadata Display**: View duration, resolution, and other properties

### Rendering Pipeline
- **ffmpeg.wasm Integration**: Full client-side video rendering
- **Clip Stitching**: Seamlessly combine clips
- **Audio Mixing**: Mix multiple audio tracks
- **Video Compositing**: Layer multiple video tracks
- **Progress Callbacks**: Real-time rendering progress updates
- **Background Worker**: UI stays responsive during rendering
- **Output Settings**: Configure resolution, bitrate, framerate, format

### Precision Tools
- **Magnetic Snapping**: Adjustable tolerance for clip alignment
- **Frame-Accurate Stepping**: Arrow keys for frame-by-frame navigation
- **Keyboard Shortcuts**: Professional editing shortcuts
  - `S` - Split clip at playhead
  - `V` - Select tool
  - `D` - Duplicate clip
  - `Delete` - Delete selected clips
  - `Space` - Play/Pause
  - `Ctrl+Z` - Undo
  - `Ctrl+Y` - Redo
  - `Ctrl+Plus/Minus` - Zoom in/out
  - `Arrow Left/Right` - Frame step
  - `Home/End` - Jump to start/end

### Project System
- **Full Export/Import**: Save complete projects with all metadata
- **Media References**: Projects store references to imported media
- **Timeline Structure**: Complete timeline state preservation
- **Transitions & Effects**: All effects and transitions saved
- **Editor Settings**: Snap tolerance, auto-save preferences
- **IndexedDB Auto-Save**: Automatic project saving to browser storage
- **Version Control**: Project file versioning

## 🚀 Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Optional: Python Renderer (recommended for sync + speed)

Run a local Python service that uses native FFmpeg:

```bash
python -m pip install -r python-renderer/requirements.txt
python python-renderer/server.py
```

Then in the app, set **Render Engine** to `Python + native FFmpeg (recommended)`.

### Build

```bash
npm run build
```

## 📖 Usage Guide

### Basic Editing
1. **Import Media**: Drag & drop or click to import video/audio files
2. **Add to Timeline**: Drag from media bin or click "Add to Track" buttons
3. **Edit Clips**:
   - **Move**: Drag clips horizontally
   - **Trim**: Drag clip edges (frame-perfect)
   - **Split**: Press `S` or right-click → Split at Playhead
   - **Duplicate**: Press `D` or right-click → Duplicate
   - **Multi-select**: Hold Shift/Ctrl and click clips

### Applying Effects
1. Select a clip on the timeline
2. Switch to "Effects" tab in sidebar
3. Add effects: Brightness, Contrast, Saturation
4. Adjust speed: Use speed slider (0.25x - 4x)
5. Toggle reverse: Check "Reverse" checkbox
6. Adjust opacity: Use opacity slider

### Adding Transitions
1. Select a clip
2. Switch to "Transitions" tab
3. Choose transition type: Fade In, Fade Out, or Crossfade
4. Adjust duration with slider
5. Transitions appear as visual handles on clips

### Rendering
1. Configure render settings:
   - Resolution (1920x1080, 1280x720, etc.)
   - Bitrate (1000-20000 kbps)
   - Framerate (24, 30, 60 fps)
   - Format (MP4, WebM)
2. Click "Render Video"
3. Monitor progress in real-time
4. Download rendered file when complete

### Keyboard Shortcuts
- `S` - Split clip at playhead
- `V` - Select tool
- `D` - Duplicate selected clip(s)
- `Delete` / `Backspace` - Delete selected clip(s)
- `Space` - Play/Pause
- `Ctrl+Z` - Undo
- `Ctrl+Y` / `Ctrl+Shift+Z` - Redo
- `Ctrl+Plus` - Zoom in
- `Ctrl+Minus` - Zoom out
- `Arrow Left` - Step back one frame
- `Arrow Right` - Step forward one frame
- `Home` - Jump to start
- `End` - Jump to end

## 🏗️ Architecture

### Component Structure
```
src/
├── components/
│   ├── Timeline.tsx          # Main timeline with virtualization
│   ├── TimelineTrack.tsx      # Individual track component
│   ├── TimelineClip.tsx       # Clip with transitions/effects
│   ├── MediaBin.tsx           # Media library with thumbnails
│   ├── EffectsPanel.tsx       # Effects controls
│   ├── TransitionsPanel.tsx   # Transition controls
│   ├── RenderPanel.tsx        # Rendering settings & progress
│   ├── PlaybackControls.tsx   # Enhanced playback controls
│   └── VideoPreview.tsx       # Preview with effects/transitions
├── hooks/
│   ├── useProject.ts          # Project state management
│   ├── useUndoRedo.ts         # Undo/redo system
│   └── useRecording.ts        # Voice recording
├── utils/
│   ├── renderer.ts            # ffmpeg.wasm rendering pipeline
│   ├── transitionUtils.ts     # Transition calculations
│   ├── effectUtils.ts         # Effect application
│   ├── keyframeUtils.ts       # Keyframe interpolation
│   ├── snappingUtils.ts       # Magnetic snapping
│   ├── shortcuts.ts           # Keyboard shortcuts
│   └── indexedDB.ts           # Auto-save system
└── types.ts                   # TypeScript definitions
```

### Key Technologies
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **ffmpeg.wasm** - Client-side video processing
- **IndexedDB** - Browser storage for auto-save
- **Web Audio API** - Audio processing
- **Canvas API** - Waveform rendering

## 🎯 Performance Optimizations

- **Virtualized Timeline**: Only renders visible clips
- **Throttled Scrubbing**: Smooth preview during scrubbing
- **Preview Buffering**: Pre-buffers frames for smooth playback
- **Efficient Rendering**: Optimized clip UI rendering
- **Background Workers**: Rendering doesn't block UI

## 📦 Project File Format

Projects are saved as JSON with the following structure:
```json
{
  "id": "project-id",
  "name": "Project Name",
  "version": "2.0.0",
  "framerate": 30,
  "mediaFiles": [...],
  "tracks": [...],
  "transitions": [...],
  "settings": {
    "snapTolerance": 10,
    "autoSave": true,
    "defaultTransitionDuration": 0.5
  },
  "createdAt": 1234567890,
  "updatedAt": 1234567890
}
```

## 🌐 Browser Compatibility

Requires modern browser with support for:
- HTML5 Video/Audio APIs
- MediaRecorder API
- IndexedDB
- Web Workers
- ES6+ JavaScript
- Canvas API
- WebAssembly (for ffmpeg.wasm)

## 🔧 Development

### Adding New Effects
1. Add effect type to `EffectType` in `types.ts`
2. Implement effect logic in `effectUtils.ts`
3. Add UI controls in `EffectsPanel.tsx`
4. Update preview rendering in `VideoPreview.tsx`

### Adding New Transitions
1. Add transition type to `TransitionType` in `types.ts`
2. Implement transition logic in `transitionUtils.ts`
3. Add UI controls in `TransitionsPanel.tsx`
4. Update clip rendering to show transition handles

## 📝 License

MIT License - feel free to use and modify

## 🙏 Acknowledgments

- ffmpeg.wasm for client-side video processing
- React team for the excellent framework
- All contributors and testers
