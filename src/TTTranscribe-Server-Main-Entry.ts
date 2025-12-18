import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startJob, getStatus, initializeJobProcessing } from './TTTranscribe-Queue-Job-Processing';
import { initializeConfig, TTTranscribeConfig } from './TTTranscribe-Config-Environment-Settings';
import { jobResultCache } from './TTTranscribe-Cache-Job-Results';
import { isValidTikTokUrl } from './TTTranscribe-Media-TikTok-Download';
import fetch from 'node-fetch';
import { getWebhookQueueStats, getFailedWebhooks, retryFailedWebhook } from './TTTranscribe-Webhook-Business-Engine';
import jwt from 'jsonwebtoken';

// Rate limiting implementation
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per minute

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this.refillRate = refillRate;
  }

  tryConsume(tokens: number = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000 / 60; // minutes
    const tokensToAdd = timePassed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getTokensRemaining(): number {
    this.refill();
    return this.tokens;
  }

  getTimeUntilRefill(): number {
    this.refill();
    if (this.tokens >= this.capacity) return 0;
    return Math.ceil((this.capacity - this.tokens) / this.refillRate * 60); // seconds
  }
}

// Rate limiters per IP
const rateLimiters = new Map<string, TokenBucket>();

const app = new Hono();

// Initialize environment-aware configuration
let config: TTTranscribeConfig;

type ReadinessState = {
  ok: boolean;
  checkedAt: number;
  message?: string;
  missing?: string[];
};

let readinessCache: ReadinessState = { ok: true, checkedAt: 0, message: 'not checked yet' };

/**
 * Parse Bearer token from Authorization header for Business Engine compatibility.
 */
function getBearerToken(authHeader?: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/Bearer (.+)/i);
  return match ? match[1].trim() : null;
}

/**
 * JWT payload interface for type safety
 */
interface JwtPayload {
  iss: string;  // issuer (pluct-business-engine)
  sub: string;  // subject (requestId)
  aud: string;  // audience (tttranscribe)
  exp: number;  // expiration timestamp
  iat: number;  // issued at timestamp
}

/**
 * Validate JWT token and extract requestId
 */
function validateJwtAuth(token: string): { valid: boolean; requestId?: string; error?: string } {
  try {
    const jwtSecret = process.env.JWT_SECRET || process.env.SHARED_SECRET;
    if (!jwtSecret) {
      return { valid: false, error: 'JWT_SECRET not configured' };
    }

    const decoded = jwt.verify(token, jwtSecret, {
      algorithms: ['HS256'],
      audience: 'tttranscribe',
      issuer: 'pluct-business-engine'
    }) as JwtPayload;

    return { valid: true, requestId: decoded.sub };
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired' };
    }
    if (err.name === 'JsonWebTokenError') {
      return { valid: false, error: 'Invalid token' };
    }
    return { valid: false, error: err.message };
  }
}

/**
 * Safely parse JSON body while preserving the raw payload for diagnostics.
 * Helps debug malformed bodies coming from upstream proxies (Business Engine/mobile).
 */
async function readJsonBody(c: any): Promise<{ data: any | null; raw: string }> {
  const raw = await c.req.text();

  if (!raw || raw.trim().length === 0) {
    return { data: null, raw: '' };
  }

  try {
    return { data: JSON.parse(raw), raw };
  } catch (err: any) {
    console.error('JSON parsing error:', {
      message: err?.message,
      rawPreview: raw.substring(0, 200),
      contentType: c.req.header('content-type') || 'missing',
      client: {
        ip: getClientIP(c),
        userAgent: c.req.header('User-Agent') || '',
        clientVersion: c.req.header('X-Client-Version') || '',
        clientPlatform: c.req.header('X-Client-Platform') || '',
      }
    });
    throw err;
  }
}

