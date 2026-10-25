const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 3000);
const devMode = process.env.DEV_MODE === 'true';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
    const result = await pool.query(
      `WITH park_properties AS (
         SELECT gis_property_number,
                coalesce(mode() WITHIN GROUP (ORDER BY sign_name)
                  FILTER (WHERE sign_name IS NOT NULL), 'Unnamed park') AS sign_name,
                string_agg(DISTINCT recreation_category, ', ') AS recreation_category,
                max(open_space_acres) AS open_space_acres,
                max(active_acres) AS active_acres,
                max(passive_acres) AS passive_acres,
                max(borough) AS borough,
                bool_or(type_category IN (
                  'Neighborhood Park', 'Community Park', 'Playground',
                  'Recreational Field/Courts', 'Jointly Operated Playground',
                  'Schoolyard to Playground', 'Flagship Park'
                )) AS suitable_candidate_category,
                ST_Multi(ST_UnaryUnion(ST_Collect(geometry))) AS geometry
           FROM parks_recreation
          GROUP BY gis_property_number
       )
       SELECT gis_property_number AS recreation_id, gis_property_number,
              sign_name, recreation_category, open_space_acres,
              active_acres, passive_acres, borough,
              ST_AsGeoJSON(ST_PointOnSurface(geometry))::json AS geometry,
              ST_X(ST_PointOnSurface(geometry)) AS longitude,
              ST_Y(ST_PointOnSurface(geometry)) AS latitude,
              suitable_candidate_category,
              coalesce(run_stats.dog_run_count, 0) AS dog_run_count,
              coalesce(run_stats.dog_run_ids, ARRAY[]::integer[]) AS dog_run_ids
         FROM park_properties p
         LEFT JOIN LATERAL (
           SELECT count(DISTINCT r.object_id)::integer AS dog_run_count,
                  array_agg(DISTINCT r.object_id) AS dog_run_ids
             FROM dog_runs r
            WHERE r.feature_status = 'Active'
              AND (r.gis_property_number = p.gis_property_number
                OR ST_Intersects(r.geometry, p.geometry))
         ) run_stats ON true
        ORDER BY sign_name`
    );
    response.json(toFeatureCollection(result.rows, (row) => ({
      id: row.recreation_id,
      properties: {
        propertyId: row.gis_property_number,
        name: row.sign_name || 'Unnamed park',
        category: row.recreation_category,
        acres: Number(row.open_space_acres) || 0,
        activeAcres: Number(row.active_acres) || 0,
        passiveAcres: Number(row.passive_acres) || 0,
        borough: row.borough,
        suitableCandidateCategory: row.suitable_candidate_category === true,
        dogRunCount: row.dog_run_count,
        dogRunIds: row.dog_run_ids,
        hasDogRun: row.dog_run_count > 0,
        longitude: Number(row.longitude),
        latitude: Number(row.latitude)
      }
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/complaint-hotspots', async (_request, response, next) => {
  try {
    const result = await pool.query(
      `WITH complaint_cells AS (
         SELECT ST_SnapToGrid(location, 0.001) AS location,
                count(*)::integer AS complaint_count
           FROM service_requests_311
          WHERE location IS NOT NULL
          GROUP BY ST_SnapToGrid(location, 0.001)
       )
       SELECT ST_AsGeoJSON(c.location)::json AS geometry,
              ST_X(c.location) AS longitude, ST_Y(c.location) AS latitude,
              c.complaint_count, n.boroname AS borough, n.ntaname AS neighborhood
         FROM complaint_cells c
         LEFT JOIN nta_2020 n ON ST_Covers(n.geometry, c.location)
        ORDER BY c.complaint_count DESC`
    );
    response.json(toFeatureCollection(result.rows, (row, index) => ({
      id: index,
      properties: {
        longitude: Number(row.longitude),
        latitude: Number(row.latitude),
        complaintCount: Number(row.complaint_count),
        borough: row.borough,
        neighborhood: row.neighborhood
      }
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/neighborhood-demand', async (_request, response, next) => {
  try {
    const result = await pool.query(neighborhoodDemandQuery);
    response.json(toFeatureCollection(result.rows, (row) => ({
      id: row.nta2020,
      properties: {
        name: row.ntaname,
        borough: row.boroname,
        licenseEstimate: Number(row.license_estimate) || 0,
        complaintCount: Number(row.complaint_count) || 0,
      }
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/opportunities', async (request, response, next) => {
  const scope = request.query.scope === 'all' ? 'all' : 'without-runs';
  const weightKeys = ['demand', 'access', 'complaints', 'suitability'];
  const weights = weightKeys.map((key, index) => {
    const defaultValue = [35, 25, 20, 20][index];
    return request.query[key] === undefined ? defaultValue : Number(request.query[key]);
  });
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0 || weight > 100)
    || weights.reduce((sum, weight) => sum + weight, 0) !== 100) {
    response.status(400).json({ error: 'Scoring weights must be between 0 and 100 and total 100.' });
    return;
  }
  try {
    const result = await pool.query(opportunityQuery, [scope === 'all', ...weights]);
    response.json(toFeatureCollection(result.rows, (row) => ({
      id: row.recreation_id,
      properties: {
        name: row.sign_name || 'Unnamed park',
        borough: row.borough,
        acres: Number(row.open_space_acres),
        score: Number(row.score),
        rank: Number(row.rank),
        hasDogRun: row.has_dog_run,
        dogRunCount: Number(row.dog_run_count),
        longitude: Number(row.longitude),
        latitude: Number(row.latitude),
        licenseEstimate: Number(row.license_estimate) || 0,
        complaintCount: Number(row.complaint_count) || 0,
        accessGap: Number(row.access_gap),
        factors: {
          dogDemand: Number(row.dog_demand_score),
          access: Number(row.access_score),
          complaints: Number(row.complaint_score),
          suitability: Number(row.suitability_score)
        },
        nearestRunMeters: row.nearest_run_meters === null ? null : Number(row.nearest_run_meters)
      }
    })));
  } catch (error) {
    next(error);
  }
});

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

function toFeatureCollection(rows, feature) {
  return {
    type: 'FeatureCollection',
    features: rows.map((row, index) => {
      const { id, properties } = feature(row, index);
      return { type: 'Feature', id, geometry: row.geometry, properties };
    })
  };
}

const neighborhoodDemandQuery = `
  WITH license_totals AS (
    SELECT zipcode, count(*)::numeric AS license_records
      FROM dog_licenses
     WHERE zipcode ~ '^[0-9]{5}$'
     GROUP BY zipcode
  ),
  zip_neighborhood_weights AS (
    SELECT p.postcode AS zipcode,
           n.nta2020,
           sum(CASE WHEN p.unitsres ~ '^[0-9]+([.][0-9]+)?$' THEN p.unitsres::numeric ELSE 0 END) AS residential_units,
           count(*)::numeric AS parcels
      FROM pluto p
      JOIN nta_2020 n ON ST_Covers(n.geometry, p.location)
     WHERE p.location IS NOT NULL
       AND p.postcode ~ '^[0-9]{5}$'
     GROUP BY p.postcode, n.nta2020
  ),
  zip_weights AS (
    SELECT *,
           CASE WHEN sum(residential_units) OVER (PARTITION BY zipcode) > 0
             THEN residential_units / sum(residential_units) OVER (PARTITION BY zipcode)
             ELSE parcels / sum(parcels) OVER (PARTITION BY zipcode)
           END AS allocation_weight
      FROM zip_neighborhood_weights
  ),
  license_estimates AS (
    SELECT w.nta2020,
           sum(l.license_records * w.allocation_weight) AS license_estimate
      FROM zip_weights w
      JOIN license_totals l ON l.zipcode = w.zipcode
     GROUP BY w.nta2020
  ),
  complaints AS (
    SELECT n.nta2020, count(*)::integer AS complaint_count
      FROM service_requests_311 s
      JOIN nta_2020 n ON ST_Covers(n.geometry, s.location)
     WHERE s.location IS NOT NULL
     GROUP BY n.nta2020
  )
  SELECT n.nta2020, n.ntaname, n.boroname,
         ST_AsGeoJSON(ST_SimplifyPreserveTopology(n.geometry, 0.00008))::json AS geometry,
         coalesce(l.license_estimate, 0) AS license_estimate,
         coalesce(c.complaint_count, 0) AS complaint_count
    FROM nta_2020 n
    LEFT JOIN license_estimates l ON l.nta2020 = n.nta2020
    LEFT JOIN complaints c ON c.nta2020 = n.nta2020
   ORDER BY n.nta2020`;

const opportunityQuery = `
  WITH park_properties AS (
    SELECT gis_property_number,
           coalesce(mode() WITHIN GROUP (ORDER BY sign_name)
             FILTER (WHERE sign_name IS NOT NULL), 'Unnamed park') AS sign_name,
           max(borough) AS borough,
           max(open_space_acres) AS open_space_acres,
           bool_or(type_category IN (
             'Neighborhood Park', 'Community Park', 'Playground',
             'Recreational Field/Courts', 'Jointly Operated Playground',
             'Schoolyard to Playground', 'Flagship Park'
           )) AS suitable_category,
           ST_Multi(ST_UnaryUnion(ST_Collect(geometry))) AS geometry
      FROM parks_recreation
     GROUP BY gis_property_number
  ),
  license_totals AS (
    SELECT zipcode, count(*)::numeric AS license_records
      FROM dog_licenses
     WHERE zipcode ~ '^[0-9]{5}$'
     GROUP BY zipcode
  ),
  zip_neighborhood_weights AS (
    SELECT p.postcode AS zipcode,
           n.nta2020,
           sum(CASE WHEN p.unitsres ~ '^[0-9]+([.][0-9]+)?$' THEN p.unitsres::numeric ELSE 0 END) AS residential_units,
           count(*)::numeric AS parcels
      FROM pluto p
      JOIN nta_2020 n ON ST_Covers(n.geometry, p.location)
     WHERE p.location IS NOT NULL
       AND p.postcode ~ '^[0-9]{5}$'
     GROUP BY p.postcode, n.nta2020
  ),
  zip_weights AS (
    SELECT *,
           CASE WHEN sum(residential_units) OVER (PARTITION BY zipcode) > 0
             THEN residential_units / sum(residential_units) OVER (PARTITION BY zipcode)
             ELSE parcels / sum(parcels) OVER (PARTITION BY zipcode)
           END AS allocation_weight
      FROM zip_neighborhood_weights
  ),
  license_estimates AS (
    SELECT w.nta2020,
           sum(l.license_records * w.allocation_weight) AS license_estimate
      FROM zip_weights w
      JOIN license_totals l ON l.zipcode = w.zipcode
     GROUP BY w.nta2020
  ),
  complaints AS (
    SELECT n.nta2020, count(*)::numeric AS complaint_count
      FROM service_requests_311 s
      JOIN nta_2020 n ON ST_Covers(n.geometry, s.location)
     WHERE s.location IS NOT NULL
     GROUP BY n.nta2020
  ),
  scored_parks AS (
    SELECT p.gis_property_number AS recreation_id, p.sign_name, p.borough, p.open_space_acres,
           ST_PointOnSurface(p.geometry) AS point,
           run_stats.dog_run_count > 0 AS has_dog_run,
           run_stats.dog_run_count,
           coalesce(l.license_estimate, 0) AS license_estimate,
           coalesce(c.complaint_count, 0) AS complaint_count,
           coalesce(nearest_run.nearest_run_meters, 5000) AS nearest_run_meters,
           ST_AsGeoJSON(ST_SimplifyPreserveTopology(p.geometry, 0.00008))::json AS geometry
      FROM park_properties p
      LEFT JOIN nta_2020 n ON ST_Covers(n.geometry, ST_PointOnSurface(p.geometry))
      LEFT JOIN license_estimates l ON l.nta2020 = n.nta2020
      LEFT JOIN complaints c ON c.nta2020 = n.nta2020
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT existing.object_id)::integer AS dog_run_count
          FROM dog_runs existing
         WHERE existing.feature_status = 'Active'
           AND (existing.gis_property_number = p.gis_property_number
             OR ST_Intersects(existing.geometry, p.geometry))
      ) run_stats ON true
      LEFT JOIN LATERAL (
        SELECT min(ST_Distance(ST_PointOnSurface(nearby.geometry)::geography, ST_PointOnSurface(p.geometry)::geography)) AS nearest_run_meters
          FROM dog_runs nearby
         WHERE nearby.feature_status = 'Active'
           AND (NOT $1 OR (
             nearby.gis_property_number IS DISTINCT FROM p.gis_property_number
             AND NOT ST_Intersects(nearby.geometry, p.geometry)
           ))
      ) nearest_run ON true
     WHERE $1
        OR (p.open_space_acres > 0
          AND run_stats.dog_run_count = 0)
  ),
  normalized AS (
    SELECT *,
           percent_rank() OVER (ORDER BY license_estimate) * 100 AS dog_demand_score,
           percent_rank() OVER (ORDER BY complaint_count) * 100 AS complaint_score,
           percent_rank() OVER (ORDER BY coalesce(open_space_acres, 0)) * 100 AS suitability_score,
           least(nearest_run_meters / 5000.0, 1) * 100 AS access_score
      FROM scored_parks
  ),
  scored AS (
    SELECT *,
           round((($2 * dog_demand_score + $3 * access_score
                + $4 * complaint_score + $5 * suitability_score) / 100)::numeric, 1) AS score,
           round((nearest_run_meters / 1000.0)::numeric, 2) AS access_gap
      FROM normalized
  )
  SELECT recreation_id, sign_name, borough, open_space_acres,
         has_dog_run, dog_run_count,
         license_estimate, complaint_count, nearest_run_meters, access_gap,
         dog_demand_score, access_score, complaint_score, suitability_score,
         score, rank() OVER (ORDER BY score DESC, sign_name) AS rank,
         ST_X(point) AS longitude, ST_Y(point) AS latitude,
         geometry
    FROM scored
   ORDER BY score DESC, sign_name`;
