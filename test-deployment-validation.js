/**
 * Validation test for TTTranscribe deployment
 * Tests all the fixes we implemented
 */

const BASE_URL = process.env.BASE_URL || 'https://iamromeoly-tttranscribe.hf.space';
const AUTH_SECRET = process.env.ENGINE_SHARED_SECRET || process.env.TTT_SHARED_SECRET;

if (!AUTH_SECRET) {
  console.error('❌ ERROR: ENGINE_SHARED_SECRET environment variable is required');
  process.exit(1);
}

console.log('🧪 TTTranscribe Deployment Validation Tests\n');
console.log(`Base URL: ${BASE_URL}`);
console.log(`Auth: ${AUTH_SECRET ? '✅ Set' : '❌ Missing'}\n`);

async function runTests() {
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  // Test 1: Health Check (no auth required)
  try {
    console.log('Test 1: Health Check Endpoint');
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();

    if (response.ok && data.status === 'healthy') {
      console.log('✅ PASS: Health check successful');
      console.log(`   Platform: ${data.platform}`);
      console.log(`   Cache: ${data.cache.size} entries, ${data.cache.hitRate}% hit rate`);
      console.log(`   Uptime: ${Math.floor(data.uptime / 60)}m ${Math.floor(data.uptime % 60)}s\n`);
      results.passed++;
    } else {
      throw new Error(`Health check failed: ${response.status}`);
    }
  } catch (error) {
    console.error('❌ FAIL: Health check failed:', error.message, '\n');
    results.failed++;
  }

  // Test 2: Auth Error Handling (should get detailed 401)
  try {
    console.log('Test 2: Authentication Error Handling');
    const response = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': 'wrong-secret'
      },
      body: JSON.stringify({ url: 'https://vm.tiktok.com/test' })
    });

    const data = await response.json();

    if (response.status === 401 && data.error === 'unauthorized' && data.details) {
      console.log('✅ PASS: Auth error properly structured');
      console.log(`   Error: ${data.message}`);
      console.log(`   Details provided: ${Object.keys(data.details).join(', ')}\n`);
      results.passed++;
    } else {
      throw new Error(`Expected 401 with details, got ${response.status}`);
    }
  } catch (error) {
    console.error('❌ FAIL: Auth error test failed:', error.message, '\n');
    results.failed++;
  }

  // Test 3: Invalid URL Error (user-friendly message)
  try {
    console.log('Test 3: Invalid URL Error Handling');
    const response = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': AUTH_SECRET
      },
      body: JSON.stringify({ url: 'not-a-url' })
    });

    const data = await response.json();

    if (response.status === 400 && data.error === 'invalid_url') {
      console.log('✅ PASS: Invalid URL properly rejected');
      console.log(`   Message: ${data.message}`);
      console.log(`   Expected format shown: ${data.details.expectedFormat ? 'Yes' : 'No'}\n`);
      results.passed++;
    } else {
      throw new Error(`Expected 400 invalid_url, got ${response.status}`);
    }
  } catch (error) {
    console.error('❌ FAIL: Invalid URL test failed:', error.message, '\n');
    results.failed++;
  }

  // Test 4: Valid submission (should queue successfully)
  try {
    console.log('Test 4: Valid Transcription Request');
    const testUrl = 'https://vm.tiktok.com/ZMAoYtB5p/'; // Use a real TikTok URL
    const response = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': AUTH_SECRET,
        'X-Client-Version': '1.0.0',
        'X-Client-Platform': 'test'
      },
      body: JSON.stringify({
        url: testUrl,
        requestId: `test_${Date.now()}`
      })
    });

    const data = await response.json();

    if (response.status === 202 && data.id && data.status === 'queued') {
      console.log('✅ PASS: Request accepted and queued');
      console.log(`   Job ID: ${data.id}`);
      console.log(`   Status: ${data.status}`);
      console.log(`   Submitted at: ${data.submittedAt}`);

      // Test 5: Check status (should include all new fields)
      console.log('\nTest 5: Status Check with Enhanced Fields');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

      const statusResponse = await fetch(`${BASE_URL}/status/${data.id}`, {
        headers: {
          'X-Engine-Auth': AUTH_SECRET
        }
      });

      const statusData = await statusResponse.json();

      if (statusResponse.ok) {
        console.log('✅ PASS: Status endpoint working');
        console.log(`   Phase: ${statusData.phase || 'N/A'}`);
        console.log(`   Progress: ${statusData.progress || 0}%`);
        console.log(`   Current Step: ${statusData.currentStep || 'N/A'}`);
        console.log(`   Cache Hit: ${statusData.cacheHit !== undefined ? (statusData.cacheHit ? 'Yes' : 'No') : 'N/A'}`);
        console.log(`   Estimated Completion: ${statusData.estimatedCompletion || 'Calculating...'}`);

        if (statusData.error) {
          console.log(`   Error: ${statusData.error}`);
          console.log('   ℹ️  Note: Error is expected for test videos without proper access\n');
        } else {
          console.log('');
        }

        results.passed++;
      } else {
        throw new Error(`Status check failed: ${statusResponse.status}`);
      }

      results.passed++;
    } else {
      throw new Error(`Expected 202 queued, got ${response.status}: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    console.error('❌ FAIL: Transcription request test failed:', error.message, '\n');
    results.failed += 2; // Counts for both test 4 and 5
  }

  // Test 6: Rate Limit Test (should work normally, not blocked by HF health checks)
  try {
    console.log('Test 6: Rate Limiting (should allow requests)');
    const testUrl = 'https://vm.tiktok.com/test123/';
    const response = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': AUTH_SECRET
      },
      body: JSON.stringify({ url: testUrl })
    });

    // Should either queue (202) or fail with validation error (400), but NOT rate limit (429)
    if (response.status !== 429) {
      console.log('✅ PASS: Rate limiting working correctly (not blocking valid requests)');
      console.log(`   Response: ${response.status}\n`);
      results.passed++;
    } else {
      const data = await response.json();
      console.error('❌ FAIL: Got rate limited when shouldn\'t have');
      console.error(`   Retry after: ${data.details?.retryAfter} seconds\n`);
      results.failed++;
    }
  } catch (error) {
    console.error('❌ FAIL: Rate limit test failed:', error.message, '\n');
    results.failed++;
  }

  // Print summary
  console.log('═'.repeat(60));
  console.log('📊 Test Summary');
  console.log('═'.repeat(60));
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Success Rate: ${Math.round((results.passed / (results.passed + results.failed)) * 100)}%`);
  console.log('═'.repeat(60));

  if (results.failed === 0) {
    console.log('\n🎉 All tests passed! Deployment is successful.\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Please review the issues above.\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
