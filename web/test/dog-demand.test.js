const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const queries = require('../lib/queries');
const sql = queries.accessibility;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('allocation conserves ZIP demand and explicitly accounts for spatial exclusions',
  { skip: !process.env.RUN_DB_TESTS }, async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL jit = off');
    // Temporary tables shadow production tables only for this connection.
    await client.query(`
      CREATE TEMP TABLE dog_runs (geometry geometry(MultiPolygon,4326), feature_status text) ON COMMIT DROP;
      CREATE TEMP TABLE dog_licenses (animal_name text, animal_gender text,
        animal_birth_year smallint, breed_name text, zipcode text,
        license_issued_date date, license_expired_date date, extract_year smallint) ON COMMIT DROP;
      CREATE TEMP TABLE pluto (bbl text, postcode text, unitsres text,
        location geometry(Point,4326)) ON COMMIT DROP;
      CREATE TEMP TABLE nta_2020 (nta2020 text, ntaname text,
        geometry geometry(MultiPolygon,4326)) ON COMMIT DROP;
      INSERT INTO dog_licenses
      SELECT 'dog' || i, 'F', 2020, 'breed',
        CASE WHEN i <= 10 THEN '10001' WHEN i <= 14 THEN '10002'
             WHEN i <= 17 THEN '10003' WHEN i <= 19 THEN 'bad' END,
        '2025-01-01', '2026-01-01', 2026 FROM generate_series(1,20) i;
      INSERT INTO dog_licenses SELECT * FROM dog_licenses LIMIT 1;
      INSERT INTO dog_licenses VALUES ('old', 'F', 2020, 'breed', '10001', '2024-01-01', '2024-12-31', 2026),
        ('other extract', 'F', 2020, 'breed', '10001', '2025-01-01', '2026-01-01', 2025);
      INSERT INTO nta_2020 VALUES
        ('A','Alpha', ST_Multi(ST_MakeEnvelope(0,0,1,1,4326))),
        ('B','Beta', ST_Multi(ST_MakeEnvelope(1,0,2,1,4326))),
        ('C','Empty', ST_Multi(ST_MakeEnvelope(3,0,4,1,4326)));
      INSERT INTO pluto VALUES
        ('1','10001','1,000', ST_SetSRID(ST_MakePoint(.5,.5),4326)),
        ('2','10001','1000',NULL),
        ('3','10001','1000',ST_SetSRID(ST_MakePoint(5,5),4326)),
        ('4','10001','1000',ST_SetSRID(ST_MakePoint(1,.5),4326)),
        ('5','10002','0',NULL),
        ('6','10004','10',ST_SetSRID(ST_MakePoint(1.5,.5),4326)),
        ('7',NULL,'20',ST_SetSRID(ST_MakePoint(1.5,.5),4326)),
        ('8','10001','bad',ST_SetSRID(ST_MakePoint(.5,.5),4326)),
        ('9','10001',NULL,NULL);
    `);
    const demandOnly = (await client.query(queries.demand)).rows[0].payload;
    const data = (await client.query(sql)).rows[0].payload;
    assert.deepEqual(data.summary, demandOnly.summary);
    assert.deepEqual(data.zipDiagnostics, demandOnly.zipDiagnostics);
    for (const n of demandOnly.ntas) {
      const full = data.ntas.find(f => f.id === n.id);
      for (const key of Object.keys(n).filter(k => k !== 'flags')) assert.deepEqual(full[key], n[key]);
    }
    assert.equal(demandOnly.accessibilitySummary, undefined);
    const s = data.summary;
    near(s.active_license_records, 20);
    near(s.unallocatable_demand, 10);
    near(s.allocated_parcel_demand, 10);
    near(s.nta_demand, 2.5);
    near(s.missing_coordinate_demand, 2.5);
    near(s.outside_nta_demand, 2.5);
    near(s.ambiguous_nta_demand, 2.5);
    near(s.excluded_demand, 17.5);
    near(s.conservation_error, 0);
    near(s.spatial_conservation_error, 0);
    assert.equal(s.assigned_residential_parcels, 3);
    assert.equal(s.residential_parcels, 6);
    const [a,b,c] = data.ntas;
    near(a.estimatedDemand, 2.5);
    near(a.demandPer1000Units, 2.5);
    assert.equal(a.flags.invalidUnitsParcels, 1);
    assert.equal(b.estimatedDemand, 0);
    assert.equal(b.flags.partialCoverage, true);
    assert.equal(b.flags.unknownZipParcels, 1);
    assert.equal(c.estimatedDemand, null);
    assert.equal(c.flags.missingData, true);
    assert.equal(data.zipDiagnostics.find(z => z.zip === '10003').status, 'unmatched_zip');
    assert.equal(data.zipDiagnostics.find(z => z.zip === '10002').status, 'no_valid_residential_units');
    for (const z of data.zipDiagnostics.filter(z => z.status === 'allocatable')) near(z.dogs, z.allocated_demand);
    assert.ok(!JSON.stringify(data).includes('animal_name'));
    await client.query('TRUNCATE dog_licenses');
    const missing = (await client.query(sql)).rows[0].payload;
    assert.ok(missing.ntas.every(n => n.estimatedDemand === null));
    assert.equal(missing.metadata.availability.licenses_available, false);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});

