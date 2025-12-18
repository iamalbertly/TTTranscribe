# Webhook Monitoring & Alerting Guide

This guide explains how to monitor webhook delivery failures and set up alerts for the simplified webhook system.

## Overview

The new simplified webhook system uses single-attempt delivery with a failed webhook queue for visibility. This guide shows how to monitor and alert on webhook failures.

## Monitoring Endpoints

### GET /admin/webhook-queue
Returns all failed webhooks for manual review.

**Request:**
```bash
curl -H "Authorization: Bearer <JWT_TOKEN>" \
  https://iamromeoly-tttranscribe.hf.space/admin/webhook-queue
```

**Response:**
```json
{
  "failed": [
    {
      "jobId": "abc123-def456",
      "url": "https://pluct-business-engine.romeo-lya2.workers.dev/webhooks/tttranscribe",
      "attempts": 1,
      "lastError": "ENOTFOUND - DNS resolution failed",
      "timestamp": "2025-01-15T10:30:00Z",
      "canRetry": true
    }
  ],
  "totalFailed": 1
}
```

### POST /admin/retry-webhook/:jobId
Manually retry a failed webhook.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  https://iamromeoly-tttranscribe.hf.space/admin/retry-webhook/abc123-def456
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook for job abc123-def456 delivered successfully",
  "jobId": "abc123-def456"
}
```

## Log Patterns for Monitoring

### Successful Webhook Delivery
```
[webhook] Successfully delivered for job abc123-def456
```

### Failed Webhook Delivery
```
[webhook] Failed to deliver: ENOTFOUND
[webhook] Client should poll /status/abc123-def456 instead
```

### Webhook Queue Addition
```
[webhook] Added job abc123-def456 to failed queue (attempts: 1, error: HTTP 503: Service Unavailable)
```

## Setting Up Alerts

### 1. Log-Based Alerts (Hugging Face Spaces)

Monitor HF Spaces logs for webhook failure patterns:

```bash
# Check logs for failed webhooks
hf space logs iamromeoly/TTTranscibe | grep "\[webhook\] Failed"

# Count failed webhooks in last hour
hf space logs iamromeoly/TTTranscibe --since 1h | grep -c "\[webhook\] Failed"
```

### 2. Health Check Monitoring

Add webhook queue size to your monitoring dashboard:

**GET /health** response includes:
```json
{
  "webhook": {
    "queueSize": 0,
    "retryIntervalSeconds": 0,
    "targetUrl": "https://pluct-business-engine.workers.dev/webhooks/tttranscribe"
  }
}
```

**Alert Conditions:**
- `webhook.queueSize > 10` - High webhook failure rate
- `webhook.queueSize > 50` - Critical webhook failure rate

### 3. Scheduled Webhook Queue Check (Cron Job)

Create a monitoring script that runs every 15 minutes:

```typescript
// monitor-webhooks.ts
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

const ALERT_THRESHOLD = 10;
const CRITICAL_THRESHOLD = 50;

