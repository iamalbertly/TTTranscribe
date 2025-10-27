/**
 * Test Configuration
 * Centralized configuration for all test journeys
 */

const config = {
  BASE_URL: process.env.BASE_URL || 'https://iamromeoly-tttranscribe.hf.space',
  AUTH_SECRET: process.env.ENGINE_SHARED_SECRET || 'hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU',
  TEST_URL: process.env.TEST_URL || 'https://www.tiktok.com/@test/video/1234567890',
  TIMEOUT: parseInt(process.env.TEST_TIMEOUT || '30000'),
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3'),
  VERBOSE: process.env.VERBOSE === 'true',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  
  // Test-specific configurations
  PERFORMANCE: {
    CONCURRENT_REQUESTS: parseInt(process.env.CONCURRENT_REQUESTS || '5'),
    CONSISTENCY_TESTS: parseInt(process.env.CONSISTENCY_TESTS || '10'),
    MEMORY_TESTS: parseInt(process.env.MEMORY_TESTS || '20'),
    ACCEPTABLE_RESPONSE_TIME: parseInt(process.env.ACCEPTABLE_RESPONSE_TIME || '5000'),
    EXCELLENT_RESPONSE_TIME: parseInt(process.env.EXCELLENT_RESPONSE_TIME || '1000')
  },
  
  CACHE: {
    TEST_URLS: [
      'https://www.tiktok.com/@test/video/1234567890',
      'https://www.tiktok.com/@test/video/9876543210',
      'https://www.tiktok.com/@test/video/5555555555'
    ],
    CACHE_HIT_THRESHOLD: parseInt(process.env.CACHE_HIT_THRESHOLD || '500') // ms
  },
  
  ERROR_HANDLING: {
    RATE_LIMIT_TESTS: parseInt(process.env.RATE_LIMIT_TESTS || '10'),
    MALFORMED_REQUEST_TESTS: parseInt(process.env.MALFORMED_REQUEST_TESTS || '5')
  }
};

module.exports = config;
