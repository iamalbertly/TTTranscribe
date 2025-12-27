/**
 * TTTranscribe-Test-01UXImprovements-01MasterRunner
 * Master test orchestrator for UX improvements validation
 *
 * Runs all UX improvement tests in sequence:
 * 1. Metadata extraction tests
 * 2. Progress update tests
 * 3. Cache performance tests
 *
 * Features:
 * - Fail-fast mode during development
 * - Detailed reporting
 * - Exit codes for CI/CD integration
 */

const { spawn } = require('child_process');
const path = require('path');

// Test configuration
const FAIL_FAST = process.env.NODE_ENV === 'development' || process.env.FAIL_FAST === 'true';
const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';

// Test suites to run (in order)
const TEST_SUITES = [
  {
    name: 'Metadata Extraction',
    file: 'TTTranscribe-Test-01UXImprovements-02MetadataExtraction.js',
    description: 'Validates short title extraction, parallel processing, and rich metadata'
  },
  {
    name: 'Progress Updates',
    file: 'TTTranscribe-Test-01UXImprovements-03ProgressUpdates.js',
    description: 'Validates optimistic progress updates and smooth percentage transitions'
  },
  {
    name: 'Cache Performance',
    file: 'TTTranscribe-Test-01UXImprovements-04CachePerformance.js',
    description: 'Validates instant cache hits and result consistency'
  }
];

let totalSuites = TEST_SUITES.length;
let passedSuites = 0;
let failedSuites = 0;

/**
 * Run a single test suite
 */
function runTestSuite(suite) {
  return new Promise((resolve, reject) => {
    console.log('\n' + '='.repeat(80));
    console.log(`🧪 Running: ${suite.name}`);
    console.log(`📄 File: ${suite.file}`);
    console.log(`📝 ${suite.description}`);
    console.log('='.repeat(80));

    const testProcess = spawn('node', [suite.file], {
      cwd: __dirname,
      env: {
        ...process.env,
        BASE_URL,
        FAIL_FAST: FAIL_FAST.toString()
      },
      stdio: 'inherit'
    });

    testProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ ${suite.name}: PASSED`);
        resolve({ suite: suite.name, passed: true });
      } else {
        console.error(`\n❌ ${suite.name}: FAILED (exit code: ${code})`);
        reject({ suite: suite.name, passed: false, code });
      }
    });

    testProcess.on('error', (error) => {
      console.error(`\n💥 ${suite.name}: ERROR`);
      console.error(error);
      reject({ suite: suite.name, passed: false, error });
    });
  });
}

/**
 * Check if server is running
 */
async function checkServerHealth() {
  console.log('\n🔍 Checking server health...');
  console.log(`   Testing connection to: ${BASE_URL}`);

  try {
    const fetch = require('node-fetch');
    const response = await fetch(`${BASE_URL}/health`, {
      timeout: 5000
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ Server is running (status: ${data.status || 'ok'})`);
      return true;
    } else {
      console.error(`   ❌ Server returned ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error(`   ❌ Cannot connect to server: ${error.message}`);
    console.error('\n📌 Make sure TTTranscribe server is running:');
    console.error('   npm start');
    return false;
  }
}

/**
 * Print final summary
 */
function printFinalSummary(results) {
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 FINAL TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Suites:  ${totalSuites}`);
  console.log(`✅ Passed:     ${passedSuites}`);
  console.log(`❌ Failed:     ${failedSuites}`);
  console.log(`Success Rate:  ${totalSuites > 0 ? Math.round((passedSuites / totalSuites) * 100) : 0}%`);
  console.log('='.repeat(80));

  console.log('\nDetailed Results:');
  results.forEach((result, index) => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${index + 1}. ${status} - ${result.suite}`);
  });

  console.log('\n' + '='.repeat(80));
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('🚀 TTTranscribe UX Improvements Test Suite');
  console.log(`📍 Target: ${BASE_URL}`);
  console.log(`⚡ Fail-fast: ${FAIL_FAST ? 'ENABLED' : 'DISABLED'}`);
  console.log(`📦 Test Suites: ${totalSuites}`);

  // Check server health first
  const serverReady = await checkServerHealth();
  if (!serverReady) {
    console.error('\n💥 Cannot proceed: Server not running');
    process.exit(1);
  }

  const results = [];
  let shouldStop = false;

  // Run each test suite
  for (const suite of TEST_SUITES) {
    if (shouldStop) {
      console.log(`\n⏭️  Skipping ${suite.name} (fail-fast triggered)`);
      results.push({ suite: suite.name, passed: false, skipped: true });
      failedSuites++;
      continue;
    }

    try {
      const result = await runTestSuite(suite);
      results.push(result);
      passedSuites++;
    } catch (error) {
      results.push(error);
      failedSuites++;

      if (FAIL_FAST) {
        console.error('\n🛑 FAIL-FAST MODE: Stopping test execution');
        shouldStop = true;
      }
    }
  }

  // Print final summary
  printFinalSummary(results);

  // Exit with appropriate code
  const exitCode = failedSuites > 0 ? 1 : 0;
  console.log(`\n🏁 Exiting with code ${exitCode}`);
  process.exit(exitCode);
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('\n💥 Unhandled rejection:', error);
  process.exit(1);
});

// Run tests
runAllTests().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
