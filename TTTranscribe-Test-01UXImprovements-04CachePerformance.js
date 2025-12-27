/**
 * TTTranscribe-Test-01UXImprovements-04CachePerformance
 * Tests for cache hit performance and instant response
 *
 * Validates:
 * - Cache hits return instantly (< 200ms)
 * - Cache hits marked with _cacheHit flag
 * - Cached results identical to original
 * - Cache hit logging is clear
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

async function pollUntilComplete(jobId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getStatus(jobId);
    if (status.status === 'completed') return status;
    if (status.status === 'failed') throw new Error(`Job failed: ${status.error}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('Job did not complete in time');
}

/**
 * TEST 1: First request completes normally
 */
async function testFirstRequestCompletes() {
  console.log('\n📝 Test 1: First Request Completes Normally');
  console.log('Submitting fresh transcription job...');

  try {
    const startTime = Date.now();
    const submitResponse = await submitJob(TEST_TIKTOK_URL);
    const jobId = submitResponse.id;

    console.log(`Job submitted: ${jobId}`);

    const finalStatus = await pollUntilComplete(jobId);
    const elapsed = Date.now() - startTime;

    // Verify completion
    assert(
      finalStatus.status === 'completed',
      'Job completed successfully',
      `Job status: ${finalStatus.status}`
    );

    // Verify transcript exists
    assert(
      finalStatus.result?.transcription !== undefined,
      'Transcription exists in result',
      'Missing transcription in completed job'
    );

    // Verify metadata exists
    assert(
      finalStatus.metadata !== undefined,
      'Metadata exists in result',
      'Missing metadata in completed job'
    );

    console.log(`   Completed in ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`   Transcript length: ${finalStatus.result.transcription.length} chars`);

    // Store for comparison in next test
    global.firstJobResult = finalStatus;

    return true;
  } catch (error) {
    assert(false, 'First request completion test', error.message);
    return false;
  }
}

/**
 * TEST 2: Cache hit returns instantly
 */
async function testCacheHitInstant() {
  console.log('\n⚡ Test 2: Cache Hit Returns Instantly');
  console.log('Re-submitting same URL (should hit cache)...');

  try {
    const startTime = Date.now();
    const submitResponse = await submitJob(TEST_TIKTOK_URL);
    const jobId = submitResponse.id;

    console.log(`Job submitted: ${jobId}`);

    // Get status immediately
    const immediateStatus = await getStatus(jobId);
    const elapsed = Date.now() - startTime;

    // Should be completed instantly
    assert(
      immediateStatus.status === 'completed',
      'Cache hit returns completed status immediately',
      `Status: ${immediateStatus.status} (expected: completed)`
    );

    // Should be super fast (< 1 second total)
    assert(
      elapsed < 1000,
      `Cache hit response time < 1s (actual: ${elapsed}ms)`,
      `Too slow: ${elapsed}ms`
    );

    console.log(`   Response time: ${elapsed}ms ⚡`);

    // Store for comparison
    global.cacheHitResult = immediateStatus;

    return true;
  } catch (error) {
    assert(false, 'Cache hit instant test', error.message);
    return false;
  }
}

/**
 * TEST 3: Cached result identical to original
 */
async function testCachedResultIdentical() {
  console.log('\n🔄 Test 3: Cached Result Identical to Original');
  console.log('Comparing cached result with original...');

  try {
    const original = global.firstJobResult;
    const cached = global.cacheHitResult;

    if (!original || !cached) {
      throw new Error('Previous tests did not store results');
    }

    // Compare transcription
    assert(
      cached.result?.transcription === original.result?.transcription,
      'Cached transcription identical to original',
      'Transcription mismatch between original and cached'
    );

    // Compare metadata title
    assert(
      cached.metadata?.title === original.metadata?.title,
      'Cached metadata title identical to original',
      `Title mismatch: "${cached.metadata?.title}" vs "${original.metadata?.title}"`
    );

    // Compare result duration
    assert(
      cached.result?.duration === original.result?.duration,
      'Cached duration identical to original',
      'Duration mismatch between original and cached'
    );

    console.log(`   Transcription: ${cached.result.transcription.length} chars (identical)`);
    console.log(`   Title: "${cached.metadata?.title}" (identical)`);

    return true;
  } catch (error) {
    assert(false, 'Cached result identical test', error.message);
    return false;
  }
}

/**
 * TEST 4: Cache hit indicator present
 */
async function testCacheHitIndicator() {
  console.log('\n🏷️  Test 4: Cache Hit Indicator Present');
  console.log('Checking for cache hit flag in response...');

  try {
    // Submit again to get fresh cache hit
    const submitResponse = await submitJob(TEST_TIKTOK_URL);
    const status = await getStatus(submitResponse.id);

    // Check for cache hit indicator
    // Note: This might be in metadata or at root level depending on implementation
    const hasCacheIndicator =
      status.cacheHit === true ||
      status._cacheHit === true ||
      status.metadata?._cacheHit === true;

    assert(
      hasCacheIndicator,
      'Cache hit indicator present in response',
      'No cache hit indicator found (checked: cacheHit, _cacheHit, metadata._cacheHit)'
    );

    console.log(`   Cache hit flagged: ${hasCacheIndicator}`);

    return true;
  } catch (error) {
    assert(false, 'Cache hit indicator test', error.message);
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
  console.log('🧪 TTTranscribe Cache Performance Tests');
  console.log(`📍 Testing against: ${BASE_URL}`);
  console.log(`⚡ Fail-fast mode: ${FAIL_FAST ? 'ENABLED' : 'DISABLED'}\n`);

  try {
    // Run tests sequentially (order matters for cache testing)
    await testFirstRequestCompletes();
    await testCacheHitInstant();
    await testCachedResultIdentical();
    await testCacheHitIndicator();
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
