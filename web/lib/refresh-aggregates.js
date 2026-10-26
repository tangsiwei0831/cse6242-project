const { randomUUID } = require('node:crypto');
const queries = require('./queries');

function validatePayload(payload, kind) {
  const near = (a, b, label) => {
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 1e-7) throw new Error(`Conservation check failed: ${label}`);
  };
  const s = payload.summary;
  if (!Object.values(payload.metadata.availability).every(Boolean)) throw new Error('Required source data is missing; previous snapshot retained');
  near(s.conservation_error, 0, 'ZIP allocation');
  near(s.spatial_conservation_error, 0, 'NTA assignment');
  for (const z of payload.zipDiagnostics.filter(z => z.status === 'allocatable')) near(z.dogs, z.allocated_demand, 'ZIP ' + z.zip);
  if (kind !== 'accessibility') return;
  const a = payload.accessibilitySummary;
  for (const key of ['conservation_error', 'nta_conservation_error', 'allocation_conservation_error']) near(a[key], 0, key);
  near(a.eligible_demand, a.nta_total_demand + a.unassigned_nta_demand, 'unassigned NTA accounting');
  let sum = 0;
  for (const n of payload.ntas) {
    if (n.accessibilityTotalDemand == null) continue;
    near(n.coveredDemand + n.uncoveredDemand, n.accessibilityTotalDemand, n.id);
    if (n.coveredDemand < 0 || n.uncoveredDemand < 0) throw new Error('Negative accessibility demand');
    if (n.accessibilityTotalDemand > 0) near(n.coveragePercentage, n.coveredDemand * 100 / n.accessibilityTotalDemand, 'weighted coverage ' + n.id);
    else if (n.coveragePercentage !== null) throw new Error('Zero demand must have undefined coverage');
    sum += n.accessibilityTotalDemand;
  }
  near(sum, a.nta_total_demand, 'NTA totals');
}

async function refreshKind(client, kind, compute = () => client.query(queries[kind])) {
  if (!['demand', 'accessibility'].includes(kind)) throw new Error('Unknown aggregate kind');
  const started = Date.now();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await client.query('SET LOCAL jit = off');
    const { rows: [source] } = await client.query('SELECT revision::text FROM map_source_versions WHERE kind = $1', [kind]);
    const { rows: [{ payload }] } = await compute();
    validatePayload(payload, kind);
    // Lock only at publication. An import committed during this snapshot causes
    // SQLSTATE 40001 (or a mismatch); roll back instead of publishing mixed data.
    const { rows: [current] } = await client.query('SELECT revision::text FROM map_source_versions WHERE kind = $1 FOR UPDATE', [kind]);
    if (current.revision !== source.revision) throw new Error('Sources changed during refresh; rerun refresh');
    const durationMs = Date.now() - started;
    const generation = randomUUID();
    payload.metadata = { ...payload.metadata, kind, sourceRevision: source.revision, generation,
      computedAt: new Date().toISOString(), queryDurationMs: durationMs, persisted: true };
    await client.query(`INSERT INTO map_aggregate_snapshots(kind, source_revision, generation, computed_at, duration_ms, payload)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kind) DO UPDATE SET
      source_revision=EXCLUDED.source_revision, generation=EXCLUDED.generation,
      computed_at=EXCLUDED.computed_at, duration_ms=EXCLUDED.duration_ms, payload=EXCLUDED.payload`,
    [kind, source.revision, generation, payload.metadata.computedAt, durationMs, payload]);
    await client.query('COMMIT');
    return { kind, durationMs, generation, sourceRevision: source.revision };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runRefresh(client, kinds, log = console.log) {
  const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock(6242, 800) AS acquired');
  if (!lock.acquired) throw new Error('Another map refresh is running; no changes made');
  try {
    await client.query(queries.schema);
    for (const kind of kinds) log(await refreshKind(client, kind));
  } finally {
    await client.query('SELECT pg_advisory_unlock(6242, 800)');
  }
}
module.exports = { validatePayload, refreshKind, runRefresh };
