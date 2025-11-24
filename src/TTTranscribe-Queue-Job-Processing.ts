import { download } from './TTTranscribe-Media-TikTok-Download';
import { transcribe } from './TTTranscribe-ASR-Whisper-Transcription';
import { summarize } from './TTTranscribe-AI-Text-Summarization';
import { jobResultCache } from './TTTranscribe-Cache-Job-Results';

// Fixed status phases as per requirements
export type StatusPhase =
  | 'REQUEST_SUBMITTED'
  | 'DOWNLOADING'
  | 'TRANSCRIBING'
  | 'SUMMARIZING'
  | 'COMPLETED'
  | 'FAILED';

export type Status = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  submittedAt: string;
  completedAt?: string;
  estimatedCompletion?: string;
  currentStep?: string;
  result?: {
    transcription: string;
    confidence: number;
    language: string;
    duration: number;
    wordCount: number;
    speakerCount: number;
    audioQuality: string;
    processingTime: number;
  };
  metadata?: {
    title?: string;
    author?: string;
    description?: string;
    url: string;
  };
};

// Job record for persistence
export type JobRecord = {
  requestId: string;
  url: string;
  phase: StatusPhase;
  percent: number;
  note: string;
  createdAt: string;
  updatedAt: string;
};

// In-memory storage (replace with Redis later)
const statuses = new Map<string, Status>();
const jobRecords = new Map<string, JobRecord>();

/**
 * Map internal phase to protocol status
 */
function mapPhaseToStatus(phase: StatusPhase): 'queued' | 'processing' | 'completed' | 'failed' {
  switch (phase) {
    case 'REQUEST_SUBMITTED': return 'queued';
    case 'DOWNLOADING':
    case 'TRANSCRIBING':
    case 'SUMMARIZING': return 'processing';
    case 'COMPLETED': return 'completed';
    case 'FAILED': return 'failed';
    default: return 'queued';
  }
}

/**
 * Map internal phase to current step description
 */
function mapPhaseToCurrentStep(phase: StatusPhase): string {
  switch (phase) {
    case 'REQUEST_SUBMITTED': return 'queued';
    case 'DOWNLOADING': return 'audio_extraction';
    case 'TRANSCRIBING': return 'transcription';
    case 'SUMMARIZING': return 'summarization';
    case 'COMPLETED': return 'completed';
    case 'FAILED': return 'failed';
    default: return 'unknown';
  }
}

/**
 * Update status with structured logging
 */
function updateStatus(requestId: string, phase: StatusPhase, percent: number, note: string, text?: string, truncated?: boolean, result?: any, metadata?: any): void {
  const now = new Date().toISOString();
  const jobRecord = jobRecords.get(requestId);


  // Update job record
  if (jobRecord) {
    jobRecord.phase = phase;
    jobRecord.percent = percent;
    jobRecord.note = note;
    jobRecord.updatedAt = now;
    jobRecords.set(requestId, jobRecord);
  }

  // Calculate estimated completion
  let estimatedCompletion: string | undefined;
  if (phase !== 'COMPLETED' && phase !== 'FAILED') {
    const nowMs = Date.now();
    let remainingSeconds = 0;
    switch (phase) {
      case 'REQUEST_SUBMITTED': remainingSeconds = 180; break;
      case 'DOWNLOADING': remainingSeconds = 150; break;
      case 'TRANSCRIBING': remainingSeconds = 90; break;
      case 'SUMMARIZING': remainingSeconds = 20; break;
    }
    estimatedCompletion = new Date(nowMs + remainingSeconds * 1000).toISOString();
  }

  // Structured logging for transitions
  console.log(JSON.stringify({
    requestId,
    phase,
    percent,
    note,
    msSinceStart: Date.now() - new Date(jobRecord?.createdAt || now).getTime(),
    timestamp: now,
    estimatedCompletion
  }));

  const status: Status = {
    id: requestId,
    status: mapPhaseToStatus(phase),
    progress: percent,
    submittedAt: jobRecord?.createdAt || now,
    completedAt: phase === 'COMPLETED' ? now : undefined,
    estimatedCompletion,
    currentStep: mapPhaseToCurrentStep(phase),
    result: phase === 'COMPLETED' && result ? {
      transcription: text || '',
      confidence: result.confidence || 0.95,
      language: result.language || 'en',
      duration: result.duration || 0,
      wordCount: text ? text.split(' ').length : 0,
      speakerCount: result.speakerCount || 1,
      audioQuality: result.audioQuality || 'high',
      processingTime: result.processingTime || 0
    } : undefined,
    metadata: metadata ? {
      title: metadata.title,
      author: metadata.author,
      description: metadata.description,
      url: metadata.url
    } : undefined
  };

  statuses.set(requestId, status);
}

