const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'https://iamromeoly-tttranscibe.hf.space';
const AUTH_SECRET = process.env.ENGINE_SHARED_SECRET || 'your-secret-key'; // Replace with actual secret if needed

async function testTranscription() {
    const url = 'https://vm.tiktok.com/ZMADQVF4e/';
    console.log(`Testing transcription for ${url} against ${BASE_URL}`);

    try {
        // 1. Submit job
        console.log('Submitting job...');
        const submitRes = await fetch(`${BASE_URL}/transcribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Engine-Auth': AUTH_SECRET
            },
            body: JSON.stringify({ url })
        });

        if (!submitRes.ok) {
            console.error(`Submission failed: ${submitRes.status} ${submitRes.statusText}`);
            const text = await submitRes.text();
            console.error(text);
            return;
        }

        const submitData = await submitRes.json();
        const requestId = submitData.id;
        console.log(`Job submitted. Request ID: ${requestId}`);
        console.log(`Initial estimated processing time: ${submitData.estimatedProcessingTime}`);

        // 2. Poll status
        let status = 'queued';
        while (status !== 'completed' && status !== 'failed') {
            await new Promise(resolve => setTimeout(resolve, 2000));

            const statusRes = await fetch(`${BASE_URL}/status/${requestId}`, {
                headers: {
                    'X-Engine-Auth': AUTH_SECRET
                }
            });

            if (!statusRes.ok) {
                console.error(`Status check failed: ${statusRes.status}`);
                return;
            }

            const statusData = await statusRes.json();
            status = statusData.status;

            console.log(`Status: ${status}, Phase: ${statusData.currentStep}, Progress: ${statusData.progress}%`);
            if (statusData.estimatedCompletion) {
                console.log(`Estimated Completion: ${statusData.estimatedCompletion}`);
            }

            if (status === 'completed') {
                console.log('Job completed!');
                console.log('Result:', JSON.stringify(statusData.result, null, 2));

                if (statusData.result && statusData.result.transcription) {
                    console.log('✅ Transcription found in result!');
                    console.log('Transcription length:', statusData.result.transcription.length);
                } else {
                    console.error('❌ Transcription MISSING in result!');
                }
            } else if (status === 'failed') {
                console.error('Job failed!');
            }
        }

    } catch (error) {
        console.error('Test failed:', error);
    }
}

testTranscription();