async function checkReadiness(): Promise<ReadinessState> {
  const now = Date.now();
  if (now - readinessCache.checkedAt < 30000 && readinessCache.checkedAt !== 0) {
    return readinessCache;
  }

  const missing: string[] = [];
  if (!config?.engineSharedSecret) missing.push('ENGINE_SHARED_SECRET');
  if (!config?.webhookUrl) missing.push('BUSINESS_ENGINE_WEBHOOK_URL');
  if (!config?.hfApiKey) missing.push('HF_API_KEY');

  if (missing.length > 0) {
    readinessCache = { ok: false, checkedAt: now, missing, message: 'Missing required secrets' };
    return readinessCache;
  }

  // Lightweight DNS reachability check for webhook host
  let webhookReachable = true;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    await fetch(config.webhookUrl, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeoutId);
  } catch (err: any) {
    webhookReachable = false;
  }

  readinessCache = {
    ok: true,
    checkedAt: now,
    message: webhookReachable ? 'ready' : 'Webhook endpoint unreachable (will retry but accepting requests)',
    missing: []
  };
  return readinessCache;
}

/**
 * Get client IP address (considering X-Forwarded-For header)
 */
function getClientIP(c: any): string {
  const forwardedFor = c.req.header('X-Forwarded-For');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return c.req.header('X-Real-IP') || 'unknown';
}

/**
 * Authentication middleware - supports both JWT and static secret
 */
async function authMiddleware(c: any, next: any) {
  // Skip authentication for health checks, root endpoint, and readiness
  if (c.req.path === '/health' || c.req.path === '/' || c.req.path === '/ready') {
    await next();
    return;
  }

  const clientInfo = {
    ip: getClientIP(c),
    userAgent: c.req.header('User-Agent') || '',
    clientVersion: c.req.header('X-Client-Version') || '',
    clientPlatform: c.req.header('X-Client-Platform') || '',
    path: c.req.path,
    method: c.req.method
  };

  // Only allow auth bypass in local development with explicit flag
  const enableAuthBypass = (process.env.ENABLE_AUTH_BYPASS || 'false').toLowerCase() === 'true';
  if (config?.isLocal && enableAuthBypass && !config?.isHuggingFace) {
    console.log(`Local development mode: bypassing authentication for ${getClientIP(c)}`);
    await next();
    return;
  }

  // Try to get auth token from Authorization header or X-Engine-Auth header
  const authorizationHeader = c.req.header('Authorization');
  const xEngineAuthHeader = c.req.header('X-Engine-Auth');
  const token = getBearerToken(authorizationHeader) || xEngineAuthHeader;

  if (!token) {
    console.error(JSON.stringify({
      type: 'auth_error',
      reason: 'missing_authorization_header',
      expected: 'Authorization: Bearer <JWT> or X-Engine-Auth: <SECRET>',
      ...clientInfo
    }));
    return c.json({
      error: 'unauthorized',
      message: 'Missing Authorization header',
      details: {
        expected: 'Authorization: Bearer <JWT> or X-Engine-Auth: <SECRET>',
        ...clientInfo
      }
    }, 401);
  }

  // Try JWT validation first
  const jwtResult = validateJwtAuth(token);
  if (jwtResult.valid) {
    c.set('requestId', jwtResult.requestId);
    c.set('authMethod', 'jwt');
    console.log(`[auth] JWT authenticated: requestId=${jwtResult.requestId}`);
    await next();
    return;
  }

  // Fallback to static secret (backward compatibility)
  const expectedSecret = config?.engineSharedSecret;
  if (token === expectedSecret) {
    c.set('authMethod', 'static-secret');
    console.log(`[auth] Static secret authenticated`);
    await next();
    return;
  }

  // Both methods failed - return detailed error
  console.error(JSON.stringify({
    type: 'auth_error',
    reason: 'invalid_token_or_secret',
    jwtError: jwtResult.error,
    ...clientInfo
  }));

  return c.json({
    error: 'unauthorized',
    message: 'Invalid authentication token',
    details: {
      jwtError: jwtResult.error || 'Invalid JWT token',
      hint: 'Use JWT token (recommended) or static secret',
      ...clientInfo
    }
  }, 401);
}

/**
 * Rate limiting middleware
 */
