import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startJob, getStatus } from './TTTranscribe-Queue-Job-Processing';
import { initializeConfig, TTTranscribeConfig } from './TTTranscribe-Config-Environment-Settings';

const app = new Hono();

// Initialize environment-aware configuration
let config: TTTranscribeConfig;

// Simple shared-secret authentication middleware (skip for health checks)
app.use('*', async (c, next) => {
  // Skip authentication for health checks and root endpoint
  if (c.req.path === '/health' || c.req.path === '/') {
    await next();
    return;
  }
  
  const key = c.req.header('X-Engine-Auth');
  const expectedKey = config.engineSharedSecret;
  
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
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'tttranscribe',
    version: '1.0.0',
    platform: config.isHuggingFace ? 'huggingface-spaces' : 'local',
    baseUrl: config.baseUrl,
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
        body: { url: 'https://www.tiktok.com/@user/video/123' }
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
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
