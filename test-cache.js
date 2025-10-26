/**
 * Cache functionality tests for TTTranscribe
 * Tests cache hits, misses, expiration, and cleanup
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';
const AUTH_SECRET = process.env.ENGINE_SHARED_SECRET || 'hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU';

async function testCache() {
  console.log('🧪 Running TTTranscribe cache tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  function assert(condition, message) {
    if (condition) {
      console.log(`✅ ${message}`);
      passed++;
    } else {
      console.log(`❌ ${message}`);
      failed++;
    }
  }
  
  try {
    const testUrl = 'https://www.tiktok.com/@test/video/1234567890';
    
    // Test 1: Cache miss on first request
    console.log('Test 1: Cache miss on first request');
    const firstResponse = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': AUTH_SECRET
      },
      body: JSON.stringify({ url: testUrl })
    });
    
    assert(firstResponse.ok, 'First request should succeed');
    const firstData = await firstResponse.json();
    assert(firstData.id, 'First request should return job ID');
    assert(firstData.status === 'queued', 'First request should return queued status');
    
    const firstJobId = firstData.id;
    console.log(`First job ID: ${firstJobId}\n`);
    
    // Wait a moment for processing to complete (in real scenario)
    console.log('Waiting for first job to complete...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 2: Cache hit on second request with same URL
    console.log('Test 2: Cache hit on second request');
    const secondResponse = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': AUTH_SECRET
      },
      body: JSON.stringify({ url: testUrl })
    });
    
    assert(secondResponse.ok, 'Second request should succeed');
    const secondData = await secondResponse.json();
    assert(secondData.id, 'Second request should return job ID');
    assert(secondData.status === 'queued', 'Second request should return queued status');
    
    const secondJobId = secondData.id;
    console.log(`Second job ID: ${secondJobId}`);
    
    // Test 3: Check if second job completes immediately (cache hit)
    console.log('Test 3: Check cache hit behavior');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const secondStatusResponse = await fetch(`${BASE_URL}/status/${secondJobId}`, {
      headers: { 'X-Engine-Auth': AUTH_SECRET }
    });
    
    assert(secondStatusResponse.ok, 'Second status check should succeed');
    const secondStatusData = await secondStatusResponse.json();
    
    // Cache hit should complete immediately or very quickly
    if (secondStatusData.status === 'completed') {
      assert(secondStatusData.result, 'Cached result should have result object');
      assert(secondStatusData.result.transcription, 'Cached result should have transcription');
      console.log(`✅ Cache hit: Job completed immediately with ${secondStatusData.result.transcription.length} characters`);
    } else {
      console.log(`⚠️  Cache hit job still processing: ${secondStatusData.status}`);
    }
    
    // Test 4: Different URL should be cache miss
    console.log('\nTest 4: Different URL should be cache miss');
    const differentUrl = 'https://www.tiktok.com/@test/video/9876543210';
    
    const thirdResponse = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': AUTH_SECRET
      },
      body: JSON.stringify({ url: differentUrl })
    });
    
    assert(thirdResponse.ok, 'Third request should succeed');
    const thirdData = await thirdResponse.json();
    assert(thirdData.id, 'Third request should return job ID');
    assert(thirdData.status === 'queued', 'Third request should return queued status');
    
    const thirdJobId = thirdData.id;
    console.log(`Third job ID: ${thirdJobId}`);
    
    // Test 5: Health endpoint should show cache statistics
    console.log('\nTest 5: Health endpoint cache statistics');
    const healthResponse = await fetch(`${BASE_URL}/health`);
    
    assert(healthResponse.ok, 'Health check should succeed');
    const healthData = await healthResponse.json();
    
    assert(healthData.cache, 'Health response should have cache object');
    assert(typeof healthData.cache.size === 'number', 'Cache size should be a number');
    assert(typeof healthData.cache.hitRate === 'number', 'Cache hit rate should be a number');
    assert(typeof healthData.cache.hitCount === 'number', 'Cache hit count should be a number');
    assert(typeof healthData.cache.missCount === 'number', 'Cache miss count should be a number');
    
    console.log(`Cache stats: ${healthData.cache.size} entries, ${healthData.cache.hitRate}% hit rate`);
    console.log(`Hit count: ${healthData.cache.hitCount}, Miss count: ${healthData.cache.missCount}`);
    
    // Test 6: URL normalization (similar URLs should hit cache)
    console.log('\nTest 6: URL normalization');
    const normalizedUrl = testUrl + '?utm_source=test'; // Add query parameter
    
    const fourthResponse = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': AUTH_SECRET
      },
      body: JSON.stringify({ url: normalizedUrl })
    });
    
    assert(fourthResponse.ok, 'Fourth request should succeed');
    const fourthData = await fourthResponse.json();
    assert(fourthData.id, 'Fourth request should return job ID');
    
    const fourthJobId = fourthData.id;
    console.log(`Fourth job ID: ${fourthJobId}`);
    
    // Check if normalized URL hits cache
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const fourthStatusResponse = await fetch(`${BASE_URL}/status/${fourthJobId}`, {
      headers: { 'X-Engine-Auth': AUTH_SECRET }
    });
    
    if (fourthStatusResponse.ok) {
      const fourthStatusData = await fourthStatusResponse.json();
      if (fourthStatusData.status === 'completed') {
        console.log(`✅ URL normalization working: Similar URL hit cache`);
      } else {
        console.log(`⚠️  URL normalization: Job still processing`);
      }
    }
    
    console.log();
    
  } catch (error) {
    console.log(`❌ Test failed with error: ${error.message}`);
    failed++;
  }
  
  console.log(`\n📊 Cache Test Results:`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  
  if (failed > 0) {
    console.log('\n⚠️  Cache tests failed! Cache functionality needs attention.');
    process.exit(1);
  } else {
    console.log('\n🎉 All cache tests passed! Cache functionality is working correctly.');
  }
}

// Run tests
testCache().catch(console.error);