async function rateLimitMiddleware(c: any, next: any) {
  // Skip rate limiting for health checks, root endpoint, and status checks
  if (c.req.path === '/health' || c.req.path === '/' || c.req.path.startsWith('/status')) {
    await next();
    return;
  }

  const clientIP = getClientIP(c);

  // Skip rate limiting for Hugging Face internal health checks and monitoring
  // HF Spaces uses specific IPv6 ranges for health checks
  if (config?.isHuggingFace && (
    clientIP.startsWith('2a06:98c0:') || // HF Spaces health check IPv6 range
    clientIP === 'unknown' ||
    clientIP === '::1' ||
    clientIP === '127.0.0.1'
  )) {
    console.log(`[rate-limit] Skipping rate limit for HF internal IP: ${clientIP}`);
    await next();
    return;
  }

  const capacity = config?.rateLimitCapacity ?? parseInt(process.env.RATE_LIMIT_CAPACITY || '10');
  const refillRate = config?.rateLimitRefillPerMin ?? parseInt(process.env.RATE_LIMIT_REFILL_PER_MIN || '10');

  // Get or create rate limiter for this IP
  let limiter = rateLimiters.get(clientIP);
  if (!limiter) {
    limiter = new TokenBucket(capacity, refillRate);
    rateLimiters.set(clientIP, limiter);
  }

  if (!limiter.tryConsume()) {
    const retryAfter = limiter.getTimeUntilRefill();
    console.error(`[rate-limit] Rate limit exceeded for IP ${clientIP}, retry after ${retryAfter} seconds. Path: ${c.req.path}, Method: ${c.req.method}`);
    return c.json({
      error: 'rate_limited',
      message: 'Too many requests. Please wait before retrying.',
      details: {
        retryAfter: retryAfter,
        retryAfterTimestamp: new Date(Date.now() + retryAfter * 1000).toISOString(),
        rateLimitInfo: {
          capacity,
          refillRate: `${refillRate} tokens per minute`,
          tokensRemaining: Math.floor(limiter.getTokensRemaining())
        }
      }
    }, 429);
  }

  await next();
}

/**
 * Core transcribe handler (reused for compatibility routes)
 */
async function handleTranscribe(c: any) {
  try {
    let parsedBody;
    let rawBody = '';
    try {
      const { data, raw } = await readJsonBody(c);
      parsedBody = data;
      rawBody = raw;
    } catch (jsonError: any) {
      return c.json({
        error: 'invalid_request',
        message: 'Invalid JSON in request body',
        details: {
          reason: 'malformed_json',
          expectedFormat: '{"url": "https://www.tiktok.com/@username/video/1234567890"}',
          rawPreview: rawBody.substring(0, 120) || undefined
        }
      }, 400);
    }

    const readiness = await checkReadiness();
    if (!readiness.ok) {
      return c.json({
        error: 'service_unavailable',
        message: 'TTTranscribe is not ready yet',
        details: {
          reason: readiness.message,
          missing: readiness.missing
        }
      }, 503);
    }
    
    const { url, requestId: businessEngineRequestId } = parsedBody || {};
    const sanitizedUrl = typeof url === 'string' ? url.trim() : url;

    if (!sanitizedUrl || typeof sanitizedUrl !== 'string') {
      return c.json({
        error: 'invalid_url',
        message: 'URL must be a valid TikTok video URL',
        details: {
          providedUrl: sanitizedUrl || 'undefined',
          expectedFormat: 'https://www.tiktok.com/@username/video/1234567890'
        }
      }, 400);
    }

    // Basic TikTok URL validation
    if (!isValidTikTokUrl(sanitizedUrl)) {
      return c.json({
        error: 'invalid_url',
        message: 'URL must be a valid TikTok video URL',
        details: {
          providedUrl: sanitizedUrl,
          expectedFormat: 'https://www.tiktok.com/@username/video/1234567890'
        }
      }, 400);
    }

    // Start the transcription job with optional Business Engine request ID for webhook callback
    const requestId = await startJob(sanitizedUrl, businessEngineRequestId);
    
    return c.json({ 
      id: requestId,
      requestId: requestId, // camelCase alias for Business Engine compatibility
      request_id: requestId, // alias for clients expecting snake_case
      statusPollUrl: `${config.baseUrl}/status/${requestId}`,
      status: 'queued',
      submittedAt: new Date().toISOString(),
      estimatedProcessingTime: 300,
      url: sanitizedUrl
    }, 202);
    
  } catch (error) {
    console.error('Error in /transcribe:', error);
    return c.json({
      error: 'processing_failed',
      message: 'Failed to start transcription job',
      details: { reason: 'internal_error' }
    }, 500);
  }
}

