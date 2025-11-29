# What TTTranscribe Expects from Business Engine

## 📋 Overview

This document details the **contract** between **TTTranscribe** (the transcription service) and **Business Engine** (the credit/billing orchestrator). It specifies what TTTranscribe expects, what it provides, and how the two services interact for a seamless credit-based monetization system.

---

## 🎯 Core Relationship

**TTTranscribe's Role:**
- **Utility Service**: Processes transcription requests and reports usage
- **Metered Billing**: Calculates and reports actual resource consumption
- **Webhook Publisher**: Sends completion/failure notifications with usage data
- **Stateless Processing**: Does NOT manage user balances or payment

**Business Engine's Role:**
- **Gatekeeper**: Pre-authorizes requests based on user credit balance
- **Credit Manager**: Places holds, processes charges, manages balance
- **Webhook Consumer**: Receives and processes usage reports from TTTranscribe
- **Source of Truth**: Owns all pricing logic, user balances, and transaction history

---

## 🔐 1. Authentication & Request Format

### 1.1 Required Headers

**Every request to TTTranscribe MUST include:**

```http
X-Engine-Auth: <SHARED_SECRET>
```

**Rationale:**
- Prevents unauthorized access from external parties
- Ensures only Business Engine can submit jobs
- Shared secret is configured via `ENGINE_SHARED_SECRET` environment variable

**What TTTranscribe Does:**
- Validates header on ALL endpoints (`/transcribe`, `/status`, `/estimate`)
- Returns `401 Unauthorized` if missing or invalid
- Logs authentication failures for security monitoring

---

### 1.2 Request Body Format for `/transcribe`

**Business Engine MUST send:**

```json
{
  "url": "https://www.tiktok.com/@username/video/1234567890",
  "requestId": "business-engine-request-uuid"
}
```

**Field Definitions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | **Yes** | TikTok video URL to transcribe |
| `requestId` | string | **Yes** | Business Engine's unique request ID for webhook correlation |

**Rationale for `requestId`:**
- TTTranscribe needs to send webhooks back with this ID for correlation
- Allows Business Engine to match webhook to original user request
- Enables idempotency and prevents duplicate charges
- Without this, TTTranscribe cannot notify Business Engine of completion

**What TTTranscribe Does:**
- Stores `requestId` in job record as `businessEngineRequestId`
- Includes `requestId` in all webhook payloads
- Returns `400 Bad Request` if `url` is invalid
- Accepts `requestId` as optional (for backwards compatibility), but **strongly recommended**

---

## 📤 2. Webhook Callback System

### 2.1 Webhook Configuration

**Business Engine MUST:**

1. **Set Environment Variable:**
   ```bash
   BUSINESS_ENGINE_WEBHOOK_URL=https://pluct-business-engine.romeo-lya2.workers.dev/webhooks/tttranscribe
   ```

2. **Set Webhook Secret:**
   ```bash
   BUSINESS_ENGINE_WEBHOOK_SECRET=<same-as-shared-secret-or-dedicated-webhook-secret>
   ```

**Rationale:**
- TTTranscribe uses this URL to send completion/failure notifications
- Secret enables Business Engine to verify webhook authenticity (HMAC signature)
- Without webhook URL, Business Engine won't receive usage/billing data

---

### 2.2 Webhook Payload Format

**TTTranscribe sends POST request to webhook URL:**

```http
POST /webhooks/tttranscribe
Content-Type: application/json
X-TTTranscribe-Signature: <HMAC-SHA256 signature>
X-Idempotency-Key: <sha256 hash of jobId+status+timestamp>
```

```json
{
  "jobId": "ttt-job-uuid",
  "requestId": "business-engine-request-uuid",
  "status": "completed",
  "usage": {
    "audioDurationSeconds": 45.23,
    "transcriptCharacters": 1937,
    "modelUsed": "openai-whisper-base",
    "processingTimeSeconds": 12
  },
  "timestamp": "2025-11-29T21:44:30.000Z",
  "idempotencyKey": "abc123...",
  "signature": "def456..."
}
```

**Field Definitions:**

