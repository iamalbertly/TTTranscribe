import 'dotenv/config'; // Load environment variables
import fetch from 'node-fetch';
import * as fs from 'fs';
import FormData from 'form-data';

// Get environment variables with proper fallbacks
const HF_API_KEY = process.env.HF_API_KEY;
const ASR_PROVIDER = process.env.ASR_PROVIDER || 'hf';

/**
 * Transcribe audio using Hugging Face Whisper API
 */
export async function transcribe(wavPath: string): Promise<string> {
  try {
    // Check if file exists and is readable (Hugging Face Spaces might have restrictions)
    try {
      await fs.promises.access(wavPath, fs.constants.R_OK);
      
      // Check if it's a placeholder file
      const content = await fs.promises.readFile(wavPath, 'utf8');
      if (content.startsWith('# Placeholder audio file') || content.startsWith('[Transcription placeholder')) {
        console.log(`Detected placeholder file, returning placeholder transcription`);
        return `[Transcription placeholder for ${wavPath} - Placeholder audio file detected]`;
      }
    } catch (error) {
      console.warn(`Cannot access audio file ${wavPath}, using fallback transcription`);
      // Return a placeholder transcription for Hugging Face Spaces
      return `[Transcription placeholder for ${wavPath} - File access restricted in Hugging Face Spaces]`;
    }
    
    // If no API key is provided and placeholders are allowed, return placeholder transcription
    const allowPlaceholder = (process.env.ALLOW_PLACEHOLDER_TRANSCRIPTION || 'true').toLowerCase() === 'true';
    if (!HF_API_KEY && allowPlaceholder) {
      console.warn('HF_API_KEY not set; returning placeholder transcription');
      return `[PLACEHOLDER TRANSCRIPTION] This is a placeholder transcription for development purposes. Set HF_API_KEY to enable real transcription.`;
    }

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
    // If transcription fails, return a helpful message
    console.warn(`Transcription failed: ${error}`);
    return `[Transcription failed: ${error}. This may be due to Hugging Face Spaces file system restrictions.]`;
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
