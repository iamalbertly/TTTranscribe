import { download } from './tiktok';
import { transcribe } from './transcribe';
import { summarize } from './summarize';
import { logPhase, logError, logAccepted } from './log';

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
  
  // Fire-and-forget async processing
  (async () => {
    try {
      // Phase 1: Downloading
      logPhase(id, 'DOWNLOADING', 15, 'fetch');
      statuses.set(id, { 
        phase: 'DOWNLOADING', 
        percent: 15, 
        note: 'fetch' 
      });
      
      const wavPath = await download(url);
      
      // Phase 2: Transcribing
      logPhase(id, 'TRANSCRIBING', 35, 'asr');
      statuses.set(id, { 
        phase: 'TRANSCRIBING', 
        percent: 35, 
        note: 'asr' 
      });
      
      const text = await transcribe(wavPath);
      
      // Phase 3: Summarizing
      logPhase(id, 'SUMMARIZING', 75, 'summary');
      statuses.set(id, { 
        phase: 'SUMMARIZING', 
        percent: 75, 
        note: 'summary' 
      });
      
      const note = await summarize(text);
      
      // Phase 4: Completed
      logPhase(id, 'COMPLETED', 100, note);
      statuses.set(id, { 
        phase: 'COMPLETED', 
        percent: 100, 
        note, 
        text 
      });
      
    } catch (e: any) {
      logError(id, 'job', e.message);
      statuses.set(id, { 
        phase: 'FAILED', 
        percent: 0, 
        note: e.message 
      });
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
