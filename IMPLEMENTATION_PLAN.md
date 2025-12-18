# TTTranscribe Strategic Overhaul - Implementation Plan

## Executive Summary

This plan addresses critical architectural failures in TTTranscribe that violate our core values of **Customer**, **Simplicity**, and **Trust**. The current system suffers from authentication failures, webhook dependency creating silent failures, and excessive complexity. This plan implements a complete overhaul in 4 hours while maintaining 100% backward compatibility.

### Critical Issues Identified
1. **Trust Violation**: Static secret auth fails with 401 errors, no token refresh mechanism
2. **Customer Violation**: Webhook-only architecture creates invisible failures, no progress visibility
3. **Simplicity Violation**: 200+ lines of fragile webhook retry code, overcomplicated error handling

### Strategic Solution
- **JWT Authentication**: Replace static secrets with time-limited, self-validating tokens
- **Poll-First Architecture**: Make webhooks optional, status polling primary integration method
- **Simplified Webhooks**: Remove retry complexity, single attempt with queue visibility
- **Customer UX**: Progressive status messages, cost estimation before processing, cache=free
- **Zero Budget**: Leverage existing infrastructure, no new services

---

## Page 1: Investigation & Root Cause Analysis

### Issue #1: Authentication System Failures ❌ CRITICAL

**Symptoms**:
- Mobile clients sending `Authorization: Bearer <token>` receive 401 errors
- No token refresh mechanism leads to expired sessions
- Static shared secrets are security theater (not cryptographically validated)

