
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
 * Simplified webhook queue for visibility (no automatic retries)
 * Failed webhooks are logged here for manual review/retry
 */
type QueuedWebhook = {
  primaryUrl: string;
  payload: WebhookPayload;
  attempts: number;
  lastError?: string;
  timestamp: string;
  lastStatus?: number;
};

const failedWebhookQueue: QueuedWebhook[] = [];

export function getWebhookQueueStats() {
  return {
    pending: failedWebhookQueue.length,
    retryIntervalSeconds: 0, // No automatic retries
  };
}

export function getFailedWebhooks(): QueuedWebhook[] {
  return failedWebhookQueue;
}

/**
 * Basic webhook URL validation to catch config typos early.
 */
function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * Send webhook to Business Engine with a single retry for transient errors.
 */
export async function sendWebhookToBusinessEngine(
  webhookUrl: string,
  payload: Omit<WebhookPayload, 'signature' | 'idempotencyKey'>,
  secret?: string
): Promise<boolean> {
  if (!isValidWebhookUrl(webhookUrl)) {
    console.error(`[webhook] Invalid webhook URL configured: ${webhookUrl}`);
    return false;
  }

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

  const postWebhookOnce = async (): Promise<{ ok: boolean; status?: number; responseText?: string; errorMessage?: string }> => {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TTTranscribe-Signature': signedPayload.signature,
          'X-Idempotency-Key': signedPayload.idempotencyKey,
          'User-Agent': 'TTTranscribe/1.0 webhook',
        },
        body: JSON.stringify(signedPayload),
        signal: AbortSignal.timeout(WEBHOOK_CONFIG.timeoutMs),
      });

      const responseText = await response.text().catch(() => 'Unable to read response');
      return { ok: response.ok || response.status === 409, status: response.status, responseText };
    } catch (error: any) {
      return { ok: false, errorMessage: error?.message || 'Unknown fetch error' };
    }
  };

  const firstAttempt = await postWebhookOnce();

  if (firstAttempt.ok) {
    console.log(`[webhook] Successfully delivered for job ${payload.jobId}`);
    return true;
  }

  const shouldRetry =
    (firstAttempt.status && (firstAttempt.status >= 500 || firstAttempt.status === 429)) ||
    !!firstAttempt.errorMessage;

  if (shouldRetry) {
    console.warn(`[webhook] First attempt failed (status=${firstAttempt.status || 'n/a'}). Retrying once...`);
    await delay(Math.min(WEBHOOK_CONFIG.initialBackoffMs, 2000));
    const secondAttempt = await postWebhookOnce();
    if (secondAttempt.ok) {
      console.log(`[webhook] Retry succeeded for job ${payload.jobId}`);
      return true;
    }
    const errMsg = secondAttempt.errorMessage || `HTTP ${secondAttempt.status}: ${secondAttempt.responseText?.substring(0, 100) || 'unknown error'}`;
    console.warn(`[webhook] Retry failed: ${errMsg}`);
    console.warn(`[webhook] Client should poll /status/${payload.jobId} instead`);
    failedWebhookQueue.push({
      primaryUrl: webhookUrl,
      payload: signedPayload,
      attempts: 2,
      lastError: errMsg,
      lastStatus: secondAttempt.status,
      timestamp: new Date().toISOString()
    });
    return false;
  }

  const responseText = firstAttempt.responseText || firstAttempt.errorMessage || 'unknown error';
  console.warn(`[webhook] Failed to deliver: ${responseText.substring(0, 200)}`);
  console.warn(`[webhook] Client should poll /status/${payload.jobId} instead`);

  failedWebhookQueue.push({
    primaryUrl: webhookUrl,
    payload: signedPayload,
    attempts: 1,
    lastError: responseText.substring(0, 100),
    lastStatus: firstAttempt.status,
    timestamp: new Date().toISOString()
  });

  return false;
}

/**
 * Manually retry a failed webhook (for admin/support use)
 */
export async function retryFailedWebhook(jobId: string): Promise<boolean> {
  const webhookIndex = failedWebhookQueue.findIndex(w => w.payload.jobId === jobId);

  if (webhookIndex === -1) {
    console.error(`[webhook] Webhook for job ${jobId} not found in failed queue`);
    return false;
  }

  const webhook = failedWebhookQueue[webhookIndex];

  try {
    const response = await fetch(webhook.primaryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TTTranscribe-Signature': webhook.payload.signature,
        'X-Idempotency-Key': webhook.payload.idempotencyKey,
      },
      body: JSON.stringify(webhook.payload),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok || response.status === 409) {
      console.log(`[webhook] Manual retry succeeded for job ${jobId}`);
      failedWebhookQueue.splice(webhookIndex, 1);
      return true;
    }

    const responseText = await response.text().catch(() => 'Unable to read response');
    console.warn(`[webhook] Manual retry failed for job ${jobId}: ${response.status} ${responseText.substring(0, 100)}`);
    webhook.attempts += 1;
    webhook.lastError = `HTTP ${response.status}: ${responseText.substring(0, 100)}`;
    webhook.timestamp = new Date().toISOString();
    webhook.lastStatus = response.status;
    return false;
  } catch (error: any) {
    console.warn(`[webhook] Manual retry failed for job ${jobId}: ${error.message}`);
    webhook.attempts += 1;
    webhook.lastError = error.message;
    webhook.timestamp = new Date().toISOString();
    return false;
  }
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
