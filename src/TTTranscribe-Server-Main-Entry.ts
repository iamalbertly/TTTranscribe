import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startJob, getStatus } from './TTTranscribe-Queue-Job-Processing';
import { initializeConfig, TTTranscribeConfig } from './TTTranscribe-Config-Environment-Settings';
import { jobResultCache } from './TTTranscribe-Cache-Job-Results';

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
  if (c.req.path === '/health' || c.req.path === '/') {
    await next();
    return;
  }
  
  const clientIP = getClientIP(c);
  const capacity = parseInt(process.env.RATE_LIMIT_CAPACITY || '10');
  const refillRate = parseInt(process.env.RATE_LIMIT_REFILL_PER_MIN || '10');
  
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
 * POST /transcribe
 * Accepts a TikTok URL and starts transcription job
 * Returns: { request_id, status: "accepted" }
 */
app.post('/transcribe', authMiddleware, async (c) => {
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
    
    const { url } = body;
    
    if (!url || typeof url !== 'string') {
      return c.json({
        error: 'invalid_url',
        message: 'URL must be a valid TikTok video URL',
        details: {
          providedUrl: url || 'undefined',
          expectedFormat: 'https://www.tiktok.com/@username/video/1234567890'
        }
      }, 400);
    }
    
    // Basic TikTok URL validation
    if (!url.includes('tiktok.com') && !url.includes('vm.tiktok.com')) {
      return c.json({
        error: 'invalid_url',
        message: 'URL must be a valid TikTok video URL',
        details: {
          providedUrl: url,
          expectedFormat: 'https://www.tiktok.com/@username/video/1234567890'
        }
      }, 400);
    }
    
    const requestId = await startJob(url);
    
    return c.json({ 
      id: requestId, 
      status: 'queued',
      submittedAt: new Date().toISOString(),
      estimatedProcessingTime: 300,
      url: url
    }, 202);
    
  } catch (error) {
    console.error('Error in /transcribe:', error);
    return c.json({
      error: 'processing_failed',
      message: 'Failed to start transcription job',
      details: { reason: 'internal_error' }
    }, 500);
  }
});

/**
 * GET /status/:id
 * Returns job status and progress
 * Returns: { phase, percent, note, text? }
 */
app.get('/status/:id', authMiddleware, async (c) => {
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
    
    return c.json(status);
    
  } catch (error) {
    console.error('Error in /status:', error);
    return c.json({
      error: 'processing_failed',
      message: 'Failed to retrieve job status',
      details: { reason: 'internal_error' }
    }, 500);
  }
});

/**
 * Health check endpoint
 */
app.get('/health', async (c) => {
  const cacheStats = jobResultCache.getStats();
  
  return c.json({ 
    status: 'healthy',
    version: '1.0.0',
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
  return c.json({ 
    service: 'TTTranscribe',
    version: '1.0.0',
    platform: config.isHuggingFace ? 'huggingface-spaces' : 'local',
    baseUrl: config.baseUrl,
    endpoints: [
      'POST /transcribe',
      'GET /status/:id',
      'GET /health'
    ],
    documentation: {
      transcribe: {
        method: 'POST',
        url: `${config.baseUrl}/transcribe`,
        headers: { 'X-Engine-Auth': 'your-secret-key', 'Content-Type': 'application/json' },
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
    console.log(`   Auth Secret: ${config.engineSharedSecret ? 'Set' : 'Using default'}`);
    console.log(`   HF API Key: ${config.hfApiKey ? 'Set' : 'Not set'}`);
    console.log(`   ASR Provider: ${config.asrProvider}`);
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
