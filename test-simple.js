const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const SHARED_SECRET = process.env.ENGINE_SHARED_SECRET;
if (!SHARED_SECRET) {
    console.error('❌ Error: ENGINE_SHARED_SECRET not set in .env.local or environment variables.');
    process.exit(1);
}

const TTT_BASE = process.env.BASE_URL || 'https://iamromeoly-tttranscribe.hf.space';
// Use a shorter video for faster testing if possible, but keep the user's example
const TEST_URL = 'https://vm.tiktok.com/ZMATN7F41/';
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
        log(`Sending X-Engine-Auth: ${SHARED_SECRET.substring(0, 5)}...${SHARED_SECRET.substring(SHARED_SECRET.length - 5)}`);

        const response = await fetch(`${TTT_BASE}/transcribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Engine-Auth': SHARED_SECRET
            },
            body: JSON.stringify({ url: TEST_URL })
        });

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
        return json.id;
    } catch (error) {
        log(`Error: ${error.message}`);
        return null;
    }
}

async function pollStatus(jobId) {
    log(`\n=== Polling Status for Job ${jobId} ===`);

    let attempts = 0;
    const maxAttempts = 60; // 2 minutes approx

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
                return false;
            }

            const json = await response.json();
            log(`[${attempts}/${maxAttempts}] Status: ${json.status} (${json.progress}%) - ${json.currentStep || ''}`);

            if (json.status === 'completed') {
                log('\n=== Transcription Result ===');
                const result = json.result || {};
                log(`Text length: ${result.transcription ? result.transcription.length : 0} chars`);
                if (result.transcription) {
                    log(`Preview: ${result.transcription.substring(0, 200)}...`);
                }
                return true;
            }

            if (json.status === 'failed') {
                log(`Job failed: ${json.error || 'Unknown error'}`);
                return false;
            }

            await sleep(2000);
        } catch (error) {
            log(`Polling error: ${error.message}`);
            await sleep(2000);
        }
    }

    log('Timed out waiting for completion');
    return false;
}

async function run() {
    // Clear output file
    if (fs.existsSync(OUTPUT_FILE)) {
        fs.unlinkSync(OUTPUT_FILE);
    }

    log('TTTranscribe Direct API Test (Enhanced)');
    log('=======================================');
    log(`Base: ${TTT_BASE}`);
    log(`Time: ${new Date().toISOString()}`);

    // 1. Check Health
    const healthOk = await testHealth();
    if (!healthOk) {
        log('❌ Health check failed. Aborting.');
        return;
    }

    // 2. Submit Job
    const jobId = await testTranscribeAuth();
    if (!jobId) {
        log('❌ Job submission failed. Aborting.');
        return;
    }

    // 3. Poll Status
    const success = await pollStatus(jobId);
    log(`\nResult: ${success ? 'SUCCESS' : 'FAILED'}`);
}

run().catch(err => {
    log(`Fatal error: ${err.message}`);
    log(err.stack);
});
