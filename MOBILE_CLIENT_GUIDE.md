# Mobile Client Integration Guide

## Overview

This guide shows mobile app developers how to integrate with TTTranscribe's poll-first architecture using JWT authentication.

## API Endpoint

**Base URL**: `https://iamromeoly-tttranscribe.hf.space`

## Authentication

### JWT Authentication (Recommended)

TTTranscribe now supports JWT (JSON Web Token) authentication for improved security and audit trails.

**Generate JWT Token (Business Engine):**
```typescript
import jwt from 'jsonwebtoken';

function generateTTTranscribeToken(requestId: string): string {
  return jwt.sign(
    {
      iss: 'pluct-business-engine',
      sub: requestId,
      aud: 'tttranscribe',
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      iat: Math.floor(Date.now() / 1000),
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
}
```

**Use JWT in Requests:**
```http
Authorization: Bearer <jwt-token>
Content-Type: application/json
X-Client-Version: 1.0.0
X-Client-Platform: ios|android
```

### Static Secret (Backward Compatible)

Legacy authentication method still supported:
```http
X-Engine-Auth: <your-secret-key>
```

**Note:** JWT is preferred for security, token expiration, and audit trails.

## Flow

### 1. Submit Transcription Request

```http
POST /transcribe
```

**Request Body:**
```json
{
  "url": "https://vm.tiktok.com/ZMAoYtB5p/",
  "requestId": "mobile-client-uuid"
}
```

**Success Response (202 Accepted):**
```json
{
  "id": "ttt-job-uuid",
  "status": "queued",
  "message": "Job queued, waiting for processing...",
  "statusUrl": "https://iamromeoly-tttranscribe.hf.space/status/ttt-job-uuid",
  "pollIntervalSeconds": 3,
  "submittedAt": "2025-12-14T23:30:00.000Z",
  "estimatedProcessingTime": 300,
  "url": "https://vm.tiktok.com/ZMAoYtB5p/"
}
```

**NEW:** Response now includes:
- `message` - User-friendly progressive status message
- `statusUrl` - Direct URL to poll for updates
- `pollIntervalSeconds` - Recommended polling interval (3 seconds)

### 2. Poll for Status (Poll-First Architecture)

```http
GET /status/:id
```

**Headers:**
```http
Authorization: Bearer <jwt-token>
```
*or legacy:* `X-Engine-Auth: <secret>`

**Polling Strategy (Recommended):**
- Poll every 3 seconds during active processing
- Use exponential backoff after 10 polls (3s → 5s → 10s max)
- Continue polling until `status === 'completed'` or `status === 'failed'`

#### Scenario A: Queued (Waiting to Start)

```json
{
  "id": "ttt-job-uuid",
  "status": "queued",
  "phase": "REQUEST_SUBMITTED",
  "progress": 0,
  "message": "Job queued, waiting for processing...",
  "statusUrl": "https://iamromeoly-tttranscribe.hf.space/status/ttt-job-uuid",
  "pollIntervalSeconds": 3,
  "estimatedCompletion": "2025-12-14T23:30:15.000Z"
}
```

**UI Recommendations:**
- Show loading spinner
- Display message: "Job queued, waiting for processing..."
- No progress bar yet

#### Scenario B: Downloading Video

```json
{
  "id": "ttt-job-uuid",
  "status": "processing",
  "phase": "DOWNLOADING",
  "progress": 20,
  "message": "Downloading video from TikTok... (this may take 10-30 seconds)",
  "statusUrl": "https://iamromeoly-tttranscribe.hf.space/status/ttt-job-uuid",
  "pollIntervalSeconds": 3,
  "estimatedCompletion": "2025-12-14T23:30:45.000Z"
}
```

**UI Recommendations:**
- Show progress bar at 20%
- Display: "Downloading video from TikTok..."
- Show subtitle: "This may take 10-30 seconds"

#### Scenario C: Transcribing Audio

