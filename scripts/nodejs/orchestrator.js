#!/usr/bin/env node
/**
 * TTTranscribe End-to-End Test Orchestrator (Node.js)
 * Comprehensive testing with automatic discovery and execution
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  BASE_URL: process.env.BASE_URL || 'https://iamromeoly-tttranscibe.hf.space',
  AUTH_SECRET: process.env.ENGINE_SHARED_SECRET || 'hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU',
  TEST_URL: process.env.TEST_URL || 'https://www.tiktok.com/@test/video/1234567890',
  TIMEOUT: parseInt(process.env.TEST_TIMEOUT || '30000'),
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3'),
  VERBOSE: process.env.VERBOSE === 'true',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

// Logging utilities
class Logger {
  constructor(level = 'info') {
    this.level = level;
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
  }

  log(level, message, data = null) {
    if (this.levels[level] >= this.levels[this.level]) {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      
      if (data) {
        console.log(`${prefix} ${message}`, data);
      } else {
        console.log(`${prefix} ${message}`);
      }
    }
  }

  debug(message, data) { this.log('debug', message, data); }
  info(message, data) { this.log('info', message, data); }
  warn(message, data) { this.log('warn', message, data); }
  error(message, data) { this.log('error', message, data); }
}

const logger = new Logger(CONFIG.LOG_LEVEL);

// Test result tracking
class TestResults {
  constructor() {
    this.tests = [];
    this.startTime = Date.now();
  }

  addTest(name, status, duration, error = null, details = {}) {
    this.tests.push({
      name,
      status,
      duration,
      error,
      details,
      timestamp: new Date().toISOString()
    });
  }

  getSummary() {
    const passed = this.tests.filter(t => t.status === 'passed').length;
    const failed = this.tests.filter(t => t.status === 'failed').length;
    const skipped = this.tests.filter(t => t.status === 'skipped').length;
    const total = this.tests.length;
    const duration = Date.now() - this.startTime;

    return {
      total,
      passed,
      failed,
      skipped,
      duration,
      successRate: total > 0 ? Math.round((passed / total) * 100) : 0
    };
  }

  printSummary() {
    const summary = this.getSummary();
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST EXECUTION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${summary.total}`);
    console.log(`Passed: ${summary.passed} (${summary.successRate}%)`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Skipped: ${summary.skipped}`);
    console.log(`Duration: ${summary.duration}ms`);
    console.log('='.repeat(60));

    if (summary.failed > 0) {
      console.log('\nFAILED TESTS:');
      this.tests.filter(t => t.status === 'failed').forEach(test => {
        console.log(`- ${test.name}: ${test.error}`);
      });
    }

    return summary.failed === 0;
  }
}

// Test discovery and execution
class TestOrchestrator {
  constructor(config) {
    this.config = config;
    this.results = new TestResults();
    this.testFiles = [];
  }

  async discoverTests() {
    const testDir = path.join(__dirname, 'journeys');
    
    if (!fs.existsSync(testDir)) {
      logger.error(`Test directory not found: ${testDir}`);
      return false;
    }

    const files = fs.readdirSync(testDir)
      .filter(file => file.endsWith('.js'))
      .map(file => path.join(testDir, file));

    this.testFiles = files;
    logger.info(`Discovered ${files.length} test files:`, files.map(f => path.basename(f)));
    return true;
  }

  async executeTest(testFile) {
    const testName = path.basename(testFile, '.js');
    const startTime = Date.now();
    
    logger.info(`Executing test: ${testName}`);
    
    try {
      // Clear require cache to ensure fresh module load
      delete require.cache[require.resolve(testFile)];
      
      const TestClass = require(testFile);
      const testInstance = new TestClass(this.config);
      
      // Validate test class has required methods
      if (typeof testInstance.run !== 'function') {
        throw new Error('Test class must implement run() method');
      }

      // Execute the test
      const result = await testInstance.run();
      const duration = Date.now() - startTime;
      
      if (result.success) {
        this.results.addTest(testName, 'passed', duration, null, result.details);
        logger.info(`✅ ${testName} passed (${duration}ms)`);
      } else {
        this.results.addTest(testName, 'failed', duration, result.error, result.details);
        logger.error(`❌ ${testName} failed: ${result.error}`);
      }
      
      return result.success;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.results.addTest(testName, 'failed', duration, error.message);
      logger.error(`❌ ${testName} failed with exception: ${error.message}`);
      return false;
    }
  }

  async runAllTests() {
    logger.info('Starting TTTranscribe E2E Test Suite');
    logger.info('Configuration:', this.config);
    
    if (!await this.discoverTests()) {
      logger.error('Failed to discover tests');
      return false;
    }

    if (this.testFiles.length === 0) {
      logger.warn('No test files found');
      return true;
    }

    // Execute tests sequentially to avoid conflicts
    for (const testFile of this.testFiles) {
      await this.executeTest(testFile);
    }

    return this.results.printSummary();
  }
}

// Main execution
async function main() {
  const orchestrator = new TestOrchestrator(CONFIG);
  const success = await orchestrator.runAllTests();
  
  process.exit(success ? 0 : 1);
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Main execution failed:', error);
    process.exit(1);
  });
}

module.exports = { TestOrchestrator, Logger, TestResults };
