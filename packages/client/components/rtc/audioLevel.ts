/**
 * Root mean square of audio samples
 * @param samples Samples from -1 to 1, e.g. from getFloatTimeDomainData
 * @returns Level from 0 to 1, 0 for no samples
 */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