| Field | Type | Description |
|-------|------|-------------|
| `jobId` | string | TTTranscribe's internal job ID |
| `requestId` | string | Business Engine's original request ID (from `/transcribe` request) |
| `status` | `'completed'` \| `'failed'` | Final status of the job |
| `usage.audioDurationSeconds` | number | Actual audio duration (billable metric) |
| `usage.transcriptCharacters` | number | Character count of transcript |
| `usage.modelUsed` | string | Whisper model used (affects pricing) |
| `usage.processingTimeSeconds` | number | Wall-clock processing time |
| `error` | string (optional) | Error message if `status === 'failed'` |
| `timestamp` | string | ISO 8601 timestamp of webhook generation |
| `idempotencyKey` | string | Unique key to prevent duplicate processing |
| `signature` | string | HMAC-SHA256 signature for verification |

---

### 2.3 Signature Verification

**Business Engine MUST verify webhook signature:**

```typescript
function verifyWebhook(payload, receivedSignature, secret) {
  const data = JSON.stringify({
    jobId: payload.jobId,
    requestId: payload.requestId,
    status: payload.status,
    usage: payload.usage,
    timestamp: payload.timestamp,
    idempotencyKey: payload.idempotencyKey,
  });

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(receivedSignature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}
```

**Rationale:**
- Prevents spoofed webhooks from malicious actors
- Ensures webhook genuinely came from TTTranscribe
- Uses timing-safe comparison to prevent timing attacks

---

### 2.4 Idempotency Handling

**Business Engine MUST check idempotency key:**

```typescript
app.post('/webhooks/tttranscribe', async (req, res) => {
  const { idempotencyKey, ...payload } = req.body;

  // Check if already processed
  const existing = await db.transactions.findByIdempotencyKey(idempotencyKey);
  if (existing) {
    console.log(`Webhook ${idempotencyKey} already processed, returning 409`);
    return res.status(409).json({ error: 'already_processed' });
  }

  // Verify signature
  if (!verifyWebhook(payload, req.headers['x-tttranscribe-signature'], secret)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  // Process webhook...
  // Store transaction with idempotencyKey
  await processUsageAndCharge(payload);

  res.status(200).json({ received: true });
});
```

**Rationale:**
- Webhooks may be retried up to 5 times if Business Engine doesn't respond
- Idempotency prevents charging user multiple times for same job
- **409 Conflict** response tells TTTranscribe "already processed, stop retrying"

---

### 2.5 Webhook Retry Policy

**TTTranscribe Behavior:**

| Attempt | Backoff | Total Delay |
|---------|---------|-------------|
| 1 | 0s | 0s |
| 2 | 1s | 1s |
| 3 | 2s | 3s |
| 4 | 4s | 7s |
| 5 | 8s | 15s |
| 6 (final) | 16s (capped at 30s) | ~45s |

**Expected Response Codes:**

| Code | Meaning | TTTranscribe Action |
|------|---------|---------------------|
| 200 OK | Success | Stop retrying |
| 409 Conflict | Already processed (idempotent) | Stop retrying (treat as success) |
| 4xx (other) | Client error | Log error, stop retrying |
| 5xx | Server error | Retry with backoff |
| Timeout (>10s) | No response | Retry with backoff |

**Rationale:**
- Network failures or temporary Business Engine downtime should not lose billing data
- Exponential backoff prevents overwhelming Business Engine during incidents
- After 5 retries (~45 seconds), TTTranscribe logs manual review required

---

## 💰 3. Credit Hold & Charge Flow

### 3.1 Pre-Authorization Flow

**Business Engine MUST implement:**

```
User → Business Engine /transcribe:
  1. Check user balance (GET /users/{userId}/balance)
  2. Calculate estimated cost (use /estimate endpoint or internal logic)
  3. Place hold on credits (HOLD transaction)
  4. If sufficient balance → Forward to TTTranscribe
  5. If insufficient → Return 402 Payment Required
```

**Example:**

