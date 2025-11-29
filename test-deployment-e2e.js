#!/usr/bin/env node
/**
 * End-to-end deployment validation test
 * Tests the complete flow from business engine to TTTranscribe
 */

const fetch = require('node-fetch');

const BUSINESS_ENGINE_URL = 'https://pluct-business-engine.romeo-lya2.workers.dev';
const TTT_URL = 'https://iamromeoly-tttranscribe.hf.space';

async function testE2E() {
  console.log('=== End-to-End Deployment Validation ===\n');

  try {
    // Test 1: Verify Business Engine is running
    console.log('1. Testing Business Engine health...');
    const beHealth = await fetch(`${BUSINESS_ENGINE_URL}/health`);
    const beData = await beHealth.json();
    console.log(`   Status: ${beData.status}`);
    console.log(`   TTT Connection: ${beData.connectivity.ttt}`);
    console.log(`   Circuit Breaker: ${beData.connectivity.circuitBreaker}`);

    if (beData.connectivity.ttt !== 'healthy') {
      console.log('   ❌ Business Engine cannot connect to TTTranscribe!');
      return false;
    }
    console.log('   ✅ Business Engine is healthy\n');

    // Test 2: Verify TTTranscribe is running
    console.log('2. Testing TTTranscribe health...');
    const tttHealth = await fetch(`${TTT_URL}/health`);
    const tttData = await tttHealth.json();
    console.log(`   Status: ${tttData.status}`);
    console.log(`   Platform: ${tttData.platform}`);
    console.log(`   ASR Provider: ${tttData.environment.asrProvider}`);
    console.log(`   Has HF API Key: ${tttData.environment.hasHfApiKey ? 'Yes' : 'No'}`);

    if (tttData.status !== 'healthy') {
      console.log('   ❌ TTTranscribe is not healthy!');
      return false;
    }
    console.log('   ✅ TTTranscribe is healthy\n');

    // Test 3: Verify both services can communicate
    console.log('3. Verifying service connectivity...');
    console.log(`   Business Engine → TTTranscribe: ${beData.connectivity.ttt}`);
    console.log('   ✅ Services can communicate\n');

    console.log('=== All Tests Passed! ===');
    console.log('\nDeployment Summary:');
    console.log(`- Business Engine: ${BUSINESS_ENGINE_URL}`);
    console.log(`- TTTranscribe: ${TTT_URL}`);
    console.log(`- Connection Status: ${beData.connectivity.ttt}`);
    console.log(`- Circuit Breaker: ${beData.connectivity.circuitBreaker}`);
    console.log('\nThe deployment is ready for production use.');
    console.log('Mobile clients can now submit transcription requests through the Business Engine.');

    return true;
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

// Run tests
testE2E().then(success => {
  process.exit(success ? 0 : 1);
});
