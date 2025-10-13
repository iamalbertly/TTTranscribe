import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startJob, getStatus } from './queue';
import { validateTranscribeRequest, validateRequestId, validateEnvironment } from './validation';
import { ValidationError, AuthenticationError, setupGlobalErrorHandling } from './error-handler';

const app = new Hono();

// Environment variables
const PORT = process.env.PORT || '8788';
const ENGINE_SHARED_SECRET = process.env.ENGINE_SHARED_SECRET;

// Setup global error handling
setupGlobalErrorHandling();

// Validate environment on startup
const envValidation = validateEnvironment();
if (!envValidation.isValid) {
  console.error('Environment validation failed:', envValidation.errors);
  process.exit(1);
}

// Simple shared-secret authentication middleware
app.use('*', async (c, next) => {
  const key = c.req.header('X-Engine-Auth');
  
  if (!ENGINE_SHARED_SECRET) {
    console.error('ENGINE_SHARED_SECRET environment variable is required');
    return c.json({ error: 'server configuration error' }, 500);
  }
  
  if (key !== ENGINE_SHARED_SECRET) {
    throw new AuthenticationError('Invalid authentication token');
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
    const { url } = validateTranscribeRequest(body);
    
    const requestId = await startJob(url);
    
    return c.json({ 
      request_id: requestId, 
      status: 'accepted' 
    });
    
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    
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
    
    const idValidation = validateRequestId(id);
    if (!idValidation.isValid) {
      return c.json({ error: `Invalid request ID: ${idValidation.errors.join(', ')}` }, 400);
    }
    
    const status = getStatus(idValidation.sanitizedValue!);
    
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
    service: 'tttranscribe'
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

// Start server
const port = parseInt(PORT);
console.log(`Starting TTTranscribe server on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`TTTranscribe server running at http://localhost:${port}`);
