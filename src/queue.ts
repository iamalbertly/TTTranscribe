import { download } from './tiktok';
import { transcribe } from './transcribe';
import { summarize } from './summarize';
import { logPhase, logError, logAccepted } from './log';
import { withRetry, withTimeout, TTTranscribeError, sanitizeError } from './error-handler';
import { cleanupTempFile } from './tiktok';

export type Status = {
  phase: string;
  percent: number;
  note?: string;
  text?: string;
};

// In-memory status tracking (replace with Redis later)
const statuses = new Map<string, Status>();

export async function startJob(url: string): Promise<string> {
  const id = crypto.randomUUID();
  
  // Initialize status
  statuses.set(id, { 
    phase: 'REQUEST_SUBMITTED', 
    percent: 5, 
    note: 'queued' 
  });
  
  logAccepted(id, url);
  
  // Fire-and-forget async processing with comprehensive error handling
  (async () => {
    let wavPath: string | null = null;
    
    try {
      // Phase 1: Downloading with retry
      logPhase(id, 'DOWNLOADING', 15, 'fetch');
      statuses.set(id, { 
        phase: 'DOWNLOADING', 
        percent: 15, 
        note: 'fetch' 
      });
      
      wavPath = await withRetry(
        () => withTimeout(download(url), 60000, 'Download timeout'),
        { maxRetries: 2, baseDelay: 2000 }
      );
      
      // Phase 2: Transcribing with retry
      logPhase(id, 'TRANSCRIBING', 35, 'asr');
      statuses.set(id, { 
        phase: 'TRANSCRIBING', 
        percent: 35, 
        note: 'asr' 
      });
      
      const text = await withRetry(
        () => withTimeout(transcribe(wavPath!), 120000, 'Transcription timeout'),
        { maxRetries: 2, baseDelay: 3000 }
      );
      
      // Phase 3: Summarizing
      logPhase(id, 'SUMMARIZING', 75, 'summary');
      statuses.set(id, { 
        phase: 'SUMMARIZING', 
        percent: 75, 
        note: 'summary' 
      });
      
      const note = await withTimeout(
        summarize(text), 
        30000, 
        'Summarization timeout'
      );
      
      // Phase 4: Completed
      logPhase(id, 'COMPLETED', 100, note);
      statuses.set(id, { 
        phase: 'COMPLETED', 
        percent: 100, 
        note, 
        text 
      });
      
    } catch (e: any) {
      const errorMessage = sanitizeError(e);
      logError(id, 'job', errorMessage);
      
      statuses.set(id, { 
        phase: 'FAILED', 
        percent: 0, 
        note: errorMessage 
      });
    } finally {
      // Cleanup temporary files
      if (wavPath) {
        try {
          await cleanupTempFile(wavPath);
        } catch (cleanupError) {
          console.warn(`Failed to cleanup temp file ${wavPath}:`, cleanupError);
        }
      }
    }
  })();
  
  return id;
}

export function getStatus(id: string): Status | undefined {
  return statuses.get(id);
}

export function getAllStatuses(): Map<string, Status> {
  return new Map(statuses);
}

export function clearStatus(id: string): boolean {
  return statuses.delete(id);
}