/**
 * POST /transcribe
 * Accepts a TikTok URL and starts transcription job
 * Returns: { request_id, status: "accepted" }
 */
app.post('/transcribe', authMiddleware, handleTranscribe);

// Compatibility alias for Business Engine
app.post('/ttt/transcribe', authMiddleware, handleTranscribe);

/**
 * Core estimate handler (reused for compatibility routes)
 */
async function handleEstimate(c: any) {
  try {
    let body;
    try {
      body = await c.req.json();
    } catch (jsonError) {
      return c.json({
        error: 'invalid_request',
        message: 'Invalid JSON in request body',
        details: {
          reason: 'malformed_json',
          expectedFormat: '{"url": "https://www.tiktok.com/@username/video/1234567890"}'
        }
      }, 400);
    }

    const { url } = body;
    const sanitizedUrl = typeof url === 'string' ? url.trim() : url;

    if (!sanitizedUrl || typeof sanitizedUrl !== 'string') {
      return c.json({
        error: 'invalid_url',
        message: 'URL must be a valid TikTok video URL',
        details: {
          providedUrl: sanitizedUrl || 'undefined',
          expectedFormat: 'https://www.tiktok.com/@username/video/1234567890'
        }
      }, 400);
    }

    if (!isValidTikTokUrl(sanitizedUrl)) {
      return c.json({
        error: 'invalid_url',
        message: 'URL must be a valid TikTok video URL',
        details: {
          providedUrl: sanitizedUrl,
          expectedFormat: 'https://www.tiktok.com/@username/video/1234567890'
        }
      }, 400);
    }

    // For now, return estimated cost based on average TikTok video length (30-60 seconds)
    // In the future, we could use yt-dlp to fetch video metadata without downloading
    const estimatedDurationSeconds = 45; // Average TikTok video length
    const modelUsed = process.env.WHISPER_MODEL_SIZE || 'base';

    // Calculate estimated credits based on duration
    // This is a simple estimate - Business Engine will have the actual pricing logic
    const creditsPerMinute = modelUsed === 'large' ? 2 : 1;
    const estimatedCredits = Math.ceil((estimatedDurationSeconds / 60) * creditsPerMinute);

    return c.json({
      estimatedCredits,
      estimatedDurationSeconds,
      modelUsed: `openai-whisper-${modelUsed}`,
      note: 'This is an estimate. Actual cost will be based on real audio duration.',
    });

  } catch (error) {
    console.error('Error in /estimate:', error);
    return c.json({
      error: 'processing_failed',
      message: 'Failed to estimate cost',
      details: { reason: 'internal_error' }
    }, 500);
  }
}

/**
 * POST /estimate
 * Estimate cost for transcribing a video before submitting
 * Body: { url: string }
 * Returns: { estimatedCost, estimatedDuration, modelUsed }
 */
app.post('/estimate', authMiddleware, handleEstimate);

// Compatibility alias for Business Engine
app.post('/ttt/estimate', authMiddleware, handleEstimate);

/**
 * Core status handler (reused for compatibility routes)
 */
async function handleStatus(c: any) {
  try {
    const id = c.req.param('id');
    
    if (!id) {
      return c.json({
        error: 'invalid_url',
        message: 'Missing job ID parameter',
        details: {
          providedId: id || 'undefined',
          expectedFormat: 'valid job ID'
        }
      }, 400);
    }
    
    const status = getStatus(id);
    
    if (!status) {
      return c.json({
        error: 'job_not_found',
        message: 'Transcription job not found',
        details: { jobId: id }
      }, 404);
    }
    
    return c.json({
      ...status,
      request_id: status.id // snake_case alias for compatibility
    });
    
  } catch (error) {
    console.error('Error in /status:', error);
    return c.json({
      error: 'processing_failed',
      message: 'Failed to retrieve job status',
      details: { reason: 'internal_error' }
    }, 500);
  }
}

