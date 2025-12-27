/**
 * TTTranscribe-Test-01UXImprovements-03ProgressUpdates
 * Tests for optimistic progress update improvements
 *
 * Validates:
 * - Immediate progress feedback on job start
 * - Incremental progress updates during processing
 * - Progress percentages match expected ranges
 * - Smooth progression (no backwards movement)
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';
const AUTH_SECRET = process.env.ENGINE_SHARED_SECRET || 'hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU';
const TEST_TIKTOK_URL = 'https://www.tiktok.com/@thesunnahguy/video/7493203244727012630';
const FAIL_FAST = process.env.NODE_ENV === 'development' || process.env.FAIL_FAST === 'true';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, errorMessage) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✅ PASS: ${testName}`);
    return true;
  } else {
    failedTests++;
    console.error(`❌ FAIL: ${testName}`);
    console.error(`   Error: ${errorMessage}`);
    if (FAIL_FAST) {
      console.error('\n🛑 FAIL-FAST MODE: Stopping on first failure\n');
      printSummary();
      process.exit(1);
    }
    return false;
  }
}

async function submitJob(url) {
  const response = await fetch(`${BASE_URL}/transcribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Engine-Auth': AUTH_SECRET
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(`Failed to submit job: ${response.status}`);
  }

  return await response.json();
}

async function getStatus(jobId) {
  const response = await fetch(`${BASE_URL}/status/${jobId}`, {
    headers: { 'X-Engine-Auth': AUTH_SECRET }
  });

  if (!response.ok) {
    throw new Error(`Failed to get status: ${response.status}`);
  }

  return await response.json();
}

/**
 * TEST 1: Immediate progress feedback
 */
async function testImmediateProgressFeedback() {
  console.log('\n⚡ Test 1: Immediate Progress Feedback');
  console.log('Checking for instant progress indicator...');

  try {
    const submitResponse = await submitJob(TEST_TIKTOK_URL);
    const jobId = submitResponse.id;

    console.log(`Job submitted: ${jobId}`);

    // Check status within 500ms
    await new Promise(resolve => setTimeout(resolve, 500));
    const quickStatus = await getStatus(jobId);

    // Should show progress immediately (optimistic update)
    assert(
      quickStatus.progress >= 0,
      'Progress indicator available within 500ms',
      'No progress field in quick status check'
    );

    assert(
      quickStatus.progress <= 15,
      `Initial progress ≤ 15% (actual: ${quickStatus.progress}%)`,
      `Initial progress too high: ${quickStatus.progress}%`
    );

    console.log(`   Initial progress: ${quickStatus.progress}%`);
    console.log(`   Initial status: ${quickStatus.status}`);

    return true;
  } catch (error) {
    assert(false, 'Immediate progress feedback test', error.message);
    return false;
  }
}

/**
 * TEST 2: Progress never goes backward
 */
async function testProgressNeverBackward() {
  console.log('\n📈 Test 2: Progress Never Goes Backward');
  console.log('Monitoring progress updates for monotonic increase...');

  try {
    const submitResponse = await submitJob(TEST_TIKTOK_URL);
    const jobId = submitResponse.id;

    console.log(`Job submitted: ${jobId}`);

    const progressHistory = [];
    let previousProgress = -1;

    // Poll for up to 60 seconds, checking progress
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));

      const status = await getStatus(jobId);
      const currentProgress = status.progress || 0;

      progressHistory.push({
        time: i * 1.5,
        progress: currentProgress,
        status: status.status,
        phase: status.phase
      });

      // Check progress never decreases
      if (previousProgress >= 0) {
        assert(
          currentProgress >= previousProgress,
          `Progress monotonic at ${i * 1.5}s (${previousProgress}% → ${currentProgress}%)`,
          `Progress went backward: ${previousProgress}% → ${currentProgress}%`
        );
      }

      previousProgress = currentProgress;

      // Stop if completed
      if (status.status === 'completed' || status.status === 'failed') {
        console.log(`   Job ${status.status} after ${i * 1.5}s`);
        break;
      }
    }

    // Print progress history
    console.log('\n   Progress History:');
    progressHistory.forEach(entry => {
      console.log(`   ${entry.time.toFixed(1)}s: ${entry.progress}% (${entry.phase || entry.status})`);
    });

    return true;
  } catch (error) {
    assert(false, 'Progress never backward test', error.message);
    return false;
  }
}

/**
 * TEST 3: Progress percentages match expected ranges
 */
async function testProgressRanges() {
  console.log('\n📊 Test 3: Progress Percentages Match Expected Ranges');
  console.log('Validating progress ranges for each phase...');

  try {
    const submitResponse = await submitJob(TEST_TIKTOK_URL);
    const jobId = submitResponse.id;

    console.log(`Job submitted: ${jobId}`);

    const phaseRanges = {
      'REQUEST_SUBMITTED': { min: 0, max: 5 },
      'DOWNLOADING': { min: 5, max: 30 },
      'TRANSCRIBING': { min: 40, max: 70 },
      'SUMMARIZING': { min: 85, max: 95 },
      'COMPLETED': { min: 100, max: 100 }
    };

    const phaseObservations = {};

    // Poll and collect observations
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const status = await getStatus(jobId);
      const phase = status.phase || status.status.toUpperCase();
      const progress = status.progress || 0;

      // Record observation
      if (!phaseObservations[phase]) {
        phaseObservations[phase] = [];
      }
      phaseObservations[phase].push(progress);

      // Check if in expected range (if we have a definition for this phase)
      if (phaseRanges[phase]) {
        const { min, max } = phaseRanges[phase];
        assert(
          progress >= min && progress <= max,
          `${phase}: ${progress}% in range [${min}%, ${max}%]`,
          `${phase}: ${progress}% outside expected range [${min}%, ${max}%]`
        );
      }

      if (status.status === 'completed' || status.status === 'failed') {
        break;
      }
    }

    // Print observations
    console.log('\n   Phase Observations:');
    Object.entries(phaseObservations).forEach(([phase, progressValues]) => {
      const min = Math.min(...progressValues);
      const max = Math.max(...progressValues);
      console.log(`   ${phase}: ${min}% - ${max}% (${progressValues.length} observations)`);
    });

    return true;
  } catch (error) {
    assert(false, 'Progress ranges test', error.message);
    return false;
  }
}

function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests:  ${totalTests}`);
  console.log(`✅ Passed:    ${passedTests}`);
  console.log(`❌ Failed:    ${failedTests}`);
  console.log(`Success Rate: ${totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0}%`);
  console.log('='.repeat(60));
}

async function runTests() {
  console.log('🧪 TTTranscribe Progress Updates Tests');
  console.log(`📍 Testing against: ${BASE_URL}`);
  console.log(`⚡ Fail-fast mode: ${FAIL_FAST ? 'ENABLED' : 'DISABLED'}\n`);

  try {
    await testImmediateProgressFeedback();
    await testProgressNeverBackward();
    await testProgressRanges();
  } catch (error) {
    console.error('\n💥 Test suite error:', error);
    failedTests++;
  }

  printSummary();
  process.exit(failedTests > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
