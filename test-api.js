#!/usr/bin/env node

/**
 * Simple test script for TTTranscribe API
 * Tests the /transcribe and /status endpoints
 */

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:8788';
const AUTH_HEADER = 'super-long-random'; // Default from env.example

async function testAPI() {
  console.log('🧪 Testing TTTranscribe API...\n');
  
  try {
    // Test 1: Health check
    console.log('1. Testing health endpoint...');
    const healthResponse = await fetch(`${BASE_URL}/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData.status);
    
    // Test 2: Submit transcription job
    console.log('\n2. Testing /transcribe endpoint...');
    const transcribeResponse = await fetch(`${BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Auth': AUTH_HEADER
      },
      body: JSON.stringify({
        url: 'https://www.tiktok.com/@test/video/1234567890'
      })
    });
    
    if (!transcribeResponse.ok) {
      const error = await transcribeResponse.text();
      console.log('❌ Transcribe failed:', error);
      return;
    }
    
    const transcribeData = await transcribeResponse.json();
    console.log('✅ Transcribe response:', transcribeData);
    
    const requestId = transcribeData.request_id;
    
    // Test 3: Check status multiple times
    console.log('\n3. Testing /status endpoint...');
    
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      const statusResponse = await fetch(`${BASE_URL}/status/${requestId}`, {
        headers: {
          'X-Engine-Auth': AUTH_HEADER
        }
      });
      
      if (!statusResponse.ok) {
        const error = await statusResponse.text();
        console.log('❌ Status check failed:', error);
        break;
      }
      
      const statusData = await statusResponse.json();
      console.log(`📊 Status ${i + 1}:`, {
        phase: statusData.phase,
        percent: statusData.percent,
        note: statusData.note
      });
      
      if (statusData.phase === 'COMPLETED' || statusData.phase === 'FAILED') {
        console.log('🏁 Job finished with phase:', statusData.phase);
        if (statusData.text) {
          console.log('📝 Text preview:', statusData.text.substring(0, 100) + '...');
        }
        break;
      }
    }
    
    console.log('\n✅ All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n💡 Make sure the server is running:');
    console.log('   npm start');
  }
}

// Run tests
testAPI();
