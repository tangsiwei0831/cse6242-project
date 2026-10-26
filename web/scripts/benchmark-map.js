// Fresh app instance => deterministic memory-cache misses, without restarting
// the user's server or touching source data. All SQL is persisted snapshot reads.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { Pool } = require('pg');
const { createApp } = require('../server');
const { validatePayload } = require('../lib/refresh-aggregates');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = createApp(pool).listen(0);
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  try {
    let demand;
    for (const [kind, path] of [['demand','/api/dog-demand'], ['accessibility','/api/dog-accessibility']]) {
      let first;
      for (let i = 0; i < 2; i++) {
        const started = performance.now();
        const response = await fetch(origin + path);
        assert.equal(response.status, 200, path);
        const payload = await response.json();
        const cache = response.headers.get('X-Aggregate-Cache');
        assert.equal(cache, i ? 'hit' : 'miss');
        validatePayload(payload, kind);
        results.push({ kind, cache, elapsedMs: +(performance.now() - started).toFixed(2),
          refreshMs: payload.metadata.queryDurationMs, generation: payload.metadata.generation });
        if (i) assert.equal(payload.metadata.generation, first.metadata.generation);
        else first = payload;
      }
      if (kind === 'demand') demand = first;
      else {
        assert.deepEqual(first.summary, demand.summary);
        console.log(JSON.stringify({ demand: demand.summary, accessibility: first.accessibilitySummary }, null, 2));
      }
    }
    for (const path of ['/api/health','/api/dog-runs','/api/dog-runs?borough=M','/api/neighborhoods']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      const data = await response.json();
      if (path.includes('borough=M')) assert.ok(data.features.every(f => f.properties.borough === 'M'));
      if (data.features) assert.ok(data.features.length > 0);
      console.log(path, data.features?.length ?? data.status);
    }
    console.log(JSON.stringify({ apiBenchmarks: results }, null, 2));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
