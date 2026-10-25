const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Client } = require('pg');
const sql = readFileSync(join(__dirname, '../sql/dog-demand.sql'), 'utf8');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('allocation conserves ZIP demand and explicitly accounts for spatial exclusions',
  { skip: !process.env.RUN_DB_TESTS }, async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    // Temporary tables shadow production tables only for this connection.
    await client.query(`
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
    const data = (await client.query(sql)).rows[0].payload;
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