**Root Cause**: [src/TTTranscribe-Server-Main-Entry.ts:183-197](src/TTTranscribe-Server-Main-Entry.ts#L183-L197)
```typescript
// Current implementation only checks static secret match
const authHeader = c.req.header('X-Engine-Auth') || c.req.header('Authorization');
const providedSecret = authHeader?.replace(/^Bearer\s+/i, '').trim();
if (providedSecret !== config.sharedSecret) {
  return c.json({ error: 'Unauthorized' }, 401);
}
```

**Impact**:
- Business Engine cannot integrate reliably
- Mobile clients fail authentication randomly
- No audit trail of who made requests
- Cannot revoke compromised tokens
- Zero visibility into auth failures

**Solution Design**:
1. **JWT Token Generation** (Business Engine side):
   ```typescript
   import jwt from 'jsonwebtoken';

   function generateTTTranscribeToken(requestId: string): string {
     return jwt.sign(
       {
         iss: 'pluct-business-engine',
         sub: requestId,
         aud: 'tttranscribe',
         exp: Math.floor(Date.now() / 1000) + (60 * 60), // 1 hour
         iat: Math.floor(Date.now() / 1000),
       },
       process.env.JWT_SECRET!,
       { algorithm: 'HS256' }
     );
   }
   ```

2. **JWT Token Validation** (TTTranscribe side):
   ```typescript
   import jwt from 'jsonwebtoken';

   function validateJwtToken(token: string): { valid: boolean; requestId?: string; error?: string } {
     try {
       const decoded = jwt.verify(token, process.env.JWT_SECRET!, {
         algorithms: ['HS256'],
         audience: 'tttranscribe',
         issuer: 'pluct-business-engine'
       });
       return { valid: true, requestId: decoded.sub };
     } catch (err: any) {
       return { valid: false, error: err.message };
     }
   }
   ```

3. **Backward Compatibility**: Support both JWT and static secrets during migration

**Testing Strategy**:
- Generate JWT with valid claims → should authenticate
- Generate JWT with expired exp → should reject with 401
- Generate JWT with wrong audience → should reject with 401
- Send static secret (legacy) → should still work during migration
- Send invalid token → should reject with clear error message

---

### Issue #2: Webhook Dependency Creates Silent Failures ❌ CRITICAL

**Symptoms**:
- Transcription succeeds but Business Engine never receives webhook
- Mobile clients wait indefinitely for completion notification
- No way for customers to check job progress
- Webhook failures logged but not surfaced to users

**Root Cause**: Architecture relies on push notifications without pull fallback

**Current Flow** (broken):
```
Mobile Client → Business Engine → TTTranscribe
                                      ↓ (transcription succeeds)
                                      ↓ (webhook fails - DNS/network)
                                      ✗ (Business Engine never knows)
                ← (client waits forever)
```

**Impact**:
- Customer sees "processing" forever even when completed
- No way to recover from webhook failures
- Business Engine cannot bill for successful transcriptions
- Support tickets for "stuck" jobs that actually completed
- Lost revenue from successful but unreported transcriptions

**Solution Design - Poll-First Architecture**:

1. **Primary Integration Method**: Status polling endpoint
   ```typescript
   // GET /status/:jobId - Returns current status
   {
     "id": "abc123",
     "status": "completed",
     "phase": "TRANSCRIBING",
     "progress": 100,
     "message": "Transcription complete",
     "result": { "transcription": "...", "duration": 45.2 },
     "cacheHit": false,
     "estimatedCost": { "audioDurationSeconds": 45.2, "characters": 892 },
     "timestamp": "2025-01-15T10:30:00Z"
   }
   ```

2. **Progressive Status Messages**:
   ```typescript
   const PROGRESSIVE_STATUS = {
     QUEUED: "Job queued, waiting for processing...",
     DOWNLOADING: "Downloading video from TikTok... (this may take 10-30 seconds)",
     TRANSCRIBING: "Transcribing audio with Whisper AI... (processing {duration}s of audio)",
     COMPLETED: "Transcription complete! {characters} characters transcribed.",
     FAILED: "Transcription failed: {error}. Please try again or contact support."
   };
   ```

3. **Webhooks as Optional Enhancement**:
   - Webhooks fire on completion but don't block job processing
   - Single attempt delivery (no infinite retries)
   - Failed webhooks logged but don't affect job status
   - Business Engine can choose to poll OR use webhooks

4. **Status Polling URL in Response**:
   ```typescript
   // POST /transcribe response includes poll URL
   {
     "id": "abc123",
     "status": "queued",
     "statusUrl": "https://tttranscribe.hf.space/status/abc123",
     "pollIntervalSeconds": 3
   }
   ```

**Testing Strategy**:
- Submit job → immediately poll status → should return "queued"
- Poll during download → should return "DOWNLOADING" with progress message
- Poll during transcription → should return "TRANSCRIBING" with duration
- Poll after completion → should return full result with transcript
- Simulate webhook failure → status endpoint should still return correct result

---

### Issue #3: Excessive Webhook Retry Complexity ❌ MAJOR

**Symptoms**:
- 200+ lines of retry logic with exponential backoff
- Infinite retry loops (fixed in v1, but complexity remains)
- IP fallback strategies that mask DNS issues
- In-memory queue that loses jobs on restart

**Root Cause**: Treating webhooks as critical path instead of best-effort notification

**Current Code Complexity**: [src/TTTranscribe-Webhook-Business-Engine.ts:49-286](src/TTTranscribe-Webhook-Business-Engine.ts#L49-L286)
- 237 lines of webhook delivery code
- Exponential backoff calculation
- Multiple IP fallback attempts
- HTTPS agent customization for SNI
- In-memory queue with retry loop
- Complex error parsing and logging

**Impact**:
- Hard to debug and maintain
- Masks real issues (DNS failures become "fixed" with IP fallbacks)
- Consumes server resources with retry loops
- No persistent queue = lost jobs on restart
- Complexity violates "simplicity" core value

**Solution Design - Simplified Webhook System**:

1. **Single Attempt Delivery**:
   ```typescript
   async function sendWebhookSimple(url: string, payload: WebhookPayload): Promise<boolean> {
     try {
       const response = await fetch(url, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           'X-TTTranscribe-Signature': payload.signature,
           'X-Idempotency-Key': payload.idempotencyKey,
         },
         body: JSON.stringify(payload),
         signal: AbortSignal.timeout(10000), // 10s timeout
       });

       if (response.ok || response.status === 409) {
         console.log(`[webhook] Delivered to ${url}`);
         return true;
       }

       console.warn(`[webhook] Failed: ${response.status} - Client should poll instead`);
       return false;
     } catch (err: any) {
       console.warn(`[webhook] Failed: ${err.message} - Client should poll instead`);
       return false;
     }
   }
   ```

2. **Webhook Queue Visibility Endpoint**:
   ```typescript
   // GET /admin/webhook-queue
   {
     "failed": [
       {
         "jobId": "abc123",
         "url": "https://business-engine.workers.dev/webhooks/tttranscribe",
         "attempts": 1,
         "lastError": "ENOTFOUND",
         "timestamp": "2025-01-15T10:30:00Z",
         "canRetry": true
       }
     ],
     "totalFailed": 1
   }
   ```

3. **Manual Retry Endpoint** (for support team):
   ```typescript
   // POST /admin/retry-webhook/:jobId
   // Allows support to manually retry failed webhooks
   ```

**Reduction in Complexity**:
- **Before**: 237 lines of webhook code
- **After**: ~50 lines of webhook code
- **Reduction**: 79% less code to maintain

**Testing Strategy**:
- Send webhook to valid endpoint → should succeed on first attempt
- Send webhook to invalid endpoint → should fail fast, log error, continue
- Check webhook queue endpoint → should show failed webhooks
- Manually retry webhook → should attempt delivery again
- Restart service → should not lose failed webhook queue (if persisted)

---

## Page 2: Technical Implementation Details

### Component 1: JWT Authentication System

**Files to Modify**:
1. [src/TTTranscribe-Server-Main-Entry.ts](src/TTTranscribe-Server-Main-Entry.ts) - Add JWT validation middleware
2. [package.json](package.json) - Add `jsonwebtoken` dependency

**Implementation Steps**:

1. **Install jsonwebtoken**:
   ```bash
   npm install jsonwebtoken
   npm install --save-dev @types/jsonwebtoken
   ```

2. **Create JWT validation middleware**:
   ```typescript
   import jwt from 'jsonwebtoken';

   interface JwtPayload {
     iss: string;  // issuer (business-engine)
     sub: string;  // subject (requestId)
     aud: string;  // audience (tttranscribe)
     exp: number;  // expiration timestamp
     iat: number;  // issued at timestamp
   }

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
   ```

3. **Update authentication middleware to support both JWT and static secrets**:
   ```typescript
   async function authenticationMiddleware(c: any, next: any) {
     // Skip auth for public endpoints
     if (c.req.path === '/health' || c.req.path === '/readiness') {
       await next();
       return;
     }

     const authHeader = c.req.header('Authorization') || c.req.header('X-Engine-Auth');
     if (!authHeader) {
       return c.json({ error: 'Missing Authorization header' }, 401);
     }

     const token = authHeader.replace(/^Bearer\s+/i, '').trim();

     // Try JWT validation first
     const jwtResult = validateJwtAuth(token);
     if (jwtResult.valid) {
       c.set('requestId', jwtResult.requestId);
       c.set('authMethod', 'jwt');
       await next();
       return;
     }

     // Fallback to static secret (backward compatibility)
     if (token === config.sharedSecret) {
       c.set('authMethod', 'static-secret');
       await next();
       return;
     }

     // Both methods failed
     return c.json({
       error: 'Unauthorized',
       details: jwtResult.error || 'Invalid token or secret'
     }, 401);
   }
   ```

**Testing**:
- Valid JWT token → 200 OK with requestId in context
- Expired JWT token → 401 with "Token expired" error
- Invalid JWT signature → 401 with "Invalid token" error
- Static secret (legacy) → 200 OK during migration period
- No auth header → 401 with "Missing Authorization header"

---

### Component 2: Poll-First Status API

**Files to Modify**:
1. [src/TTTranscribe-Queue-Job-Processing.ts](src/TTTranscribe-Queue-Job-Processing.ts) - Add progressive status messages
2. [src/TTTranscribe-Server-Main-Entry.ts](src/TTTranscribe-Server-Main-Entry.ts) - Add statusUrl to responses

**Implementation Steps**:

1. **Add progressive status messages**:
   ```typescript
   const PROGRESSIVE_STATUS_MESSAGES: Record<StatusPhase, (metadata?: any) => string> = {
     QUEUED: () => "Job queued, waiting for processing...",
     DOWNLOADING: () => "Downloading video from TikTok... (this may take 10-30 seconds)",
     TRANSCRIBING: (metadata?: any) => {
       const duration = metadata?.audioDuration || 'unknown';
       return `Transcribing audio with Whisper AI... (processing ${duration}s of audio)`;
     },
     COMPLETED: (metadata?: any) => {
       const chars = metadata?.transcriptLength || 0;
       return `Transcription complete! ${chars} characters transcribed.`;
     },
     FAILED: (metadata?: any) => {
       const error = metadata?.error || 'Unknown error';
       return `Transcription failed: ${error}. Please try again or contact support.`;
     }
   };
   ```

2. **Update Status type to include user-friendly message**:
   ```typescript
   export type Status = {
     id: string;
     status: 'queued' | 'processing' | 'completed' | 'failed';
     phase?: StatusPhase;
     progress: number;
     message: string; // NEW: User-friendly progressive message
     cacheHit?: boolean;
     estimatedCost?: { // NEW: Cost transparency
       audioDurationSeconds: number;
       estimatedCharacters: number;
       isCacheFree: boolean;
     };
     result?: TranscriptionResult;
     error?: string;
     createdAt: string;
     updatedAt: string;
     statusUrl?: string; // NEW: URL to poll for updates
     pollIntervalSeconds?: number; // NEW: Recommended poll interval
   };
   ```

3. **Update updateStatus function to include progressive messages**:
   ```typescript
   export function updateStatus(
     id: string,
     phase: StatusPhase,
     progress: number,
     customMessage?: string,
     transcription?: string,
     error?: boolean,
     result?: TranscriptionResult,
     metadata?: any,
     cacheHit?: boolean
   ) {
     const existingStatus = getStatus(id);
     if (!existingStatus) {
       console.warn(`Cannot update status for unknown job ${id}`);
       return;
     }

     // Generate progressive message
     const progressMessage = customMessage || PROGRESSIVE_STATUS_MESSAGES[phase]?.(metadata) || phase;

     const updated: Status = {
       ...existingStatus,
       status: error ? 'failed' : (phase === 'COMPLETED' ? 'completed' : 'processing'),
       phase,
       progress,
       message: progressMessage,
       cacheHit: cacheHit || false,
       updatedAt: new Date().toISOString(),
     };

     if (result) updated.result = result;
     if (error && customMessage) updated.error = customMessage;
     if (metadata?.audioDuration) {
       updated.estimatedCost = {
         audioDurationSeconds: metadata.audioDuration,
         estimatedCharacters: metadata.transcriptLength || 0,
         isCacheFree: cacheHit || false
       };
     }

     statusMap.set(id, updated);
   }
   ```

4. **Add statusUrl to POST /transcribe response**:
   ```typescript
   app.post('/transcribe', async (c) => {
     // ... existing job creation code

     return c.json({
       id: jobId,
       status: 'queued',
       message: 'Job queued, waiting for processing...',
       statusUrl: `${c.req.url.replace(/\/transcribe.*/, '')}/status/${jobId}`,
       pollIntervalSeconds: 3,
       cacheHit: false
     });
   });
   ```

**Testing**:
- Submit job → response includes statusUrl and pollIntervalSeconds
- Poll immediately → should return "Job queued, waiting for processing..."
- Poll during download → should return "Downloading video from TikTok... (this may take 10-30 seconds)"
- Poll during transcription → should return "Transcribing audio with Whisper AI... (processing 45.2s of audio)"
- Poll after completion → should return "Transcription complete! 892 characters transcribed."
- Cache hit → should return estimatedCost.isCacheFree = true

---

### Component 3: Simplified Webhook System

**Files to Modify**:
1. [src/TTTranscribe-Webhook-Business-Engine.ts](src/TTTranscribe-Webhook-Business-Engine.ts) - Simplify to single-attempt delivery
2. [src/TTTranscribe-Server-Main-Entry.ts](src/TTTranscribe-Server-Main-Entry.ts) - Add webhook queue admin endpoints

**Implementation Steps**:

1. **Replace complex retry logic with simple delivery**:
   ```typescript
   // Remove: startRetryLoop(), deliverWebhook() complex retry logic
   // Replace with simple single-attempt delivery

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

     const idempotencyKey = crypto
       .createHash('sha256')
       .update(`${payload.jobId}-${payload.status}-${payload.timestamp}`)
       .digest('hex');

     const signedPayload: WebhookPayload = {
       ...payload,
       idempotencyKey,
       signature: '',
     };

     signedPayload.signature = generateSignature(signedPayload, webhookSecret);

     console.log(`[webhook] Sending webhook for job ${payload.jobId} to ${webhookUrl}`);

     try {
       const response = await fetch(webhookUrl, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           'X-TTTranscribe-Signature': signedPayload.signature,
           'X-Idempotency-Key': signedPayload.idempotencyKey,
         },
         body: JSON.stringify(signedPayload),
         signal: AbortSignal.timeout(10000), // 10s timeout
       });

       if (response.ok) {
         console.log(`[webhook] Successfully delivered for job ${payload.jobId}`);
         return true;
       }

       if (response.status === 409) {
         console.log(`[webhook] Webhook for job ${payload.jobId} already processed (409 Conflict)`);
         return true;
       }

       const responseText = await response.text().catch(() => 'Unable to read response');
       console.warn(`[webhook] Failed to deliver: ${response.status} ${response.statusText}`);
       console.warn(`[webhook] Response: ${responseText.substring(0, 200)}`);
       console.warn(`[webhook] Client should poll /status/${payload.jobId} instead`);

       // Add to failed queue for visibility
       failedWebhookQueue.push({
         primaryUrl: webhookUrl,
         payload: signedPayload,
         attempts: 1,
         lastError: `HTTP ${response.status}: ${responseText.substring(0, 100)}`,
         timestamp: new Date().toISOString()
       });

       return false;
     } catch (error: any) {
       console.warn(`[webhook] Failed to deliver: ${error.message}`);
       console.warn(`[webhook] Client should poll /status/${payload.jobId} instead`);

       failedWebhookQueue.push({
         primaryUrl: webhookUrl,
         payload: signedPayload,
         attempts: 1,
         lastError: error.message,
         timestamp: new Date().toISOString()
       });

       return false;
     }
   }
   ```

2. **Update webhook queue type** (remove retry loop fields):
   ```typescript
   type QueuedWebhook = {
     primaryUrl: string;
     payload: WebhookPayload;
     attempts: number;
     lastError?: string;
     timestamp: string;
   };

   const failedWebhookQueue: QueuedWebhook[] = [];
   // Remove: retryTimer, startRetryLoop()
   ```

3. **Add admin endpoint for webhook queue visibility**:
   ```typescript
   // GET /admin/webhook-queue
   app.get('/admin/webhook-queue', async (c) => {
     // Require admin auth (future enhancement: check admin JWT claim)
     return c.json({
       failed: failedWebhookQueue.map(w => ({
         jobId: w.payload.jobId,
         url: w.primaryUrl,
         attempts: w.attempts,
         lastError: w.lastError,
         timestamp: w.timestamp,
         canRetry: true
       })),
       totalFailed: failedWebhookQueue.length
     });
   });

   // POST /admin/retry-webhook/:jobId
   app.post('/admin/retry-webhook/:jobId', async (c) => {
     const jobId = c.req.param('jobId');
     const webhookIndex = failedWebhookQueue.findIndex(w => w.payload.jobId === jobId);

     if (webhookIndex === -1) {
       return c.json({ error: 'Webhook not found in failed queue' }, 404);
     }

     const webhook = failedWebhookQueue[webhookIndex];
     const success = await sendWebhookToBusinessEngine(
       webhook.primaryUrl,
       webhook.payload,
       process.env.BUSINESS_ENGINE_WEBHOOK_SECRET
     );

     if (success) {
       failedWebhookQueue.splice(webhookIndex, 1);
       return c.json({ success: true, message: 'Webhook delivered successfully' });
     } else {
       webhook.attempts += 1;
       webhook.timestamp = new Date().toISOString();
       return c.json({ success: false, message: 'Webhook delivery failed again' }, 500);
     }
   });
   ```

**Code Reduction**:
- **Before**: 237 lines (lines 49-286 in TTTranscribe-Webhook-Business-Engine.ts)
- **After**: ~60 lines (single-attempt delivery + queue visibility)
- **Reduction**: 75% less code

**Testing**:
- Send webhook to valid endpoint → should succeed, not appear in failed queue
- Send webhook to invalid endpoint → should fail, appear in failed queue
- GET /admin/webhook-queue → should return list of failed webhooks
- POST /admin/retry-webhook/:jobId → should reattempt delivery
- Restart service → failed queue should persist (if implemented with file storage)

---

### Component 4: Customer UX Improvements

**Files to Modify**:
1. [src/TTTranscribe-Queue-Job-Processing.ts](src/TTTranscribe-Queue-Job-Processing.ts) - Add cost estimation
2. [src/TTTranscribe-Media-TikTok-Download.ts](src/TTTranscribe-Media-TikTok-Download.ts) - Improve error messages

**Implementation Steps**:

1. **Add cost transparency to status response**:
   ```typescript
   export type CostEstimate = {
     audioDurationSeconds: number;
     estimatedCharacters: number;
     isCacheFree: boolean;
     billingNote: string;
   };

   function generateCostEstimate(audioDuration: number, cacheHit: boolean): CostEstimate {
     const estimatedChars = Math.round(audioDuration * 20); // ~20 chars/second estimate
     return {
       audioDurationSeconds: audioDuration,
       estimatedCharacters: estimatedChars,
       isCacheFree: cacheHit,
       billingNote: cacheHit
         ? 'This result was served from cache - no charge!'
         : `Estimated cost based on ${audioDuration}s of audio`
     };
   }
   ```

2. **Update cache hit flow to highlight free service**:
   ```typescript
   const cached = await getCached(url);
   if (cached) {
     const costEstimate = generateCostEstimate(cached.metadata?.audioDuration || 0, true);
     updateStatus(id, 'COMPLETED', 100,
       `Transcription complete! ${cached.result.transcription.length} characters transcribed. (Served from cache - free!)`,
       cached.result.transcription, false, cached.result, cached.metadata, true
     );

     const status = getStatus(id);
     if (status) {
       status.estimatedCost = costEstimate;
     }
   }
   ```

3. **Improve TikTok download error messages**:
   ```typescript
   // Already implemented in TTTranscribe-Media-TikTok-Download.ts
   // Ensure errors include actionable guidance:

   const ERROR_MESSAGES: Record<DownloadErrorCode, string> = {
     download_auth: 'This video requires authentication or is private. The video may be age-restricted, region-locked, or require login. Please try a different public video.',
     download_blocked: 'Unable to bypass TikTok\'s bot protection. This is a temporary issue with TikTok\'s anti-bot systems. Please try again in a few minutes or try a different video.',
     download_network: 'Network error while downloading video. This could be a temporary connectivity issue. Please try again.',
     download_not_found: 'Video not found. It may have been deleted, made private, or the URL is incorrect. Please check the URL and try again.',
     download_unknown: 'Failed to download video. Please check the URL is correct and the video is publicly accessible. If the problem persists, contact support.'
   };
   ```

**Testing**:
- Cache hit → status response includes "Served from cache - free!" message
- New transcription → status response includes cost estimate
- Auth-required video → error message includes actionable guidance
- Blocked video → error message explains it's temporary and suggests retry
- Network error → error message suggests retry

---

## Page 3: Deployment & Testing

### Build & Deployment Process

**Step 1: Install Dependencies**
```bash
npm install jsonwebtoken
npm install --save-dev @types/jsonwebtoken
```

**Step 2: Build TypeScript**
```bash
npm run build
```

**Step 3: Run Local Tests**
```bash
# Start local server for testing
npm start

# In separate terminal, run automated tests
node test-deployment-validation.js
```

**Step 4: Deploy to Hugging Face Spaces**
```bash
git add .
git commit -m "feat: Strategic overhaul - JWT auth, poll-first architecture, simplified webhooks

- Implement JWT authentication with backward compatibility for static secrets
- Add progressive status messages with user-friendly guidance
- Simplify webhook system to single-attempt delivery (75% code reduction)
- Add cost transparency with cache hit = free indicator
- Add webhook queue visibility for admin/support
- Add statusUrl and pollIntervalSeconds to responses
- Improve TikTok download error messages with actionable guidance

This addresses critical violations of Customer, Simplicity, and Trust core values."

git push
```

**Step 5: Monitor Deployment**
```bash
# Check GitHub Actions / HF Spaces build logs
# Wait for deployment to complete (~2-3 minutes)
```

**Step 6: Run Production Tests**
```bash
# Update test script with production URL
BASE_URL="https://iamromeoly-tttranscribe.hf.space" node test-deployment-validation.js
```

---

### Automated Testing Strategy

**Test File**: `test-deployment-validation.js` (to be updated)

**Test Coverage**:

1. **JWT Authentication Tests**:
   ```javascript
   // Test 1: Valid JWT token
   const validToken = generateJWT('test-request-123', JWT_SECRET);
   const response = await fetch(`${BASE_URL}/transcribe`, {
     method: 'POST',
     headers: {
       'Authorization': `Bearer ${validToken}`,
       'Content-Type': 'application/json'
     },
     body: JSON.stringify({ url: TEST_URL })
   });
   assert(response.status === 200, 'Valid JWT should authenticate');

   // Test 2: Expired JWT token
   const expiredToken = generateJWT('test-request-456', JWT_SECRET, -3600); // expired 1 hour ago
   const response2 = await fetch(`${BASE_URL}/transcribe`, {
     method: 'POST',
     headers: { 'Authorization': `Bearer ${expiredToken}` },
     body: JSON.stringify({ url: TEST_URL })
   });
   assert(response2.status === 401, 'Expired JWT should reject');
   const error = await response2.json();
   assert(error.details.includes('Token expired'), 'Should indicate token expired');

   // Test 3: Static secret (backward compatibility)
   const response3 = await fetch(`${BASE_URL}/transcribe`, {
     method: 'POST',
     headers: {
       'Authorization': `Bearer ${STATIC_SECRET}`,
       'Content-Type': 'application/json'
     },
     body: JSON.stringify({ url: TEST_URL })
   });
   assert(response3.status === 200, 'Static secret should still work during migration');
   ```

2. **Poll-First Architecture Tests**:
   ```javascript
   // Test 1: Submit job and verify statusUrl in response
   const submitResponse = await fetch(`${BASE_URL}/transcribe`, {
     method: 'POST',
     headers: { 'Authorization': `Bearer ${validToken}`, 'Content-Type': 'application/json' },
     body: JSON.stringify({ url: TEST_URL })
   });
   const submitData = await submitResponse.json();
   assert(submitData.statusUrl, 'Response should include statusUrl');
   assert(submitData.pollIntervalSeconds, 'Response should include pollIntervalSeconds');

   // Test 2: Poll status endpoint with progressive messages
   const statusUrl = submitData.statusUrl;
   const jobId = submitData.id;

   let status = null;
   let pollCount = 0;
   const maxPolls = 40; // 40 * 3s = 2 minutes max

   while (pollCount < maxPolls) {
     const statusResponse = await fetch(statusUrl);
     status = await statusResponse.json();

     console.log(`Poll ${pollCount}: ${status.message}`);

     // Verify progressive messages
     if (status.phase === 'QUEUED') {
       assert(status.message.includes('Job queued'), 'Should show queued message');
     } else if (status.phase === 'DOWNLOADING') {
       assert(status.message.includes('Downloading video'), 'Should show downloading message');
     } else if (status.phase === 'TRANSCRIBING') {
       assert(status.message.includes('Transcribing audio'), 'Should show transcribing message');
     } else if (status.phase === 'COMPLETED') {
       assert(status.message.includes('Transcription complete'), 'Should show completion message');
       assert(status.result, 'Should include result');
       assert(status.estimatedCost, 'Should include cost estimate');
       break;
     } else if (status.status === 'failed') {
       console.error('Job failed:', status.error);
       break;
     }

     await sleep(3000);
     pollCount++;
   }

   assert(status.status === 'completed', 'Job should complete successfully');
   ```

3. **Simplified Webhook Tests**:
   ```javascript
   // Test 1: Verify webhook queue endpoint exists
   const queueResponse = await fetch(`${BASE_URL}/admin/webhook-queue`);
   assert(queueResponse.status === 200, 'Webhook queue endpoint should exist');
   const queueData = await queueResponse.json();
   assert(Array.isArray(queueData.failed), 'Should return failed webhooks array');

   // Test 2: Verify webhook failures are logged (not blocking)
   // (This test requires inspecting logs or queue endpoint after job completion)
   ```

4. **Cache Hit Tests**:
   ```javascript
   // Test 1: Submit same URL twice, verify cache hit
   const url = 'https://www.tiktok.com/@thesunnahguy/video/7493203244727012630';

   // First request (cache miss)
   const response1 = await submitAndWaitForCompletion(url, validToken);
   assert(response1.cacheHit === false, 'First request should be cache miss');
   assert(response1.estimatedCost, 'Should include cost estimate');

   // Second request (cache hit)
   const response2 = await submitAndWaitForCompletion(url, validToken);
   assert(response2.cacheHit === true, 'Second request should be cache hit');
   assert(response2.estimatedCost.isCacheFree === true, 'Cache hit should be free');
   assert(response2.message.includes('cache'), 'Message should mention cache');
   ```

5. **Error Message Tests**:
   ```javascript
   // Test 1: Private video error message
   const privateVideoUrl = 'https://www.tiktok.com/@private/video/123456789';
   const response = await submitAndWaitForCompletion(privateVideoUrl, validToken);
   assert(response.status === 'failed', 'Should fail for private video');
   assert(response.error.includes('authentication') || response.error.includes('private'),
     'Error should explain video is private/auth-required');
   assert(response.error.includes('try a different'), 'Error should suggest trying different video');
   ```

**Test Execution**:
```bash
# Run all tests
node test-deployment-validation.js

# Expected output:
# ✓ JWT Authentication: Valid token
# ✓ JWT Authentication: Expired token rejected
# ✓ JWT Authentication: Static secret (backward compat)
# ✓ Poll-First: statusUrl in response
# ✓ Poll-First: Progressive status messages
# ✓ Poll-First: Job completion
# ✓ Simplified Webhooks: Queue endpoint exists
# ✓ Cache Hit: First request (cache miss)
# ✓ Cache Hit: Second request (cache hit + free)
# ✓ Error Messages: Private video actionable guidance
#
# All tests passed! ✓
```

---

### Documentation Updates

**Files to Update**:

1. **MOBILE_CLIENT_GUIDE.md**:
   - Add JWT token generation examples for Business Engine
   - Update API flow to show poll-first pattern
   - Add progressive status message examples
   - Document cache hit = free pricing
   - Show recommended polling intervals (3s)
   - Add error handling examples with actionable messages

2. **README.md**:
   - Update authentication section with JWT instructions
   - Document new environment variables (JWT_SECRET)
   - Add migration guide from static secrets to JWT
   - Update architecture diagram to show poll-first flow

3. **API_REFERENCE.md** (new file):
   - Complete OpenAPI/Swagger-style documentation
   - All endpoints with request/response examples
   - Authentication methods (JWT + static secret)
   - Status codes and error messages
   - Webhook payload format
   - Admin endpoints documentation

4. **DEPLOYMENT_SUMMARY.md**:
   - Update with new architecture changes
   - Document code reduction (75% less webhook code)
   - Add performance improvements (no retry loops blocking resources)
   - Document backward compatibility guarantees

---

### Success Metrics

**After Implementation, Verify**:

1. **Trust Restored**:
   - ✅ JWT authentication works reliably (no 401 errors for valid tokens)
   - ✅ Clear error messages when tokens expire
   - ✅ Audit trail via JWT sub claim (requestId)
   - ✅ Token refresh mechanism possible (Business Engine can generate new tokens)

2. **Customer Experience Improved**:
   - ✅ Clients can poll status at any time (no webhook dependency)
   - ✅ Progressive status messages provide clear progress updates
   - ✅ Cost transparency before billing (estimatedCost in status)
   - ✅ Cache hits clearly marked as free
   - ✅ Error messages include actionable guidance

3. **Simplicity Achieved**:
   - ✅ 75% reduction in webhook code (237 → 60 lines)
   - ✅ No infinite retry loops
   - ✅ Single-attempt webhook delivery
   - ✅ Clear separation: polling (primary), webhooks (optional)
   - ✅ Admin visibility into failed webhooks

4. **Backward Compatibility Maintained**:
   - ✅ Static secret auth still works during migration
   - ✅ Existing webhook integrations continue working
   - ✅ No breaking changes to API responses (only additions)

---

## Implementation Timeline

**Total Time: 4 hours**

- **Hour 1**: JWT Authentication
  - Install jsonwebtoken
  - Implement validateJwtAuth()
  - Update authenticationMiddleware
  - Write JWT tests
  - Test locally

- **Hour 2**: Poll-First Architecture
  - Add progressive status messages
  - Add statusUrl to responses
  - Add estimatedCost to Status type
  - Update all updateStatus() calls
  - Write polling tests

- **Hour 3**: Simplify Webhooks
  - Replace retry logic with single-attempt delivery
  - Add webhook queue visibility endpoint
  - Add manual retry endpoint
  - Write webhook tests

- **Hour 4**: Deploy & Validate
  - Build and deploy to HF Spaces
  - Run full test suite
  - Update all documentation
  - Monitor production logs
  - Celebrate 🎉

---

## Conclusion

This plan addresses all critical violations of our core values:

- **Trust**: JWT authentication with clear error messages and audit trails
- **Customer**: Poll-first architecture with progressive status and cost transparency
- **Simplicity**: 75% code reduction in webhook system, clear separation of concerns

The implementation maintains 100% backward compatibility while providing a clear migration path. All changes are tested end-to-end with automated validation scripts.

**Next Step**: Execute this plan end-to-end, starting with Hour 1 (JWT Authentication).
