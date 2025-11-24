#!/usr/bin/env node
/**
 * Simple Test Script for TTTranscribe
 * Quick validation of the updated API
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Configuration
const CONFIG = {
  BASE_URL: 'http://localhost:8788',
  AUTH_SECRET: process.env.ENGINE_SHARED_SECRET,
  TEST_URL: 'https://www.tiktok.com/@test/video/1234567890'
};

// Simple HTTP request function
function makeRequest(method, endpoint, body = null, headers = {}) {
  const url = new URL(endpoint, CONFIG.BASE_URL);

  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TTTranscribe-Simple-Test/1.0',
        ...headers
      }
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        try {
          const parsedBody = responseBody ? JSON.parse(responseBody) : null;
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsedBody,
            rawBody: responseBody
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: responseBody,
            rawBody: responseBody
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }

    req.end();
  });
}

// Test functions
async function testHealth() {
  console.log('Testing health endpoint...');
  try {
    const response = await makeRequest('GET', '/health');
    console.log(`Health check: ${response.statusCode}`);
    console.log('Response:', JSON.stringify(response.body, null, 2));
    return response.statusCode === 200;
  } catch (error) {
    console.error('Health check failed:', error.message);
    return false;
  }
}

async function testTranscribe() {
  console.log('Testing transcribe endpoint...');
  try {
    const response = await makeRequest('POST', '/transcribe', {
      url: CONFIG.TEST_URL
    }, {
      'X-Engine-Auth': CONFIG.AUTH_SECRET
    });

    console.log(`Transcribe: ${response.statusCode}`);
    console.log('Response:', JSON.stringify(response.body, null, 2));

    if (response.statusCode === 202 && response.body && response.body.id) {
      return response.body.id;
    }
    return null;
  } catch (error) {
    console.error('Transcribe test failed:', error.message);
    return null;
  }
}

async function testStatus(jobId) {
  console.log(`Testing status endpoint for job ${jobId}...`);
  try {
    const response = await makeRequest('GET', `/status/${jobId}`, null, {
      'X-Engine-Auth': CONFIG.AUTH_SECRET
    });

    console.log(`Status: ${response.statusCode}`);
    console.log('Response:', JSON.stringify(response.body, null, 2));
    return response.statusCode === 200;
  } catch (error) {
    console.error('Status test failed:', error.message);
    return false;
  }
}

// Main test execution
async function runTests() {
  console.log('Starting TTTranscribe Simple Tests');
  console.log('Configuration:', CONFIG);
  console.log('='.repeat(50));

  // Test 1: Health check
  const healthOk = await testHealth();
  console.log('='.repeat(50));

  if (!healthOk) {
    console.error('Health check failed, stopping tests');
    process.exit(1);
  }

  // Test 2: Transcribe endpoint
  const jobId = await testTranscribe();
  console.log('='.repeat(50));

  if (!jobId) {
    console.error('Transcribe test failed, stopping tests');
    process.exit(1);
  }

  // Test 3: Status endpoint
  const statusOk = await testStatus(jobId);
  console.log('='.repeat(50));

  // Summary
  console.log('TEST SUMMARY:');
  console.log(`Health Check: ${healthOk ? 'PASS' : 'FAIL'}`);
  console.log(`Transcribe: ${jobId ? 'PASS' : 'FAIL'}`);
  console.log(`Status: ${statusOk ? 'PASS' : 'FAIL'}`);

  const allPassed = healthOk && jobId && statusOk;
  console.log(`Overall: ${allPassed ? 'PASS' : 'FAIL'}`);

  process.exit(allPassed ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
