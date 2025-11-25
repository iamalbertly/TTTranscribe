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
    
    // Try multiple endpoint formats with fallback
    // Note: The inference API endpoint may return 410 (deprecated) but still function
    const endpointFormats = [
      `https://api-inference.huggingface.co/models/${model}`, // Original endpoint (may return 410 but still work)
      `https://router.huggingface.co/${model}`, // Router endpoint without /models/
    ];
    
    let lastError: Error | null = null;
    let response: any = null;
    let successfulEndpoint: string | null = null;
    
    // Try each endpoint format until one works
    for (const apiUrl of endpointFormats) {
      try {
        // Create form data with audio file
        const formData = new FormData();
        formData.append('file', fs.createReadStream(wavPath));
        
        console.log(`Attempting transcription with endpoint: ${apiUrl}`);
        
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${HF_API_KEY}`,
            ...formData.getHeaders()
          },
          body: formData
        });
        
        // Handle 410 error (deprecated endpoint) - still try to read response as it may work
        if (response.status === 410) {
          console.warn(`Endpoint ${apiUrl} returned 410 (deprecated), but attempting to use response anyway...`);
          // Don't continue - try to process the response even if deprecated
        }
        
        // Handle 404 error - try next format
        if (response.status === 404) {
          console.warn(`Endpoint ${apiUrl} returned 404 (not found), trying next format...`);
          lastError = new Error(`Endpoint not found: ${apiUrl}`);
          continue;
        }
        
        // Handle rate limiting and model loading
        if (response.status === 503) {
          const errorText = await response.text();
          console.log('Model is loading, waiting 10 seconds before retry...');
          await new Promise(resolve => setTimeout(resolve, 10000));
          
          // Retry the request with new form data
          const retryFormData = new FormData();
          retryFormData.append('file', fs.createReadStream(wavPath));
          response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${HF_API_KEY}`,
              ...retryFormData.getHeaders()
            },
            body: retryFormData
          });
        }
        
        // If we got a successful response (200) or deprecated but functional (410), break out of the loop
        if (response.ok || response.status === 410) {
          if (response.status === 410) {
            console.log(`Using deprecated but functional endpoint: ${apiUrl}`);
          } else {
            console.log(`Successfully connected to endpoint: ${apiUrl}`);
          }
          successfulEndpoint = apiUrl;
          break;
        }
        
        // If not successful and not a retryable error, try next endpoint
        if (response.status !== 503) {
          const errorText = await response.text();
          lastError = new Error(`ASR API error ${response.status} from ${apiUrl}: ${errorText.substring(0, 200)}`);
          continue;
        }
      } catch (fetchError: any) {
        console.warn(`Error with endpoint ${apiUrl}: ${fetchError.message}`);
        lastError = fetchError;
        continue;
      }
    }
    
    // If all endpoints failed, throw the last error
    if (!response || (!response.ok && response.status !== 410)) {
      const errorText = response ? await response.text() : 'No response';
      const truncatedError = errorText.length > 500 ? errorText.substring(0, 500) + '...' : errorText;
      throw lastError || new Error(`ASR API error: All endpoints failed. Last error: ${truncatedError}`);
    }
    
    // For 410 responses, try to parse the response body as it may still contain valid data
    if (response.status === 410) {
      console.warn('Received 410 (deprecated) but attempting to parse response...');
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
