/**
 * Automated Webhook Queue Monitoring Script
 *
 * This script monitors the TTTranscribe webhook queue and optionally
 * retries failed webhooks automatically.
 *
 * Features:
 * - Check webhook queue size
 * - Alert if queue size exceeds threshold
 * - Optionally retry failed webhooks
 * - Log monitoring results
 * - Send notifications (email, Slack, etc.)
 *
 * Usage:
 *   node monitor-webhook-queue.js [options]
 *
 * Options:
 *   --auto-retry    Automatically retry failed webhooks
 *   --threshold N   Alert threshold (default: 10)
 *   --slack-webhook URL  Send alerts to Slack
 *
 * Cron Setup (runs every hour):
 *   0 * * * * cd /path/to/tttranscribe && node monitor-webhook-queue.js --auto-retry >> logs/webhook-monitor.log 2>&1
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  TTT_BASE_URL: process.env.TTT_BASE || process.env.BASE_URL || 'https://iamromeoly-tttranscribe.hf.space',
  ADMIN_KEY: process.env.ENGINE_ADMIN_KEY || process.env.SHARED_SECRET,
  ALERT_THRESHOLD: parseInt(process.env.WEBHOOK_ALERT_THRESHOLD) || 10,
  AUTO_RETRY: process.argv.includes('--auto-retry'),
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL || getArgValue('--slack-webhook'),
  LOG_FILE: process.env.WEBHOOK_LOG_FILE || path.join(__dirname, 'logs', 'webhook-monitor.log'),
};

/**
 * Get command line argument value
 */
