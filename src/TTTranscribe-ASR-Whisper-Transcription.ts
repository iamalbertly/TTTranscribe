import 'dotenv/config'; // Load environment variables
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
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
      
      // Check file size - placeholder files are typically very small (< 1KB)
      const stats = await fs.promises.stat(wavPath);
      if (stats.size < 1024) {
        // Small file might be a placeholder - check first few bytes as text
        const buffer = await fs.promises.readFile(wavPath);
        const firstBytes = buffer.slice(0, 100).toString('utf8');
        if (firstBytes.startsWith('# Placeholder') || firstBytes.startsWith('[Transcription placeholder')) {
          console.log(`Detected placeholder file, returning placeholder transcription`);
          return `[Transcription placeholder for ${wavPath} - Placeholder audio file detected]`;
        }
      }
      
      // Validate it's a real audio file (WAV files start with "RIFF")
      if (stats.size > 1024) {
        const buffer = await fs.promises.readFile(wavPath);
        const header = buffer.slice(0, 4).toString('ascii');
        if (header !== 'RIFF' && stats.size < 10000) {
          // Might be a text placeholder file
          const textContent = buffer.slice(0, 100).toString('utf8');
          if (textContent.includes('Placeholder') || textContent.includes('placeholder')) {
            console.log(`Detected placeholder file by header check`);
            return `[Transcription placeholder for ${wavPath} - Placeholder audio file detected]`;
          }
        }
      }
    } catch (error: any) {
      console.warn(`Cannot access audio file ${wavPath}: ${error.message}`);
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
    // Note: The inference API endpoint format is: https://api-inference.huggingface.co/models/{model}
    const endpointFormats = [
      `https://api-inference.huggingface.co/models/${model}`, // Standard inference API endpoint
    ];
    
    if (!HF_API_KEY) {
      throw new Error('HF_API_KEY is required for transcription');
    }
    
    let lastError: Error | null = null;
    let response: any = null;
    let successfulEndpoint: string | null = null;
    
    // Try each endpoint format until one works
    for (const apiUrl of endpointFormats) {
      try {
        // Verify file exists and get its size
        const stats = await fs.promises.stat(wavPath);
        if (stats.size === 0) {
          throw new Error(`Audio file is empty: ${wavPath}`);
        }
        
        console.log(`Attempting transcription with endpoint: ${apiUrl}, file size: ${stats.size} bytes`);
        
        // Create form data with audio file
        // Hugging Face Inference API expects the file field name to be 'file' or 'inputs'
        const formData = new FormData();
        formData.append('file', fs.createReadStream(wavPath), {
          filename: path.basename(wavPath),
          contentType: 'audio/wav'
        });
        
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${HF_API_KEY}`,
            ...formData.getHeaders()
          },
          body: formData
        });
        
        // Handle 410 error (deprecated endpoint) - check if response is HTML (error page) or JSON (might still work)
        if (response.status === 410) {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('text/html')) {
            console.warn(`Endpoint ${apiUrl} returned 410 with HTML (fully deprecated), trying next format...`);
            lastError = new Error(`Endpoint deprecated: ${apiUrl}`);
            continue;
          } else {
            console.warn(`Endpoint ${apiUrl} returned 410 but content-type suggests it might work, attempting to use...`);
            // Don't continue - try to process the response even if deprecated
          }
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
        
        // Check if 410 response is HTML (fully deprecated) or might still work
        if (response.status === 410) {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('text/html')) {
            // Clone response to read body without consuming it
            const clonedResponse = response.clone();
            const text = await clonedResponse.text();
            if (text.trim().startsWith('<!') || text.includes('<html')) {
              console.warn(`Endpoint ${apiUrl} returned 410 with HTML (fully deprecated), trying next format...`);
              lastError = new Error(`Endpoint deprecated: ${apiUrl}`);
              continue;
            }
          }
          // If 410 but not HTML, might still work
          console.log(`Using deprecated but potentially functional endpoint: ${apiUrl}`);
          successfulEndpoint = apiUrl;
          break;
        }
        
        // If we got a successful response, break out of the loop
        if (response.ok) {
          console.log(`Successfully connected to endpoint: ${apiUrl}`);
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
    if (!response || !response.ok) {
      const errorText = response ? await response.text() : 'No response';
      const truncatedError = errorText.length > 500 ? errorText.substring(0, 500) + '...' : errorText;
      throw lastError || new Error(`ASR API error: All endpoints failed. Last error: ${truncatedError}`);
    }
    
    // Parse the response as JSON (response body can only be read once!)
    let result: any;
    const responseText = await response.text();
    
    try {
      // Check if response is HTML (error page)
      if (responseText.trim().startsWith('<!') || responseText.includes('<html')) {
        throw new Error('Response is HTML, not JSON. Endpoint may have returned an error page.');
      }
      
      // Try to parse as JSON
      result = JSON.parse(responseText);
    } catch (parseError: any) {
      // If JSON parsing fails, check if it's a plain string transcription
      if (responseText && responseText.length > 0 && !responseText.includes('<') && !responseText.includes('Error')) {
        // Might be a plain text transcription response
        result = responseText;
        console.log(`Received plain text response (not JSON), using as transcription`);
      } else {
        // Log the actual response for debugging
        console.error(`Failed to parse API response. Status: ${response.status}, Response: ${responseText.substring(0, 500)}`);
        throw new Error(`Failed to parse API response: ${parseError.message}. Response preview: ${responseText.substring(0, 200)}`);
      }
    }
    
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
