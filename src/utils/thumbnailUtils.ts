export async function generateThumbnail(videoFile: File, time: number = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.currentTime = time;
    
    video.onloadedmetadata = () => {
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
        resolve(thumbnail);
      } else {
        reject(new Error('Could not get canvas context'));
      }
    };
    
    video.onerror = reject;
    video.src = URL.createObjectURL(videoFile);
  });
}

