import { download } from './TTTranscribe-Media-TikTok-Download';
import * as fs from 'fs';
import { transcribe } from './TTTranscribe-ASR-Whisper-Transcription';
import { summarize } from './TTTranscribe-AI-Text-Summarization';
import { jobResultCache } from './TTTranscribe-Cache-Job-Results';
import { sendWebhookToBusinessEngine, calculateUsage } from './TTTranscribe-Webhook-Business-Engine';
import { getAudioDuration, getModelUsed } from './TTTranscribe-Audio-Utils';
import { TTTranscribeConfig } from './TTTranscribe-Config-Environment-Settings';

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
  phase?: StatusPhase;
  note?: string;
  percent?: number;
  progress: number;
  submittedAt: string;
  completedAt?: string;
  estimatedCompletion?: string;
  currentStep?: string;
  error?: string; // Error message when status is 'failed'
  cacheHit?: boolean; // Indicates if result was served from cache
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
  // Server-side debug information included in status for easier client-side reporting
  server?: {
    requestId: string;
    phaseStartTime?: number;
    phaseElapsedTime?: number;
    createdAt?: string;
    updatedAt?: string;
  };
};

// Job record for persistence
export type JobRecord = {
  requestId: string; // TTTranscribe job ID (UUID)
  businessEngineRequestId?: string; // Original request ID from Business Engine (for webhook callback)
  url: string;
  phase: StatusPhase;
  percent: number;
  note: string;
  createdAt: string;
  updatedAt: string;
  phaseStartTime?: number; // Timestamp when current phase started
  phaseElapsedTime?: number; // Time elapsed in current phase
};

// In-memory storage (replace with Redis later)
const statuses = new Map<string, Status>();
const jobRecords = new Map<string, JobRecord>();

// Configuration reference (set by server on startup)
let config: TTTranscribeConfig | null = null;

/**
 * Initialize job processing with configuration
 */
