/**
 * Business Engine Integration Module for TTTranscribe
 *
 * This module provides ready-to-use functions for the Pluct Business Engine
 * to integrate with TTTranscribe API using JWT authentication and poll-first architecture.
 *
 * Features:
 * - JWT token generation with HS256
 * - Transcription request submission
 * - Status polling with exponential backoff
 * - Cost transparency
 * - Webhook handling
 * - Error handling
 *
 * Usage:
 *   const TTT = require('./business-engine-integration');
 *   await TTT.transcribe('https://www.tiktok.com/@user/video/123', 'req_123');
 */

const jwt = require('jsonwebtoken');
const https = require('https');
const http = require('http');

// Configuration (load from environment variables)
const CONFIG = {
  TTT_BASE_URL: process.env.TTT_BASE || 'https://iamromeoly-tttranscribe.hf.space',
  JWT_SECRET: process.env.JWT_SECRET || process.env.SHARED_SECRET,
  POLL_INTERVAL_SECONDS: parseInt(process.env.TTT_POLL_INTERVAL) || 3,
  MAX_POLL_ATTEMPTS: parseInt(process.env.TTT_MAX_POLL_ATTEMPTS) || 100,
  REQUEST_TIMEOUT_MS: parseInt(process.env.TTT_REQUEST_TIMEOUT) || 30000,
};

/**
 * Generate JWT token for TTTranscribe authentication
 * @param {string} requestId - Unique request ID from Business Engine
 * @param {number} expiresInSeconds - Token expiration time (default: 1 hour)
 * @returns {string} JWT token string
 */
function generateJwtToken(requestId, expiresInSeconds = 3600) {
  if (!CONFIG.JWT_SECRET) {
    throw new Error('JWT_SECRET not configured. Set JWT_SECRET or SHARED_SECRET environment variable.');
  }

  return jwt.sign(
    {
      iss: 'pluct-business-engine',
      sub: requestId,
      aud: 'tttranscribe',
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
      iat: Math.floor(Date.now() / 1000),
    },
    CONFIG.JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

/**
 * Make HTTP request to TTTranscribe API
 * @param {string} path - API path (e.g., '/transcribe')
 * @param {object} options - Request options
 * @returns {Promise<object>} Response data
 */
function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, CONFIG.TTT_BASE_URL);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Pluct-Business-Engine/1.0',
        ...options.headers,
      },
      timeout: CONFIG.REQUEST_TIMEOUT_MS,
    };

    const req = client.request(requestOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const error = new Error(parsed.message || `HTTP ${res.statusCode}`);
            error.statusCode = res.statusCode;
            error.response = parsed;
            reject(error);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

/**
 * Submit transcription request to TTTranscribe
 * @param {string} url - TikTok video URL
 * @param {string} requestId - Unique request ID
 * @param {string} webhookUrl - Optional webhook URL for completion notification
 * @returns {Promise<object>} Job details with status URL
 */
async function submitTranscriptionRequest(url, requestId, webhookUrl = null) {
  const token = generateJwtToken(requestId);

  const body = {
    url,
    requestId,
  };

  if (webhookUrl) {
    body.webhookUrl = webhookUrl;
  }

  return makeRequest('/transcribe', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body,
  });
}

/**
 * Get transcription status
 * @param {string} jobId - Job ID from submission
 * @param {string} requestId - Request ID for JWT auth
 * @returns {Promise<object>} Status details
 */
async function getTranscriptionStatus(jobId, requestId) {
  const token = generateJwtToken(requestId);

  return makeRequest(`/status/${jobId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
}

/**
 * Poll for transcription completion with exponential backoff
 * @param {string} jobId - Job ID
 * @param {string} requestId - Request ID
 * @param {function} onProgress - Optional progress callback
 * @returns {Promise<object>} Final transcription result
 */
async function pollUntilComplete(jobId, requestId, onProgress = null) {
  let attempts = 0;
  let backoffSeconds = CONFIG.POLL_INTERVAL_SECONDS;

  while (attempts < CONFIG.MAX_POLL_ATTEMPTS) {
    attempts++;

    try {
      const status = await getTranscriptionStatus(jobId, requestId);

      // Call progress callback if provided
      if (onProgress) {
        onProgress(status);
      }

      // Check if complete
      if (status.status === 'completed') {
        return status;
      }

      // Check if failed
      if (status.status === 'failed') {
        const error = new Error(status.error || status.message || 'Transcription failed');
        error.status = status;
        throw error;
      }

      // Wait before next poll (exponential backoff with max 10s)
      await new Promise((resolve) => setTimeout(resolve, backoffSeconds * 1000));
      backoffSeconds = Math.min(backoffSeconds * 1.5, 10);

    } catch (error) {
      // If status check fails, retry with backoff
      if (error.statusCode >= 500) {
        console.error(`Status check failed (attempt ${attempts}/${CONFIG.MAX_POLL_ATTEMPTS}):`, error.message);
        await new Promise((resolve) => setTimeout(resolve, backoffSeconds * 1000));
        backoffSeconds = Math.min(backoffSeconds * 2, 10);
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Polling timeout after ${attempts} attempts`);
}