```typescript
async function handleTranscribeRequest(userId, tiktokUrl) {
  // Step 1: Check balance
  const user = await db.users.findById(userId);
  if (!user) return { status: 404, error: 'user_not_found' };

  // Step 2: Estimate cost
  const estimate = await estimateCost(tiktokUrl); // or call TTTranscribe /estimate
  const estimatedCredits = estimate.estimatedCredits || 5; // default: 5 credits

  // Step 3: Check if sufficient balance
  const availableBalance = user.balance - user.heldCredits;
  if (availableBalance < estimatedCredits) {
    return {
      status: 402,
      error: 'insufficient_credits',
      details: {
        required: estimatedCredits,
        available: availableBalance,
        message: 'Please purchase more credits to continue'
      }
    };
  }

  // Step 4: Place hold
  const holdId = await db.transactions.create({
    userId,
    type: 'hold',
    amount: estimatedCredits,
    balanceBefore: user.balance,
    balanceAfter: user.balance, // balance unchanged, just held
    expiresAt: Date.now() + 15 * 60 * 1000, // 15 minute expiry
    metadata: { tiktokUrl }
  });

  await db.users.update(userId, {
    heldCredits: user.heldCredits + estimatedCredits
  });

  // Step 5: Forward to TTTranscribe
  const requestId = crypto.randomUUID();
  const response = await fetch('https://tttranscribe.hf.space/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Engine-Auth': process.env.TTTRANSCRIBE_SECRET
    },
    body: JSON.stringify({ url: tiktokUrl, requestId })
  });

  const { id: jobId } = await response.json();

  // Store mapping for webhook lookup
  await db.jobMappings.create({ requestId, userId, holdId, jobId });

  return { status: 202, jobId, requestId, estimatedCredits };
}
```

**Rationale:**
- **Hold prevents overdraft**: User can't submit 100 jobs with only 10 credits
- **Estimate manages UX**: User knows upfront if they have enough credits
- **15-minute expiry**: If webhook doesn't arrive (service down), hold auto-releases
- **402 Payment Required**: Standard HTTP code for insufficient funds

---

### 3.2 Webhook Processing & Charge Flow

**Business Engine webhook handler:**

```typescript
async function processWebhook(payload) {
  const { requestId, status, usage, error } = payload;

  // Step 1: Find original request
  const mapping = await db.jobMappings.findByRequestId(requestId);
  if (!mapping) {
    console.error(`Webhook for unknown requestId: ${requestId}`);
    return { status: 404, error: 'request_not_found' };
  }

  const { userId, holdId } = mapping;
  const user = await db.users.findById(userId);
  const hold = await db.transactions.findById(holdId);

  // Step 2: Calculate actual cost
  let actualCost = 0;
  if (status === 'completed') {
    actualCost = calculateCost(usage); // based on audioDurationSeconds, model, etc.
  } else {
    // Failed jobs: charge partial cost or zero (your policy)
    actualCost = 0; // Option: charge for download time, or refund entirely
  }

  // Step 3: Release hold
  await db.users.update(userId, {
    heldCredits: user.heldCredits - hold.amount
  });

  await db.transactions.update(holdId, {
    type: 'released',
    releasedAt: Date.now()
  });

  // Step 4: Charge actual cost
  if (actualCost > 0) {
    await db.transactions.create({
      userId,
      type: 'charge',
      amount: -actualCost, // negative = deduction
      balanceBefore: user.balance,
      balanceAfter: user.balance - actualCost,
      metadata: {
        jobId: payload.jobId,
        requestId: payload.requestId,
        usage
      }
    });

    await db.users.update(userId, {
      balance: user.balance - actualCost
    });
  }

  // Step 5: Log and notify user (optional)
  console.log(`Charged ${actualCost} credits to user ${userId} for job ${payload.jobId}`);

  return { status: 200, charged: actualCost };
}
```

**Rationale:**
- **Release hold first**: Prevents double-holding credits
- **Charge actual cost**: User pays for what they used, not estimate
- **Partial charges**: Your policy decision (charge for failed downloads, refund entirely, etc.)
- **Transaction log**: Full audit trail for disputes and analytics

---

### 3.3 Cost Calculation Formula

**Business Engine decides pricing:**

```typescript
function calculateCost(usage) {
  const { audioDurationSeconds, modelUsed } = usage;

  // Example pricing tiers
  const creditsPerMinute = {
    'openai-whisper-tiny': 0.5,
    'openai-whisper-base': 1.0,
    'openai-whisper-large': 2.0,
  };

  const rate = creditsPerMinute[modelUsed] || 1.0;
  const minutes = audioDurationSeconds / 60;

  // Round up to nearest credit
  return Math.ceil(minutes * rate);
}
```

**Rationale:**
- TTTranscribe provides usage metrics, Business Engine sets pricing
- Pricing can change without redeploying TTTranscribe
- Allows promotional pricing, bulk discounts, subscription tiers

---

## 🔍 4. Status Polling & Client Integration

### 4.1 Business Engine → TTTranscribe Status Queries

**Business Engine MAY poll status endpoint:**

