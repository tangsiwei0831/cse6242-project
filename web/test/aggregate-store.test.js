const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createAggregateStore } = require('../lib/aggregate-store');
const { createApp } = require('../server');
const { runRefresh } = require('../lib/refresh-aggregates');

function database() {
  const rows = { demand: { revision: '1' }, accessibility: { revision: '1' } };
  let calls = 0;
  return { rows, get calls() { return calls; },
    publish(kind, generation, value) {
      Object.assign(rows[kind], { generation, source_revision: rows[kind].revision, payload: { value, ntas: [], metadata: {} } });
    },
    async query(sql, [kind, generation] = []) {
      calls++;
      assert.match(sql, /FROM map_source_versions/);
      assert.doesNotMatch(sql, /ST_Distance|ST_DWithin|FROM pluto/);
      const row = rows[kind];
      return { rows: [{ ...row, payload: row.generation === generation ? null : row.payload }] };
    }
  };
}

test('cache checks source revisions and publication generations on every request', async () => {
  const db = database();
  const store = createAggregateStore(db);
  await assert.rejects(store.get('demand'), { status: 'not_ready' });
  db.publish('demand', 'd1', 10);
  db.publish('accessibility', 'a1', 20);
  assert.equal((await store.get('demand')).cacheHit, false);
  assert.equal((await store.get('demand')).cacheHit, true);
  await store.get('accessibility');
  db.rows.accessibility.revision = '2'; // Dog-run change invalidates access only.
  await assert.rejects(store.get('accessibility'), { status: 'stale' });
  assert.equal((await store.get('demand')).cacheHit, true);
  db.publish('accessibility', 'a2', 21);
  assert.equal((await store.get('accessibility')).payload.value, 21);
  db.publish('demand', 'd2', 11); // Forced refresh with unchanged source revision.
  assert.deepEqual(await store.get('demand'), { payload: db.rows.demand.payload, cacheHit: false });
  db.rows.demand.revision = '2';
  await assert.rejects(store.get('demand'), { status: 'stale' });
  assert.ok(db.calls >= 9);
  const restarted = createAggregateStore(db);
  assert.equal((await restarted.get('accessibility')).payload.value, 21);
});

test('missing schema is not-ready; database failures never serve unchecked cached data', async () => {
  const unavailable = createAggregateStore({ query: async () => { throw Object.assign(new Error(), { code: '42P01' }); } });
  await assert.rejects(unavailable.get('demand'), { status: 'not_ready' });
  const db = database();
  db.publish('demand', 'd1', 10);
  const store = createAggregateStore(db);
  await store.get('demand');
  db.query = async () => { throw new Error('database unavailable'); };
  await assert.rejects(store.get('demand'), /database unavailable/);
});

test('HTTP demand is independent from unprepared/stale accessibility; GETs do not compute', async () => {
  const db = database();
  const server = createApp(db).listen(0);
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(url + '/api/dog-accessibility');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, 'not_ready');
    db.publish('demand', 'd1', 10);
    response = await fetch(url + '/api/dog-demand');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Aggregate-Cache'), 'miss');
    response = await fetch(url + '/api/dog-demand');
    assert.equal(response.headers.get('X-Aggregate-Cache'), 'hit');
    db.publish('accessibility', 'a1', 20);
    assert.equal((await fetch(url + '/api/dog-accessibility')).status, 200);
    db.rows.accessibility.revision = '2';
    assert.equal((await fetch(url + '/api/dog-accessibility')).status, 503);
    assert.equal((await fetch(url + '/api/dog-demand')).status, 200);
    const html = await fetch(url + '/');
    assert.equal(html.status, 200);
    assert.match(await html.text(), /id="map"/);
    assert.equal((await fetch(url + '/vendor/d3/d3.min.js')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('a concurrent refresh is rejected before installation or computation', async () => {
  let count = 0;
  await assert.rejects(runRefresh({ query: async () => { count++; return { rows: [{ acquired: false }] }; } }, ['demand']), /Another map refresh/);
  assert.equal(count, 1);
});
