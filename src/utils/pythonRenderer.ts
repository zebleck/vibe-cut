import { Project, RenderProgress, RenderSettings } from '../types';

const PYTHON_RENDER_URL = 'http://127.0.0.1:8765';
const REQUIRED_PYTHON_RENDERER_VERSION = '2026-03-01-text-v1';

type PythonHealth = {
  status: string;
  version?: string;
};

export async function getPythonRendererHealth(signal?: AbortSignal): Promise<PythonHealth | null> {
  try {
    const resp = await fetch(`${PYTHON_RENDER_URL}/health`, { method: 'GET', signal });
    if (!resp.ok) return null;
    return await resp.json() as PythonHealth;
  } catch {
    return null;
  }
}

export async function renderWithPythonService(
  project: Project,
  settings: RenderSettings,
  onProgress?: (progress: RenderProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const health = await getPythonRendererHealth(signal);
  if (!health) {
    throw new Error(
      'Python renderer is not reachable. Start it with:\npython python-renderer/server.py'
    );
  }
  if (health.version !== REQUIRED_PYTHON_RENDERER_VERSION) {
    throw new Error(
      `Python renderer version mismatch (server=${health.version ?? 'unknown'}, required=${REQUIRED_PYTHON_RENDERER_VERSION}). ` +
      'Please restart the Python renderer:\npython python-renderer/server.py'
    );
  }

  onProgress?.({
    stage: 'preparing',
    progress: 5,
    message: 'Checking Python renderer...',
  });

  const form = new FormData();

  const serializableProject = {
    id: project.id,
    name: project.name,
    duration: project.duration,
    framerate: project.framerate ?? 30,
    tracks: project.tracks.map(t => ({
      id: t.id,
      type: t.type,
      clips: t.clips.map(c => ({
        id: c.id,
        mediaId: c.mediaId,
        linkedClipId: c.linkedClipId,
        startTime: c.startTime,
        trimStart: c.trimStart,
        trimEnd: c.trimEnd,
        speed: c.speed,
        reverse: c.reverse,
        textOverlay: c.textOverlay
          ? {
              content: c.textOverlay.content,
              duration: c.textOverlay.duration,
              x: c.textOverlay.x,
              y: c.textOverlay.y,
              fontSize: c.textOverlay.fontSize,
              color: c.textOverlay.color,
              fontFamily: c.textOverlay.fontFamily,
              fontWeight: c.textOverlay.fontWeight,
              fontStyle: c.textOverlay.fontStyle,
              backgroundColor: c.textOverlay.backgroundColor,
              align: c.textOverlay.align,
            }
          : undefined,
      })),
    })),
    mediaFiles: project.mediaFiles.map(m => ({
      id: m.id,
      name: m.name,
      type: m.type,
      url: m.url,
      duration: m.duration,
    })),
  };

  console.log('Sending project to Python renderer:', JSON.stringify(serializableProject, null, 2));

  form.append('project', JSON.stringify(serializableProject));
  form.append('settings', JSON.stringify(settings));

  onProgress?.({
    stage: 'preparing',
    progress: 10,
    message: 'Uploading media to Python renderer...',
  });

  for (const media of project.mediaFiles) {
    const file = media.file instanceof File
      ? media.file
      : new File([await (await fetch(media.url, { signal })).blob()], media.name);
    form.append(`media_${media.id}`, file, media.name);
  }

  onProgress?.({
    stage: 'encoding',
    progress: 20,
    message: 'Rendering with native FFmpeg...',
  });

  const resp = await fetch(`${PYTHON_RENDER_URL}/render`, {
    method: 'POST',
    body: form,
    signal,
  });

  if (!resp.ok) {
    const msg = await resp.text();
    throw new Error(`Python renderer failed: ${msg}`);
  }

  onProgress?.({
    stage: 'finalizing',
    progress: 95,
    message: 'Downloading rendered file...',
  });

  return await resp.blob();
}