async function checkWebhookQueue() {
  const token = jwt.sign(
    {
      iss: 'pluct-business-engine',
      sub: 'monitoring-check',
      aud: 'tttranscribe',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256' }
  );

  const response = await fetch(
    'https://iamromeoly-tttranscribe.hf.space/admin/webhook-queue',
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  const data = await response.json();
  const failedCount = data.totalFailed;

  console.log(`[Monitor] Failed webhooks: ${failedCount}`);

  if (failedCount >= CRITICAL_THRESHOLD) {
    await sendAlert('CRITICAL', `${failedCount} webhooks have failed delivery!`, data.failed);
  } else if (failedCount >= ALERT_THRESHOLD) {
    await sendAlert('WARNING', `${failedCount} webhooks have failed delivery`, data.failed);
  }

  return { failedCount, failed: data.failed };
}

async function sendAlert(level: string, message: string, failedWebhooks: any[]) {
  console.error(`[Alert ${level}] ${message}`);

  // Send to your alerting system (Slack, PagerDuty, Email, etc.)
  // Example: Slack webhook
  if (process.env.SLACK_WEBHOOK_URL) {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 TTTranscribe ${level}: ${message}`,
        attachments: [{
          color: level === 'CRITICAL' ? 'danger' : 'warning',
          fields: failedWebhooks.slice(0, 5).map(w => ({
            title: `Job ${w.jobId}`,
            value: `Error: ${w.lastError}\nTimestamp: ${w.timestamp}`,
            short: false
          }))
        }]
      })
    });
  }
}

// Run check
checkWebhookQueue().catch(console.error);
```

**Cron Schedule (GitHub Actions):**
```yaml
# .github/workflows/monitor-webhooks.yml
name: Monitor Webhook Queue

on:
  schedule:
    - cron: '*/15 * * * *'  # Every 15 minutes
  workflow_dispatch:

jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: node monitor-webhooks.js
        env:
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### 4. Cloudflare Workers Analytics (for Business Engine)

Track webhook receipt on Business Engine side:

```typescript
// business-engine/webhooks/tttranscribe.ts
export async function handleTTTranscribeWebhook(request: Request, env: Env) {
  const jobId = request.headers.get('X-Job-ID');

  try {
    // Validate webhook signature
    const isValid = await validateWebhookSignature(request, env.WEBHOOK_SECRET);

    if (!isValid) {
      // Log failed signature validation
      console.error(`[webhook] Invalid signature for job ${jobId}`);
      return new Response('Invalid signature', { status: 401 });
    }

    const payload = await request.json();

    // Process webhook
    await processTranscriptionResult(payload);

    // Track successful webhook receipt
    await env.ANALYTICS.writeDataPoint({
      indexes: ['tttranscribe_webhook_received'],
      doubles: [1],
      blobs: [jobId]
    });

    return new Response('OK', { status: 200 });
  } catch (error) {
    // Track webhook processing errors
    await env.ANALYTICS.writeDataPoint({
      indexes: ['tttranscribe_webhook_error'],
      doubles: [1],
      blobs: [jobId, error.message]
    });

    return new Response('Error processing webhook', { status: 500 });
  }
}
```

## Automated Retry Strategy

### Option 1: Periodic Batch Retry (Recommended)

Run a scheduled job to retry failed webhooks in batches:

```typescript
// retry-failed-webhooks.ts
async function retryFailedWebhooks() {
  const token = jwt.sign(
    {
      iss: 'pluct-business-engine',
      sub: 'batch-retry',
      aud: 'tttranscribe',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256' }
  );

  // Get failed webhooks
  const queueResponse = await fetch(
    'https://iamromeoly-tttranscribe.hf.space/admin/webhook-queue',
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  const { failed } = await queueResponse.json();

  console.log(`[Retry] Found ${failed.length} failed webhooks to retry`);

  // Retry each webhook
  for (const webhook of failed) {
    try {
      const retryResponse = await fetch(
        `https://iamromeoly-tttranscribe.hf.space/admin/retry-webhook/${webhook.jobId}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const result = await retryResponse.json();

      if (result.success) {
        console.log(`[Retry] ✅ Successfully retried webhook for job ${webhook.jobId}`);
      } else {
        console.warn(`[Retry] ⚠️ Retry failed for job ${webhook.jobId}: ${result.message}`);
      }
    } catch (error) {
      console.error(`[Retry] ❌ Error retrying job ${webhook.jobId}:`, error);
    }

    // Rate limit: 1 second between retries
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

retryFailedWebhooks().catch(console.error);
```

**Schedule:** Run every hour via cron or GitHub Actions

### Option 2: Manual Admin Dashboard

Create a simple admin dashboard to manually review and retry webhooks:

```html
<!-- admin-webhooks.html -->
<!DOCTYPE html>
<html>
<head>
  <title>TTTranscribe Webhook Monitor</title>
  <style>
    body { font-family: monospace; padding: 20px; }
    .webhook { border: 1px solid #ddd; padding: 10px; margin: 10px 0; }
    .error { color: red; }
    button { margin: 5px; }
  </style>
</head>
<body>
  <h1>Failed Webhooks</h1>
  <div id="webhooks"></div>

  <script>
    const JWT_TOKEN = 'YOUR_JWT_TOKEN_HERE';
    const BASE_URL = 'https://iamromeoly-tttranscribe.hf.space';

    async function loadFailedWebhooks() {
      const response = await fetch(`${BASE_URL}/admin/webhook-queue`, {
        headers: { 'Authorization': `Bearer ${JWT_TOKEN}` }
      });
      const data = await response.json();

      const container = document.getElementById('webhooks');
      container.innerHTML = '';

      data.failed.forEach(webhook => {
        const div = document.createElement('div');
        div.className = 'webhook';
        div.innerHTML = `
          <strong>Job ID:</strong> ${webhook.jobId}<br>
          <strong>URL:</strong> ${webhook.url}<br>
          <strong>Attempts:</strong> ${webhook.attempts}<br>
          <strong>Last Error:</strong> <span class="error">${webhook.lastError}</span><br>
          <strong>Timestamp:</strong> ${webhook.timestamp}<br>
          <button onclick="retryWebhook('${webhook.jobId}')">Retry</button>
        `;
        container.appendChild(div);
      });

      if (data.failed.length === 0) {
        container.innerHTML = '<p>✅ No failed webhooks!</p>';
      }
    }

    async function retryWebhook(jobId) {
      const response = await fetch(`${BASE_URL}/admin/retry-webhook/${jobId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${JWT_TOKEN}` }
      });

      const result = await response.json();
      alert(result.success ? '✅ Retry successful!' : `❌ Retry failed: ${result.message}`);
      loadFailedWebhooks();
    }

    loadFailedWebhooks();
    setInterval(loadFailedWebhooks, 60000); // Refresh every minute
  </script>
</body>
</html>
```

## Metrics to Track

### Key Performance Indicators (KPIs)

1. **Webhook Success Rate**
   - Formula: `(successful_webhooks / total_webhooks) * 100`
   - Target: > 95%

2. **Failed Webhook Queue Size**
   - Current: Check `/admin/webhook-queue`
   - Target: < 10

3. **Webhook Delivery Latency**
   - Time from job completion to webhook delivery
   - Target: < 5 seconds

4. **Retry Success Rate**
   - Formula: `(successful_retries / total_retries) * 100`
   - Target: > 80%

### Grafana Dashboard Example

```json
{
  "dashboard": {
    "title": "TTTranscribe Webhook Monitoring",
    "panels": [
      {
        "title": "Failed Webhook Queue Size",
        "targets": [{
          "expr": "tttranscribe_webhook_queue_size"
        }],
        "alert": {
          "conditions": [
            {
              "evaluator": { "params": [10], "type": "gt" },
              "query": { "params": ["A", "5m", "now"] }
            }
          ]
        }
      },
      {
        "title": "Webhook Success Rate",
        "targets": [{
          "expr": "rate(tttranscribe_webhooks_successful[5m]) / rate(tttranscribe_webhooks_total[5m])"
        }]
      }
    ]
  }
}
```

## Best Practices

1. **Monitor Daily**: Check webhook queue at least once per day
2. **Set Alerts**: Configure alerts for queue size > 10
3. **Investigate Patterns**: If multiple webhooks fail, check Business Engine availability
4. **Regular Retries**: Run batch retry every 1-6 hours
5. **Document Failures**: Keep log of persistent webhook failures
6. **Escalate**: Alert engineering team if queue size > 50

## Troubleshooting Common Issues

### High Webhook Failure Rate

**Symptoms:** Many webhooks failing with network errors

**Causes:**
- Business Engine endpoint is down
- DNS resolution issues
- Network connectivity problems

**Actions:**
1. Check Business Engine health: `curl https://pluct-business-engine.romeo-lya2.workers.dev/health`
2. Verify DNS: `nslookup pluct-business-engine.romeo-lya2.workers.dev`
3. Check HF Spaces network logs
4. Enable poll-first flow as fallback

### Webhooks Stuck in Queue

**Symptoms:** Queue size growing, retries not helping

**Causes:**
- Business Engine rejecting webhooks (401, 403, 500)
- Signature validation failing
- Payload format issues

**Actions:**
1. Check webhook logs for HTTP status codes
2. Verify webhook secret matches
3. Test webhook manually with curl
4. Contact Business Engine team

### Duplicate Webhook Deliveries

**Symptoms:** Business Engine receiving same webhook multiple times

**Causes:**
- Idempotency key not being checked
- Manual retries while automatic retry in progress

**Actions:**
1. Verify Business Engine checks `X-Idempotency-Key` header
2. Implement deduplication on Business Engine side
3. Use single retry mechanism (not multiple)

## Support

For webhook monitoring issues:
1. Check `/admin/webhook-queue` endpoint
2. Review HF Spaces logs
3. Test manual retry with `/admin/retry-webhook/:jobId`
4. Contact TTTranscribe support with failed job IDs
