const https = require('https');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

(async () => {
  try {
    const runId = process.argv[2] || '19786430859';
    const url = `https://api.github.com/repos/iamalbertly/TTTranscribe/actions/runs/${runId}/jobs`;
    const json = await getJSON(url);
    const jobs = json.jobs || [];
    console.log(`Found ${jobs.length} job(s) for run ${runId}`);
    for (const job of jobs) {
      console.log('---');
      console.log('Job name:', job.name);
      console.log('Status:', job.status, 'Conclusion:', job.conclusion);
      if (job.steps) {
        for (const step of job.steps) {
          console.log(`  Step: ${step.name} => ${step.conclusion || step.status}`);
        }
      }
      console.log('Logs URL:', job.logs_url);
    }
  } catch (e) {
    console.error('Error', e);
  }
})();
