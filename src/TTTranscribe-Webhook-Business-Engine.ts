import fetch from 'node-fetch';
import * as crypto from 'crypto';

/**
 * Webhook payload sent to Business Engine when job completes or fails
 */
export interface WebhookPayload {
  jobId: string;
  requestId: string; // Original request ID from Business Engine
  status: 'completed' | 'failed';
  usage: {
    audioDurationSeconds: number;
    transcriptCharacters: number;
    modelUsed: string;
    processingTimeSeconds: number;
  };
  error?: string; // Error message if failed
  cacheHit?: boolean; // Indicates if result was served from cache (for billing optimization)
  timestamp: string;
  idempotencyKey: string; // Unique key to prevent duplicate processing
  signature: string; // HMAC signature for verification
}

/**
 * Retry configuration for webhook delivery
 */
const WEBHOOK_CONFIG = {
  maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || '5'),
  initialBackoffMs: parseInt(process.env.WEBHOOK_INITIAL_BACKOFF_MS || '1000'),
  maxBackoffMs: parseInt(process.env.WEBHOOK_MAX_BACKOFF_MS || '30000'),
  timeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS || '10000'),
};

/**
 * In-memory queue to re-drive webhooks that failed due to transient network/DNS errors.
 * Prevents losing billing notifications when Business Engine is briefly unreachable.
 */
type QueuedWebhook = {
  primaryUrl: string;
  fallbackUrl?: string;
  payload: WebhookPayload;
  attempts: number;
  lastError?: string;
};

const failedWebhookQueue: QueuedWebhook[] = [];
let retryTimer: NodeJS.Timeout | null = null;

function startRetryLoop() {
  if (retryTimer) return;
  retryTimer = setInterval(async () => {
    if (failedWebhookQueue.length === 0) return;
    const job = failedWebhookQueue.shift();
    if (!job) return;
    const success = await deliverWebhook(job.payload, job.primaryUrl, job.fallbackUrl);
    if (!success && job.attempts < WEBHOOK_CONFIG.maxRetries * 3) {
      job.attempts += 1;
      failedWebhookQueue.push(job);
    }
  }, 30000);
}

export function getWebhookQueueStats() {
  return {
    pending: failedWebhookQueue.length,
    retryIntervalSeconds: 30,
  };
}

/**
 * Generate HMAC signature for webhook payload
 * This allows Business Engine to verify the webhook came from TTTranscribe
 */
function generateSignature(payload: Omit<WebhookPayload, 'signature'>, secret: string): string {
  const data = JSON.stringify({
    jobId: payload.jobId,
    requestId: payload.requestId,
    status: payload.status,
    usage: payload.usage,
    timestamp: payload.timestamp,
    idempotencyKey: payload.idempotencyKey,
  });

  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');
}

/**
 * Send webhook to Business Engine with retry logic
 */
export async function sendWebhookToBusinessEngine(
  webhookUrl: string,
  payload: Omit<WebhookPayload, 'signature' | 'idempotencyKey'>,
  secret?: string
): Promise<boolean> {
  const webhookSecret = secret || process.env.BUSINESS_ENGINE_WEBHOOK_SECRET || process.env.SHARED_SECRET || '';

  if (!webhookSecret) {
    console.error('[webhook] BUSINESS_ENGINE_WEBHOOK_SECRET not configured, cannot send webhook');
    return false;
  }

  // Generate idempotency key from jobId + status to prevent duplicate charges
  const idempotencyKey = crypto
    .createHash('sha256')
    .update(`${payload.jobId}-${payload.status}-${payload.timestamp}`)
    .digest('hex');

  // Add signature to payload
  const signedPayload: WebhookPayload = {
    ...payload,
    idempotencyKey,
    signature: '',
  };

  signedPayload.signature = generateSignature(signedPayload, webhookSecret);

  console.log(`[webhook] Sending webhook for job ${payload.jobId} to ${webhookUrl}`);
  console.log(`[webhook] Idempotency key: ${idempotencyKey}`);
  console.log(`[webhook] Usage: ${payload.usage.audioDurationSeconds}s audio, ${payload.usage.transcriptCharacters} chars`);

  const fallbackUrl = process.env.BUSINESS_ENGINE_WEBHOOK_FALLBACK_URL;
  const success = await deliverWebhook(signedPayload, webhookUrl, fallbackUrl);
  if (!success) {
    failedWebhookQueue.push({
      primaryUrl: webhookUrl,
      fallbackUrl,
      payload: signedPayload,
      attempts: 0,
      lastError: 'exhausted immediate retries'
    });
    startRetryLoop();
    console.error(`[webhook] MANUAL REVIEW REQUIRED: Job ${signedPayload.jobId} queued for retry. Queue size: ${failedWebhookQueue.length}`);
  }

  return success;
}

