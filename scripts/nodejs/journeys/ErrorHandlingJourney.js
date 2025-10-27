/**
 * Error Handling Journey Test
 * Tests various error scenarios and edge cases
 */

const BaseTest = require('../BaseTest');

class ErrorHandlingJourney extends BaseTest {
  async run() {
    this.logger.info('Starting Error Handling Journey Test');
    
    try {
      // Step 1: Test error handling scenarios
      const errorResult = await this.testErrorHandling();
      if (!errorResult.success) {
        return { success: false, error: `Error handling test failed: ${errorResult.error}` };
      }

      // Step 2: Test non-existent job status
      const nonExistentJobResult = await this.testNonExistentJob();
      if (!nonExistentJobResult.success) {
        return { success: false, error: `Non-existent job test failed: ${nonExistentJobResult.error}` };
      }

      // Step 3: Test malformed requests
      const malformedRequestResult = await this.testMalformedRequests();
      if (!malformedRequestResult.success) {
        return { success: false, error: `Malformed request test failed: ${malformedRequestResult.error}` };
      }

      // Step 4: Test rate limiting (if applicable)
      const rateLimitResult = await this.testRateLimiting();
      if (!rateLimitResult.success) {
        this.logger.warn(`Rate limiting test failed: ${rateLimitResult.error}`);
        // Don't fail the entire test for rate limiting issues
      }

      this.logger.info('Error Handling Journey Test completed successfully');
      
      return {
        success: true,
        details: {
          errorHandlingTests: errorResult.details,
          nonExistentJobTest: nonExistentJobResult.details,
          malformedRequestTests: malformedRequestResult.details,
          rateLimitTest: rateLimitResult.details
        }
      };

    } catch (error) {
      this.logger.error('Error Handling Journey Test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testNonExistentJob() {
    this.logger.info('Testing non-existent job status...');
    
    try {
      const fakeJobId = 'non-existent-job-id-12345';
      const response = await this.makeRequest('GET', `/status/${fakeJobId}`, null, {
        'X-Engine-Auth': this.config.AUTH_SECRET
      });

      if (response.statusCode !== 404) {
        throw new Error(`Expected 404, got ${response.statusCode}`);
      }

      if (response.body && response.body.error !== 'job_not_found') {
        throw new Error(`Expected error 'job_not_found', got '${response.body.error}'`);
      }

      this.logger.info('Non-existent job test passed');
      return { success: true };
      
    } catch (error) {
      this.logger.error('Non-existent job test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testMalformedRequests() {
    this.logger.info('Testing malformed requests...');
    
    const tests = [
      {
        name: 'Invalid JSON',
        body: '{"invalid": json}',
        expectedStatus: 400
      },
      {
        name: 'Empty body',
        body: '',
        expectedStatus: 400
      },
      {
        name: 'Null body',
        body: null,
        expectedStatus: 400
      }
    ];

    const results = [];
    
    for (const test of tests) {
      try {
        const response = await this.makeRequest('POST', '/transcribe', test.body, {
          'X-Engine-Auth': this.config.AUTH_SECRET
        });

        if (response.statusCode !== test.expectedStatus) {
          throw new Error(`Expected ${test.expectedStatus}, got ${response.statusCode}`);
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

  async testRateLimiting() {
    this.logger.info('Testing rate limiting...');
    
    try {
      const requests = [];
      const maxRequests = 10;
      
      // Send multiple requests rapidly
      for (let i = 0; i < maxRequests; i++) {
        requests.push(
          this.makeRequest('POST', '/transcribe', {
            url: `${this.config.TEST_URL}?test=${i}`
          }, {
            'X-Engine-Auth': this.config.AUTH_SECRET
          })
        );
      }

      const responses = await Promise.allSettled(requests);
      const rateLimited = responses.some(r => 
        r.status === 'fulfilled' && r.value.statusCode === 429
      );

      if (rateLimited) {
        this.logger.info('Rate limiting detected (expected behavior)');
        return { success: true, details: { rateLimited: true } };
      } else {
        this.logger.warn('Rate limiting not detected (may be disabled)');
        return { success: true, details: { rateLimited: false } };
      }
      
    } catch (error) {
      this.logger.error('Rate limiting test failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = ErrorHandlingJourney;
