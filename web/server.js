const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

const devMode = process.env.DEV_MODE === 'true';
function createApp(pool) {
  const app = express();
  const { createAggregateStore, AggregateUnavailable } = require('./lib/aggregate-store');
  const aggregates = createAggregateStore(pool);

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

  // GETs only read published aggregates. They never run spatial SQL or refreshes.
  for (const [route, kind] of [['/api/dog-demand', 'demand'], ['/api/dog-accessibility', 'accessibility'], ['/api/candidate-parks', 'candidates']]) {
    app.get(route, async (_request, response, next) => {
      response.set('Cache-Control', 'no-store');
      try {
        const { payload, cacheHit } = await aggregates.get(kind);
        response.set('X-Aggregate-Cache', cacheHit ? 'hit' : 'miss');
        response.json(payload);
      } catch (error) {
        if (error instanceof AggregateUnavailable) {
          response.status(503).json({ status: error.status, kind, message: error.message });
        } else next(error);
      }
    });
  }

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

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: 'Unable to load map data' });
  });

  return app;
}

module.exports = { createApp };

function latestFrontendMtime() {
  if (!devMode) return 0;
  const publicDirectory = path.join(__dirname, 'public');
  return Math.max(...require('node:fs').readdirSync(publicDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => require('node:fs').statSync(path.join(publicDirectory, entry.name)).mtimeMs));
}

if (require.main === module) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const app = createApp(pool);
  const server = app.listen(Number(process.env.PORT || 3000), () => console.log('Dog run map listening'));
  const shutdown = () => server.close(async () => { await pool.end(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
