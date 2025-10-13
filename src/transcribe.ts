import fetch from 'node-fetch';
import * as fs from 'fs';
import FormData from 'form-data';

const HF_API_KEY = process.env.HF_API_KEY;
const ASR_PROVIDER = process.env.ASR_PROVIDER || 'hf';

/**
 * Transcribe audio using Hugging Face Whisper API
 */
export async function transcribe(wavPath: string): Promise<string> {
  if (!HF_API_KEY) {
    throw new Error('HF_API_KEY environment variable is required');
  }
  
  try {
    const model = 'openai/whisper-large-v3';
    const apiUrl = `https://api-inference.huggingface.co/models/${model}`;
    
    // Create form data with audio file
    const formData = new FormData();
    formData.append('file', fs.createReadStream(wavPath));
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ASR API error ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    // Handle different response formats
    let text = '';
    if (typeof result === 'string') {
      text = result;
    } else if (result.text) {
      text = result.text;
    } else if (result.transcription) {
      text = result.transcription;
    } else if (Array.isArray(result) && result.length > 0) {
      // Handle array of segments
      text = result.map((segment: any) => segment.text || segment.transcription || '').join(' ');
    } else {
      text = JSON.stringify(result);
    }
    
    // Normalize and clean up text
    text = text.trim();
    
    // Truncate if too long
    const maxLength = parseInt(process.env.KEEP_TEXT_MAX || '10000');
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + '...';
    }
    
    return text;
    
  } catch (error) {
    throw new Error(`Transcription failed: ${error}`);
  }
}

/**
 * Alternative transcription using local Whisper (if available)
 */
export async function transcribeLocal(wavPath: string): Promise<string> {
  // This would use a local Whisper installation
  // For now, we'll throw an error indicating it's not implemented
  throw new Error('Local transcription not implemented - use HF API');
}

/**
 * Validate audio file before transcription
 */
export async function validateAudioFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}
