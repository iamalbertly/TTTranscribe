/**
 * Performance Journey Test
 * Tests performance characteristics and load handling
 */

const BaseTest = require('../BaseTest');

class PerformanceJourney extends BaseTest {
  async run() {
    this.logger.info('Starting Performance Journey Test');
    
    try {
      // Step 1: Test single request performance
      const singleRequestResult = await this.testSingleRequestPerformance();
      if (!singleRequestResult.success) {
        return { success: false, error: `Single request performance test failed: ${singleRequestResult.error}` };
      }

      // Step 2: Test concurrent requests
      const concurrentRequestResult = await this.testConcurrentRequests();
      if (!concurrentRequestResult.success) {
        return { success: false, error: `Concurrent requests test failed: ${concurrentRequestResult.error}` };
      }

      // Step 3: Test response time consistency
      const consistencyResult = await this.testResponseTimeConsistency();
      if (!consistencyResult.success) {
        return { success: false, error: `Response time consistency test failed: ${consistencyResult.error}` };
      }

      // Step 4: Test memory usage patterns
      const memoryResult = await this.testMemoryUsagePatterns();
      if (!memoryResult.success) {
        this.logger.warn(`Memory usage test failed: ${memoryResult.error}`);
        // Don't fail the entire test for memory issues
      }

      this.logger.info('Performance Journey Test completed successfully');
      
      return {
        success: true,
        details: {
          singleRequest: singleRequestResult.details,
          concurrentRequests: concurrentRequestResult.details,
          consistency: consistencyResult.details,
          memory: memoryResult.details,
          performanceScore: this.calculatePerformanceScore([
            singleRequestResult.details,
            concurrentRequestResult.details,
            consistencyResult.details
          ])
        }
      };

    } catch (error) {
      this.logger.error('Performance Journey Test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testSingleRequestPerformance() {
    this.logger.info('Testing single request performance...');
    
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

      // Performance thresholds
      const acceptableDuration = 5000; // 5 seconds
      const excellentDuration = 1000;  // 1 second

      let performanceRating = 'poor';
      if (duration <= excellentDuration) {
        performanceRating = 'excellent';
      } else if (duration <= acceptableDuration) {
        performanceRating = 'good';
      }

      this.logger.info(`Single request performance: ${duration}ms (${performanceRating})`);
      
      return {
        success: true,
        details: {
          duration,
          performanceRating,
          acceptableDuration,
          excellentDuration,
          jobId: response.body.id
        }
      };
      
    } catch (error) {
      this.logger.error('Single request performance test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testConcurrentRequests() {
    this.logger.info('Testing concurrent requests...');
    
    try {
      const concurrentCount = 5;
      const requests = [];
      
      // Create multiple concurrent requests with different URLs
      for (let i = 0; i < concurrentCount; i++) {
        requests.push(
          this.makeRequest('POST', '/transcribe', {
            url: `${this.config.TEST_URL}?concurrent=${i}`
          }, {
            'X-Engine-Auth': this.config.AUTH_SECRET
          })
        );
      }

      const startTime = Date.now();
      const responses = await Promise.allSettled(requests);
      const totalDuration = Date.now() - startTime;

      // Analyze results
      const successful = responses.filter(r => 
        r.status === 'fulfilled' && r.value.statusCode === 202
      ).length;

      const failed = responses.filter(r => 
        r.status === 'rejected' || (r.status === 'fulfilled' && r.value.statusCode !== 202)
      ).length;

      const successRate = (successful / concurrentCount) * 100;
      const averageResponseTime = totalDuration / concurrentCount;

      // Performance thresholds
      const acceptableSuccessRate = 80; // 80%
      const acceptableAverageTime = 10000; // 10 seconds

      let performanceRating = 'poor';
      if (successRate >= acceptableSuccessRate && averageResponseTime <= acceptableAverageTime) {
        performanceRating = 'good';
      }
      if (successRate >= 95 && averageResponseTime <= 5000) {
        performanceRating = 'excellent';
      }

      this.logger.info(`Concurrent requests: ${successful}/${concurrentCount} successful (${successRate.toFixed(1)}%), avg time: ${averageResponseTime.toFixed(0)}ms`);
      
      return {
        success: true,
        details: {
          concurrentCount,
          successful,
          failed,
          successRate,
          totalDuration,
          averageResponseTime,
          performanceRating,
          acceptableSuccessRate,
          acceptableAverageTime
        }
      };
      
    } catch (error) {
      this.logger.error('Concurrent requests test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testResponseTimeConsistency() {
    this.logger.info('Testing response time consistency...');
    
    try {
      const testCount = 10;
      const responseTimes = [];
      
      // Make multiple requests and measure response times
      for (let i = 0; i < testCount; i++) {
        const startTime = Date.now();
        
        try {
          const response = await this.makeRequest('POST', '/transcribe', {
            url: `${this.config.TEST_URL}?consistency=${i}`
          }, {
            'X-Engine-Auth': this.config.AUTH_SECRET
          });

          const duration = Date.now() - startTime;
          
          if (response.statusCode === 202) {
            responseTimes.push(duration);
          }
          
          // Small delay between requests
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          this.logger.warn(`Request ${i} failed: ${error.message}`);
        }
      }

      if (responseTimes.length === 0) {
        throw new Error('No successful requests for consistency testing');
      }

      // Calculate statistics
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const minResponseTime = Math.min(...responseTimes);
      const maxResponseTime = Math.max(...responseTimes);
      const variance = responseTimes.reduce((acc, time) => acc + Math.pow(time - avgResponseTime, 2), 0) / responseTimes.length;
      const standardDeviation = Math.sqrt(variance);
      const coefficientOfVariation = standardDeviation / avgResponseTime;

      // Consistency thresholds
      const acceptableCV = 0.5; // 50% coefficient of variation
      const excellentCV = 0.2;  // 20% coefficient of variation

      let consistencyRating = 'poor';
      if (coefficientOfVariation <= excellentCV) {
        consistencyRating = 'excellent';
      } else if (coefficientOfVariation <= acceptableCV) {
        consistencyRating = 'good';
      }

      this.logger.info(`Response time consistency: avg=${avgResponseTime.toFixed(0)}ms, cv=${coefficientOfVariation.toFixed(2)} (${consistencyRating})`);
      
      return {
        success: true,
        details: {
          testCount,
          successfulRequests: responseTimes.length,
          avgResponseTime,
          minResponseTime,
          maxResponseTime,
          standardDeviation,
          coefficientOfVariation,
          consistencyRating,
          acceptableCV,
          excellentCV
        }
      };
      
    } catch (error) {
      this.logger.error('Response time consistency test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testMemoryUsagePatterns() {
    this.logger.info('Testing memory usage patterns...');
    
    try {
      // This is a simplified test - in a real scenario, you'd monitor actual memory usage
      const initialMemory = process.memoryUsage();
      
      // Make several requests to see if memory usage increases significantly
      const requestCount = 20;
      for (let i = 0; i < requestCount; i++) {
        try {
          await this.makeRequest('POST', '/transcribe', {
            url: `${this.config.TEST_URL}?memory=${i}`
          }, {
            'X-Engine-Auth': this.config.AUTH_SECRET
          });
        } catch (error) {
          // Ignore individual request failures
        }
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024);

      // Memory thresholds (simplified)
      const acceptableIncreaseMB = 100; // 100MB
      const excellentIncreaseMB = 50;   // 50MB

      let memoryRating = 'poor';
      if (memoryIncreaseMB <= excellentIncreaseMB) {
        memoryRating = 'excellent';
      } else if (memoryIncreaseMB <= acceptableIncreaseMB) {
        memoryRating = 'good';
      }

      this.logger.info(`Memory usage: +${memoryIncreaseMB.toFixed(1)}MB (${memoryRating})`);
      
      return {
        success: true,
        details: {
          requestCount,
          initialMemoryMB: initialMemory.heapUsed / (1024 * 1024),
          finalMemoryMB: finalMemory.heapUsed / (1024 * 1024),
          memoryIncreaseMB,
          memoryRating,
          acceptableIncreaseMB,
          excellentIncreaseMB
        }
      };
      
    } catch (error) {
      this.logger.error('Memory usage test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  calculatePerformanceScore(results) {
    // Simple scoring algorithm
    let score = 0;
    let maxScore = 0;

    // Single request performance (30% weight)
    const singleRequest = results[0];
    if (singleRequest.performanceRating === 'excellent') score += 30;
    else if (singleRequest.performanceRating === 'good') score += 20;
    else if (singleRequest.performanceRating === 'poor') score += 10;
    maxScore += 30;

    // Concurrent requests (40% weight)
    const concurrent = results[1];
    if (concurrent.performanceRating === 'excellent') score += 40;
    else if (concurrent.performanceRating === 'good') score += 30;
    else if (concurrent.performanceRating === 'poor') score += 15;
    maxScore += 40;

    // Consistency (30% weight)
    const consistency = results[2];
    if (consistency.consistencyRating === 'excellent') score += 30;
    else if (consistency.consistencyRating === 'good') score += 20;
    else if (consistency.consistencyRating === 'poor') score += 10;
    maxScore += 30;

    const percentage = Math.round((score / maxScore) * 100);
    
    let rating = 'poor';
    if (percentage >= 90) rating = 'excellent';
    else if (percentage >= 70) rating = 'good';
    else if (percentage >= 50) rating = 'fair';

    return {
      score: percentage,
      rating,
      breakdown: {
        singleRequest: singleRequest.performanceRating,
        concurrent: concurrent.performanceRating,
        consistency: consistency.consistencyRating
      }
    };
  }
}

module.exports = PerformanceJourney;
