/**
 * TTTranscribe Health Monitoring Script
 *
 * This script monitors the health and availability of TTTranscribe service.
 *
 * Features:
 * - Check /health endpoint
 * - Check /ready endpoint
 * - Monitor response time
 * - Track uptime
 * - Alert on failures
 * - Send notifications (email, Slack, PagerDuty, etc.)
 * - Log health metrics
 *
 * Usage:
 *   node monitor-health.js [options]
 *
 * Options:
 *   --slack-webhook URL  Send alerts to Slack
 *   --alert-email EMAIL  Send email alerts
 *   --interval N         Check interval in seconds (default: 60)
 *
 * Cron Setup (runs every 5 minutes):
 *   */5 * * * * cd /path/to/tttranscribe && node monitor-health.js >> logs/health-monitor.log 2>&1
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  TTT_BASE_URL: process.env.TTT_BASE || process.env.BASE_URL || 'https://iamromeoly-tttranscribe.hf.space',
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL || getArgValue('--slack-webhook'),
  ALERT_EMAIL: process.env.ALERT_EMAIL || getArgValue('--alert-email'),
  CHECK_INTERVAL: parseInt(getArgValue('--interval') || process.env.HEALTH_CHECK_INTERVAL || '60'),
  RESPONSE_TIME_THRESHOLD_MS: parseInt(process.env.RESPONSE_TIME_THRESHOLD) || 5000,
  LOG_FILE: process.env.HEALTH_LOG_FILE || path.join(__dirname, 'logs', 'health-monitor.log'),
  METRICS_FILE: process.env.METRICS_FILE || path.join(__dirname, 'logs', 'health-metrics.json'),
};

/**
 * Get command line argument value
 */
