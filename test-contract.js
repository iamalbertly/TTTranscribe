/**
 * Contract tests for TTTranscribe API
 * Verifies stable field names and response formats
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';
const AUTH_SECRET = process.env.ENGINE_SHARED_SECRET || 'hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU';

// Ensure authentication is required for testing
// Don't set ENABLE_AUTH_BYPASS to ensure authentication is enforced

async function testContract() {
  console.log('🧪 Running TTTranscribe contract tests...\n');
  
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
    // Test 1: POST /transcribe returns stable field names
    console.log('Test 1: POST /transcribe contract');
    const transcribeResponse = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': AUTH_SECRET
      },
      body: JSON.stringify({
        url: 'https://www.tiktok.com/@test/video/1234567890'
      })
    });
    
    assert(transcribeResponse.ok, 'POST /transcribe should return 200');
    
    const transcribeData = await transcribeResponse.json();
    assert(transcribeData.id, 'Response should have id field');
    assert(transcribeData.status === 'queued', 'Response should have status: "queued"');
    assert(transcribeData.submittedAt, 'Response should have submittedAt field');
    assert(transcribeData.estimatedProcessingTime, 'Response should have estimatedProcessingTime field');
    assert(transcribeData.url, 'Response should have url field');
    assert(!transcribeData.request_id, 'Response should NOT have request_id field (use id)');
    assert(!transcribeData.transcript, 'Response should NOT have transcript field (use result.transcription in status)');
    assert(!transcribeData.content, 'Response should NOT have content field (use result.transcription in status)');
    
    const requestId = transcribeData.id;
    console.log(`Request ID: ${requestId}\n`);
    
    // Test 2: GET /status returns stable field names
    console.log('Test 2: GET /status contract');
    const statusResponse = await fetch(`${BASE_URL}/status/${requestId}`, {
      headers: {
        'X-Engine-Auth': AUTH_SECRET
      }
    });
    
    assert(statusResponse.ok, 'GET /status should return 200');
    
    const statusData = await statusResponse.json();
    assert(statusData.id, 'Status should have id field');
    assert(statusData.status, 'Status should have status field');
    assert(typeof statusData.progress === 'number', 'Status should have progress as number');
    assert(statusData.submittedAt, 'Status should have submittedAt field');
    assert(!statusData.phase, 'Status should NOT have phase field (use status)');
    assert(!statusData.percent, 'Status should NOT have percent field (use progress)');
    assert(!statusData.note, 'Status should NOT have note field (use currentStep)');
    
    // Test 3: Status values are from protocol set
    const validStatuses = ['queued', 'processing', 'completed', 'failed'];
    assert(validStatuses.includes(statusData.status), `Status should be one of: ${validStatuses.join(', ')}`);
    
    // Test 4: Result object for completed jobs
    if (statusData.status === 'completed') {
      assert(statusData.result, 'Completed jobs should have result field');
      assert(statusData.result.transcription, 'Result should have transcription field');
      assert(typeof statusData.result.confidence === 'number', 'Result should have confidence as number');
      assert(statusData.result.language, 'Result should have language field');
      assert(typeof statusData.result.duration === 'number', 'Result should have duration as number');
      assert(typeof statusData.result.wordCount === 'number', 'Result should have wordCount as number');
      assert(typeof statusData.result.speakerCount === 'number', 'Result should have speakerCount as number');
      assert(statusData.result.audioQuality, 'Result should have audioQuality field');
      assert(typeof statusData.result.processingTime === 'number', 'Result should have processingTime as number');
      assert(statusData.completedAt, 'Completed jobs should have completedAt field');
      assert(typeof statusData.completedAt === 'string', 'CompletedAt should be a string (ISO date)');
    }
    
    console.log(`Status: ${statusData.status} (${statusData.progress}%)`);
    if (statusData.currentStep) {
      console.log(`Current Step: ${statusData.currentStep}`);
    }
    if (statusData.result) {
      console.log(`Transcription length: ${statusData.result.transcription.length} characters`);
      console.log(`Confidence: ${statusData.result.confidence}`);
      console.log(`Language: ${statusData.result.language}`);
    }
    console.log();
    
    // Test 6: Authentication required
    console.log('Test 3: Authentication required');
    const unauthResponse = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // No X-Engine-Auth header
      },
      body: JSON.stringify({
        url: 'https://www.tiktok.com/@test/video/1234567890'
      })
    });
    
    assert(unauthResponse.status === 401, 'Missing auth should return 401');
    const unauthData = await unauthResponse.json();
    assert(unauthData.error === 'unauthorized', 'Error should be unauthorized');
    assert(unauthData.message, 'Error should have message field');
    
    // Test 7: Invalid auth
    const invalidAuthResponse = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': 'invalid-secret'
      },
      body: JSON.stringify({
        url: 'https://www.tiktok.com/@test/video/1234567890'
      })
    });
    
    assert(invalidAuthResponse.status === 401, 'Invalid auth should return 401');
    const invalidAuthData = await invalidAuthResponse.json();
    assert(invalidAuthData.error === 'unauthorized', 'Error should be unauthorized');
    assert(invalidAuthData.message, 'Error should have message field');
    
    console.log();
    
  } catch (error) {
    console.log(`❌ Test failed with error: ${error.message}`);
    failed++;
  }
  
  console.log(`\n📊 Test Results:`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  
  if (failed > 0) {
    console.log('\n⚠️  Contract tests failed! API contract is not stable.');
    process.exit(1);
  } else {
    console.log('\n🎉 All contract tests passed! API contract is stable.');
  }
}

// Run tests
testContract().catch(console.error);

