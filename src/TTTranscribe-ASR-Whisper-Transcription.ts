import 'dotenv/config'; // Load environment variables
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';

// Get environment variables with proper fallbacks
const HF_API_KEY = process.env.HF_API_KEY;
const ASR_PROVIDER = process.env.ASR_PROVIDER || 'hf';
// Comma-separated list of HF API endpoints to try (allows migration/fallback)
const HF_API_URLS = (process.env.HF_API_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
const ASR_MAX_RETRIES = parseInt(process.env.ASR_MAX_RETRIES || '2');
const ASR_TIMEOUT_MS = parseInt(process.env.ASR_TIMEOUT_MS || '60000'); // 60 second default timeout

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

    // Prefer an explicit model via ASR_MODEL env; fall back to a prioritized list of supported models.
    // NOTE: openai/whisper-* models are deprecated on HF Inference API
    // Prioritize smaller/faster models first to avoid timeouts
    const configuredModel = (process.env.ASR_MODEL || '').trim();
    const preferredModels = configuredModel ? [configuredModel] : [
      'openai/whisper-base',       // Smallest, fastest - good for quick responses
      'distil-whisper/distil-medium.en',  // Fast English-only model
      'distil-whisper/distil-large-v2',   // Balanced speed/accuracy
      'Systran/faster-whisper-medium',    // CTranslate2 optimized medium
      'distil-whisper/distil-large-v3',   // Larger but still fast
      'openai/whisper-small',      // Deprecated but might work
      'openai/whisper-medium'      // Fallback
    ];

    // Build endpoint list: env-specified HF_API_URLS first, then construct from preferredModels
    const endpointFormats = HF_API_URLS.length > 0 ? HF_API_URLS : preferredModels.map(m => `https://api-inference.huggingface.co/models/${m}`);

    if (!HF_API_KEY) {
      // If API key is missing allow placeholder behavior controlled by env var
      const allowPlaceholder = (process.env.ALLOW_PLACEHOLDER_TRANSCRIPTION || 'true').toLowerCase() === 'true';
      if (!allowPlaceholder) {
        throw new Error('HF_API_KEY is required for transcription in this environment');
      }
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
        
        // Add retry loop per endpoint to handle transient errors
        let attempt = 0;
        while (attempt < ASR_MAX_RETRIES) {
          // Re-create form data stream for each attempt
          const attemptForm = new FormData();
          attemptForm.append('file', fs.createReadStream(wavPath), {
            filename: path.basename(wavPath),
            contentType: 'audio/wav'
          });

          // Create abort controller for timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            console.log(`Request to ${apiUrl} timed out after ${ASR_TIMEOUT_MS}ms`);
            controller.abort();
          }, ASR_TIMEOUT_MS);

          try {
            response = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                ...(HF_API_KEY ? { 'Authorization': `Bearer ${HF_API_KEY}` } : {}),
                ...attemptForm.getHeaders()
              },
              body: attemptForm,
              signal: controller.signal
            });
            clearTimeout(timeoutId);
          } catch (fetchError: any) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
              console.warn(`Request to ${apiUrl} was aborted due to timeout (${ASR_TIMEOUT_MS}ms)`);
              lastError = new Error(`Timeout after ${ASR_TIMEOUT_MS}ms`);
              break; // Move to next endpoint
            }
            throw fetchError; // Re-throw other errors
          }

          // If successful or non-retryable status, break retry loop
          if (response.ok || [404].includes(response.status)) break;

          // If model is loading (503) or server error (5xx), backoff and retry
          if (response.status === 503 || (response.status >= 500 && response.status < 600)) {
            const backoffMs = Math.min(10000, 1000 * Math.pow(2, attempt));
            console.log(`Transient error from ${apiUrl} (status=${response.status}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${ASR_MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            attempt++;
            continue;
          }

          // If we reach here, it's not retryable - break and let outer logic handle
          break;
        }
        
        // Handle 410 error (deprecated endpoint) - check if response is HTML (error page) or JSON (might still work)
        if (response.status === 410) {
          const contentType = response.headers.get('content-type') || '';
          const responseBody = await response.clone().text();
          const snippet = responseBody.substring(0, 200);
          if (contentType.includes('text/html') || snippet.trim().startsWith('<!') || snippet.includes('<html')) {
            console.warn(`Endpoint ${apiUrl} returned 410 with HTML (fully deprecated). Snippet: ${snippet}`);
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
    
    // If all endpoints failed, attempt local transcription fallback before throwing
    if (!response || !response.ok) {
      const errorText = response ? await response.text() : 'No response';
      const truncatedError = errorText.length > 500 ? errorText.substring(0, 500) + '...' : errorText;
      
      // Attempt local transcription as fallback (if configured and available)
      try {
        const allowLocalFallback = (process.env.ASR_FALLBACK_TO_LOCAL || 'true').toLowerCase() === 'true';
        if (allowLocalFallback) {
          console.log('All HF endpoints failed; attempting local transcription fallback...');
          try {
            const localText = await transcribeLocal(wavPath);
            console.log('Local transcription succeeded as fallback');
            return localText;
          } catch (localErr: any) {
            console.warn(`Local transcription fallback failed: ${localErr?.message || localErr}`);
          }
        }
      } catch (fallbackErr) {
        console.warn(`Error attempting local fallback: ${fallbackErr}`);
      }

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
    // If transcription fails, return a helpful error message (do NOT include sensitive values like tokens)
    console.warn(`Transcription failed: ${error}`);
    const msg = error instanceof Error ? error.message : String(error);
    return `[Transcription failed: ${msg}.]`;
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
