export async function generateWaveform(audioBuffer: AudioBuffer, width: number): Promise<Float32Array> {
  const samples = audioBuffer.getChannelData(0);

  // Handle edge case: no samples or invalid width
  if (samples.length === 0 || width <= 0) {
    return new Float32Array(width > 0 ? width : 0);
  }

  // Limit width to sample count to avoid division by zero
  const effectiveWidth = Math.min(width, samples.length);
  const blockSize = Math.max(1, Math.floor(samples.length / effectiveWidth));
  const waveform = new Float32Array(width);

  for (let i = 0; i < effectiveWidth; i++) {
    let sum = 0;
    const start = i * blockSize;
    const end = Math.min(start + blockSize, samples.length);
    const count = end - start;

    for (let j = start; j < end; j++) {
      sum += Math.abs(samples[j]);
    }

    waveform[i] = count > 0 ? sum / count : 0;
  }

  // Fill remaining slots with 0 if width > samples.length
  for (let i = effectiveWidth; i < width; i++) {
    waveform[i] = 0;
  }

  return waveform;
}

export async function loadAudioBuffer(file: File): Promise<AudioBuffer> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}

