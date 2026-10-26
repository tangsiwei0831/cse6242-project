const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const queries = require('../lib/queries');
const { refreshKind } = require('../lib/refresh-aggregates');
const { createAggregateStore } = require('../lib/aggregate-store');

test('persisted snapshots survive restarts; imports invalidate; failed/concurrent refreshes retain published data',
  { skip: !process.env.RUN_DB_TESTS }, async () => {
  const schema = 'map_test_' + randomUUID().replaceAll('-', '');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const other = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await other.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path = ${schema}, public`);
    await other.query(`SET search_path = ${schema}, public`);
    await client.query(`
      CREATE TABLE dog_licenses (animal_name text, animal_gender text, animal_birth_year smallint,
        breed_name text, zipcode text, license_issued_date date, license_expired_date date, extract_year smallint);
      CREATE TABLE pluto (bbl text PRIMARY KEY, postcode text, unitsres text, location geometry(Point,4326));
      CREATE TABLE nta_2020 (nta2020 text, ntaname text, geometry geometry(MultiPolygon,4326));
      CREATE TABLE parks_recreation (gis_property_number text,sign_name text,type_category text,borough text,
        recreation_category text,open_space_acres numeric,active_percent numeric,passive_percent numeric,
        active_acres numeric,passive_acres numeric,geometry geometry(MultiPolygon,4326));
      CREATE TABLE map_source_versions(kind text PRIMARY KEY CHECK(kind IN ('demand','accessibility')), revision bigint NOT NULL DEFAULT 1);
      INSERT INTO map_source_versions VALUES ('demand',17),('accessibility',29);
      CREATE TABLE dog_runs (geometry geometry(MultiPolygon,4326), feature_status text, object_id integer GENERATED ALWAYS AS IDENTITY, gis_property_number text);
      INSERT INTO dog_licenses VALUES ('fixture','F',2020,'breed','10001','2025-01-01','2026-01-01',2026);
      INSERT INTO pluto VALUES ('1','10001','1',ST_SetSRID(ST_MakePoint(-74,40),4326));
      INSERT INTO nta_2020 VALUES ('A','Alpha',ST_Multi(ST_MakeEnvelope(-74.1,39.9,-73.9,40.1,4326)));
      INSERT INTO parks_recreation VALUES ('P','Candidate park','Neighborhood Park','Brooklyn','Active',1,100,0,1,0,ST_Multi(ST_MakeEnvelope(-74.1,39.9,-73.9,40.1,4326)));
      INSERT INTO dog_runs(geometry,feature_status) VALUES (ST_Multi(ST_MakeEnvelope(-74.001,39.999,-73.999,40.001,4326)),'Active');
    `);
    await client.query(queries.schema);
    const migrated = await client.query('SELECT kind,revision::text FROM map_source_versions ORDER BY kind');
    assert.deepEqual(migrated.rows, [{kind:'accessibility',revision:'29'}, {kind:'candidates',revision:'1'}, {kind:'demand',revision:'17'}]);
    await refreshKind(client, 'demand');
    await refreshKind(client, 'accessibility');
    await refreshKind(client, 'candidates');
    const store = createAggregateStore(client);
    assert.equal((await store.get('demand')).cacheHit, false);
    assert.equal((await store.get('demand')).cacheHit, true);
    assert.equal((await store.get('accessibility')).payload.ntas[0].coveredDemand, 1);
    assert.equal((await createAggregateStore(client).get('accessibility')).payload.ntas[0].coveredDemand, 1);
    const candidateBefore = (await store.get('candidates')).payload.metadata.generation;
    await client.query("UPDATE parks_recreation SET sign_name = 'Renamed park'");
    await assert.rejects(store.get('candidates'), { status: 'stale' });
    assert.equal((await store.get('demand')).cacheHit, true);
    assert.equal((await store.get('accessibility')).cacheHit, true);
    await refreshKind(client, 'candidates');
    assert.notEqual((await store.get('candidates')).payload.metadata.generation, candidateBefore);
    assert.equal((await createAggregateStore(client).get('candidates')).payload.candidates.length, 1);
    await client.query("UPDATE dog_runs SET feature_status = 'Inactive'");
    await assert.rejects(store.get('accessibility'), { status: 'stale' });
    await assert.rejects(store.get('candidates'), { status: 'stale' });
    assert.equal((await store.get('demand')).cacheHit, true);
    await refreshKind(client, 'accessibility');
    const fresh = await store.get('accessibility');
    assert.equal(fresh.cacheHit, false);
    assert.equal(fresh.payload.ntas[0].coveredDemand, 0);
    assert.equal(fresh.payload.ntas[0].uncoveredDemand, 1);
    const old = (await store.get('demand')).payload.metadata.generation;
    // Actual import-style TRUNCATE + INSERT invalidates inside the same transaction.
    await client.query('BEGIN');
    await client.query('TRUNCATE pluto');
    await client.query("INSERT INTO pluto VALUES ('1','10001','2',ST_SetSRID(ST_MakePoint(-74,40),4326))");
    await client.query('COMMIT');
    await assert.rejects(store.get('demand'), { status: 'stale' });
    await assert.rejects(store.get('accessibility'), { status: 'stale' });
    await assert.rejects(refreshKind(client, 'demand', async () => { throw new Error('forced failure'); }), /forced failure/);
    let stored = await client.query("SELECT generation FROM map_aggregate_snapshots WHERE kind='demand'");
    assert.equal(stored.rows[0].generation, old);
    await assert.rejects(refreshKind(client, 'demand', async () => {
      const result = await client.query(queries.demand);
      result.rows[0].payload.summary.conservation_error = 1;
      return result;
    }), /Conservation check failed/);
    stored = await client.query("SELECT generation FROM map_aggregate_snapshots WHERE kind='demand'");
    assert.equal(stored.rows[0].generation, old);
    await assert.rejects(refreshKind(client, 'demand', async () => {
      const result = await client.query(queries.demand);
      await other.query("UPDATE pluto SET unitsres = '3'");
      return result;
    }), error => error.code === '40001');
    stored = await client.query("SELECT generation FROM map_aggregate_snapshots WHERE kind='demand'");
    assert.equal(stored.rows[0].generation, old);
    await refreshKind(client, 'demand');
    assert.notEqual((await store.get('demand')).payload.metadata.generation, old);
    // Other source tables also invalidate both dependencies.
    for (const table of ['dog_licenses', 'nta_2020']) {
      const before = await client.query('SELECT revision FROM map_source_versions ORDER BY kind');
      await client.query(`DELETE FROM ${table} WHERE false`);
      const after = await client.query('SELECT revision FROM map_source_versions ORDER BY kind');
      assert.ok(after.rows.every((r, i) => BigInt(r.revision) > BigInt(before.rows[i].revision)));
    }
  } finally {
    await other.end();
    await client.query('ROLLBACK');
    await client.query('SET search_path = public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
