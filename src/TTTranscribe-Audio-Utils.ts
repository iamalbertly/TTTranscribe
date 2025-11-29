import * as fs from 'fs';

/**
 * Extract audio duration from WAV file
 * WAV files have a simple header structure that includes duration info
 */
export async function getAudioDuration(wavPath: string): Promise<number> {
  try {
    const stats = await fs.promises.stat(wavPath);
    const buffer = Buffer.alloc(Math.min(44, stats.size)); // WAV header is 44 bytes
    const fd = await fs.promises.open(wavPath, 'r');

    try {
      await fd.read(buffer, 0, buffer.length, 0);

      // Check if this is a valid WAV file (RIFF header)
      const riffHeader = buffer.toString('ascii', 0, 4);
      if (riffHeader !== 'RIFF') {
        console.warn(`[audio-utils] Not a valid WAV file (expected RIFF header): ${wavPath}`);
        return estimateDurationFromFileSize(stats.size);
      }

      // Read WAV format data
      const sampleRate = buffer.readUInt32LE(24);
      const byteRate = buffer.readUInt32LE(28);
      const dataSize = stats.size - 44; // Total file size minus header

      if (byteRate === 0) {
        console.warn(`[audio-utils] Invalid byte rate in WAV file: ${wavPath}`);
        return estimateDurationFromFileSize(stats.size);
      }

      const durationSeconds = dataSize / byteRate;
      console.log(`[audio-utils] Extracted duration from WAV: ${durationSeconds.toFixed(2)}s (sample rate: ${sampleRate}Hz)`);

      return Math.round(durationSeconds * 100) / 100; // Round to 2 decimals

    } finally {
      await fd.close();
    }

  } catch (error: any) {
    console.error(`[audio-utils] Failed to extract duration from ${wavPath}: ${error.message}`);

    // Fallback: estimate from file size
    const stats = await fs.promises.stat(wavPath);
    return estimateDurationFromFileSize(stats.size);
  }
}

/**
 * Fallback method: estimate duration from file size
 * Assumes 16-bit stereo at 44.1kHz (CD quality) = ~176KB per second
 */
function estimateDurationFromFileSize(fileSizeBytes: number): number {
  const bytesPerSecond = 176400; // 44100 Hz * 2 bytes/sample * 2 channels
  const estimatedDuration = (fileSizeBytes - 44) / bytesPerSecond; // Subtract header

  console.log(`[audio-utils] Estimated duration from file size: ${estimatedDuration.toFixed(2)}s`);
  return Math.round(estimatedDuration * 100) / 100;
}

/**
 * Get model name used for transcription
 * This is determined by environment variable or defaults
 */
export function getModelUsed(): string {
  const preferLocal = (process.env.PREFER_LOCAL_WHISPER || 'true').toLowerCase() === 'true';

  if (preferLocal) {
    const modelSize = process.env.WHISPER_MODEL_SIZE || 'base';
    return `openai-whisper-${modelSize}`;
  }

  return process.env.ASR_MODEL || 'openai/whisper-large-v3-turbo';
}