/**
 * Complete transcription flow: submit and wait for result
 * @param {string} url - TikTok video URL
 * @param {string} requestId - Unique request ID
 * @param {object} options - Additional options
 * @returns {Promise<object>} Final transcription result
 */
async function transcribe(url, requestId, options = {}) {
  console.log(`[TTTranscribe] Submitting transcription request for: ${url}`);
  console.log(`[TTTranscribe] Request ID: ${requestId}`);

  // Step 1: Submit request
  const submission = await submitTranscriptionRequest(url, requestId, options.webhookUrl);
  console.log(`[TTTranscribe] Job queued: ${submission.id || submission.requestId}`);
  console.log(`[TTTranscribe] Status URL: ${submission.statusUrl || submission.statusPollUrl}`);

  const jobId = submission.id || submission.requestId || submission.request_id;

  // Step 2: Poll for completion
  console.log(`[TTTranscribe] Polling for completion (interval: ${CONFIG.POLL_INTERVAL_SECONDS}s)...`);

  const result = await pollUntilComplete(jobId, requestId, (status) => {
    console.log(`[TTTranscribe] Status: ${status.status} - ${status.message || status.note || 'Processing...'}`);

    // Show cost estimate if available
    if (status.estimatedCost && !status.estimatedCost.isCacheFree) {
      console.log(`[TTTranscribe] Estimated cost: ${status.estimatedCost.billingNote || 'TBD'}`);
    } else if (status.estimatedCost?.isCacheFree) {
      console.log(`[TTTranscribe] Cache hit - FREE!`);
    }

    // Call user progress callback if provided
    if (options.onProgress) {
      options.onProgress(status);
    }
  });

  console.log(`[TTTranscribe] Transcription completed!`);
  console.log(`[TTTranscribe] Text length: ${result.text?.length || 0} characters`);

  return result;
}

/**
 * Verify webhook signature (for webhook endpoint)
 * @param {string} payload - Webhook payload (JSON string)
 * @param {string} signature - Signature from X-TTT-Signature header
 * @param {string} secret - Webhook secret
 * @returns {boolean} True if signature is valid
 */
function verifyWebhookSignature(payload, signature, secret) {
  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return signature === expectedSignature;
}

/**
 * Handle webhook callback (for webhook endpoint)
 * @param {object} req - HTTP request object
 * @param {string} webhookSecret - Webhook secret for verification
 * @returns {Promise<object>} Parsed webhook data
 */
async function handleWebhook(req, webhookSecret) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        // Verify signature
        const signature = req.headers['x-ttt-signature'];
        if (!signature) {
          return reject(new Error('Missing X-TTT-Signature header'));
        }

        if (!verifyWebhookSignature(body, signature, webhookSecret)) {
          return reject(new Error('Invalid webhook signature'));
        }

        // Parse payload
        const data = JSON.parse(body);
        console.log(`[TTTranscribe] Webhook received: ${data.status} for ${data.requestId}`);

        resolve(data);
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Export all functions
module.exports = {
  // Main functions
  transcribe,
  submitTranscriptionRequest,
  getTranscriptionStatus,
  pollUntilComplete,

  // Utility functions
  generateJwtToken,
  verifyWebhookSignature,
  handleWebhook,

  // Configuration
  CONFIG,
};

// CLI interface for testing
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node business-engine-integration.js <url> <requestId> [webhookUrl]');
    console.log('');
    console.log('Example:');
    console.log('  node business-engine-integration.js https://www.tiktok.com/@user/video/123 req_123');
    console.log('');
    console.log('Environment Variables:');
    console.log('  JWT_SECRET or SHARED_SECRET - Required for authentication');
    console.log('  TTT_BASE - TTTranscribe base URL (default: https://iamromeoly-tttranscribe.hf.space)');
    console.log('  TTT_POLL_INTERVAL - Poll interval in seconds (default: 3)');
    console.log('  TTT_MAX_POLL_ATTEMPTS - Max polling attempts (default: 100)');
    process.exit(1);
  }

  const [url, requestId, webhookUrl] = args;

  transcribe(url, requestId, { webhookUrl })
    .then((result) => {
      console.log('');
      console.log('='.repeat(80));
      console.log('✅ TRANSCRIPTION COMPLETE');
      console.log('='.repeat(80));
      console.log(`Request ID: ${result.requestId || result.request_id}`);
      console.log(`Status: ${result.status}`);
      console.log(`Duration: ${result.audioDuration || 'N/A'}s`);
      console.log(`Characters: ${result.text?.length || 0}`);
      console.log('');
      console.log('Transcription:');
      console.log('-'.repeat(80));
      console.log(result.text || '(empty)');
      console.log('-'.repeat(80));
      process.exit(0);
    })
    .catch((error) => {
      console.error('');
      console.error('='.repeat(80));
      console.error('❌ TRANSCRIPTION FAILED');
      console.error('='.repeat(80));
      console.error(`Error: ${error.message}`);
      if (error.response) {
        console.error('Response:', JSON.stringify(error.response, null, 2));
      }
      process.exit(1);
    });
}