/**
 * Truncate text if it exceeds KEEP_TEXT_MAX
 */
function truncateTextIfNeeded(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }

  return {
    text: text.substring(0, maxLength),
    truncated: true
  };
}

export async function startJob(url: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Check cache first
  const cached = jobResultCache.get(url);
  if (cached) {
    const cachedTextLength = cached.result.transcription?.length || 0;
    console.log(`Cache hit for ${url}, returning cached result immediately. Text length: ${cachedTextLength}`);

    // Create job record for cached result
    const jobRecord: JobRecord = {
      requestId: id,
      url,
      phase: 'COMPLETED',
      percent: 100,
      note: 'Retrieved from cache',
      createdAt: now,
      updatedAt: now
    };

    jobRecords.set(id, jobRecord);

    // Return cached result immediately
    updateStatus(id, 'COMPLETED', 100, 'Retrieved from cache', cached.result.transcription, false, cached.result, cached.metadata);
    return id;
  }

  console.log(`Cache miss for ${url}, processing normally`);

  // Create job record
  const jobRecord: JobRecord = {
    requestId: id,
    url,
    phase: 'REQUEST_SUBMITTED',
    percent: 0,
    note: 'queued',
    createdAt: now,
    updatedAt: now
  };

  jobRecords.set(id, jobRecord);

  // Initialize status
  updateStatus(id, 'REQUEST_SUBMITTED', 0, 'queued');

  console.log(`ttt:accepted req=${id} url=${url.slice(-12)}`);

  // Fire-and-forget async processing
  (async () => {
    const startTime = Date.now();

    try {
      // Phase 1: Downloading
      updateStatus(id, 'DOWNLOADING', 15, 'Downloading audio');

      const wavPath = await download(url);

      // Phase 2: Transcribing
      updateStatus(id, 'TRANSCRIBING', 35, 'Transcribing audio');

      const rawText = await transcribe(wavPath);

      // Apply text truncation if needed
      const maxLength = parseInt(process.env.KEEP_TEXT_MAX || '10000');
      const { text, truncated } = truncateTextIfNeeded(rawText, maxLength);

      // Phase 3: Summarizing
      updateStatus(id, 'SUMMARIZING', 75, 'Generating summary', text, truncated);

      const summary = await summarize(text);

      // Phase 4: Completed
      const result = {
        transcription: text,
        confidence: 0.95,
        language: 'en',
        duration: 30.5, // TODO: Extract from audio metadata
        speakerCount: 1,
        audioQuality: 'high',
        processingTime: Math.round((Date.now() - startTime) / 1000)
      };

      const metadata = {
        url: url,
        title: 'TikTok Video',
        author: 'unknown',
        description: 'Transcribed TikTok video'
      };

      updateStatus(id, 'COMPLETED', 100, summary, text, truncated, result, metadata);

      // Cache the result for future requests
      jobResultCache.set(url, result, metadata);

    } catch (e: any) {
      console.log(`ttt:error req=${id} where=job msg=${e.message}`);
      updateStatus(id, 'FAILED', 0, e.message);
    }
  })();

  return id;
}

export function getStatus(id: string): Status | undefined {
  return statuses.get(id);
}

export function getJobRecord(id: string): JobRecord | undefined {
  return jobRecords.get(id);
}

export function getAllStatuses(): Map<string, Status> {
  return new Map(statuses);
}

export function getAllJobRecords(): Map<string, JobRecord> {
  return new Map(jobRecords);
}

export function clearStatus(id: string): boolean {
  const statusDeleted = statuses.delete(id);
  const jobDeleted = jobRecords.delete(id);
  return statusDeleted || jobDeleted;
}

/**
 * Get job record by request ID (for persistence)
 */
export function getJobRecordByRequestId(requestId: string): JobRecord | undefined {
  return jobRecords.get(requestId);
}

/**
 * Persist job record (placeholder for Redis implementation)
 */
export function persistJobRecord(requestId: string): void {
  const jobRecord = jobRecords.get(requestId);
  if (jobRecord) {
    // In a real implementation, this would save to Redis with key "job:<requestId>"
    console.log(`Persisting job record for ${requestId}:`, JSON.stringify(jobRecord));
  }
}

/**
 * Persist status (placeholder for Redis implementation)
 */
export function persistStatus(requestId: string): void {
  const status = statuses.get(requestId);
  if (status) {
    // In a real implementation, this would save to Redis with key "status:<requestId>"
    console.log(`Persisting status for ${requestId}:`, JSON.stringify(status));
  }
}