```http
GET /status/{jobId}
X-Engine-Auth: <SHARED_SECRET>
```

**Use Cases:**
- Provide real-time updates to mobile client (websocket/SSE relay)
- Debug stuck jobs
- Trigger alerts if job exceeds expected duration

**Rationale:**
- Webhooks are eventual (may take seconds to arrive)
- Polling allows real-time progress for premium UX
- Status endpoint includes server-side debug info for troubleshooting

---

### 4.2 Mobile Client → Business Engine Proxy

**Business Engine SHOULD provide proxy endpoints:**

```
Mobile App → Business Engine:
  POST /transcribe → Business Engine → TTTranscribe
  GET /status/{businessEngineRequestId} → Business Engine → TTTranscribe
```

**Rationale:**
- Mobile clients should NOT have direct access to TTTranscribe
- Business Engine handles auth, credit checks, user mapping
- TTTranscribe jobId is internal; Business Engine uses requestId

---

## 📊 5. Cost Estimation Endpoint

### 5.1 Optional Pre-Flight Estimation

**Business Engine MAY call:**

```http
POST /estimate
X-Engine-Auth: <SHARED_SECRET>
Content-Type: application/json

{
  "url": "https://www.tiktok.com/@username/video/1234567890"
}
```

**Response:**

```json
{
  "estimatedCredits": 1,
  "estimatedDurationSeconds": 45,
  "modelUsed": "openai-whisper-base",
  "note": "This is an estimate. Actual cost will be based on real audio duration."
}
```

**Rationale:**
- Shows user upfront cost before submitting
- Based on average TikTok video length (currently hardcoded to 45s)
- Future: could use yt-dlp metadata fetch (without download) for precise estimate

**Business Engine Use:**

```typescript
async function estimateCost(tiktokUrl) {
  const response = await fetch('https://tttranscribe.hf.space/estimate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Engine-Auth': process.env.TTTRANSCRIBE_SECRET
    },
    body: JSON.stringify({ url: tiktokUrl })
  });

  return await response.json();
}
```

---

## ⚠️ 6. Error Handling & Edge Cases

### 6.1 Failed Jobs

**TTTranscribe sends `status: 'failed'` webhook with:**

```json
{
  "status": "failed",
  "usage": {
    "audioDurationSeconds": 0,
    "transcriptCharacters": 0,
    "modelUsed": "openai-whisper-base",
    "processingTimeSeconds": 5
  },
  "error": "Download failed: Video is private or unavailable"
}
```

**Business Engine MUST:**
1. Release the hold
2. Decide refund policy:
   - **Full refund**: Charge 0 credits (best for user trust)
   - **Partial charge**: Charge for download attempt (if policy)
   - **No charge**: Set transaction to `refunded` status

**Rationale:**
- Failed jobs still consume compute resources
- User should not be charged full price for failed jobs
- Clear error message helps user understand what went wrong

---

### 6.2 Orphaned Jobs (Webhook Never Arrives)

**Business Engine MUST implement hold expiry:**

```typescript
// Cron job runs every 5 minutes
async function releaseExpiredHolds() {
  const expiredHolds = await db.transactions.find({
    type: 'hold',
    expiresAt: { $lt: Date.now() },
    releasedAt: null
  });

  for (const hold of expiredHolds) {
    // Release hold
    await db.transactions.update(hold.id, {
      type: 'released',
      releasedAt: Date.now(),
      note: 'Auto-released due to expiry (webhook timeout)'
    });

    // Update user balance
    const user = await db.users.findById(hold.userId);
    await db.users.update(hold.userId, {
      heldCredits: user.heldCredits - hold.amount
    });

    console.warn(`Released expired hold ${hold.id} for user ${hold.userId}`);
  }
}
```

**Rationale:**
- TTTranscribe or network failures could prevent webhook delivery
- 15-minute expiry ensures credits are not held indefinitely
- User balance becomes available again for new requests

---

### 6.3 Duplicate Webhooks

**Business Engine MUST check idempotency key:**

```typescript
const existing = await db.transactions.findByIdempotencyKey(idempotencyKey);
if (existing) {
  return res.status(409).json({ error: 'already_processed' });
}
```

**Rationale:**
- TTTranscribe retries up to 5 times on timeout/5xx
- Without idempotency check, user could be charged multiple times
- 409 response tells TTTranscribe to stop retrying

---

## 🚀 7. Production Checklist