/**
 * GET /status/:id
 * Returns job status and progress
 * Returns: { phase, percent, note, text? }
 */
app.get('/status/:id', authMiddleware, handleStatus);

// Compatibility alias for Business Engine
app.get('/ttt/status/:id', authMiddleware, handleStatus);

/**
 * Health check endpoint
 */
app.get('/health', async (c) => {
  const cacheStats = jobResultCache.getStats();
  const readiness = await checkReadiness();
  const capacity = config?.rateLimitCapacity ?? parseInt(process.env.RATE_LIMIT_CAPACITY || '10');
  const refillRate = config?.rateLimitRefillPerMin ?? parseInt(process.env.RATE_LIMIT_REFILL_PER_MIN || '10');

  return c.json({
    status: 'healthy',
    version: config.apiVersion,
    apiVersion: config.apiVersion,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'tttranscribe',
    platform: config.isHuggingFace ? 'huggingface-spaces' : 'local',
    baseUrl: config.baseUrl,
    cache: {
      size: cacheStats.size,
      hitRate: cacheStats.hitRate,
      hitCount: cacheStats.hitCount,
      missCount: cacheStats.missCount,
      oldestEntry: cacheStats.oldestEntry
    },
    readiness: {
      ok: readiness.ok,
      message: readiness.message,
      missing: readiness.missing
    },
    rateLimit: {
      capacityPerIp: capacity,
      refillPerMinute: refillRate
    },
    webhook: {
      queueSize: getWebhookQueueStats().pending,
      retryIntervalSeconds: getWebhookQueueStats().retryIntervalSeconds,
      targetUrl: config.webhookUrl
    },
    environment: {
      hasAuthSecret: !!config.engineSharedSecret,
      hasHfApiKey: !!config.hfApiKey,
      hasWebhookUrl: !!config.webhookUrl,
      hasWebhookSecret: !!config.webhookSecret,
      asrProvider: config.asrProvider,
      port: config.port,
      tmpDir: config.tmpDir
    }
  });
});

/**
 * Root endpoint
 */
app.get('/', async (c) => {
  const clientVersion = c.req.header('X-Client-Version') || 'unknown';
  const clientPlatform = c.req.header('X-Client-Platform') || 'unknown';

  return c.json({
    service: 'TTTranscribe',
    version: config.apiVersion,
    apiVersion: config.apiVersion,
    platform: config.isHuggingFace ? 'huggingface-spaces' : 'local',
    baseUrl: config.baseUrl,
    rateLimit: {
      capacityPerIp: config?.rateLimitCapacity ?? parseInt(process.env.RATE_LIMIT_CAPACITY || '10'),
      refillPerMinute: config?.rateLimitRefillPerMin ?? parseInt(process.env.RATE_LIMIT_REFILL_PER_MIN || '10'),
    },
    supportedClientVersions: {
      minimum: '1.0.0',
      recommended: '1.0.0',
      latest: '1.0.0'
    },
    clientInfo: {
      detectedVersion: clientVersion,
      detectedPlatform: clientPlatform
    },
    endpoints: [
      'POST /transcribe',
      'POST /estimate',
      'GET /status/:id',
      'GET /health'
    ],
    documentation: {
      transcribe: {
        method: 'POST',
        url: `${config.baseUrl}/transcribe`,
        headers: {
          'Authorization': 'Bearer <ENGINE_SHARED_SECRET>',
          'Content-Type': 'application/json',
          'X-Client-Version': '1.0.0',
          'X-Client-Platform': 'ios|android|web'
        },
        body: {
          url: 'https://vm.tiktok.com/ZMADQVF4e/',
          requestId: 'business-engine-uuid'
        }
      },
      estimate: {
        method: 'POST',
        url: `${config.baseUrl}/estimate`,
        headers: {
          'Authorization': 'Bearer <ENGINE_SHARED_SECRET>',
          'Content-Type': 'application/json'
        },
        body: { url: 'https://vm.tiktok.com/ZMADQVF4e/' }
      },
      status: {
        method: 'GET',
        url: `${config.baseUrl}/status/{request_id}`,
        headers: { 'Authorization': 'Bearer <ENGINE_SHARED_SECRET>' }
      }
    },
    errors: {
      download_blocked: 'TikTok blocked the download (bot protection). Try later.',
      download_not_found: 'Video not found or removed.',
      download_network: 'Network error while downloading video.',
      download_unknown: 'Unknown download failure.'
    }
  });
});

