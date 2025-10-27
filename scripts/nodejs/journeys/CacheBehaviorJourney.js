/**
 * Cache Behavior Journey Test
 * Tests the 48-hour job result caching functionality
 */

const BaseTest = require('../BaseTest');

class CacheBehaviorJourney extends BaseTest {
  async run() {
    this.logger.info('Starting Cache Behavior Journey Test');
    
    try {
      // Step 1: Test cache miss (first request)
      const firstRequestResult = await this.testCacheMiss();
      if (!firstRequestResult.success) {
        return { success: false, error: `Cache miss test failed: ${firstRequestResult.error}` };
      }

      const jobId1 = firstRequestResult.details.jobId;
      const firstDuration = firstRequestResult.details.duration;

      // Step 2: Wait for first job to complete
      const completionResult = await this.waitForCompletion(jobId1, 60000);
      if (!completionResult.success) {
        return { success: false, error: `First job completion failed: ${completionResult.error}` };
      }

      // Step 3: Test cache hit (second request with same URL)
      const secondRequestResult = await this.testCacheHit();
      if (!secondRequestResult.success) {
        return { success: false, error: `Cache hit test failed: ${secondRequestResult.error}` };
      }

      const jobId2 = secondRequestResult.details.jobId;
      const secondDuration = secondRequestResult.details.duration;

      // Step 4: Validate cache behavior
      const cacheValidationResult = await this.validateCacheBehavior(
        firstRequestResult.details,
        secondRequestResult.details
      );
      
      if (!cacheValidationResult.success) {
        return { success: false, error: `Cache validation failed: ${cacheValidationResult.error}` };
      }

      // Step 5: Test cache with different URL (should be cache miss)
      const differentUrlResult = await this.testCacheMissWithDifferentUrl();
      if (!differentUrlResult.success) {
        return { success: false, error: `Different URL cache test failed: ${differentUrlResult.error}` };
      }

      this.logger.info('Cache Behavior Journey Test completed successfully');
      
      return {
        success: true,
        details: {
          firstRequest: firstRequestResult.details,
          secondRequest: secondRequestResult.details,
          cacheValidation: cacheValidationResult.details,
          differentUrlTest: differentUrlResult.details,
          cacheWorking: cacheValidationResult.details.cacheWorking
        }
      };

    } catch (error) {
      this.logger.error('Cache Behavior Journey Test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testCacheMiss() {
    this.logger.info('Testing cache miss (first request)...');
    
    try {
      const startTime = Date.now();
      const response = await this.makeRequest('POST', '/transcribe', {
        url: this.config.TEST_URL
      }, {
        'X-Engine-Auth': this.config.AUTH_SECRET
      });

      const duration = Date.now() - startTime;

      if (response.statusCode !== 202) {
        throw new Error(`Expected 202, got ${response.statusCode}`);
      }

      if (!response.body || !response.body.id) {
        throw new Error('Missing job ID in response');
      }

      this.logger.info(`Cache miss test passed - Job ID: ${response.body.id}, Duration: ${duration}ms`);
      
      return {
        success: true,
        details: {
          jobId: response.body.id,
          duration,
          status: response.body.status,
          submittedAt: response.body.submittedAt
        }
      };
      
    } catch (error) {
      this.logger.error('Cache miss test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testCacheHit() {
    this.logger.info('Testing cache hit (second request with same URL)...');
    
    try {
      const startTime = Date.now();
      const response = await this.makeRequest('POST', '/transcribe', {
        url: this.config.TEST_URL
      }, {
        'X-Engine-Auth': this.config.AUTH_SECRET
      });

      const duration = Date.now() - startTime;

      if (response.statusCode !== 202) {
        throw new Error(`Expected 202, got ${response.statusCode}`);
      }

      if (!response.body || !response.body.id) {
        throw new Error('Missing job ID in response');
      }

      this.logger.info(`Cache hit test passed - Job ID: ${response.body.id}, Duration: ${duration}ms`);
      
      return {
        success: true,
        details: {
          jobId: response.body.id,
          duration,
          status: response.body.status,
          submittedAt: response.body.submittedAt
        }
      };
      
    } catch (error) {
      this.logger.error('Cache hit test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async validateCacheBehavior(firstRequest, secondRequest) {
    this.logger.info('Validating cache behavior...');
    
    try {
      // Check if second request was faster (indicating cache hit)
      const isFaster = secondRequest.duration < firstRequest.duration;
      const speedDifference = firstRequest.duration - secondRequest.duration;
      
      // Check if both jobs completed successfully
      const firstJobStatus = await this.makeRequest('GET', `/status/${firstRequest.jobId}`, null, {
        'X-Engine-Auth': this.config.AUTH_SECRET
      });

      const secondJobStatus = await this.makeRequest('GET', `/status/${secondRequest.jobId}`, null, {
        'X-Engine-Auth': this.config.AUTH_SECRET
      });

      if (firstJobStatus.statusCode !== 200 || secondJobStatus.statusCode !== 200) {
        throw new Error('Failed to get job statuses for validation');
      }

      const firstCompleted = firstJobStatus.body.status === 'completed';
      const secondCompleted = secondJobStatus.body.status === 'completed';

      if (!firstCompleted || !secondCompleted) {
        throw new Error('One or both jobs did not complete successfully');
      }

      // Check if results are identical (cache hit)
      const resultsIdentical = JSON.stringify(firstJobStatus.body.result) === 
                              JSON.stringify(secondJobStatus.body.result);

      const cacheWorking = isFaster && resultsIdentical;

      this.logger.info(`Cache validation: Faster=${isFaster}, Identical=${resultsIdentical}, Working=${cacheWorking}`);
      
      return {
        success: true,
        details: {
          cacheWorking,
          isFaster,
          speedDifference,
          resultsIdentical,
          firstJobDuration: firstRequest.duration,
          secondJobDuration: secondRequest.duration,
          firstJobCompleted: firstCompleted,
          secondJobCompleted: secondCompleted
        }
      };
      
    } catch (error) {
      this.logger.error('Cache validation failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testCacheMissWithDifferentUrl() {
    this.logger.info('Testing cache miss with different URL...');
    
    try {
      const differentUrl = `${this.config.TEST_URL}?different=1`;
      const startTime = Date.now();
      
      const response = await this.makeRequest('POST', '/transcribe', {
        url: differentUrl
      }, {
        'X-Engine-Auth': this.config.AUTH_SECRET
      });

      const duration = Date.now() - startTime;

      if (response.statusCode !== 202) {
        throw new Error(`Expected 202, got ${response.statusCode}`);
      }

      if (!response.body || !response.body.id) {
        throw new Error('Missing job ID in response');
      }

      this.logger.info(`Different URL test passed - Job ID: ${response.body.id}, Duration: ${duration}ms`);
      
      return {
        success: true,
        details: {
          jobId: response.body.id,
          duration,
          url: differentUrl,
          status: response.body.status
        }
      };
      
    } catch (error) {
      this.logger.error('Different URL test failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = CacheBehaviorJourney;
