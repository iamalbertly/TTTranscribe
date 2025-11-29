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
    const url = 'https://api.github.com/repos/iamalbertly/TTTranscribe/actions/runs?per_page=10';
    const json = await getJSON(url);
    const runs = json.workflow_runs || [];
    const sha = '82cd0f42e9c0166060a1e42986a04d7877a2f0bc';
    const found = runs.find(r => r.head_sha === sha);
    if (!found) {
      console.log('No run found for sha', sha);
      return;
    }
    console.log('Run found:');
    console.log('id:', found.id);
    console.log('name:', found.name);
    console.log('status:', found.status);
    console.log('conclusion:', found.conclusion);
    console.log('html_url:', found.html_url);
  } catch (e) {
    console.error('Error', e);
  }
})();
