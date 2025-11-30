# TTTranscribe Deployment Guide - Hugging Face Spaces

## 📋 Overview

This guide provides step-by-step instructions for deploying TTTranscribe to Hugging Face Spaces and configuring the required secrets for integration with the Business Engine.

---

## 🚀 Deployment Steps

### 1. Create Hugging Face Space

1. Go to https://huggingface.co/spaces
2. Click "Create new Space"
3. Configure:
   - **Name**: `TTTranscribe` (or your preferred name)
   - **SDK**: Docker
   - **Hardware**: CPU basic (free tier) or upgraded if needed
   - **Visibility**: Private (recommended) or Public

### 2. Configure Repository Secrets

Navigate to your Space settings → **Variables and secrets** and add the following secrets:

#### Required Secrets:

| Secret Name | Description | Example Value | Notes |
|------------|-------------|---------------|--------|
| `ENGINE_SHARED_SECRET` | Shared secret for X-Engine-Auth authentication | `your-secure-random-string-here` | **CRITICAL**: Must match Business Engine's `TTT_SHARED_SECRET` |
| `BUSINESS_ENGINE_WEBHOOK_SECRET` | Secret for signing webhook payloads | `another-secure-random-string` | **CRITICAL**: Must match Business Engine's `BUSINESS_ENGINE_WEBHOOK_SECRET` |
| `HF_API_KEY` | Hugging Face API key for ASR provider | `hf_xxxxxxxxxxxxx` | Get from https://huggingface.co/settings/tokens |

#### Optional Secrets:

| Secret Name | Description | Default Value | Notes |
|------------|-------------|---------------|--------|
| `BUSINESS_ENGINE_WEBHOOK_URL` | Webhook endpoint URL | `https://pluct-business-engine.romeo-lya2.workers.dev/webhooks/tttranscribe` | Auto-configured; override if using different URL |
| `API_VERSION` | API version number | `1.0.0` | Change when making breaking changes |
| `RATE_LIMIT_CAPACITY` | Max requests per IP | `10` | Adjust based on expected load |
| `RATE_LIMIT_REFILL_PER_MIN` | Tokens refilled per minute | `10` | Adjust based on expected load |
| `KEEP_TEXT_MAX` | Max transcript length | `10000` | Truncate longer transcripts |
| `ASR_PROVIDER` | ASR provider | `hf` | Options: `hf` (Hugging Face) or `local` |
| `WHISPER_MODEL_SIZE` | Whisper model size | `base` | Options: `tiny`, `base`, `small`, `medium`, `large` |

---

## 🔐 Generating Secure Secrets

Use these commands to generate cryptographically secure secrets:

### On Linux/Mac:
```bash
# Generate ENGINE_SHARED_SECRET
openssl rand -base64 32

# Generate BUSINESS_ENGINE_WEBHOOK_SECRET
openssl rand -base64 32
```

### On Windows (PowerShell):
```powershell
# Generate ENGINE_SHARED_SECRET
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

# Generate BUSINESS_ENGINE_WEBHOOK_SECRET
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

### Example Output:
```
ENGINE_SHARED_SECRET=7KZqN3mX9vP2wR5tY8uA6bC4dE1fG0hJ
BUSINESS_ENGINE_WEBHOOK_SECRET=9XzA2bC3dE4fG5hJ6kL7mN8oP9qR0sT1
```

---

## ⚙️ Configuration Verification

### Step 1: Set Secrets in Hugging Face

1. Go to your Space → **Settings** → **Variables and secrets**
2. Click **Add secret**
3. Add each secret from the table above
4. Click **Save**

### Step 2: Deploy to Hugging Face

Push your code to the Space repository:

```bash
git remote add huggingface https://huggingface.co/spaces/YOUR_USERNAME/TTTranscribe
git push huggingface main
```

### Step 3: Verify Deployment

1. Wait for build to complete (check **Build** tab in Space)
2. Once running, visit your Space URL: `https://huggingface.co/spaces/YOUR_USERNAME/TTTranscribe`
3. Check the root endpoint:

```bash
curl https://YOUR_USERNAME-tttranscribe.hf.space/
```

Expected response:
```json
{
  "service": "TTTranscribe",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "platform": "huggingface-spaces",
  "baseUrl": "https://YOUR_USERNAME-tttranscribe.hf.space",
  "endpoints": [
    "POST /transcribe",
    "POST /estimate",
    "GET /status/:id",
    "GET /health"
  ]
}
```

### Step 4: Verify Health Check

```bash
curl https://YOUR_USERNAME-tttranscribe.hf.space/health
```

Expected response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "service": "tttranscribe",
  "platform": "huggingface-spaces",
  "environment": {
    "hasAuthSecret": true,
    "hasHfApiKey": true,
    "hasWebhookUrl": true,
    "hasWebhookSecret": true,
    "asrProvider": "hf"
  }
}
```

**⚠️ CRITICAL CHECKS:**
- `hasAuthSecret` must be `true`
- `hasWebhookSecret` must be `true`
- `hasHfApiKey` must be `true` (unless using local ASR)

---

## 🔗 Business Engine Configuration

### Step 1: Configure Business Engine Secrets

In your Cloudflare Worker (Business Engine), set these environment variables:

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `TTT_SHARED_SECRET` | Same as `ENGINE_SHARED_SECRET` | For X-Engine-Auth authentication |
| `BUSINESS_ENGINE_WEBHOOK_SECRET` | Same as TTTranscribe's secret | For webhook signature verification |
| `TTTRANSCRIBE_URL` | `https://YOUR_USERNAME-tttranscribe.hf.space` | Your Space URL |