async function deliverWebhook(
  signedPayload: WebhookPayload,
  webhookUrl: string,
  fallbackUrl?: string
): Promise<boolean> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < WEBHOOK_CONFIG.maxRetries) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_CONFIG.timeoutMs);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TTTranscribe-Signature': signedPayload.signature,
          'X-Idempotency-Key': signedPayload.idempotencyKey,
        },
        body: JSON.stringify(signedPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`[webhook] Successfully sent webhook for job ${signedPayload.jobId} (attempt ${attempt + 1})`);
        return true;
      }

      // If Business Engine responds with 409 Conflict, it means webhook was already processed (idempotent)
      if (response.status === 409) {
        console.log(`[webhook] Webhook for job ${signedPayload.jobId} already processed (409 Conflict), treating as success`);
        return true;
      }

      // Log response details for debugging
      const responseText = await response.text().catch(() => 'Unable to read response');
      console.warn(`[webhook] Failed to send webhook (attempt ${attempt + 1}/${WEBHOOK_CONFIG.maxRetries}): ${response.status} ${response.statusText}`);
      console.warn(`[webhook] Response: ${responseText.substring(0, 200)}`);

      lastError = new Error(`HTTP ${response.status}: ${responseText.substring(0, 100)}`);

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn(`[webhook] Webhook request timed out after ${WEBHOOK_CONFIG.timeoutMs}ms (attempt ${attempt + 1}/${WEBHOOK_CONFIG.maxRetries})`);
        lastError = new Error(`Timeout after ${WEBHOOK_CONFIG.timeoutMs}ms`);
      } else {
        console.warn(`[webhook] Webhook request failed (attempt ${attempt + 1}/${WEBHOOK_CONFIG.maxRetries}): ${error.message}`);
        lastError = error;
      }
    }

    attempt++;

    // If we have more retries, wait with exponential backoff
    if (attempt < WEBHOOK_CONFIG.maxRetries) {
      const backoffMs = Math.min(
        WEBHOOK_CONFIG.maxBackoffMs,
        WEBHOOK_CONFIG.initialBackoffMs * Math.pow(2, attempt - 1)
      );
      console.log(`[webhook] Retrying in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  if (fallbackUrl) {
    console.warn(`[webhook] Primary webhook URL failed for job ${signedPayload.jobId}. Attempting fallback URL ${fallbackUrl}`);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_CONFIG.timeoutMs);
      const response = await fetch(fallbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TTTranscribe-Signature': signedPayload.signature,
          'X-Idempotency-Key': signedPayload.idempotencyKey,
        },
        body: JSON.stringify(signedPayload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok || response.status === 409) {
        console.log(`[webhook] Fallback webhook succeeded for job ${signedPayload.jobId}`);
        return true;
      }
      const responseText = await response.text().catch(() => 'Unable to read response');
      console.warn(`[webhook] Fallback webhook failed: ${response.status} ${response.statusText} - ${responseText.substring(0, 150)}`);
      lastError = new Error(`Fallback HTTP ${response.status}`);
    } catch (fallbackErr: any) {
      console.warn(`[webhook] Fallback webhook threw: ${fallbackErr.message}`);
      lastError = fallbackErr;
    }
  }

  console.error(`[webhook] Failed to send webhook for job ${signedPayload.jobId} after ${WEBHOOK_CONFIG.maxRetries} attempts`);
  console.error(`[webhook] Last error: ${lastError?.message}`);

  // Even if webhook fails, we don't want to crash the job processing
  // Log the failure for manual review/retry
  console.error(`[webhook] MANUAL REVIEW REQUIRED: Job ${signedPayload.jobId} completed but webhook failed`);

  return false;
}

/**
 * Calculate billable usage from transcription result
 */
export function calculateUsage(
  audioDurationSeconds: number,
  transcriptText: string,
  modelUsed: string,
  processingStartTime: number
): WebhookPayload['usage'] {
  return {
    audioDurationSeconds: Math.round(audioDurationSeconds * 100) / 100, // Round to 2 decimals
    transcriptCharacters: transcriptText.length,
    modelUsed,
    processingTimeSeconds: Math.round((Date.now() - processingStartTime) / 1000),
  };
}

/**
 * Verify incoming webhook signature (used if Business Engine sends webhooks to TTTranscribe)
 */
export function verifyWebhookSignature(
  payload: WebhookPayload,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = generateSignature(payload, secret);

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}
