# JWT Helper Library for Business Engine Integration

This document provides ready-to-use JWT token generation code for the Business Engine to integrate with TTTranscribe's new JWT authentication system.

## Installation

```bash
npm install jsonwebtoken
# or
yarn add jsonwebtoken
```

## TypeScript/Node.js Implementation

### Basic JWT Generator

```typescript
import jwt from 'jsonwebtoken';

/**
 * Generate a JWT token for TTTranscribe API authentication
 * @param requestId - Unique request ID from Business Engine
 * @param expiresInSeconds - Token expiration time (default: 1 hour)
 * @returns JWT token string
 */
export function generateTTTranscribeToken(
  requestId: string,
  expiresInSeconds: number = 3600
): string {
  const jwtSecret = process.env.JWT_SECRET || process.env.SHARED_SECRET;

  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  return jwt.sign(
    {
      iss: 'pluct-business-engine',     // Issuer
      sub: requestId,                    // Subject (request ID)
      aud: 'tttranscribe',               // Audience
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
      iat: Math.floor(Date.now() / 1000)
    },
    jwtSecret,
    { algorithm: 'HS256' }
  );
}
```

### Complete Integration Example

```typescript
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

interface TTTranscribeRequest {
  url: string;
  requestId?: string;
}

interface TTTranscribeResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  message: string;
  statusUrl: string;
  pollIntervalSeconds: number;
  cacheHit?: boolean;
}

class TTTranscribeClient {
  private baseUrl: string;
  private jwtSecret: string;

  constructor(baseUrl: string, jwtSecret: string) {
    this.baseUrl = baseUrl;
    this.jwtSecret = jwtSecret;
  }

  /**
   * Generate JWT token for authentication
   */
  private generateToken(requestId: string): string {
    return jwt.sign(
      {
        iss: 'pluct-business-engine',
        sub: requestId,
        aud: 'tttranscribe',
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
        iat: Math.floor(Date.now() / 1000),
      },
      this.jwtSecret,
      { algorithm: 'HS256' }
    );
  }

  /**
   * Submit transcription request
   */
  async submitTranscription(request: TTTranscribeRequest): Promise<TTTranscribeResponse> {
    const requestId = request.requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const token = this.generateToken(requestId);

    const response = await fetch(`${this.baseUrl}/transcribe`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: request.url,
        requestId
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`TTTranscribe API error: ${error.message || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Poll job status with progressive updates
   */
  async pollStatus(jobId: string, requestId: string): Promise<TTTranscribeResponse> {
    const token = this.generateToken(requestId);

    const response = await fetch(`${this.baseUrl}/status/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Status check failed: ${error.message || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Poll until job completes (with exponential backoff)
   */
  async pollUntilCompletion(
    jobId: string,
    requestId: string,
    onProgress?: (status: TTTranscribeResponse) => void,
    maxPolls: number = 40
  ): Promise<TTTranscribeResponse> {
    let pollInterval = 3000; // Start with 3 seconds
    const maxInterval = 10000; // Max 10 seconds between polls

    for (let i = 0; i < maxPolls; i++) {
      const status = await this.pollStatus(jobId, requestId);

      if (onProgress) {
        onProgress(status);
      }

      if (status.status === 'completed') {
        return status;
      }

      if (status.status === 'failed') {
        throw new Error(`Transcription failed: ${status.message}`);
      }

      // Exponential backoff with max interval
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      pollInterval = Math.min(pollInterval * 1.5, maxInterval);
    }

    throw new Error('Polling timeout - job did not complete in time');
  }
}

// Usage Example
async function example() {
  const client = new TTTranscribeClient(
    'https://iamromeoly-tttranscribe.hf.space',
    process.env.JWT_SECRET!
  );

  try {
    // Submit transcription
    const job = await client.submitTranscription({
      url: 'https://www.tiktok.com/@user/video/1234567890',
      requestId: 'business-engine-req-123'
    });

    console.log(`Job submitted: ${job.id}`);
    console.log(`Initial message: ${job.message}`);
    console.log(`Poll every ${job.pollIntervalSeconds} seconds at: ${job.statusUrl}`);

    // Poll until completion
    const result = await client.pollUntilCompletion(
      job.id,
      'business-engine-req-123',
      (status) => {
        console.log(`[${status.phase}] ${status.message} (${status.progress}%)`);
      }
    );

    console.log('Transcription complete!');
    console.log(`Cache hit: ${result.cacheHit ? 'Yes (FREE!)' : 'No'}`);
    console.log(`Cost: ${result.estimatedCost?.billingNote}`);
    console.log(`Transcript: ${result.result?.transcription?.substring(0, 100)}...`);
  } catch (error) {
    console.error('Error:', error);
  }
}
```

## Cloudflare Workers Implementation

For Cloudflare Workers (Business Engine deployment platform):

```typescript
import jwt from '@tsndr/cloudflare-worker-jwt';

export async function generateTTTranscribeToken(
  requestId: string,
  jwtSecret: string
): Promise<string> {
  return await jwt.sign(
    {
      iss: 'pluct-business-engine',
      sub: requestId,
      aud: 'tttranscribe',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    },
    jwtSecret
  );
}

export interface Env {
  JWT_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = `req_${Date.now()}_${crypto.randomUUID()}`;
    const token = await generateTTTranscribeToken(requestId, env.JWT_SECRET);

    const response = await fetch('https://iamromeoly-tttranscribe.hf.space/transcribe', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: 'https://www.tiktok.com/@user/video/123',
        requestId
      })
    });

    return response;
  }
};
```

## Environment Variables

Set these environment variables in Business Engine:

```bash
# Shared secret for JWT signing (same as TTTranscribe's JWT_SECRET or SHARED_SECRET)
JWT_SECRET=your-secret-key-here

# TTTranscribe API base URL
TTTRANSCRIBE_API_URL=https://iamromeoly-tttranscribe.hf.space
```

## Migration Path

### Phase 1: Add JWT Support (Backward Compatible)
- Install jsonwebtoken library
- Add JWT generation function
- Start sending JWT tokens in `Authorization: Bearer <token>` header
- Keep existing static secret as fallback

### Phase 2: Transition Period (Both Methods Work)
- All new requests use JWT
- Old requests with static secret still work
- Monitor logs for JWT authentication success

### Phase 3: JWT Only (Future)
- Remove static secret support
- All requests must use JWT
- Improved security and audit trail

## Benefits of JWT Authentication

1. **Time-Limited Tokens**: Tokens expire after 1 hour, reducing security risk
2. **Audit Trail**: requestId in JWT sub claim provides traceability
3. **Self-Validating**: No need to store sessions or tokens server-side
4. **Standard Protocol**: Industry-standard authentication method
5. **Secure**: HMAC-SHA256 signature prevents tampering

## Testing JWT Integration

Test your JWT implementation locally:

```typescript
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  {
    iss: 'pluct-business-engine',
    sub: 'test-request-123',
    aud: 'tttranscribe',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  },
  'your-jwt-secret',
  { algorithm: 'HS256' }
);

console.log('Generated token:', token);

// Test the token
const response = await fetch('https://iamromeoly-tttranscribe.hf.space/transcribe', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    url: 'https://www.tiktok.com/@thesunnahguy/video/7493203244727012630',
    requestId: 'test-request-123'
  })
});

console.log('Status:', response.status);
console.log('Response:', await response.json());
```

## Troubleshooting

### Token Expired Error
- Check system clock is synchronized
- Ensure exp claim is in the future
- Default expiry is 1 hour (3600 seconds)

### Invalid Token Error
- Verify JWT_SECRET matches between Business Engine and TTTranscribe
- Check token is being passed in `Authorization: Bearer <token>` header
- Ensure all required claims are present (iss, sub, aud, exp, iat)

### 401 Unauthorized
- Verify JWT_SECRET environment variable is set correctly
- Check token format: `Authorization: Bearer <token>`
- Ensure audience is 'tttranscribe' and issuer is 'pluct-business-engine'

## Support

For issues or questions:
1. Check TTTranscribe health endpoint: `GET /health`
2. Review implementation plan: `IMPLEMENTATION_PLAN.md`
3. Check authentication logs in TTTranscribe for detailed error messages