/**
 * Deep readiness probe endpoint (lightweight)
 */
app.get('/ready', async (c) => {
  const readiness = await checkReadiness();
  if (!readiness.ok) {
    return c.json({ ready: false, reason: readiness.message, missing: readiness.missing }, 503);
  }
  return c.json({ ready: true, checkedAt: readiness.checkedAt });
});

/**
 * GET /admin/webhook-queue
 * Returns list of failed webhooks for visibility
 */
app.get('/admin/webhook-queue', authMiddleware, async (c) => {
  const failedWebhooks = getFailedWebhooks();
  return c.json({
    failed: failedWebhooks.map(w => ({
      jobId: w.payload.jobId,
      url: w.primaryUrl,
      attempts: w.attempts,
      lastError: w.lastError,
      timestamp: w.timestamp,
      canRetry: true
    })),
    totalFailed: failedWebhooks.length
  });
});

/**
 * POST /admin/retry-webhook/:jobId
 * Manually retry a failed webhook (for admin/support)
 */
app.post('/admin/retry-webhook/:jobId', authMiddleware, async (c) => {
  const jobId = c.req.param('jobId');

  if (!jobId) {
    return c.json({ error: 'Missing job ID parameter' }, 400);
  }

  const success = await retryFailedWebhook(jobId);

  if (success) {
    return c.json({
      success: true,
      message: `Webhook for job ${jobId} delivered successfully`,
      jobId
    });
  } else {
    return c.json({
      success: false,
      message: `Webhook for job ${jobId} delivery failed again`,
      jobId
    }, 500);
  }
});

// Error handling
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'internal server error' }, 500);
});

// Initialize configuration and start server
async function startServer() {
  try {
    // Initialize environment-aware configuration
    config = await initializeConfig();

    // Initialize job processing with configuration
    initializeJobProcessing(config);

    console.log(`🎯 Starting TTTranscribe server on port ${config.port}...`);
    console.log(`🔐 Config loaded: isHuggingFace=${config.isHuggingFace}, isLocal=${config.isLocal}`);

    // Set up rate limiting middleware
    app.use('*', rateLimitMiddleware);

    console.log(`🔐 Middleware registered with config: isHuggingFace=${config.isHuggingFace}`);
    
    serve({
      fetch: app.fetch,
      port: config.port,
    });

    if (config.isHuggingFace) {
      console.log(`✅ TTTranscribe server running on Hugging Face Spaces`);
      console.log(`🔗 Access your space at: ${config.baseUrl}`);
    } else {
      console.log(`✅ TTTranscribe server running at ${config.baseUrl}`);
    }
    
    console.log(`📋 Configuration:`);
    console.log(`   Platform: ${config.isHuggingFace ? 'Hugging Face Spaces' : 'Local Development'}`);
    console.log(`   Base URL: ${config.baseUrl}`);
    console.log(`   API Version: ${config.apiVersion}`);
    console.log(`   Auth Secret: ${config.engineSharedSecret ? 'Set' : 'Using default'}`);
    console.log(`   HF API Key: ${config.hfApiKey ? 'Set' : 'Not set'}`);
    console.log(`   ASR Provider: ${config.asrProvider}`);
    console.log(`   Webhook URL: ${config.webhookUrl}`);
    console.log(`   Webhook Secret: ${config.webhookSecret ? 'Set' : 'Not set'}`);
    console.log(`   Temp Directory: ${config.tmpDir}`);
    
    // Start cache cleanup interval (every hour)
    setInterval(() => {
      jobResultCache.cleanup();
    }, 60 * 60 * 1000);
    
    console.log(`🔄 Cache cleanup scheduled every hour`);
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
