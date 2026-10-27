const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 3000);
const devMode = process.env.DEV_MODE === 'true';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let licenseDensityPromise;
let parksPromise;
const opportunityCache = new Map();

app.disable('x-powered-by');
app.use('/vendor/d3', express.static(path.join(__dirname, 'node_modules/d3/dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/dev-version', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ enabled: devMode, version: latestFrontendMtime() });
});

app.get('/api/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok' });
  } catch (error) {
    response.status(503).json({ status: 'error', message: 'Database unavailable' });
  }
});

app.get('/api/dog-runs', async (request, response, next) => {
  const borough = String(request.query.borough || '').toUpperCase();
  const allowedBoroughs = new Set(['B', 'M', 'Q', 'R', 'X']);
  const params = [];
  const where = ["feature_status = 'Active'"];

  if (allowedBoroughs.has(borough)) {
    params.push(borough);
    where.push(`borough = $${params.length}`);
  }

  try {
    const result = await pool.query(
      `SELECT object_id, name, borough, zipcode, dog_area_type, seating, surface,
              feature_status, gis_property_number,
              ST_AsGeoJSON(geometry)::json AS geometry,
              ST_X(ST_PointOnSurface(geometry)) AS longitude,
              ST_Y(ST_PointOnSurface(geometry)) AS latitude,
              ST_Area(geometry::geography) AS area_sq_m
         FROM dog_runs
        WHERE ${where.join(' AND ')}
        ORDER BY name`,
      params
    );

    response.json({
      type: 'FeatureCollection',
      features: result.rows.map((row) => ({
        type: 'Feature',
        id: row.object_id,
        geometry: row.geometry,
        properties: {
          objectId: row.object_id,
          name: row.name,
          borough: row.borough,
          zipcode: row.zipcode,
          type: row.dog_area_type,
          seating: row.seating,
          surface: row.surface,
          status: row.feature_status,
          propertyId: row.gis_property_number,
          longitude: Number(row.longitude),
          latitude: Number(row.latitude),
          areaSqM: Number(row.area_sq_m)
        }
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/neighborhoods', async (_request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT nta2020, ntaname, boroname,
              ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry, 0.00008))::json AS geometry
         FROM nta_2020
        ORDER BY nta2020`
    );
    response.json({
      type: 'FeatureCollection',
      features: result.rows.map((row) => ({
        type: 'Feature',
        id: row.nta2020,
        geometry: row.geometry,
        properties: { name: row.ntaname, borough: row.boroname }
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/parks', async (_request, response, next) => {
  try {
    parksPromise ||= loadParks().catch((error) => {
      parksPromise = undefined;
      throw error;
    });
    response.json(await parksPromise);
  } catch (error) {
    next(error);
  }
});

async function loadParks() {
  const result = await pool.query(`
    WITH grouped_parks AS (
      SELECT gis_property_number,
             max(sign_name) AS name,
             max(recreation_category) AS recreation_category,
             max(type_category) AS type_category,
             max(borough) AS borough,
             ST_Multi(ST_UnaryUnion(ST_Collect(geometry))) AS geometry
      FROM parks_recreation
      GROUP BY gis_property_number
    )
    SELECT p.gis_property_number, p.name, p.recreation_category,
           p.type_category, p.borough,
           ST_AsGeoJSON(ST_PointOnSurface(p.geometry))::json AS geometry,
           ST_X(ST_PointOnSurface(p.geometry)) AS longitude,
           ST_Y(ST_PointOnSurface(p.geometry)) AS latitude
    FROM grouped_parks p
    WHERE NOT EXISTS (
      SELECT 1
      FROM dog_runs d
      WHERE d.feature_status = 'Active'
        AND ST_Intersects(p.geometry, d.geometry)
    )
    ORDER BY p.gis_property_number
  `);

  return {
    type: 'FeatureCollection',
    features: result.rows.map((row) => ({
      type: 'Feature',
      id: row.gis_property_number,
      geometry: row.geometry,
      properties: {
        propertyId: row.gis_property_number,
        name: row.name || 'Unnamed park property',
        recreationCategory: row.recreation_category,
        type: row.type_category,
        borough: row.borough,
        longitude: Number(row.longitude),
        latitude: Number(row.latitude)
      }
    }))
  };
}

app.get('/api/license-density', async (_request, response, next) => {
  try {
    licenseDensityPromise ||= loadLicenseDensity().catch((error) => {
      licenseDensityPromise = undefined;
      throw error;
    });
    response.json(await licenseDensityPromise);
  } catch (error) {
    next(error);
  }
});

async function loadLicenseDensity() {
  const result = await pool.query(`
    WITH latest AS (
      SELECT max(extract_year) AS extract_year
      FROM dog_licenses
      WHERE extract_year IS NOT NULL
    ), license_zip AS (
      SELECT zipcode, count(*)::numeric AS licenses
      FROM dog_licenses, latest
      WHERE dog_licenses.extract_year = latest.extract_year
        AND zipcode ~ '^[0-9]{5}$'
      GROUP BY zipcode
    ), lot_counts AS (
      SELECT p.postcode, n.nta2020, count(*)::numeric AS lots
      FROM pluto p
      JOIN nta_2020 n ON ST_Covers(n.geometry, p.location)
      WHERE p.location IS NOT NULL AND p.postcode ~ '^[0-9]{5}$'
      GROUP BY p.postcode, n.nta2020
    ), zip_weights AS (
      SELECT postcode, nta2020,
             lots / sum(lots) OVER (PARTITION BY postcode) AS share
      FROM lot_counts
    ), estimated AS (
      SELECT w.nta2020, sum(l.licenses * w.share) AS licenses
      FROM zip_weights w
      JOIN license_zip l ON l.zipcode = w.postcode
      GROUP BY w.nta2020
    )
    SELECT n.nta2020, n.ntaname, n.boroname,
           latest.extract_year,
           coalesce(e.licenses, 0) AS licenses,
           ST_Area(n.geometry::geography) / 1000000.0 AS area_sq_km,
           coalesce(e.licenses, 0) / nullif(ST_Area(n.geometry::geography) / 1000000.0, 0) AS density
    FROM nta_2020 n
    CROSS JOIN latest
    LEFT JOIN estimated e ON e.nta2020 = n.nta2020
    ORDER BY n.nta2020
  `);

  const areas = result.rows.map((row) => ({
    nta: row.nta2020,
    name: row.ntaname,
    borough: row.boroname,
    licenses: Math.round(Number(row.licenses)),
    areaSqKm: Number(row.area_sq_km),
    density: Number(row.density)
  }));
  return {
    year: Number(result.rows[0]?.extract_year),
    totalLicenses: areas.reduce((sum, area) => sum + area.licenses, 0),
    method: 'ZIP totals apportioned to NTAs by the distribution of PLUTO address points',
    areas
  };
}

app.get('/api/complaint-hotspots', async (_request, response, next) => {
  try {
    const result = await pool.query(`
      WITH cells AS (
        SELECT ST_SnapToGrid(location, 0.001) AS geometry, count(*)::integer AS complaint_count
        FROM service_requests_311
        WHERE location IS NOT NULL
        GROUP BY ST_SnapToGrid(location, 0.001)
        HAVING count(*) >= 5
      )
      SELECT ST_AsGeoJSON(c.geometry)::json AS geometry, c.complaint_count,
             n.boroname AS borough, n.ntaname AS neighborhood
      FROM cells c
      LEFT JOIN nta_2020 n ON ST_Covers(n.geometry, c.geometry)
      ORDER BY c.complaint_count DESC
    `);
    response.json({
      type: 'FeatureCollection',
      features: result.rows.map((row, index) => ({
        type: 'Feature', id: index, geometry: row.geometry,
        properties: { complaintCount: row.complaint_count, borough: row.borough, neighborhood: row.neighborhood }
      }))
    });
  } catch (error) { next(error); }
});

app.get('/api/opportunities', async (request, response, next) => {
  const weights = ['demand', 'access', 'complaints', 'suitability'].map((key, index) =>
    request.query[key] === undefined ? [35, 25, 20, 20][index] : Number(request.query[key]));
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0 || weight > 100)
    || weights.reduce((sum, weight) => sum + weight, 0) !== 100) {
    response.status(400).json({ error: 'Scoring weights must be between 0 and 100 and total 100.' });
    return;
  }
  try {
    const cacheKey = weights.join('-');
    let resultPromise = opportunityCache.get(cacheKey);
    if (!resultPromise) {
      resultPromise = pool.query(opportunityQuery, weights).catch((error) => {
        opportunityCache.delete(cacheKey);
        throw error;
      });
      opportunityCache.set(cacheKey, resultPromise);
    }
    const result = await resultPromise;
    response.json({
      type: 'FeatureCollection',
      features: result.rows.map((row) => ({
        type: 'Feature', id: row.property_id,
        geometry: row.geometry,
        properties: {
          propertyId: row.property_id, name: row.name, borough: row.borough,
          acres: Number(row.acres), score: Number(row.score), rank: Number(row.rank),
          licenseEstimate: Math.round(Number(row.license_estimate)),
          complaintCount: Number(row.complaint_count),
          nearestRunKm: Number(row.nearest_run_km),
          factors: {
            demand: Number(row.demand_score), access: Number(row.access_score),
            complaints: Number(row.complaint_score), acreage: Number(row.acreage_score)
          }
        }
      }))
    });
  } catch (error) { next(error); }
});

const opportunityQuery = `
  WITH parks AS (
    SELECT gis_property_number AS property_id,
           coalesce(mode() WITHIN GROUP (ORDER BY sign_name) FILTER (WHERE sign_name IS NOT NULL), 'Unnamed park') AS name,
           max(borough) AS borough, max(open_space_acres) AS acres,
           ST_Multi(ST_UnaryUnion(ST_Collect(geometry))) AS geometry
    FROM parks_recreation GROUP BY gis_property_number
  ), latest AS (
    SELECT max(extract_year) AS extract_year FROM dog_licenses WHERE extract_year IS NOT NULL
  ), license_zip AS (
    SELECT zipcode, count(*)::numeric AS licenses FROM dog_licenses, latest
    WHERE dog_licenses.extract_year = latest.extract_year AND zipcode ~ '^[0-9]{5}$' GROUP BY zipcode
  ), zip_parts AS (
    SELECT p.postcode, n.nta2020,
           sum(CASE WHEN p.unitsres ~ '^[0-9]+([.][0-9]+)?$' THEN p.unitsres::numeric ELSE 0 END) AS units,
           count(*)::numeric AS parcels
    FROM pluto p JOIN nta_2020 n ON ST_Covers(n.geometry, p.location)
    WHERE p.location IS NOT NULL AND p.postcode ~ '^[0-9]{5}$'
    GROUP BY p.postcode, n.nta2020
  ), zip_weights AS (
    SELECT *, CASE WHEN sum(units) OVER (PARTITION BY postcode) > 0
      THEN units / sum(units) OVER (PARTITION BY postcode)
      ELSE parcels / sum(parcels) OVER (PARTITION BY postcode) END AS weight
    FROM zip_parts
  ), licenses AS (
    SELECT w.nta2020, sum(l.licenses * w.weight) AS license_estimate
    FROM zip_weights w JOIN license_zip l ON l.zipcode = w.postcode GROUP BY w.nta2020
  ), complaints AS (
    SELECT n.nta2020, count(*)::numeric AS complaint_count
    FROM service_requests_311 s JOIN nta_2020 n ON ST_Covers(n.geometry, s.location)
    WHERE s.location IS NOT NULL GROUP BY n.nta2020
  ), candidates AS (
    SELECT p.property_id, p.name, p.borough, p.acres, ST_PointOnSurface(p.geometry) AS point,
           coalesce(l.license_estimate, 0) AS license_estimate,
           coalesce(c.complaint_count, 0) AS complaint_count,
           coalesce((SELECT min(ST_Distance(ST_PointOnSurface(d.geometry)::geography, ST_PointOnSurface(p.geometry)::geography))
                     FROM dog_runs d WHERE d.feature_status = 'Active'), 5000) AS nearest_run_meters
    FROM parks p
    LEFT JOIN nta_2020 n ON ST_Covers(n.geometry, ST_PointOnSurface(p.geometry))
    LEFT JOIN licenses l ON l.nta2020 = n.nta2020
    LEFT JOIN complaints c ON c.nta2020 = n.nta2020
    WHERE p.acres > 0 AND NOT EXISTS (
      SELECT 1 FROM dog_runs d WHERE d.feature_status = 'Active'
        AND (d.gis_property_number = p.property_id OR ST_Intersects(d.geometry, p.geometry))
    )
  ), normalized AS (
    SELECT *, percent_rank() OVER (ORDER BY license_estimate) * 100 AS demand_score,
           least(nearest_run_meters / 5000.0, 1) * 100 AS access_score,
           percent_rank() OVER (ORDER BY complaint_count) * 100 AS complaint_score,
           percent_rank() OVER (ORDER BY acres) * 100 AS acreage_score
    FROM candidates
  ), scored AS (
    SELECT *, round((($1*demand_score + $2*access_score + $3*complaint_score + $4*acreage_score)/100)::numeric, 1) AS score
    FROM normalized
  )
  SELECT property_id, name, borough, acres, license_estimate, complaint_count,
         round((nearest_run_meters/1000.0)::numeric, 2) AS nearest_run_km,
         demand_score, access_score, complaint_score, acreage_score, score,
         rank() OVER (ORDER BY score DESC, name) AS rank,
         ST_AsGeoJSON(point)::json AS geometry
  FROM scored ORDER BY score DESC, name`;

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Unable to load map data' });
});

const server = app.listen(port, () => console.log(`Dog run map listening on port ${port}`));

function latestFrontendMtime() {
  if (!devMode) return 0;
  const publicDirectory = path.join(__dirname, 'public');
  return Math.max(...require('node:fs').readdirSync(publicDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => require('node:fs').statSync(path.join(publicDirectory, entry.name)).mtimeMs));
}

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
