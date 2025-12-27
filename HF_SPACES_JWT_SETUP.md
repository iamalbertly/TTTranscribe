# Hugging Face Spaces JWT_SECRET Configuration

## URGENT: Production JWT Authentication Not Working

**Issue**: Production endpoint returns `"jwtError": "JWT_SECRET not configured"` when testing JWT authentication.

**Root Cause**: The `JWT_SECRET` environment variable is not configured in Hugging Face Spaces.

**Impact**: JWT authentication is NOT working in production. Only static secret authentication works.

---

## How to Fix (5 minutes)

### Step 1: Go to HF Spaces Settings

Open: https://huggingface.co/spaces/iamromeoly/TTTranscribe/settings

### Step 2: Navigate to Repository Secrets

Click on **"Repository secrets"** in the left sidebar.

### Step 3: Add JWT_SECRET

1. Click **"Add a secret"**
2. Enter the following:

**Name:**
```
JWT_SECRET
```

**Value:** (copy from .env.local)
```
hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU
```

3. Click **"Add secret"**

### Step 4: Restart the Space

After adding the secret, the space will automatically rebuild. This takes ~2-3 minutes.

Monitor at: https://huggingface.co/spaces/iamromeoly/TTTranscribe

---

## Verification

Once the rebuild completes, test JWT authentication:

```bash
# Generate a JWT token
node generate-jwt-token.js generate test-request-prod

# Copy the token from the output, then test:
curl -X POST https://iamromeoly-tttranscribe.hf.space/transcribe \
  -H "Authorization: Bearer <PASTE_TOKEN_HERE>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@thesunnahguy/video/7493203244727012630","requestId":"test-jwt-prod"}'
```

**Expected Response:**
```json
{
  "jobId": "...",
  "status": "queued",
  "message": "Your transcription request is being processed...",
  "statusUrl": "https://iamromeoly-tttranscribe.hf.space/status/...",
  "pollIntervalSeconds": 3,
  "requestId": "test-jwt-prod"
}
```

**Success Indicator**: No `"error": "unauthorized"` or `"jwtError"` in response.

---

## Current Production Status

✅ **Working**: Static secret authentication (X-Engine-Auth header)
❌ **NOT Working**: JWT authentication (Authorization: Bearer header)

**Reason**: JWT_SECRET not configured in HF Spaces environment variables.

---

## Alternative: Test Locally Instead

While waiting for HF Spaces configuration, you can test JWT authentication locally:

```bash
# Terminal 1: Start local server
cd c:\Shared\Projects\Pluct\TTTranscribe
npm start

# Terminal 2: Test JWT authentication
node generate-jwt-token.js generate test-local
# Copy the token, then:

curl -X POST http://localhost:8788/transcribe \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@thesunnahguy/video/7493203244727012630","requestId":"test-local"}'
```

---

## Next Steps

1. **Immediate**: Configure JWT_SECRET in HF Spaces (this document)
2. **Wait 2-3 min**: For HF Spaces rebuild to complete
3. **Test**: Run verification curl command above
4. **Continue**: With remaining implementation steps

---

## Reference

- **Environment Variables Documentation**: [DEPLOYMENT.md](DEPLOYMENT.md#environment-variables)
- **JWT Helper Script**: [generate-jwt-token.js](generate-jwt-token.js)
- **Strategic Overhaul Plan**: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
- **Local Environment**: [.env.local](.env.local) (lines 24-26)

---

**Status**: ⏳ BLOCKED - Waiting for JWT_SECRET configuration in HF Spaces
**Priority**: 🔴 HIGH - Required for JWT authentication to work in production