### Step 2: Test Integration

Test the full flow from Business Engine to TTTranscribe:

```bash
# 1. Business Engine calls TTTranscribe /estimate
curl -X POST https://pluct-business-engine.romeo-lya2.workers.dev/transcribe/estimate \
  -H "Authorization: Bearer YOUR_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.tiktok.com/@garyvee/video/7308801293029248299"}'

# Expected: { "estimatedCredits": 1, "estimatedDurationSeconds": 45, ... }

# 2. Business Engine calls TTTranscribe /transcribe
curl -X POST https://pluct-business-engine.romeo-lya2.workers.dev/transcribe \
  -H "Authorization: Bearer YOUR_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.tiktok.com/@garyvee/video/7308801293029248299"}'

# Expected: { "requestId": "...", "status": "queued", ... }

# 3. Poll status via Business Engine
curl https://pluct-business-engine.romeo-lya2.workers.dev/status/REQUEST_ID \
  -H "Authorization: Bearer YOUR_USER_JWT"

# Expected: { "status": "processing", "progress": 35, ... }
```

---

## 🐛 Troubleshooting

### Issue: Authentication Failed (401)

**Symptom:**
```json
{
  "error": "unauthorized",
  "message": "Missing or invalid X-Engine-Auth header"
}
```

**Solution:**
1. Verify `ENGINE_SHARED_SECRET` is set in Hugging Face Spaces secrets
2. Verify `TTT_SHARED_SECRET` in Business Engine matches exactly
3. Check Space logs for authentication attempts

### Issue: Webhook Signature Mismatch (401)

**Symptom:**
Business Engine returns 401 when receiving webhooks from TTTranscribe

**Solution:**
1. Verify `BUSINESS_ENGINE_WEBHOOK_SECRET` is set in Hugging Face Spaces
2. Verify Business Engine's `BUSINESS_ENGINE_WEBHOOK_SECRET` matches exactly
3. Check webhook signature generation in logs

### Issue: HF API Key Not Working

**Symptom:**
```
Transcription failed: API key not found
```

**Solution:**
1. Generate new API key at https://huggingface.co/settings/tokens
2. Ensure key has `read` permissions
3. Set `HF_API_KEY` secret in Space settings
4. Restart Space (Settings → Factory reboot)

### Issue: Webhook Not Reaching Business Engine

**Symptom:**
Transcription completes but Business Engine never receives webhook

**Solution:**
1. Check `BUSINESS_ENGINE_WEBHOOK_URL` is correct
2. Verify Business Engine webhook endpoint is accessible
3. Check Space logs for webhook delivery attempts
4. Verify firewall/network rules allow outbound HTTPS

---

## 📊 Monitoring

### View Space Logs

1. Go to your Space → **Logs** tab
2. Filter by:
   - `[webhook]` - Webhook delivery logs
   - `[job-processing]` - Job processing logs
   - `❌` - Error logs

### Key Metrics to Monitor

- **Cache Hit Rate**: Check `/health` → `cache.hitRate`
- **Active Jobs**: Monitor memory usage in Space metrics
- **Webhook Success Rate**: Check logs for webhook delivery failures
- **Authentication Failures**: Monitor 401 responses

---

## 🔄 Updating TTTranscribe

### Step 1: Update Code

```bash
# Make changes locally
git add .
git commit -m "Update TTTranscribe configuration"
git push huggingface main
```

### Step 2: Monitor Build

1. Go to Space → **Build** tab
2. Wait for build to complete
3. Check logs for errors

### Step 3: Verify Changes

```bash
curl https://YOUR_USERNAME-tttranscribe.hf.space/health
```

---

## 🚨 Security Best Practices

1. **Never commit secrets to Git**
   - Use Hugging Face Spaces secrets only
   - Add `.env.local` to `.gitignore`

2. **Rotate secrets regularly**
   - Generate new secrets every 90 days
   - Update both TTTranscribe and Business Engine simultaneously

3. **Monitor authentication failures**
   - Set up alerts for repeated 401 responses
   - Investigate unknown IPs attempting access

4. **Use HTTPS only**
   - Never configure `BUSINESS_ENGINE_WEBHOOK_URL` with `http://`
   - Hugging Face Spaces automatically use HTTPS

---

## 📞 Support

If you encounter issues:

1. **Check Space Logs**: Most issues show up in logs
2. **Verify Secrets**: Ensure all secrets are set correctly
3. **Test Endpoints**: Use `/health` to verify configuration
4. **Check Business Engine**: Ensure it can reach TTTranscribe

---

## ✅ Deployment Checklist

- [ ] Created Hugging Face Space
- [ ] Set `ENGINE_SHARED_SECRET` in Space secrets
- [ ] Set `BUSINESS_ENGINE_WEBHOOK_SECRET` in Space secrets
- [ ] Set `HF_API_KEY` in Space secrets
- [ ] Deployed code to Space
- [ ] Verified `/health` endpoint returns `hasAuthSecret: true`
- [ ] Verified `/health` endpoint returns `hasWebhookSecret: true`
- [ ] Configured Business Engine with matching secrets
- [ ] Tested `/estimate` endpoint via Business Engine
- [ ] Tested full transcription flow
- [ ] Verified webhook delivery to Business Engine
- [ ] Monitored logs for errors

---

**Next Steps**: See [WHAT_TTTRANSCRIBE_EXPECTSFROM_MOBILECLIENTS.md](./WHAT_TTTRANSCRIBE_EXPECTSFROM_MOBILECLIENTS.md) for mobile app integration details.
