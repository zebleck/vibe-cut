export async function generateThumbnail(videoFile: File, time: number = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(videoFile);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.src = '';
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    // Timeout to prevent hanging on problematic videos
    timeoutId = setTimeout(() => {
      settle(() => reject(new Error('Thumbnail generation timed out')));
    }, 10000);

    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      // Only set currentTime after metadata is loaded
      video.currentTime = Math.min(time, video.duration || 0);
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.8);
        settle(() => resolve(thumbnail));
      } else {
        settle(() => reject(new Error('Could not get canvas context')));
      }
    };

    video.onerror = () => {
      settle(() => reject(new Error('Failed to load video for thumbnail')));
    };

    video.src = url;
  });
}

