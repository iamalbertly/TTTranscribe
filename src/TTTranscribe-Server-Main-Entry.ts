import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startJob, getStatus, initializeJobProcessing } from './TTTranscribe-Queue-Job-Processing';
import { initializeConfig, TTTranscribeConfig } from './TTTranscribe-Config-Environment-Settings';
import { jobResultCache } from './TTTranscribe-Cache-Job-Results';
import { isValidTikTokUrl } from './TTTranscribe-Media-TikTok-Download';

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
 * Authentication middleware
 */
async function authMiddleware(c: any, next: any) {
  // Skip authentication for health checks and root endpoint
  if (c.req.path === '/health' || c.req.path === '/') {
    await next();
    return;
  }
  
  // Never bypass authentication in production (Hugging Face Spaces)
  if (config?.isHuggingFace) {
    const authHeader = c.req.header('X-Engine-Auth');
    const expectedSecret = config.engineSharedSecret;
    
    if (!authHeader || authHeader !== expectedSecret) {
      console.log(`❌ Authentication failed for ${getClientIP(c)}: missing or invalid X-Engine-Auth header`);
      return c.json({
        error: 'unauthorized',
        message: 'Missing or invalid X-Engine-Auth header',
        details: {
          provided: authHeader ? 'present' : 'missing',
          expected: 'X-Engine-Auth header with valid secret'
        }
      }, 401);
    }
    
    // Only log successful auth on first request or errors to reduce spam
    await next();
    return;
  }
  
  // Only allow auth bypass in local development with explicit flag
  const enableAuthBypass = (process.env.ENABLE_AUTH_BYPASS || 'false').toLowerCase() === 'true';
  
  // Only bypass auth in local development, never in production
  if (config?.isLocal && enableAuthBypass && !config?.isHuggingFace) {
    console.log(`Local development mode: bypassing authentication for ${getClientIP(c)}`);
    await next();
    return;
  }
  
  const authHeader = c.req.header('X-Engine-Auth');
  const expectedSecret = config?.engineSharedSecret;
  
  if (!authHeader || authHeader !== expectedSecret) {
    console.log(`Authentication failed for ${getClientIP(c)}: missing or invalid X-Engine-Auth header`);
    return c.json({
      error: 'unauthorized',
      message: 'Missing or invalid X-Engine-Auth header',
      details: {
        provided: authHeader ? 'present' : 'missing',
        expected: 'X-Engine-Auth header with valid secret'
      }
    }, 401);
  }
  
  await next();
}

/**
 * Rate limiting middleware
 */
async function rateLimitMiddleware(c: any, next: any) {
  // Skip rate limiting for health checks and root endpoint
  if (c.req.path === '/health' || c.req.path === '/' || c.req.path.startsWith('/status')) {
    await next();
    return;
  }
  
  const clientIP = getClientIP(c);
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
    console.log(`Rate limit exceeded for ${clientIP}, retry after ${retryAfter} seconds`);
    return c.json({
      error: 'rate_limited',
      message: 'Too many requests',
      details: { retryAfter: retryAfter }
    }, 429);
  }
  
  await next();
}

/**
 * Core transcribe handler (reused for compatibility routes)
 */
async function handleTranscribe(c: any) {
  try {
    let body;
    try {
      body = await c.req.json();
    } catch (jsonError) {
      console.error('JSON parsing error:', jsonError);
      return c.json({
        error: 'invalid_request',
        message: 'Invalid JSON in request body',
        details: {
          reason: 'malformed_json',
          expectedFormat: '{"url": "https://www.tiktok.com/@username/video/1234567890"}'
        }
      }, 400);
    }
    
    const { url, requestId: businessEngineRequestId } = body;
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
      request_id: requestId, // alias for clients expecting snake_case
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
          'X-Engine-Auth': 'your-secret-key',
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
          'X-Engine-Auth': 'your-secret-key',
          'Content-Type': 'application/json'
        },
        body: { url: 'https://vm.tiktok.com/ZMADQVF4e/' }
      },
      status: {
        method: 'GET',
        url: `${config.baseUrl}/status/{request_id}`,
        headers: { 'X-Engine-Auth': 'your-secret-key' }
      }
    }
  });
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
