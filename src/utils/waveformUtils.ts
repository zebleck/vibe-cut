export async function generateWaveform(audioBuffer: AudioBuffer, width: number): Promise<Float32Array> {
  const samples = audioBuffer.getChannelData(0);
  const blockSize = Math.floor(samples.length / width);
  const waveform = new Float32Array(width);

  for (let i = 0; i < width; i++) {
    let sum = 0;
    const start = i * blockSize;
    const end = Math.min(start + blockSize, samples.length);
    
    for (let j = start; j < end; j++) {
      sum += Math.abs(samples[j]);
    }
    
    waveform[i] = sum / (end - start);
  }

  return waveform;
}

export async function loadAudioBuffer(file: File): Promise<AudioBuffer> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}

