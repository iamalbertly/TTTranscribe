import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startJob, getStatus } from './TTTranscribe-Queue-Job-Processing';

const app = new Hono();

// Environment variables
const PORT = process.env.PORT || '8788';
const ENGINE_SHARED_SECRET = process.env.ENGINE_SHARED_SECRET;

// Simple environment validation
if (!process.env.ENGINE_SHARED_SECRET) {
  console.warn('⚠️  ENGINE_SHARED_SECRET not set, using default for development');
}

// Simple shared-secret authentication middleware (skip for health checks)
app.use('*', async (c, next) => {
  // Skip authentication for health checks and root endpoint
  if (c.req.path === '/health' || c.req.path === '/') {
    await next();
    return;
  }
  
  const key = c.req.header('X-Engine-Auth');
  const expectedKey = ENGINE_SHARED_SECRET || 'super-long-random';
  
  if (key !== expectedKey) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  
  await next();
});

/**
 * POST /transcribe
 * Accepts a TikTok URL and starts transcription job
 * Returns: { request_id, status: "accepted" }
 */
app.post('/transcribe', async (c) => {
  try {
    const body = await c.req.json();
    const { url } = body;
    
    if (!url || typeof url !== 'string') {
      return c.json({ error: 'missing url' }, 400);
    }
    
    // Basic TikTok URL validation
    if (!url.includes('tiktok.com') && !url.includes('vm.tiktok.com')) {
      return c.json({ error: 'invalid tiktok url' }, 400);
    }
    
    const requestId = await startJob(url);
    
    return c.json({ 
      request_id: requestId, 
      status: 'accepted' 
    });
    
  } catch (error) {
    console.error('Error in /transcribe:', error);
    return c.json({ error: 'internal server error' }, 500);
  }
});

/**
 * GET /status/:id
 * Returns job status and progress
 * Returns: { phase, percent, note, text? }
 */
app.get('/status/:id', async (c) => {
  try {
    const id = c.req.param('id');
    
    if (!id) {
      return c.json({ error: 'missing request id' }, 400);
    }
    
    const status = getStatus(id);
    
    if (!status) {
      return c.json({ error: 'not_found' }, 404);
    }
    
    return c.json(status);
    
  } catch (error) {
    console.error('Error in /status:', error);
    return c.json({ error: 'internal server error' }, 500);
  }
});

/**
 * Health check endpoint
 */
app.get('/health', async (c) => {
  const isHuggingFace = process.env.HF_SPACE_ID !== undefined;
  const hasAuthSecret = !!process.env.ENGINE_SHARED_SECRET;
  const hasHfApiKey = !!process.env.HF_API_KEY;
  
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'tttranscribe',
    version: '1.0.0',
    platform: isHuggingFace ? 'huggingface-spaces' : 'local',
    environment: {
      hasAuthSecret,
      hasHfApiKey,
      asrProvider: process.env.ASR_PROVIDER || 'hf',
      port: process.env.PORT || '8788'
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
    endpoints: [
      'POST /transcribe',
      'GET /status/:id',
      'GET /health'
    ]
  });
});

// Error handling
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'internal server error' }, 500);
});

// Start server with environment-adaptive configuration
const port = parseInt(PORT);
const isProduction = process.env.NODE_ENV === 'production';
const isHuggingFace = process.env.HF_SPACE_ID !== undefined;

console.log(`🎯 Starting TTTranscribe server on port ${port}...`);
console.log(`Environment: ${isProduction ? 'production' : 'development'}`);
console.log(`Platform: ${isHuggingFace ? 'Hugging Face Spaces' : 'local'}`);

try {
  serve({
    fetch: app.fetch,
    port,
  });

  if (isHuggingFace) {
    console.log(`✅ TTTranscribe server running on Hugging Face Spaces`);
  } else {
    console.log(`✅ TTTranscribe server running at http://localhost:${port}`);
  }
} catch (error) {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
}
