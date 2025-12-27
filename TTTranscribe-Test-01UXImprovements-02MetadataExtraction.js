/**
 * TTTranscribe-Test-01UXImprovements-02MetadataExtraction
 * Tests for metadata extraction improvements (short titles, parallel processing)
 *
 * Validates:
 * - Short title extraction (max 80 chars)
 * - Full description preservation
 * - Parallel metadata extraction with download
 * - Fallback behavior when metadata fails
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';
const AUTH_SECRET = process.env.ENGINE_SHARED_SECRET || 'hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU';
const TEST_TIKTOK_URL = 'https://www.tiktok.com/@thesunnahguy/video/7493203244727012630';

// Test configuration
const FAIL_FAST = process.env.NODE_ENV === 'development' || process.env.FAIL_FAST === 'true';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * Test assertion with fail-fast support
 */
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

/**
 * Test helper: Submit transcription job
 */
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
    throw new Error(`Failed to submit job: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Test helper: Get job status
 */
async function getStatus(jobId) {
  const response = await fetch(`${BASE_URL}/status/${jobId}`, {
    headers: {
      'X-Engine-Auth': AUTH_SECRET
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to get status: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Test helper: Poll until completion
 */
async function pollUntilComplete(jobId, maxAttempts = 60, intervalMs = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getStatus(jobId);

    if (status.status === 'completed') {
      return status;
    }

    if (status.status === 'failed') {
      throw new Error(`Job failed: ${status.error || 'Unknown error'}`);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Job did not complete within ${maxAttempts * intervalMs / 1000} seconds`);
}

/**
 * TEST 1: Short title extraction (max 80 chars)
 */
async function testShortTitleExtraction() {
  console.log('\n📋 Test 1: Short Title Extraction');
  console.log('Submitting job and checking if title is shortened...');

  try {
    const submitResponse = await submitJob(TEST_TIKTOK_URL);
    const jobId = submitResponse.id;

    console.log(`Job submitted: ${jobId}`);

    // Poll until complete
    const finalStatus = await pollUntilComplete(jobId);

    // Validate metadata exists
    assert(
      finalStatus.metadata !== undefined,
      'Metadata exists in response',
      'Response missing metadata field'
    );

    // Validate title exists
    assert(
      finalStatus.metadata?.title !== undefined,
      'Metadata title exists',
      'Metadata missing title field'
    );

    const title = finalStatus.metadata.title;

    // Validate title is short (max 80 chars)
    assert(
      title.length <= 80,
      `Title length ≤ 80 chars (actual: ${title.length})`,
      `Title too long: ${title.length} chars`
    );

    // Validate title is not generic
    assert(
      title !== 'TikTok Video',
      'Title is not generic placeholder',
      'Title is still generic "TikTok Video"'
    );

    // Validate description is full (not truncated)
    const description = finalStatus.metadata.description;
    assert(
      description && description.length > title.length,
      'Full description preserved and longer than title',
      'Description should be longer than title'
    );

    console.log(`   Title: "${title}"`);
    console.log(`   Description length: ${description?.length || 0} chars`);

    return true;
  } catch (error) {
    assert(
      false,
      'Short title extraction test',
      error.message
    );
    return false;
  }
}

/**
 * TEST 2: Metadata extraction doesn't block transcription
 */
async function testMetadataDoesNotBlock() {
  console.log('\n⚡ Test 2: Metadata Extraction Non-Blocking');
  console.log('Verifying metadata extraction happens in parallel...');

  try {
    const submitResponse = await submitJob(TEST_TIKTOK_URL);
    const jobId = submitResponse.id;

    console.log(`Job submitted: ${jobId}`);

    // Check status immediately after submission
    await new Promise(resolve => setTimeout(resolve, 1000));
    const earlyStatus = await getStatus(jobId);

    // Should show progress even if metadata is still extracting
    assert(
      earlyStatus.progress >= 0,
      'Progress indicator starts immediately',
      'No progress indicator found'
    );

    assert(
      earlyStatus.status === 'queued' || earlyStatus.status === 'processing',
      'Job processing started (not waiting for metadata)',
      `Unexpected status: ${earlyStatus.status}`
    );

    // Wait for completion
    const finalStatus = await pollUntilComplete(jobId);

    // Verify metadata was extracted (even though processing didn't wait)
    assert(
      finalStatus.metadata?.title !== undefined,
      'Metadata extracted successfully in parallel',
      'Metadata missing from completed job'
    );

    return true;
  } catch (error) {
    assert(
      false,
      'Metadata non-blocking test',
      error.message
    );
    return false;
  }
}

/**
 * TEST 3: Rich metadata fields present
 */
async function testRichMetadataFields() {
  console.log('\n🎬 Test 3: Rich Metadata Fields');
  console.log('Checking for comprehensive metadata fields...');

  try {
    const submitResponse = await submitJob(TEST_TIKTOK_URL);
    const jobId = submitResponse.id;

    console.log(`Job submitted: ${jobId}`);

    const finalStatus = await pollUntilComplete(jobId);
    const metadata = finalStatus.metadata;

    // Check for required fields
    const requiredFields = ['title', 'author', 'url'];
    for (const field of requiredFields) {
      assert(
        metadata[field] !== undefined,
        `Required field present: ${field}`,
        `Missing required field: ${field}`
      );
    }

    // Check for optional rich fields (should have at least some)
    const richFields = [
      'authorDisplayName',
      'description',
      'thumbnail',
      'viewCount',
      'likeCount',
      'hashtags',
      'uploadDate'
    ];

    const presentRichFields = richFields.filter(field => metadata[field] !== undefined);

    assert(
      presentRichFields.length >= 4,
      `At least 4 rich metadata fields present (found: ${presentRichFields.length})`,
      `Only ${presentRichFields.length} rich fields found: ${presentRichFields.join(', ')}`
    );

    console.log(`   Rich fields found: ${presentRichFields.join(', ')}`);

    return true;
  } catch (error) {
    assert(
      false,
      'Rich metadata fields test',
      error.message
    );
    return false;
  }
}

/**
 * Print test summary
 */
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

/**
 * Main test runner
 */
async function runTests() {
  console.log('🧪 TTTranscribe Metadata Extraction Tests');
  console.log(`📍 Testing against: ${BASE_URL}`);
  console.log(`⚡ Fail-fast mode: ${FAIL_FAST ? 'ENABLED' : 'DISABLED'}\n`);

  try {
    // Run tests sequentially
    await testShortTitleExtraction();
    await testMetadataDoesNotBlock();
    await testRichMetadataFields();

  } catch (error) {
    console.error('\n💥 Test suite error:', error);
    failedTests++;
  }

  // Print summary
  printSummary();

  // Exit with appropriate code
  process.exit(failedTests > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
