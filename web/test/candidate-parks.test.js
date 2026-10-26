const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const queries = require('../lib/queries');
const { validatePayload } = require('../lib/refresh-aggregates');
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);

test('candidate ranking groups/repairs parks, excludes active IDs, and counts only new 800m demand',
  { skip: !process.env.RUN_DB_TESTS }, async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL jit=off');
    await client.query(`
      CREATE TEMP TABLE dog_licenses (animal_name text,animal_gender text,animal_birth_year smallint,
        breed_name text,zipcode text,license_issued_date date,license_expired_date date,extract_year smallint) ON COMMIT DROP;
      CREATE TEMP TABLE pluto (bbl text,postcode text,unitsres text,location geometry(Point,4326)) ON COMMIT DROP;
      CREATE TEMP TABLE nta_2020 (nta2020 text,ntaname text,geometry geometry(MultiPolygon,4326)) ON COMMIT DROP;
      CREATE TEMP TABLE dog_runs (object_id integer,gis_property_number text,feature_status text,geometry geometry(MultiPolygon,4326)) ON COMMIT DROP;
      CREATE TEMP TABLE parks_recreation (gis_property_number text,sign_name text,type_category text,borough text,
        recreation_category text,open_space_acres numeric,active_percent numeric,passive_percent numeric,
        active_acres numeric,passive_acres numeric,geometry geometry(MultiPolygon,4326)) ON COMMIT DROP;
      INSERT INTO dog_licenses SELECT 'dog'||i,'F',2020,'breed','10001','2025-01-01','2026-01-01',2026 FROM generate_series(1,7) i;
      INSERT INTO nta_2020 VALUES ('N','Neighborhood',ST_Multi(ST_MakeEnvelope(-.05,-.05,.05,.05,4326)));
      INSERT INTO dog_runs VALUES
        (1,'B','Active',ST_Multi(ST_MakeEnvelope(-.001,-.001,.001,.001,4326))),
        (2,'I','Inactive',ST_Multi(ST_MakeEnvelope(.0099,-.0001,.0101,.0001,4326)));
      INSERT INTO pluto VALUES
        ('covered','10001','1',ST_SetSRID(ST_MakePoint(.002,0),4326)),
        ('new','10001','1',ST_SetSRID(ST_MakePoint(.01,0),4326)),
        ('missing','10001','1',NULL),
        ('outside','10001','1',ST_SetSRID(ST_MakePoint(1,1),4326)),
        ('unknownZip','bad','1',ST_SetSRID(ST_MakePoint(.005,0),4326)),
        ('invalidUnits','10001','bad',ST_SetSRID(ST_MakePoint(.005,0),4326));
      INSERT INTO pluto SELECT label,'10001','1',ST_Project('SRID=4326;POINT(0.005 0)'::geography,m,pi()/2)::geometry
        FROM (VALUES ('near',799.9),('exact',800),('far',800.1)) v(label,m);
      INSERT INTO parks_recreation
        SELECT id,name,type,'Brooklyn',category,1,100,0,1,0,geom FROM (VALUES
        ('A','A Left','Neighborhood Park','Active',ST_Multi(ST_MakeEnvelope(.004,-.001,.005,.001,4326))),
        ('A','A Right','Neighborhood Park','Passive',ST_Multi(ST_MakeEnvelope(.005,-.001,.006,.001,4326))),
        ('C','Tie C','Community Park','Mixed',ST_Multi(ST_MakeEnvelope(.004,-.001,.006,.001,4326))),
        ('I','Inactive host','Flagship Park','Active',ST_Multi(ST_MakeEnvelope(.004,-.001,.006,.001,4326))),
        ('B','Excluded host','Community Park','Active',ST_Multi(ST_MakeEnvelope(-.001,-.001,.001,.001,4326))),
        ('S','Uncertain overlap','Neighborhood Park','Active',ST_Multi(ST_MakeEnvelope(-.001,-.001,.001,.001,4326))),
        ('Z','Repaired park','Neighborhood Park','Passive',ST_Multi(ST_GeomFromText('POLYGON((.03 .03,.032 .032,.03 .032,.032 .03,.03 .03))',4326))),
        ('E','Empty','Community Park','Active',ST_GeomFromText('MULTIPOLYGON EMPTY',4326)),
        ('R','Out of range','Community Park','Active',ST_Multi(ST_MakeEnvelope(181,0,181.01,.01,4326))),
        ('X','Not screened','Playground','Active',ST_Multi(ST_MakeEnvelope(.004,-.001,.006,.001,4326)))
        ) v(id,name,type,category,geom);
    `);
    const data = (await client.query(queries.candidates)).rows[0].payload;
    validatePayload(data,'candidates');
    const baseline = (await client.query(queries.accessibility)).rows[0].payload;
    assert.deepEqual(data.summary, baseline.summary);
    assert.deepEqual(data.accessibilitySummary, baseline.accessibilitySummary);
    assert.deepEqual(data.candidates.map(c=>c.id), ['A','C','I','S','Z']);
    assert.deepEqual(data.candidates.map(c=>c.rank), [1,2,3,4,5]);
    assert.equal(new Set(data.candidates.map(c=>c.id)).size, 5);
    const a = data.candidates[0];
    near(a.longitude,.005); near(a.latitude,0);
    near(a.incrementalDemand,3); // new + 799.9m + exactly 800m; never 'covered'.
    near(data.accessibilitySummary.uncovered_demand,5);
    assert.equal(a.sourceRows,2);
    assert.equal(a.flags.multipleNames,true);
    assert.equal(a.flags.sourceCoverageIncomplete,true);
    assert.equal(a.sourceCoverage.invalidUnitsParcels,1);
    assert.equal(a.sourceCoverage.unallocatableResidentialParcels,1);
    assert.equal(data.candidates.find(c=>c.id==='S').flags.uncertainSpatialOverlap,true);
    near(data.candidates.find(c=>c.id==='S').incrementalDemand,0);
    assert.equal(data.candidates.find(c=>c.id==='Z').flags.geometryRepaired,true);
    assert.equal(data.candidateSummary.pointsInsideProperties,true);
    assert.deepEqual(data.geometryExclusions.map(c=>c.id), ['E','R']);
    assert.deepEqual(data.excludedProperties.map(c=>c.id), ['B']);
    for (const e of data.excludedProperties) {
      const active = await client.query("SELECT object_id FROM dog_runs WHERE feature_status='Active' AND gis_property_number=$1",[e.id]);
      assert.deepEqual(e.activeRunIds,active.rows.map(r=>r.object_id));
    }
    // A byte-stable tie break and canonical point survive source row reordering.
    await client.query('CREATE TEMP TABLE reversed_parks AS SELECT * FROM parks_recreation ORDER BY gis_property_number DESC,sign_name DESC');
    await client.query('TRUNCATE parks_recreation');
    await client.query('INSERT INTO parks_recreation SELECT * FROM reversed_parks');
    const reordered = (await client.query(queries.candidates)).rows[0].payload;
    assert.deepEqual(reordered.candidates,data.candidates);
    for (const c of data.candidates) assert.ok(c.incrementalDemand <= data.accessibilitySummary.uncovered_demand);
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
