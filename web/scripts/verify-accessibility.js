// Read-only live API checks. Run separately from the temporary-table unit suite.
const assert = require('node:assert/strict');
const http = require('node:http');
const origin = `http://localhost:${process.env.PORT || 3000}`;
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-7, label);
function get(path) {
  return new Promise((resolve, reject) => {
    const request = http.get(origin + path, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 200, path);
          resolve(JSON.parse(body));
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.setTimeout(1800000, () => request.destroy(new Error('API request timed out')));
    request.on('error', reject);
  });
}
(async () => {
  const started = Date.now();
  const demand = await get('/api/dog-demand');
  const data = await get('/api/dog-accessibility');
  assert.deepEqual(data.summary, demand.summary);
  assert.equal(demand.accessibilitySummary, undefined);
  const s = data.accessibilitySummary;
  for (const key of ['conservation_error','nta_conservation_error','allocation_conservation_error']) near(s[key], 0, key);
  near(s.eligible_demand, s.nta_total_demand + s.unassigned_nta_demand, 'NTA assignment accounting');
  near(data.summary.allocated_parcel_demand,
    s.eligible_demand + s.missing_coordinate_demand + s.invalid_location_demand, 'all parcel allocations accounted for');
  let total = 0;
  for (const n of data.ntas) {
    if (n.accessibilityTotalDemand == null) {
      assert.equal(n.coveredDemand, null);
      assert.equal(n.uncoveredDemand, null);
      continue;
    }
    near(n.coveredDemand + n.uncoveredDemand, n.accessibilityTotalDemand, n.id);
    assert.ok(n.coveredDemand >= 0 && n.uncoveredDemand >= 0);
    if (n.coveragePercentage != null) near(n.coveragePercentage, n.coveredDemand * 100 / n.accessibilityTotalDemand, n.id);
    else near(n.accessibilityTotalDemand, 0, 'undefined coverage only for zero demand');
    total += n.accessibilityTotalDemand;
  }
  near(total, s.nta_total_demand, 'NTA aggregate total');
  near(data.summary.conservation_error, 0, 'original ZIP conservation');
  near(data.summary.spatial_conservation_error, 0, 'original spatial conservation');
  const requestMs = Date.now() - started;
  const cachedStarted = Date.now();
  const cached = await get('/api/dog-accessibility');
  assert.equal(cached.metadata.computedAt, data.metadata.computedAt);
  console.log(JSON.stringify({ requestMs, cachedRequestMs: Date.now() - cachedStarted,
    metadata: data.metadata, originalDemand: data.summary, accessibility: s, ntas: data.ntas.length }, null, 2));
  for (const path of ['/api/health','/api/dog-runs','/api/dog-runs?borough=M','/api/neighborhoods']) {
    const result = await get(path);
    if (path.includes('borough=M')) assert.ok(result.features.every(f => f.properties.borough === 'M'));
    if (result.features) assert.ok(result.features.length > 0);
    console.log(path, result.features?.length ?? result.status);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
