const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

// Prefer explicit TTT_SHARED_SECRET, fallback to ENGINE_SHARED_SECRET
const SHARED_SECRET = process.env.TTT_SHARED_SECRET || process.env.ENGINE_SHARED_SECRET;
if (!SHARED_SECRET) {
    console.error('❌ Error: TTT_SHARED_SECRET or ENGINE_SHARED_SECRET not set in .env.local or environment variables.');
    process.exit(1);
}

// Prefer explicit TTT_BASE, fallback to BASE_URL
const TTT_BASE = process.env.TTT_BASE || process.env.BASE_URL || 'https://iamromeoly-tttranscibe.hf.space';
// Use the provided test URL
const TEST_URL = 'https://vm.tiktok.com/ZMAKpqkpN/';
const OUTPUT_FILE = 'ttt-test-output.txt';

let output = [];

function log(msg) {
    console.log(msg);
    output.push(msg);
    fs.appendFileSync(OUTPUT_FILE, msg + '\n');
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testHealth() {
    log('\n=== Testing /health ===');
    try {
        const response = await fetch(`${TTT_BASE}/health`);
        log(`Status: ${response.status} ${response.statusText}`);

        if (response.ok) {
            const json = await response.json();
            log(`Response: ${JSON.stringify(json, null, 2)}`);

            // Check if environment reports having auth secret
            if (json.environment && json.environment.hasAuthSecret === false) {
                log('⚠️ WARNING: Server reports it does NOT have an auth secret configured!');
            } else if (json.environment && json.environment.hasAuthSecret === true) {
                log('✅ Server reports it has an auth secret configured.');
            }
            return true;
        } else {
            const text = await response.text();
            log(`Error: ${text}`);
            return false;
        }
    } catch (error) {
        log(`Error: ${error.message}`);
        return false;
    }
}

async function testTranscribeAuth() {
    log('\n=== Testing /transcribe WITH X-Engine-Auth ===');
    try {
        log(`Sending X-Engine-Auth header (masked), secretLength=${SHARED_SECRET.length}`);
        log(`URL: ${TTT_BASE}/transcribe`);
        log(`Payload: { url: "${TEST_URL}" }`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

        const response = await fetch(`${TTT_BASE}/transcribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Engine-Auth': SHARED_SECRET
            },
            body: JSON.stringify({ url: TEST_URL }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        log(`Status: ${response.status} ${response.statusText}`);
        const text = await response.text();

        if (!response.ok) {
            log(`Response: ${text}`);
            try {
                const json = JSON.parse(text);
                log(`Error details: ${JSON.stringify(json, null, 2)}`);
            } catch (e) { }
            return null;
        }

        const json = JSON.parse(text);
        log(`Success! Job ID: ${json.id}`);
        
        // Log full response for debugging
        log(`Full response: ${JSON.stringify(json, null, 2)}`);
        
        return json.id;
    } catch (error) {
        log(`Error: ${error.message}`);
        log(`Error name: ${error.name}`);
        if (error.code) log(`Error code: ${error.code}`);
        return null;
    }
}

async function pollStatus(jobId) {
    log(`\n=== Polling Status for Job ${jobId} ===`);

    let attempts = 0;
    const maxAttempts = 120; // 5+ minutes with 2-3 second waits

    while (attempts < maxAttempts) {
        attempts++;
        try {
            const response = await fetch(`${TTT_BASE}/status/${jobId}`, {
                headers: {
                    'X-Engine-Auth': SHARED_SECRET
                }
            });

            if (!response.ok) {
                log(`Status check failed: ${response.status}`);
                const text = await response.text().catch(()=>'<unreadable>');
                log(`Upstream response (snippet): ${text ? text.slice(0, 400) : '<empty>'}`);
                return false;
            }

            const json = await response.json();
            log(`[${attempts}/${maxAttempts}] Status: ${json.status} (${json.progress || 0}%) - ${json.currentStep || ''}`);

            if (json.status === 'completed') {
                log('\n=== Transcription Result ===');
                const result = json.result || {};
                
                // Handle various response formats for transcript
                let transcript = null;
                if (result.transcription) {
                    transcript = result.transcription;
                } else if (typeof result === 'string') {
                    transcript = result;
                } else if (json.transcription) {
                    transcript = json.transcription;
                } else if (json.text) {
                    transcript = json.text;
                }
                
                log(`\n✅ TRANSCRIPT RETRIEVED (${transcript ? transcript.length : 0} characters):`);
                log('---');
                
                if (transcript) {
                    // Log full transcript in chunks to avoid truncation
                    const chunkSize = 500;
                    for (let i = 0; i < transcript.length; i += chunkSize) {
                        log(transcript.slice(i, i + chunkSize));
                    }
                } else {
                    log('⚠️ No transcript found in result');
                }
                
                log('---');
                
                // Log additional metadata if available
                if (result.confidence) log(`Confidence: ${result.confidence}`);
                if (result.language) log(`Language: ${result.language}`);
                if (result.duration) log(`Duration: ${result.duration}s`);
                if (result.wordCount) log(`Word Count: ${result.wordCount}`);
                
                log('\n✅ SUCCESS: Transcription completed and retrieved!');
                return true;
            }

            if (json.status === 'failed') {
                log(`❌ Job failed: ${json.error || 'Unknown error'}`);
                if (json.result && json.result.transcription === 'N/A') {
                    log('Note: result.transcription is "N/A" (standard failure response)');
                }
                // Log full error response for debugging
                log(`Full error response: ${JSON.stringify(json, null, 2)}`);
                return false;
            }

            // Wait before polling again, gradually increase interval
            const waitTime = Math.min(3000 + (attempts * 100), 10000);
            await sleep(waitTime);
        } catch (error) {
            log(`Polling error: ${error.message}`);
            await sleep(2000);
        }
    }

    log('⏱️ Timed out waiting for completion (5+ minutes)');
    return false;
}async function run() {
    // Clear output file
    if (fs.existsSync(OUTPUT_FILE)) {
        fs.unlinkSync(OUTPUT_FILE);
    }

    log('TTTranscribe Direct API Test (Enhanced)');
    log('=======================================');
    log(`Base: ${TTT_BASE}`);
    log(`Test URL: ${TEST_URL}`);
    log(`Time: ${new Date().toISOString()}`);

    // 1. Check Health
    const healthOk = await testHealth();
    if (!healthOk) {
        log('⚠️ Health check did not return 200. Continuing to attempt /transcribe to collect more diagnostics.');
        // don't abort — some Hugging Face Spaces expose different paths; continue to exercise /transcribe
    }

    // 2. Submit Job
    const jobId = await testTranscribeAuth();
    if (!jobId) {
        log('❌ Job submission failed. Aborting.');
        return;
    }

    // 3. Poll Status and retrieve transcript
    log('\n=== WAITING FOR TRANSCRIPTION ===');
    log('This can take 30 seconds to several minutes depending on video length and service load.');
    const success = await pollStatus(jobId);
    
    log(`\n${'='.repeat(50)}`);
    log(`FINAL RESULT: ${success ? '✅ SUCCESS' : '❌ FAILED'}`);
    log(`${'='.repeat(50)}`);
    
    if (!success) {
        log('\nDiagnostics:');
        log('- Verify TTT_BASE and TTT_SHARED_SECRET are correctly configured in .env.local');
        log('- Check that the TTTranscribe service is running and accessible');
        log('- Ensure the service implements /transcribe and /status endpoints');
    }
}

run().catch(err => {
    log(`Fatal error: ${err.message}`);
    log(err.stack);
});