function getArgValue(arg) {
  const index = process.argv.indexOf(arg);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

/**
 * Make HTTP request
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const req = client.request({
      ...options,
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

/**
 * Log message to file and console
 */
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;

  console.log(logMessage);

  // Ensure log directory exists
  const logDir = path.dirname(CONFIG.LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Append to log file
  fs.appendFileSync(CONFIG.LOG_FILE, logMessage + '\n');
}

/**
 * Send Slack notification
 */
async function sendSlackNotification(message, level = 'warning') {
  if (!CONFIG.SLACK_WEBHOOK_URL) {
    return;
  }

  const color = level === 'critical' ? 'danger' : level === 'warning' ? 'warning' : 'good';
  const emoji = level === 'critical' ? ':rotating_light:' : level === 'warning' ? ':warning:' : ':white_check_mark:';

  try {
    const urlObj = new URL(CONFIG.SLACK_WEBHOOK_URL);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const payload = {
      attachments: [{
        color,
        text: `${emoji} *TTTranscribe Webhook Monitor*\n${message}`,
        footer: 'TTTranscribe Monitoring',
        ts: Math.floor(Date.now() / 1000),
      }],
    };

    await new Promise((resolve, reject) => {
      const req = client.request({
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }, (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      });

      req.on('error', reject);
      req.write(JSON.stringify(payload));
      req.end();
    });

    log('Slack notification sent', 'INFO');
  } catch (error) {
    log(`Failed to send Slack notification: ${error.message}`, 'ERROR');
  }
}

/**
 * Get webhook queue status
 */
async function getWebhookQueue() {
  const url = `${CONFIG.TTT_BASE_URL}/admin/webhook-queue`;

  const response = await makeRequest(url, {
    method: 'GET',
    headers: {
      'X-Engine-Auth': CONFIG.ADMIN_KEY,
    },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Failed to get webhook queue: HTTP ${response.statusCode}`);
  }

  return response.data;
}

/**
 * Retry failed webhook
 */
async function retryWebhook(jobId) {
  const url = `${CONFIG.TTT_BASE_URL}/admin/retry-webhook/${jobId}`;

  const response = await makeRequest(url, {
    method: 'POST',
    headers: {
      'X-Engine-Auth': CONFIG.ADMIN_KEY,
    },
  });

  return response;
}

/**
 * Main monitoring function
 */
async function monitorWebhookQueue() {
  log('Starting webhook queue monitoring', 'INFO');
  log(`Base URL: ${CONFIG.TTT_BASE_URL}`, 'INFO');
  log(`Alert threshold: ${CONFIG.ALERT_THRESHOLD}`, 'INFO');
  log(`Auto-retry: ${CONFIG.AUTO_RETRY ? 'Enabled' : 'Disabled'}`, 'INFO');

  try {
    // Get queue status
    const queue = await getWebhookQueue();
    const queueSize = queue.queue?.length || 0;

    log(`Webhook queue size: ${queueSize}`, 'INFO');

    // Check if alert threshold exceeded
    if (queueSize >= CONFIG.ALERT_THRESHOLD) {
      const message = `⚠️ Webhook queue size (${queueSize}) exceeded threshold (${CONFIG.ALERT_THRESHOLD})`;
      log(message, 'WARNING');
      await sendSlackNotification(message, 'warning');
    }

    // List failed webhooks
    if (queueSize > 0) {
      log('Failed webhooks:', 'INFO');
      queue.queue.forEach((item, index) => {
        log(`  ${index + 1}. Job ${item.jobId} - ${item.failedCount} attempts - Last failed: ${item.lastFailedAt}`, 'INFO');
        log(`     Error: ${item.error}`, 'INFO');
      });
    } else {
      log('✅ No failed webhooks in queue', 'INFO');
    }

    // Auto-retry if enabled
    if (CONFIG.AUTO_RETRY && queueSize > 0) {
      log('Auto-retry enabled, attempting to retry failed webhooks...', 'INFO');

      let successCount = 0;
      let failCount = 0;

      for (const item of queue.queue) {
        try {
          log(`Retrying webhook for job ${item.jobId}...`, 'INFO');
          const response = await retryWebhook(item.jobId);

          if (response.statusCode === 200) {
            log(`✅ Successfully retried webhook for job ${item.jobId}`, 'INFO');
            successCount++;
          } else {
            log(`❌ Failed to retry webhook for job ${item.jobId}: HTTP ${response.statusCode}`, 'ERROR');
            failCount++;
          }
        } catch (error) {
          log(`❌ Error retrying webhook for job ${item.jobId}: ${error.message}`, 'ERROR');
          failCount++;
        }

        // Add delay between retries to avoid overwhelming the server
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      log(`Retry summary: ${successCount} succeeded, ${failCount} failed`, 'INFO');

      if (successCount > 0) {
        await sendSlackNotification(`✅ Successfully retried ${successCount} webhook(s)`, 'good');
      }

      if (failCount > 0) {
        await sendSlackNotification(`❌ Failed to retry ${failCount} webhook(s)`, 'warning');
      }
    }

    log('Webhook queue monitoring completed', 'INFO');
    log('─'.repeat(80), 'INFO');

  } catch (error) {
    log(`ERROR: ${error.message}`, 'ERROR');
    await sendSlackNotification(`🚨 Webhook monitoring failed: ${error.message}`, 'critical');
    process.exit(1);
  }
}

// Help text
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
TTTranscribe Webhook Queue Monitor

Usage:
  node monitor-webhook-queue.js [options]

Options:
  --auto-retry           Automatically retry failed webhooks
  --threshold N          Alert threshold (default: 10)
  --slack-webhook URL    Slack webhook URL for alerts
  --help, -h             Show this help message

Environment Variables:
  TTT_BASE or BASE_URL              TTTranscribe base URL
  ENGINE_ADMIN_KEY or SHARED_SECRET Admin authentication key
  WEBHOOK_ALERT_THRESHOLD           Alert threshold (default: 10)
  SLACK_WEBHOOK_URL                 Slack webhook URL
  WEBHOOK_LOG_FILE                  Log file path

Examples:
  # Check queue status
  node monitor-webhook-queue.js

  # Auto-retry failed webhooks
  node monitor-webhook-queue.js --auto-retry

  # Set custom threshold and send Slack alerts
  node monitor-webhook-queue.js --threshold 5 --slack-webhook https://hooks.slack.com/...

Cron Setup (runs every hour):
  0 * * * * cd /path/to/tttranscribe && node monitor-webhook-queue.js --auto-retry >> logs/webhook-monitor.log 2>&1

Cron Setup (runs every 15 minutes):
  */15 * * * * cd /path/to/tttranscribe && node monitor-webhook-queue.js >> logs/webhook-monitor.log 2>&1
  `);
  process.exit(0);
}

// Check required configuration
if (!CONFIG.ADMIN_KEY) {
  console.error('❌ ERROR: ENGINE_ADMIN_KEY or SHARED_SECRET not configured');
  console.error('Set environment variable or add to .env.local');
  process.exit(1);
}

// Override threshold if provided via command line
const thresholdArg = getArgValue('--threshold');
if (thresholdArg) {
  CONFIG.ALERT_THRESHOLD = parseInt(thresholdArg);
}

// Run monitoring
monitorWebhookQueue().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
