// Explicit maintenance command; never run by an HTTP request.
const { Client } = require('pg');
const { runRefresh } = require('../lib/refresh-aggregates');
const flags = process.argv.slice(2);
if (flags.length > 1 || flags.some(f => !['--demand-only', '--accessibility-only', '--install-only'].includes(f))) {
  console.error('Usage: node scripts/refresh-map-data.js [--demand-only|--accessibility-only|--install-only]');
  process.exitCode = 1;
} else {
  const kinds = flags[0] === '--install-only' ? [] : flags[0] === '--demand-only' ? ['demand'] : flags[0] === '--accessibility-only' ? ['accessibility'] : ['demand', 'accessibility'];
  (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'map-aggregate-refresh' });
    await client.connect();
    try { await runRefresh(client, kinds, result => console.log(JSON.stringify(result))); }
    finally { await client.end(); }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
