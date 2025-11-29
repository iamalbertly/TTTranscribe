const fetch = global.fetch || require('node-fetch');

(async () => {
  const baseUrl = 'https://iamromeoly-tttranscribe.hf.space';
  const auth = 'hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU';
  try {
    console.log('Health:');
    const h = await fetch(`${baseUrl}/health`, { headers: { 'X-Engine-Auth': auth } });
    console.log('health status', h.status);
    console.log(await h.text());

    console.log('\nSubmitting transcription job...');
    const body = { url: 'https://vm.tiktok.com/ZMAKpqkpN/' };
    const res = await fetch(`${baseUrl}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engine-Auth': auth }, body: JSON.stringify(body) });
    const json = await res.json();
    console.log('submit status', res.status, json);
    if (!json.id) return;
    const id = json.id;

    console.log('\nPolling status for id', id);
    for (let i = 0; i < 40; i++) {
      const s = await fetch(`${baseUrl}/status/${id}`, { headers: { 'X-Engine-Auth': auth } });
      const sj = await s.json();
      console.log(`${i+1}: status=${sj.status} progress=${sj.progress} step=${sj.currentStep}`);
      if (sj.status === 'completed' || sj.status === 'failed') {
        console.log('Final:', JSON.stringify(sj, null, 2));
        break;
      }
      await new Promise(r => setTimeout(r, i>10?5000:2000));
    }
  } catch (err) {
    console.error('Error', err);
  }
})();