test('800m accessibility uses nearest active polygon geography distance and conserves demand',
  { skip: !process.env.RUN_DB_TESTS }, async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL jit = off');
    await client.query(`
      CREATE TEMP TABLE dog_licenses (animal_name text, animal_gender text,
        animal_birth_year smallint, breed_name text, zipcode text,
        license_issued_date date, license_expired_date date, extract_year smallint) ON COMMIT DROP;
      CREATE TEMP TABLE pluto (bbl text, postcode text, unitsres text,
        location geometry(Point,4326)) ON COMMIT DROP;
      CREATE TEMP TABLE nta_2020 (nta2020 text, ntaname text,
        geometry geometry(MultiPolygon,4326)) ON COMMIT DROP;
      CREATE TEMP TABLE dog_runs (geometry geometry(MultiPolygon,4326), feature_status text) ON COMMIT DROP;
      INSERT INTO dog_licenses
        SELECT 'dog' || i, 'F', 2020, 'breed', '10001', '2025-01-01', '2026-01-01', 2026
        FROM generate_series(1,10) i;
      INSERT INTO nta_2020 VALUES
        ('A','Alpha',ST_Multi(ST_MakeEnvelope(-.1,-.1,.4,.1,4326))),
        ('Z','Zero demand',ST_Multi(ST_MakeEnvelope(1.9,1.9,2.1,2.1,4326)));
      INSERT INTO dog_runs VALUES
        (ST_Multi(ST_MakeEnvelope(0,-.001,.1,.001,4326)), 'Active'),
        (ST_Multi(ST_MakeEnvelope(.199,-.001,.201,.001,4326)), 'Inactive');
      -- Duplicate active coverage must not double-count parcel demand.
      INSERT INTO dog_runs SELECT geometry, feature_status FROM dog_runs WHERE feature_status = 'Active';
      INSERT INTO dog_runs VALUES (ST_Multi(ST_MakeEnvelope(.3,-.001,.301,.001,4326)), 'Active');
      INSERT INTO pluto VALUES
        ('inside','10001','1',ST_SetSRID(ST_MakePoint(.099,0),4326)),
        ('boundary','10001','1',ST_SetSRID(ST_MakePoint(.1,0),4326)),
        ('inactive','10001','1',ST_SetSRID(ST_MakePoint(.2,0),4326)),
        ('missing','10001','1',NULL),
        ('outside','10001','1',ST_SetSRID(ST_MakePoint(1,1),4326)),
        ('invalid','10001','1',ST_SetSRID(ST_MakePoint(181,0),4326)),
        ('zero','10002','1',ST_SetSRID(ST_MakePoint(2,2),4326));
      INSERT INTO pluto
        SELECT label,'10001','1',ST_Project('SRID=4326;POINT(0.1 0)'::geography,meters,pi()/2)::geometry
        FROM (VALUES ('near',799.9),('exact',800),('far',800.1),('overlap',100)) v(label,meters);
    `);
    const demandOnly = (await client.query(queries.demand)).rows[0].payload;
    const data = (await client.query(sql)).rows[0].payload;
    assert.deepEqual(data.summary, demandOnly.summary);
    assert.deepEqual(data.zipDiagnostics, demandOnly.zipDiagnostics);
    for (const n of demandOnly.ntas) {
      const full = data.ntas.find(f => f.id === n.id);
      for (const key of Object.keys(n).filter(k => k !== 'flags')) assert.deepEqual(full[key], n[key]);
    }
    assert.equal(demandOnly.accessibilitySummary, undefined);
    const a = data.ntas.find(n => n.id === 'A');
    near(a.estimatedDemand, 7);
    near(a.accessibilityTotalDemand, 7);
    near(a.coveredDemand, 5);
    near(a.uncoveredDemand, 2);
    near(a.coveragePercentage, 500 / 7);
    const zero = data.ntas.find(n => n.id === 'Z');
    assert.equal(zero.uncoveredDemand, 0);
    assert.equal(zero.coveragePercentage, null);
    const s = data.accessibilitySummary;
    near(s.eligible_demand, 8);
    near(s.covered_demand, 5);
    near(s.uncovered_demand, 3);
    near(s.unassigned_nta_demand, 1);
    near(s.missing_coordinate_demand, 1);
    near(s.invalid_location_demand, 1);
    for (const key of ['conservation_error','nta_conservation_error','allocation_conservation_error']) near(s[key], 0);
    assert.equal(data.metadata.accessibility.activeDogRuns, 3);
    assert.equal(data.metadata.accessibility.radiusMeters, 800);
    // Inspect fixture-only intermediate results, never expose parcel records via API.
    const prefix = sql.slice(0, sql.lastIndexOf('SELECT dp.payload'));
    const distances = (await client.query(prefix + 'SELECT bbl, covered FROM access_classified')).rows;
    const byId = new Map(distances.map(r => [r.bbl, r]));
    const brute = (await client.query(`SELECT p.bbl,
      MIN(ST_Distance(p.location::geography, d.geometry::geography)) AS meters
      FROM pluto p CROSS JOIN dog_runs d WHERE d.feature_status = 'Active'
      AND p.location IS NOT NULL AND ST_X(p.location) BETWEEN -180 AND 180
      GROUP BY p.bbl`)).rows;
    for (const r of brute) assert.equal(byId.get(r.bbl).covered, r.meters <= 800, r.bbl);
    const meters = new Map(brute.map(r => [r.bbl, r.meters]));
    near(meters.get('inside'), 0);
    near(meters.get('boundary'), 0);
    near(meters.get('near'), 799.9);
    near(meters.get('exact'), 800);
    near(meters.get('far'), 800.1);
    assert.equal(byId.get('near').covered, true);
    assert.equal(byId.get('exact').covered, true);
    assert.equal(byId.get('far').covered, false);
    assert.equal(byId.get('inactive').covered, false);
    assert.ok(!byId.has('missing') && !byId.has('invalid'));
    // Empty active-run set is valid: every eligible demand share is uncovered.
    await client.query("UPDATE dog_runs SET feature_status = 'Inactive'");
    const noRuns = (await client.query(sql)).rows[0].payload;
    near(noRuns.accessibilitySummary.covered_demand, 0);
    near(noRuns.accessibilitySummary.uncovered_demand, 8);
    assert.ok(noRuns.ntas.every(n => n.flags.noActiveDogRuns));
    near(noRuns.ntas[0].coveragePercentage, 0);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