export function initializeJobProcessing(appConfig: TTTranscribeConfig): void {
  config = appConfig;
  console.log(`[job-processing] Initialized with webhook URL: ${config.webhookUrl}`);
}

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
function updateStatus(requestId: string, phase: StatusPhase, percent: number, note: string, text?: string, truncated?: boolean, result?: any, metadata?: any, cacheHit?: boolean): void {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const jobRecord = jobRecords.get(requestId);

  // Update job record
  if (jobRecord) {
    // If phase changed, record the elapsed time and start new phase
    if (jobRecord.phase !== phase && jobRecord.phaseStartTime) {
      jobRecord.phaseElapsedTime = nowMs - jobRecord.phaseStartTime;
    }
    
    jobRecord.phase = phase;
    jobRecord.percent = percent;
    jobRecord.note = note;
    jobRecord.updatedAt = now;
    
    // Start timing for new phase
    if (!jobRecord.phaseStartTime || jobRecord.phase !== phase) {
      jobRecord.phaseStartTime = nowMs;
    }
    
    jobRecords.set(requestId, jobRecord);
  }

  // Calculate estimated completion based on actual elapsed time and remaining work
  let estimatedCompletion: string | undefined;
  if (phase !== 'COMPLETED' && phase !== 'FAILED' && jobRecord) {
    const totalElapsed = nowMs - new Date(jobRecord.createdAt).getTime();
    const elapsedSeconds = totalElapsed / 1000;
    
    // Calculate remaining time based on progress and elapsed time
    // If we have progress, estimate based on rate; otherwise use phase-specific defaults
    let remainingSeconds = 0;
    
    if (percent > 0 && elapsedSeconds > 0) {
      // Estimate based on current progress rate
      const progressRate = percent / elapsedSeconds; // percent per second
      const remainingPercent = 100 - percent;
      remainingSeconds = remainingPercent / progressRate;
      
      // Cap estimates to reasonable maximums per phase
      const maxSecondsByPhase: Record<StatusPhase, number> = {
        'REQUEST_SUBMITTED': 30,
        'DOWNLOADING': 300, // 5 minutes max for download
        'TRANSCRIBING': 600, // 10 minutes max for transcription
        'SUMMARIZING': 60, // 1 minute max for summarization
        'COMPLETED': 0,
        'FAILED': 0
      };
      
      remainingSeconds = Math.min(remainingSeconds, maxSecondsByPhase[phase] || 300);
      
      // Ensure minimum time based on phase
      const minSecondsByPhase: Record<StatusPhase, number> = {
        'REQUEST_SUBMITTED': 5,
        'DOWNLOADING': 10,
        'TRANSCRIBING': 30,
        'SUMMARIZING': 5,
        'COMPLETED': 0,
        'FAILED': 0
      };
      
      remainingSeconds = Math.max(remainingSeconds, minSecondsByPhase[phase] || 10);
    } else {
      // Fallback to phase-specific defaults if no progress yet
      switch (phase) {
        case 'REQUEST_SUBMITTED': remainingSeconds = 10; break;
        case 'DOWNLOADING': remainingSeconds = 120; break;
        case 'TRANSCRIBING': remainingSeconds = 180; break;
        case 'SUMMARIZING': remainingSeconds = 30; break;
        default: remainingSeconds = 60;
      }
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
    phase,
    note,
    percent,
    progress: percent,
    submittedAt: jobRecord?.createdAt || now,
    completedAt: phase === 'COMPLETED' ? now : undefined,
    estimatedCompletion,
    currentStep: mapPhaseToCurrentStep(phase),
    error: phase === 'FAILED' ? note : undefined, // Include error message when failed
    cacheHit: cacheHit ?? undefined, // Indicate if result was served from cache
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
  } : undefined,
  server: jobRecord ? {
      requestId: jobRecord.requestId,
      phaseStartTime: jobRecord.phaseStartTime,
      phaseElapsedTime: jobRecord.phaseElapsedTime,
      createdAt: jobRecord.createdAt,
      updatedAt: jobRecord.updatedAt
    } : undefined,
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

export async function startJob(url: string, businessEngineRequestId?: string): Promise<string> {
  // Lightweight normalization to improve cache hits and consistency
  const normalizedUrl = (() => {
    try {
      const trimmed = url.trim();
      const withoutHash = trimmed.split('#')[0];
      const u = new URL(withoutHash);
      u.search = ''; // Drop query params for cache consistency
      return u.toString().replace(/\/+$/, ''); // Remove trailing slashes
    } catch {
      return url;
    }
  })();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Check cache first
  const cached = jobResultCache.get(normalizedUrl);
  if (cached) {
    const cachedTextLength = cached.result.transcription?.length || 0;
    console.log(`Cache hit for ${normalizedUrl}, returning cached result immediately. Text length: ${cachedTextLength}`);

    // Create job record for cached result
    const jobRecord: JobRecord = {
      requestId: id,
      businessEngineRequestId,
      url: normalizedUrl,
      phase: 'COMPLETED',
      percent: 100,
      note: 'Retrieved from cache',
      createdAt: now,
      updatedAt: now
    };

    jobRecords.set(id, jobRecord);

    // Return cached result immediately with cache hit indicator
    updateStatus(id, 'COMPLETED', 100, 'Retrieved from cache', cached.result.transcription, false, cached.result, cached.metadata, true);

    // Send webhook for cached result if Business Engine request ID is provided
    if (businessEngineRequestId && config?.webhookUrl) {
      const usage = calculateUsage(
        cached.result.duration || 0,
        cached.result.transcription || '',
        getModelUsed(),
        Date.now()
      );

      sendWebhookToBusinessEngine(config.webhookUrl, {
        jobId: id,
        requestId: businessEngineRequestId,
        status: 'completed',
        usage,
        timestamp: now,
        cacheHit: true, // Indicate this was served from cache
      }, config.webhookSecret).catch(err => {
        console.error(`[webhook] Failed to send webhook for cached result ${id}: ${err.message}`);
      });
    }

    return id;
  }

  console.log(`Cache miss for ${normalizedUrl}, processing normally`);

  // Create job record
  const jobRecord: JobRecord = {
    requestId: id,
    businessEngineRequestId,
    url: normalizedUrl,
    phase: 'REQUEST_SUBMITTED',
    percent: 0,
    note: 'queued',
    createdAt: now,
    updatedAt: now
  };

  jobRecords.set(id, jobRecord);

  // Initialize status
  updateStatus(id, 'REQUEST_SUBMITTED', 0, 'queued');

  console.log(`ttt:accepted req=${id} url=${normalizedUrl.slice(-12)}`);

  // Fire-and-forget async processing
  (async () => {
    const startTime = Date.now();

    try {
      // Phase 1: Downloading
      updateStatus(id, 'DOWNLOADING', 15, 'Downloading audio');

      let wavPath: string;
      try {
        wavPath = await download(normalizedUrl);
      } catch (downloadError: any) {
        const errMsg = downloadError.message || String(downloadError);
        const errStack = downloadError.stack || '';
        const guidance = 'Tip: configure YTDLP_COOKIES or YTDLP_PROXY if TikTok blocks the Space IP.';
        console.error(JSON.stringify({
          type: 'download_error',
          requestId: id,
          phase: 'DOWNLOADING',
          error: errMsg,
          stack: errStack.substring(0, 500),
          url: normalizedUrl,
          client: jobRecord?.businessEngineRequestId || null
        }));
        updateStatus(id, 'FAILED', 0, `Download failed: ${errMsg.substring(0, 220)}. ${guidance}`);

        // Send failure webhook to Business Engine
        if (jobRecord.businessEngineRequestId && config?.webhookUrl) {
          const usage = calculateUsage(0, '', getModelUsed(), startTime);
          sendWebhookToBusinessEngine(config.webhookUrl, {
            jobId: id,
            requestId: jobRecord.businessEngineRequestId,
            status: 'failed',
            usage,
            error: `Download failed: ${errMsg.substring(0, 200)}`,
            timestamp: new Date().toISOString(),
          }, config.webhookSecret).catch(err => {
            console.error(`[webhook] Failed to send failure webhook for ${id}: ${err.message}`);
          });
        }

        return; // Exit early on download failure
      }

      // Phase 2: Transcribing
      updateStatus(id, 'TRANSCRIBING', 35, 'Transcribing audio');

      let rawText: string;
      try {
        rawText = await transcribe(wavPath);
        // Check if transcription failed or returned a placeholder marker
        const normalized = (rawText || '').toString();
        if (normalized.startsWith('[Transcription failed') || normalized.startsWith('[PLACEHOLDER') || normalized.includes('Placeholder')) {
          const messagePreview = normalized.substring(0, 200);
          console.error(JSON.stringify({
            type: 'transcription_placeholder',
            requestId: id,
            phase: 'TRANSCRIBING',
            error: messagePreview,
            url: normalizedUrl,
            client: jobRecord?.businessEngineRequestId || null
          }));
          // Mark job as FAILED and include the transcription error in the note. Do NOT cache placeholder or failed results.
          updateStatus(id, 'FAILED', 0, `Transcription failed: ${messagePreview}`);

          // Send failure webhook to Business Engine
          if (jobRecord.businessEngineRequestId && config?.webhookUrl) {
            const audioDuration = await getAudioDuration(wavPath).catch(() => 0);
            const usage = calculateUsage(audioDuration, '', getModelUsed(), startTime);
            sendWebhookToBusinessEngine(config.webhookUrl, {
              jobId: id,
              requestId: jobRecord.businessEngineRequestId,
              status: 'failed',
              usage,
              error: `Transcription failed: ${messagePreview}`,
              timestamp: new Date().toISOString(),
            }, config.webhookSecret).catch(err => {
              console.error(`[webhook] Failed to send failure webhook for ${id}: ${err.message}`);
            });
          }

          // Clean up temp file if needed - best-effort
          try { await fs.promises.unlink(wavPath); } catch {}
          return; // End processing for this job early
        }
      } catch (transcribeError: any) {
        const errMsg = transcribeError.message || String(transcribeError);
        const errStack = transcribeError.stack || '';
        // Friendlier hint when audio validation failed (common when TikTok blocks download)
        const hint = errMsg.includes('Audio validation failed') ? ' Hint: TikTok download may have been blocked; add YTDLP_COOKIES or proxy.' : '';
        console.error(JSON.stringify({
          type: 'transcription_error',
          requestId: id,
          phase: 'TRANSCRIBING',
          error: errMsg,
          stack: errStack.substring(0, 500),
          url: normalizedUrl,
          client: jobRecord?.businessEngineRequestId || null
        }));
        updateStatus(id, 'FAILED', 0, `Transcription error: ${errMsg.substring(0, 260)}${hint}`);

        // Send failure webhook to Business Engine
        if (jobRecord.businessEngineRequestId && config?.webhookUrl) {
          const audioDuration = await getAudioDuration(wavPath).catch(() => 0);
          const usage = calculateUsage(audioDuration, '', getModelUsed(), startTime);
          sendWebhookToBusinessEngine(config.webhookUrl, {
            jobId: id,
            requestId: jobRecord.businessEngineRequestId,
            status: 'failed',
            usage,
            error: `Transcription error: ${errMsg.substring(0, 200)}`,
            timestamp: new Date().toISOString(),
          }, config.webhookSecret).catch(err => {
            console.error(`[webhook] Failed to send failure webhook for ${id}: ${err.message}`);
          });
        }

        try { await fs.promises.unlink(wavPath); } catch {}
        return; // Exit early instead of re-throwing
      }

      // Apply text truncation if needed
      const maxLength = parseInt(process.env.KEEP_TEXT_MAX || '10000');
      const { text, truncated } = truncateTextIfNeeded(rawText, maxLength);

      // Phase 3: Summarizing
      updateStatus(id, 'SUMMARIZING', 75, 'Generating summary', text, truncated);

      const summary = await summarize(text);

      // Phase 4: Completed
      // Extract audio duration from WAV file
      const audioDuration = await getAudioDuration(wavPath);

      const result = {
        transcription: text,
        confidence: 0.95,
        language: 'en',
        duration: audioDuration,
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

      updateStatus(id, 'COMPLETED', 100, summary, text, truncated, result, metadata, false);

      // Cache the result for future requests only if transcription did not contain placeholders or failed markers
      if (text && !text.startsWith('[Transcription failed') && !text.startsWith('[PLACEHOLDER')) {
        jobResultCache.set(url, result, metadata);
        console.log(`[cache] Cached successful transcription for ${url}`);
      } else {
        console.log(`[cache] Not caching result for ${url} due to failure/placeholder content.`);
      }

      // Send webhook to Business Engine if configured
      if (jobRecord.businessEngineRequestId && config?.webhookUrl) {
        const usage = calculateUsage(
          audioDuration,
          text,
          getModelUsed(),
          startTime
        );

        sendWebhookToBusinessEngine(config.webhookUrl, {
          jobId: id,
          requestId: jobRecord.businessEngineRequestId,
          status: 'completed',
          usage,
          timestamp: new Date().toISOString(),
          cacheHit: false, // Fresh processing, not from cache
        }, config.webhookSecret).catch(err => {
          console.error(`[webhook] Failed to send completion webhook for ${id}: ${err.message}`);
        });
      }

      // Clean up WAV file
      try {
        await fs.promises.unlink(wavPath);
        console.log(`[cleanup] Deleted WAV file: ${wavPath}`);
      } catch (cleanupError) {
        console.warn(`[cleanup] Failed to delete WAV file ${wavPath}: ${cleanupError}`);
      }

    } catch (e: any) {
      const errorMsg = e.message || String(e);
      const errStack = e.stack || '';
      const phase = jobRecord?.phase || 'UNKNOWN';
      console.error(JSON.stringify({
        type: 'unhandled_job_error',
        requestId: id,
        phase,
        error: errorMsg,
        stack: errStack.substring(0, 500),
        url: normalizedUrl,
        client: jobRecord?.businessEngineRequestId || null
      }));
      updateStatus(id, 'FAILED', 0, `Error during ${phase}: ${errorMsg.substring(0, 200)}`);

      // Send failure webhook to Business Engine
      if (jobRecord.businessEngineRequestId && config?.webhookUrl) {
        const usage = calculateUsage(0, '', getModelUsed(), startTime);
        sendWebhookToBusinessEngine(config.webhookUrl, {
          jobId: id,
          requestId: jobRecord.businessEngineRequestId,
          status: 'failed',
          usage,
          error: `Error during ${phase}: ${errorMsg.substring(0, 200)}`,
          timestamp: new Date().toISOString(),
        }, config.webhookSecret).catch(err => {
          console.error(`[webhook] Failed to send failure webhook for ${id}: ${err.message}`);
        });
      }
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
