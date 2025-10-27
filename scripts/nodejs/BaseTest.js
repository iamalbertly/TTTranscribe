/**
 * Base Test Class for TTTranscribe Journey Tests
 * Provides common functionality for all test journeys
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

class BaseTest {
  constructor(config) {
    this.config = config;
    this.logger = {
      debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data || ''),
      info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
      warn: (msg, data) => console.log(`[WARN] ${msg}`, data || ''),
      error: (msg, data) => console.log(`[ERROR] ${msg}`, data || '')
    };
  }

  /**
   * Make HTTP request with detailed logging
   */
  async makeRequest(method, endpoint, body = null, headers = {}) {
    const url = new URL(endpoint, this.config.BASE_URL);
    const startTime = Date.now();
    
    this.logger.info(`Making ${method} request to ${url.toString()}`);
    
    if (body) {
      this.logger.debug('Request body:', body);
    }
    
    if (Object.keys(headers).length > 0) {
      this.logger.debug('Request headers:', headers);
    }

    return new Promise((resolve, reject) => {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TTTranscribe-Test-Suite/1.0',
          ...headers
        }
      };

      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(url, options, (res) => {
        const duration = Date.now() - startTime;
        let responseBody = '';

        res.on('data', (chunk) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          this.logger.info(`Response: ${res.statusCode} (${duration}ms)`);
          this.logger.debug('Response body:', responseBody);

          try {
            const parsedBody = responseBody ? JSON.parse(responseBody) : null;
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: parsedBody,
              rawBody: responseBody,
              duration
            });
          } catch (error) {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: responseBody,
              rawBody: responseBody,
              duration
            });
          }
        });
      });

      req.on('error', (error) => {
        const duration = Date.now() - startTime;
        this.logger.error(`Request failed after ${duration}ms:`, error.message);
        reject(error);
      });

      req.setTimeout(this.config.TIMEOUT, () => {
        req.destroy();
        reject(new Error(`Request timeout after ${this.config.TIMEOUT}ms`));
      });

      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * Test health endpoint
   */
  async testHealth() {
    this.logger.info('Testing health endpoint...');
    
    try {
      const response = await this.makeRequest('GET', '/health');
      
      if (response.statusCode !== 200) {
        throw new Error(`Expected 200, got ${response.statusCode}`);
      }

      if (!response.body || response.body.status !== 'healthy') {
        throw new Error('Health check failed - invalid response format');
      }

      this.logger.info('Health check passed');
      return { success: true, details: response.body };
      
    } catch (error) {
      this.logger.error('Health check failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test authentication
   */
  async testAuthentication() {
    this.logger.info('Testing authentication...');
    
    try {
      // Test without auth header (should fail)
      const response1 = await this.makeRequest('POST', '/transcribe', {
        url: this.config.TEST_URL
      });

      if (response1.statusCode !== 401) {
        throw new Error(`Expected 401 without auth, got ${response1.statusCode}`);
      }

      // Test with invalid auth header (should fail)
      const response2 = await this.makeRequest('POST', '/transcribe', {
        url: this.config.TEST_URL
      }, {
        'X-Engine-Auth': 'invalid-secret'
      });

      if (response2.statusCode !== 401) {
        throw new Error(`Expected 401 with invalid auth, got ${response2.statusCode}`);
      }

      this.logger.info('Authentication tests passed');
      return { success: true };
      
    } catch (error) {
      this.logger.error('Authentication test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test transcribe endpoint
   */
  async testTranscribe() {
    this.logger.info('Testing transcribe endpoint...');
    
    try {
      const response = await this.makeRequest('POST', '/transcribe', {
        url: this.config.TEST_URL
      }, {
        'X-Engine-Auth': this.config.AUTH_SECRET
      });

      if (response.statusCode !== 202) {
        throw new Error(`Expected 202, got ${response.statusCode}`);
      }

      if (!response.body || !response.body.id) {
        throw new Error('Missing job ID in response');
      }

      if (response.body.status !== 'queued') {
        throw new Error(`Expected status 'queued', got '${response.body.status}'`);
      }

      this.logger.info('Transcribe endpoint test passed');
      return { success: true, details: response.body };
      
    } catch (error) {
      this.logger.error('Transcribe endpoint test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test status endpoint
   */
  async testStatus(jobId) {
    this.logger.info(`Testing status endpoint for job ${jobId}...`);
    
    try {
      const response = await this.makeRequest('GET', `/status/${jobId}`, null, {
        'X-Engine-Auth': this.config.AUTH_SECRET
      });

      if (response.statusCode !== 200) {
        throw new Error(`Expected 200, got ${response.statusCode}`);
      }

      if (!response.body || !response.body.id) {
        throw new Error('Missing job ID in status response');
      }

      if (response.body.id !== jobId) {
        throw new Error(`Job ID mismatch: expected ${jobId}, got ${response.body.id}`);
      }

      this.logger.info('Status endpoint test passed');
      return { success: true, details: response.body };
      
    } catch (error) {
      this.logger.error('Status endpoint test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Wait for job completion
   */
  async waitForCompletion(jobId, maxWaitTime = 300000) {
    this.logger.info(`Waiting for job ${jobId} to complete...`);
    
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const response = await this.makeRequest('GET', `/status/${jobId}`, null, {
          'X-Engine-Auth': this.config.AUTH_SECRET
        });

        if (response.statusCode !== 200) {
          throw new Error(`Status check failed: ${response.statusCode}`);
        }

        const status = response.body.status;
        this.logger.debug(`Job status: ${status}`);

        if (status === 'completed') {
          this.logger.info(`Job ${jobId} completed successfully`);
          return { success: true, details: response.body };
        } else if (status === 'failed') {
          throw new Error(`Job ${jobId} failed: ${response.body.error || 'Unknown error'}`);
        }

        // Still processing, wait and retry
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        this.logger.error(`Error checking job status: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error(`Job ${jobId} did not complete within ${maxWaitTime}ms`);
  }

  /**
   * Test error handling
   */
  async testErrorHandling() {
    this.logger.info('Testing error handling...');
    
    const tests = [
      {
        name: 'Invalid URL',
        request: { url: 'not-a-url' },
        expectedStatus: 400,
        expectedError: 'invalid_url'
      },
      {
        name: 'Missing URL',
        request: {},
        expectedStatus: 400,
        expectedError: 'invalid_url'
      },
      {
        name: 'Non-TikTok URL',
        request: { url: 'https://example.com/video' },
        expectedStatus: 400,
        expectedError: 'invalid_url'
      }
    ];

    const results = [];
    
    for (const test of tests) {
      try {
        const response = await this.makeRequest('POST', '/transcribe', test.request, {
          'X-Engine-Auth': this.config.AUTH_SECRET
        });

        if (response.statusCode !== test.expectedStatus) {
          throw new Error(`Expected ${test.expectedStatus}, got ${response.statusCode}`);
        }

        if (response.body && response.body.error !== test.expectedError) {
          throw new Error(`Expected error '${test.expectedError}', got '${response.body.error}'`);
        }

        results.push({ name: test.name, success: true });
        this.logger.info(`✅ ${test.name} test passed`);
        
      } catch (error) {
        results.push({ name: test.name, success: false, error: error.message });
        this.logger.error(`❌ ${test.name} test failed: ${error.message}`);
      }
    }

    const allPassed = results.every(r => r.success);
    return { success: allPassed, details: results };
  }

  /**
   * Abstract method that must be implemented by subclasses
   */
  async run() {
    throw new Error('Subclasses must implement the run() method');
  }
}

module.exports = BaseTest;