```json
{
  "id": "ttt-job-uuid",
  "status": "processing",
  "phase": "TRANSCRIBING",
  "progress": 60,
  "message": "Transcribing audio with Whisper AI... (processing 45s of audio)",
  "statusUrl": "https://iamromeoly-tttranscribe.hf.space/status/ttt-job-uuid",
  "pollIntervalSeconds": 3,
  "estimatedCompletion": "2025-12-14T23:32:00.000Z"
}
```

**UI Recommendations:**
- Show progress bar at 60%
- Display: "Transcribing audio with Whisper AI..."
- Show subtitle: "Processing 45s of audio"

#### Scenario D: Success (Cache Hit - FREE!)

```json
{
  "id": "ttt-job-uuid",
  "status": "completed",
  "phase": "COMPLETED",
  "progress": 100,
  "message": "Transcription complete! 892 characters transcribed.",
  "cacheHit": true,
  "estimatedCost": {
    "audioDurationSeconds": 45.2,
    "estimatedCharacters": 892,
    "isCacheFree": true,
    "billingNote": "This result was served from cache - no charge!"
  },
  "statusUrl": "https://iamromeoly-tttranscribe.hf.space/status/ttt-job-uuid",
  "pollIntervalSeconds": 3,
  "completedAt": "2025-12-14T23:30:01.000Z",
  "result": {
    "transcription": "Full transcript text here...",
    "confidence": 0.95,
    "language": "en",
    "duration": 45.2,
    "wordCount": 150,
    "processingTime": 0
  },
  "metadata": {
    "url": "https://vm.tiktok.com/ZMAoYtB5p/",
    "title": "TikTok Video",
    "author": "unknown"
  }
}
```

**UI Recommendations:**
- Show "⚡ Instant result" badge
- Display transcript immediately
- No loading spinner needed
- Show duration: "45 seconds"
- Free or reduced cost indicator

#### Scenario C: Success (Fresh Processing)

```json
{
  "id": "ttt-job-uuid",
  "status": "completed",
  "phase": "COMPLETED",
  "progress": 100,
  "cacheHit": false,
  "completedAt": "2025-12-14T23:32:30.000Z",
  "result": {
    "transcription": "Full transcript text here...",
    "confidence": 0.95,
    "language": "en",
    "duration": 45.2,
    "wordCount": 150,
    "processingTime": 28
  }
}
```

**UI Recommendations:**
- Normal success state
- Show processing time: "Processed in 28s"
- Standard cost deduction

#### Scenario D: Failure (Private/Auth Required)

```json
{
  "id": "ttt-job-uuid",
  "status": "failed",
  "phase": "FAILED",
  "progress": 0,
  "error": "This video requires authentication or is private. The video may be age-restricted, region-locked, or require login."
}
```

**UI Recommendations:**
- Show error icon
- Display error message as-is
- Suggest: "Try a public video instead"
- Don't charge credits

#### Scenario E: Failure (Bot Protection)

```json
{
  "id": "ttt-job-uuid",
  "status": "failed",
  "phase": "FAILED",
  "progress": 0,
  "error": "Unable to bypass TikTok's bot protection. The service needs additional configuration."
}
```

**UI Recommendations:**
- Show error icon
- Display: "TikTok is blocking our service. Please try again later."
- Don't charge credits
- Log issue to support

#### Scenario F: Failure (Not Found)

```json
{
  "id": "ttt-job-uuid",
  "status": "failed",
  "phase": "FAILED",
  "progress": 0,
  "error": "Video not found. It may have been deleted or the URL is incorrect."
}
```

**UI Recommendations:**
- Show error icon
- Display: "Video not found. Please check the URL."
- Suggest double-checking the link
- Don't charge credits

### 3. Rate Limit Handling

If you make too many requests:

```json
{
  "error": "rate_limited",
  "message": "Too many requests. Please wait before retrying.",
  "details": {
    "retryAfter": 45,
    "retryAfterTimestamp": "2025-12-14T23:45:00.000Z",
    "rateLimitInfo": {
      "capacity": 10,
      "refillRate": "10 tokens per minute",
      "tokensRemaining": 0
    }
  }
}
```

