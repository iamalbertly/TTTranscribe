# TTTranscribe Deployment Guide

Complete deployment guide for TTTranscribe to Hugging Face Spaces.

## Prerequisites

- Git configured with SSH or HTTPS access
- Node.js 18+ and npm installed locally
- Access to Hugging Face Spaces account
- Environment variables configured

## Deployment Targets

### Production: Hugging Face Spaces
- **URL**: https://iamromeoly-tttranscribe.hf.space
- **Platform**: Hugging Face Spaces (Docker runtime)
- **Git Remote**: `origin` (https://huggingface.co/spaces/iamromeoly/TTTranscribe)

### GitHub Repository (Code Backup)
- **URL**: https://github.com/iamalbertly/TTTranscribe
- **Git Remote**: `github`

## Environment Variables

Configure these secrets in Hugging Face Spaces Settings > Repository Secrets:

### Required Secrets
```bash
# Authentication
SHARED_SECRET=<your-shared-secret>
JWT_SECRET=<same-as-shared-secret-or-separate>
ENGINE_SHARED_SECRET=<same-as-shared-secret>

# Business Engine Integration
BUSINESS_ENGINE_WEBHOOK_URL=https://pluct-business-engine.romeo-lya2.workers.dev/webhooks/tttranscribe
BUSINESS_ENGINE_WEBHOOK_SECRET=<webhook-signature-secret>

# Hugging Face API
HF_API_KEY=<your-hf-api-key>

# Optional Configuration
RATE_LIMIT_CAPACITY=10
RATE_LIMIT_REFILL_PER_MIN=10
WHISPER_MODEL_SIZE=base
KEEP_TEXT_MAX=100000
```

### How to Set Secrets in HF Spaces

1. Go to https://huggingface.co/spaces/iamromeoly/TTTranscribe/settings
2. Navigate to "Repository secrets"
3. Click "Add a secret"
4. Enter name and value
5. Click "Add secret"

## Deployment Process

### Standard Deployment (Recommended)

1. **Make Changes Locally**
   ```bash
   # Edit files
   vim src/TTTranscribe-Server-Main-Entry.ts

   # Build to check for errors
   npm run build
   ```

2. **Test Locally (Optional but Recommended)**
   ```bash
   # Set environment variables
   export SHARED_SECRET="test-secret"
   export ENABLE_AUTH_BYPASS="true"

   # Start local server
   npm start

   # In another terminal, run tests
   BASE_URL="http://localhost:7860" \
   SHARED_SECRET="test-secret" \
   node test-simple.js
   ```

3. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: Add new feature

   Detailed description of changes...

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
   ```

4. **Push to GitHub (Backup)**
   ```bash
   git push github main
   ```

5. **Deploy to Hugging Face Spaces**
   ```bash
   git push origin main
   ```

6. **Monitor Deployment**
   - Go to https://huggingface.co/spaces/iamromeoly/TTTranscribe
   - Check "Build logs" tab
   - Wait for "Running" status (usually 2-5 minutes)

7. **Verify Deployment**
   ```bash
   # Health check
   curl https://iamromeoly-tttranscribe.hf.space/health

   # Run production tests
   BASE_URL="https://iamromeoly-tttranscribe.hf.space" \
   SHARED_SECRET="<your-secret>" \
   node test-deployment-validation.js
   ```

### Emergency Rollback

If deployment fails:

```bash
# Find last working commit
git log --oneline -10

# Rollback to previous commit
git reset --hard <commit-hash>

# Force push to Hugging Face
git push origin main --force

# Monitor rebuild
# Check HF Spaces build logs
```

### Hotfix Deployment

For urgent fixes:

```bash
# Create hotfix branch
git checkout -b hotfix/critical-bug

# Make fix
vim src/file.ts

# Test
npm run build
npm test

# Commit
git commit -m "hotfix: Fix critical bug"

# Merge to main
git checkout main
git merge hotfix/critical-bug

# Deploy
git push origin main

# Tag release
git tag -a v1.0.1-hotfix -m "Hotfix: Critical bug fix"
git push origin v1.0.1-hotfix
```

## Build Process

### Local Build

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Check for type errors
npx tsc --noEmit
```

### Hugging Face Spaces Build

HF Spaces automatically runs:
1. Reads `Dockerfile`
2. Installs system dependencies from `apt.txt`
3. Installs Python dependencies from `requirements.txt`
4. Installs Node.js dependencies from `package.json`
5. Builds TypeScript with `npm run build`
6. Starts server with `npm start` (runs `start.sh`)

**Build Time**: ~2-5 minutes

**Files Involved:**
- `Dockerfile` - Container configuration
- `apt.txt` - System packages (ffmpeg, curl, etc.)
- `requirements.txt` - Python dependencies (yt-dlp, faster-whisper)
- `package.json` - Node.js dependencies
- `tsconfig.json` - TypeScript compiler configuration
- `start.sh` - Startup script

## Monitoring Deployment

### Check Build Logs

Via HF Spaces UI:
1. Go to https://huggingface.co/spaces/iamromeoly/TTTranscribe
2. Click "Build logs" tab
3. Monitor for errors

Via API:
```bash
# Check space status
curl https://huggingface.co/api/spaces/iamromeoly/TTTranscribe

# Expected: {"id":"iamromeoly/TTTranscribe","author":"iamromeoly",...,"runtime":{"stage":"RUNNING"}}
```

### Check Application Logs

Via HF Spaces UI:
1. Go to https://huggingface.co/spaces/iamromeoly/TTTranscribe
2. Click "Logs" tab
3. Monitor application output

### Verify Endpoints

```bash
# Health check
curl https://iamromeoly-tttranscribe.hf.space/health | jq .

# Expected: {"status":"healthy","platform":"huggingface-spaces",...}

# Readiness check
curl https://iamromeoly-tttranscribe.hf.space/ready | jq .

# Expected: {"ready":true,"checkedAt":...}
```

## Troubleshooting

### Build Failures

**Symptom**: Build fails with error messages

**Common Causes:**
1. TypeScript errors
2. Missing dependencies
3. Invalid Dockerfile syntax

**Solutions:**
```bash
# Check TypeScript errors locally
npm run build

# Fix errors and redeploy
git add .
git commit -m "fix: Resolve build errors"
git push origin main
```

### Runtime Failures

**Symptom**: Build succeeds but app crashes on startup

**Common Causes:**
1. Missing environment variables
2. Port binding issues
3. File permission problems

**Solutions:**
1. Check HF Spaces logs for error messages
2. Verify all required secrets are set
3. Test locally with same environment

### Slow Deployment

**Symptom**: Deployment takes > 10 minutes

**Causes:**
- Docker layer cache miss
- Large npm dependencies
- HF Spaces platform load

**Solutions:**
- Wait patiently (usually resolves itself)
- Check HF Spaces status page
- Contact HF support if persists

## Performance Optimization

### Reduce Build Time

1. **Use Layer Caching**
   ```dockerfile
   # Dockerfile - Copy package files first
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build
   ```

2. **Minimize Dependencies**
   ```bash
   # Remove unused packages
   npm prune --production
   ```

3. **Optimize TypeScript Build**
   ```json
   // tsconfig.json
   {
     "compilerOptions": {
       "incremental": true,
       "tsBuildInfoFile": "./.tsbuildinfo"
     }
   }
   ```

### Reduce Container Size

```dockerfile
# Use multi-stage build
FROM node:18-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
CMD ["npm", "start"]
```

## Deployment Checklist

Before deploying to production:

- [ ] All tests pass locally (`npm test`)
- [ ] TypeScript builds without errors (`npm run build`)
- [ ] Environment variables are configured in HF Spaces
- [ ] Changes are committed with clear message
- [ ] Backup push to GitHub completed
- [ ] IMPLEMENTATION_PLAN.md updated if needed
- [ ] Breaking changes documented in commit message

After deployment:

- [ ] Health endpoint returns 200 OK
- [ ] Readiness endpoint returns ready=true
- [ ] Test transcription request succeeds
- [ ] Webhook delivery works (or fails gracefully)
- [ ] Production tests pass
- [ ] Monitor logs for 10 minutes for errors

## Rollout Strategy

### Blue-Green Deployment (Future Enhancement)

For zero-downtime deployments:

1. **Deploy to staging space** (blue environment)
2. **Run full test suite** against staging
3. **Switch traffic** to new version (green)
4. **Monitor** for errors
5. **Rollback** if issues detected

### Canary Deployment (Future Enhancement)

For gradual rollouts:

1. **Deploy new version** to subset of users (10%)
2. **Monitor metrics** (error rate, latency)
3. **Increase traffic** gradually (25%, 50%, 100%)
4. **Rollback** if metrics degrade

## CI/CD Pipeline (Future Enhancement)

Automate deployment with GitHub Actions:

```yaml
# .github/workflows/deploy.yml
name: Deploy to HF Spaces

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Push to HF Spaces
        run: |
          git remote add hf https://user:${{ secrets.HF_TOKEN }}@huggingface.co/spaces/iamromeoly/TTTranscribe.git
          git push hf main
```

## Support

For deployment issues:
1. Check HF Spaces build logs
2. Review application logs
3. Test locally with same environment
4. Contact HF Spaces support: https://huggingface.co/support
5. Review IMPLEMENTATION_PLAN.md for architecture details

## Related Documentation

- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) - Strategic overhaul details
- [JWT_HELPER_FOR_BUSINESS_ENGINE.md](JWT_HELPER_FOR_BUSINESS_ENGINE.md) - JWT integration
- [WEBHOOK_MONITORING_GUIDE.md](WEBHOOK_MONITORING_GUIDE.md) - Webhook monitoring
- [MOBILE_CLIENT_GUIDE.md](MOBILE_CLIENT_GUIDE.md) - Client integration guide