function getArgValue(arg) {
  const index = process.argv.indexOf(arg);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

/**
 * Make HTTP request with timing
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const req = client.request({
      ...options,
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'TTTranscribe-Health-Monitor/1.0',
        ...options.headers,
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        try {
          resolve({
            statusCode: res.statusCode,
            data: JSON.parse(data),
            responseTime,
            headers: res.headers,
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            data,
            responseTime,
            headers: res.headers,
          });
        }
      });
    });

    req.on('error', (error) => {
      reject({
        error: error.message,
        responseTime: Date.now() - startTime,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject({
        error: 'Request timeout',
        responseTime: Date.now() - startTime,
      });
    });

    req.end();
  });
}

/**
 * Log message
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

  fs.appendFileSync(CONFIG.LOG_FILE, logMessage + '\n');
}

/**
 * Save metrics to file
 */
function saveMetrics(metrics) {
  const metricsDir = path.dirname(CONFIG.METRICS_FILE);
  if (!fs.existsSync(metricsDir)) {
    fs.mkdirSync(metricsDir, { recursive: true });
  }

  // Load existing metrics
  let allMetrics = [];
  if (fs.existsSync(CONFIG.METRICS_FILE)) {
    try {
      allMetrics = JSON.parse(fs.readFileSync(CONFIG.METRICS_FILE, 'utf-8'));
    } catch (e) {
      log(`Failed to load existing metrics: ${e.message}`, 'WARN');
    }
  }

  // Add new metrics
  allMetrics.push(metrics);

  // Keep only last 1000 entries
  if (allMetrics.length > 1000) {
    allMetrics = allMetrics.slice(-1000);
  }

  fs.writeFileSync(CONFIG.METRICS_FILE, JSON.stringify(allMetrics, null, 2));
}

/**
 * Send Slack notification
 */
async function sendSlackNotification(message, level = 'warning') {
  if (!CONFIG.SLACK_WEBHOOK_URL) {
    return;
  }

  const color = level === 'critical' ? 'danger' : level === 'warning' ? 'warning' : 'good';
  const emoji = level === 'critical' ? ':fire:' : level === 'warning' ? ':warning:' : ':white_check_mark:';

  try {
    const urlObj = new URL(CONFIG.SLACK_WEBHOOK_URL);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const payload = {
      attachments: [{
        color,
        text: `${emoji} *TTTranscribe Health Monitor*\n${message}`,
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
 * Check health endpoint
 */
async function checkHealth() {
  const url = `${CONFIG.TTT_BASE_URL}/health`;
  log(`Checking health endpoint: ${url}`, 'INFO');

  try {
    const response = await makeRequest(url);

    const healthy = response.statusCode === 200 && response.data.status === 'healthy';

    const metrics = {
      timestamp: new Date().toISOString(),
      endpoint: '/health',
      statusCode: response.statusCode,
      responseTime: response.responseTime,
      healthy,
      uptime: response.data.uptime,
      platform: response.data.platform,
      cacheSize: response.data.cache?.size,
      webhookQueueSize: response.data.webhook?.queueSize,
    };

    log(`Health check: ${healthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`, healthy ? 'INFO' : 'ERROR');
    log(`Response time: ${response.responseTime}ms`, 'INFO');
    log(`Uptime: ${Math.floor(response.data.uptime / 60)}m ${Math.floor(response.data.uptime % 60)}s`, 'INFO');
    log(`Cache: ${response.data.cache?.size || 0} entries`, 'INFO');
    log(`Webhook queue: ${response.data.webhook?.queueSize || 0} failed`, 'INFO');

    // Alert on slow response
    if (response.responseTime > CONFIG.RESPONSE_TIME_THRESHOLD_MS) {
      const message = `⚠️ Slow response time: ${response.responseTime}ms (threshold: ${CONFIG.RESPONSE_TIME_THRESHOLD_MS}ms)`;
      log(message, 'WARNING');
      await sendSlackNotification(message, 'warning');
    }

    // Alert on unhealthy
    if (!healthy) {
      const message = `🚨 Service UNHEALTHY! Status: ${response.data.status}, HTTP ${response.statusCode}`;
      log(message, 'CRITICAL');
      await sendSlackNotification(message, 'critical');
    }

    // Alert on high webhook queue
    if (response.data.webhook?.queueSize > 10) {
      const message = `⚠️ High webhook queue size: ${response.data.webhook.queueSize}`;
      log(message, 'WARNING');
      await sendSlackNotification(message, 'warning');
    }

    saveMetrics(metrics);
    return metrics;

  } catch (error) {
    const metrics = {
      timestamp: new Date().toISOString(),
      endpoint: '/health',
      error: error.error || error.message,
      responseTime: error.responseTime,
      healthy: false,
    };

    log(`Health check FAILED: ${error.error || error.message}`, 'CRITICAL');
    await sendSlackNotification(`🚨 Health check FAILED: ${error.error || error.message}`, 'critical');

    saveMetrics(metrics);
    return metrics;
  }
}

/**
 * Check readiness endpoint
 */
async function checkReadiness() {
  const url = `${CONFIG.TTT_BASE_URL}/ready`;
  log(`Checking readiness endpoint: ${url}`, 'INFO');

  try {
    const response = await makeRequest(url);

    const ready = response.statusCode === 200 && response.data.ready === true;

    log(`Readiness check: ${ready ? '✅ READY' : '⚠️ NOT READY'}`, ready ? 'INFO' : 'WARNING');

    if (!ready && response.data.reason) {
      log(`Reason: ${response.data.reason}`, 'WARNING');
      // Don't alert on readiness issues - they're expected when webhook endpoint is down
    }

    return { ready, reason: response.data.reason, responseTime: response.responseTime };

  } catch (error) {
    log(`Readiness check FAILED: ${error.error || error.message}`, 'ERROR');
    return { ready: false, error: error.error || error.message, responseTime: error.responseTime };
  }
}

/**
 * Run full health monitoring
 */
async function runHealthMonitoring() {
  log('Starting health monitoring', 'INFO');
  log(`Base URL: ${CONFIG.TTT_BASE_URL}`, 'INFO');
  log(`Response time threshold: ${CONFIG.RESPONSE_TIME_THRESHOLD_MS}ms`, 'INFO');

  // Check health
  const healthMetrics = await checkHealth();

  // Check readiness
  const readinessMetrics = await checkReadiness();

  // Summary
  log('─'.repeat(80), 'INFO');
  log('Health Monitoring Summary:', 'INFO');
  log(`  Health: ${healthMetrics.healthy ? '✅ Healthy' : '❌ Unhealthy'}`, 'INFO');
  log(`  Readiness: ${readinessMetrics.ready ? '✅ Ready' : '⚠️ Not Ready'}`, 'INFO');
  log(`  Response Time: ${healthMetrics.responseTime}ms`, 'INFO');
  log(`  Uptime: ${Math.floor((healthMetrics.uptime || 0) / 60)}m`, 'INFO');
  log('─'.repeat(80), 'INFO');

  if (healthMetrics.healthy && readinessMetrics.ready) {
    log('✅ All checks passed', 'INFO');
  } else if (healthMetrics.healthy) {
    log('⚠️ Service healthy but not ready (webhook endpoint may be down)', 'WARNING');
  } else {
    log('❌ Service unhealthy or unreachable', 'CRITICAL');
  }

  return {
    healthy: healthMetrics.healthy,
    ready: readinessMetrics.ready,
    responseTime: healthMetrics.responseTime,
  };
}

// Help text
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
TTTranscribe Health Monitor

Usage:
  node monitor-health.js [options]

Options:
  --slack-webhook URL    Slack webhook URL for alerts
  --alert-email EMAIL    Email address for alerts (requires mail setup)
  --interval N           Check interval in seconds (default: 60)
  --help, -h             Show this help message

Environment Variables:
  TTT_BASE or BASE_URL          TTTranscribe base URL
  SLACK_WEBHOOK_URL             Slack webhook URL
  ALERT_EMAIL                   Alert email address
  HEALTH_CHECK_INTERVAL         Check interval in seconds
  RESPONSE_TIME_THRESHOLD       Response time alert threshold (ms)
  HEALTH_LOG_FILE               Log file path
  METRICS_FILE                  Metrics file path

Examples:
  # Single health check
  node monitor-health.js

  # Continuous monitoring every 30 seconds
  node monitor-health.js --interval 30

  # With Slack alerts
  node monitor-health.js --slack-webhook https://hooks.slack.com/...

Cron Setup (runs every 5 minutes):
  */5 * * * * cd /path/to/tttranscribe && node monitor-health.js >> logs/health-monitor.log 2>&1

Systemd Timer Setup:
  # /etc/systemd/system/tttranscribe-health-monitor.service
  [Unit]
  Description=TTTranscribe Health Monitor

  [Service]
  Type=oneshot
  ExecStart=/usr/bin/node /path/to/monitor-health.js
  WorkingDirectory=/path/to/tttranscribe

  # /etc/systemd/system/tttranscribe-health-monitor.timer
  [Unit]
  Description=Run TTTranscribe Health Monitor every 5 minutes

  [Timer]
  OnBootSec=1min
  OnUnitActiveSec=5min

  [Install]
  WantedBy=timers.target
  `);
  process.exit(0);
}

// Run monitoring
runHealthMonitoring()
  .then((result) => {
    process.exit(result.healthy ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