**Business Engine MUST implement:**

- ✅ Pre-authorization with balance check before forwarding to TTTranscribe
- ✅ Hold mechanism with 15-minute expiry
- ✅ Webhook endpoint at `/webhooks/tttranscribe`
- ✅ Signature verification using HMAC-SHA256
- ✅ Idempotency key storage and checking
- ✅ Transaction ledger with full audit trail
- ✅ Auto-release of expired holds
- ✅ Cost calculation based on usage metrics
- ✅ Error handling for failed jobs (refund policy)
- ✅ Proxy endpoints for mobile clients
- ✅ Monitoring and alerting for orphaned jobs

**Business Engine SHOULD implement:**

- ⭐ WebSocket/SSE relay for real-time status to mobile clients
- ⭐ Rate limiting per user (prevent abuse)
- ⭐ Usage analytics dashboard
- ⭐ Manual webhook retry UI (for failed webhooks)
- ⭐ Cost estimation via `/estimate` endpoint

---

## 📞 8. Support & Troubleshooting

### 8.1 Common Issues

**Issue: Webhook never arrives**
- Check `BUSINESS_ENGINE_WEBHOOK_URL` environment variable set in TTTranscribe
- Verify Business Engine endpoint is publicly accessible
- Check Business Engine logs for incoming webhook attempts
- Ensure Business Engine returns 200 OK (not 3xx redirect)

**Issue: User charged twice for same job**
- Check idempotency key implementation
- Verify 409 response is returned for duplicate keys
- Check transaction table for multiple entries with same idempotencyKey

**Issue: Jobs stuck in processing**
- TTTranscribe timeout is 5 minutes (300 seconds)
- If no webhook after 15 minutes, consider job orphaned
- Release hold and notify user of service issue

### 8.2 Debug Endpoints

**Business Engine can query TTTranscribe:**

```http
GET /status/{jobId}
X-Engine-Auth: <SECRET>
```

**Response includes server debug info:**

```json
{
  "server": {
    "requestId": "ttt-job-uuid",
    "phaseStartTime": 1764451426762,
    "phaseElapsedTime": 3572,
    "createdAt": "2025-11-29T21:33:33.516Z",
    "updatedAt": "2025-11-29T21:33:35.830Z"
  }
}
```

---

## 🔒 9. Security Considerations

### 9.1 Shared Secret Rotation

**TTTranscribe supports:**
- `ENGINE_SHARED_SECRET` environment variable
- Can be updated without code changes
- Restart required to apply new secret

**Business Engine MUST:**
- Store secret securely (environment variable, secrets manager)
- Rotate secret periodically (quarterly recommended)
- Coordinate rotation with TTTranscribe deployment

### 9.2 Webhook Signature Verification

**ALWAYS verify signature before processing webhook:**

```typescript
if (!verifyWebhook(payload, signature, secret)) {
  console.error('Invalid webhook signature, possible spoofing attempt');
  return res.status(401).json({ error: 'invalid_signature' });
}
```

**Rationale:**
- Prevents malicious actors from sending fake completion webhooks
- Prevents unauthorized credit deductions
- Ensures webhook genuinely came from TTTranscribe

---

## 📚 10. Summary

**TTTranscribe provides:**
- ✅ Metered transcription service with usage reporting
- ✅ Webhook callbacks with HMAC signatures
- ✅ Idempotency keys to prevent duplicate charges
- ✅ Retry logic with exponential backoff
- ✅ Cost estimation endpoint
- ✅ Detailed error messages for failed jobs

**Business Engine must provide:**
- ✅ Pre-authorization with credit balance checks
- ✅ Hold mechanism to prevent overdraft
- ✅ Webhook endpoint to receive usage data
- ✅ Signature verification and idempotency handling
- ✅ Transaction ledger and audit trail
- ✅ Refund policy for failed jobs
- ✅ Mobile client proxy endpoints

**Key Design Principles:**
1. **TTTranscribe is stateless**: No user data, no balances, no pricing
2. **Business Engine is source of truth**: All credit logic lives here
3. **Webhooks are asynchronous**: Don't block transcription on billing
4. **Idempotency is critical**: Prevent double charges
5. **Hold → Charge pattern**: Industry standard for pre-authorization

---

**Questions or Issues?**
- TTTranscribe GitHub: https://github.com/iamalbertly/TTTranscribe
- Business Engine integration support: Contact development team