**UI Recommendations:**
- Show countdown timer: "Try again in 45 seconds"
- Use `retryAfterTimestamp` for precise countdown
- Disable submit button until `retryAfter` expires
- Display: "You've reached the request limit"

## Sample Code (React Native)

```javascript
async function transcribeVideo(videoUrl) {
  const AUTH_SECRET = 'your-secret';
  const BASE_URL = 'https://iamromeoly-tttranscribe.hf.space';

  // 1. Submit request
  const submitResponse = await fetch(`${BASE_URL}/transcribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Engine-Auth': AUTH_SECRET,
      'X-Client-Version': '1.0.0',
      'X-Client-Platform': 'ios'
    },
    body: JSON.stringify({
      url: videoUrl,
      requestId: `mobile-${Date.now()}`
    })
  });

  if (submitResponse.status === 429) {
    const rateLimitData = await submitResponse.json();
    throw new Error(`Rate limited. Retry in ${rateLimitData.details.retryAfter}s`);
  }

  if (!submitResponse.ok) {
    const error = await submitResponse.json();
    throw new Error(error.message || 'Failed to submit');
  }

  const { id } = await submitResponse.json();

  // 2. Poll for result
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds

    const statusResponse = await fetch(`${BASE_URL}/status/${id}`, {
      headers: {
        'X-Engine-Auth': AUTH_SECRET
      }
    });

    if (!statusResponse.ok) {
      throw new Error('Failed to check status');
    }

    const status = await statusResponse.json();

    // Update UI with progress
    console.log(`Progress: ${status.progress}% - ${status.note}`);

    if (status.status === 'completed') {
      // Success!
      return {
        transcript: status.result.transcription,
        cacheHit: status.cacheHit,
        duration: status.result.duration,
        processingTime: status.result.processingTime
      };
    }

    if (status.status === 'failed') {
      // Show user-friendly error
      throw new Error(status.error);
    }

    // Still processing, continue polling
  }
}

// Usage
try {
  const result = await transcribeVideo('https://vm.tiktok.com/ZMAoYtB5p/');

  if (result.cacheHit) {
    console.log('⚡ Instant result! (from cache)');
  } else {
    console.log(`Processed in ${result.processingTime}s`);
  }

  console.log(result.transcript);
} catch (error) {
  // Show error.message to user
  console.error('Transcription failed:', error.message);
}
```

## Error Handling Best Practices

1. **Always check `status.error` field** - It contains user-friendly messages
2. **Show `error` directly to users** - No need to parse or modify
3. **Handle rate limits gracefully** - Show countdown timer
4. **Cache hit optimization** - Show instant result badge
5. **Don't charge for failures** - Check `status === 'failed'`

## Polling Strategy

**Recommended polling intervals:**
- First 10 seconds: Poll every 2 seconds
- 10-60 seconds: Poll every 3 seconds
- After 60 seconds: Poll every 5 seconds

**Stop polling when:**
- `status === 'completed'`
- `status === 'failed'`
- User navigates away

## Testing

Use this test URL for development:
```
https://vm.tiktok.com/ZMAoYtB5p/
```

Expected behavior:
- Will fail with bot protection or auth error
- Good for testing error handling UI
- Don't use for production testing

## Support

If you encounter issues:
1. Check error message in response
2. Verify auth header is set correctly
3. Check rate limit status
4. Contact backend team with job ID

## Migration from Old API

**Old response:**
```json
{
  "phase": "COMPLETED",
  "percent": 100,
  "text": "transcript..."
}
```

**New response:**
```json
{
  "status": "completed",
  "phase": "COMPLETED",
  "progress": 100,
  "cacheHit": false,
  "result": {
    "transcription": "transcript...",
    "duration": 45.2,
    "confidence": 0.95
  }
}
```

**Changes:**
- Use `status` instead of checking `phase === 'COMPLETED'`
- Use `result.transcription` instead of `text`
- New: `cacheHit` indicator
- New: `result.duration` for video length
- New: Structured error messages in `error` field
