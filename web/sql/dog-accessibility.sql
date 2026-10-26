, active_run_summary AS (
 SELECT COUNT(*) AS run_count FROM dog_runs WHERE feature_status = 'Active'
), covered_parcels AS MATERIALIZED (
 -- Exact threshold equivalence: min geography distance <= 800 iff at least
 -- one active polygon is within 800m. No projected buffers or approximate KNN.
 -- Drive the spatial join from the small run set into the parcel geography index.
 SELECT DISTINCT p.bbl
 FROM dog_runs d
 CROSS JOIN LATERAL (
   SELECT p.bbl FROM pluto p
   WHERE p.location IS NOT NULL AND NOT ST_IsEmpty(p.location) AND ST_IsValid(p.location)
   AND ST_X(p.location) BETWEEN -180 AND 180 AND ST_Y(p.location) BETWEEN -90 AND 90
   AND ST_DWithin(p.location::geography, d.geometry::geography, 800, true)
   -- Keep the small run set outside: validity selectivity estimates otherwise
   -- make PostgreSQL scan all parcel points and probe runs once per parcel.
   OFFSET 0
 ) p
 WHERE d.feature_status = 'Active'
), access_classified AS MATERIALIZED (
 SELECT l.bbl, l.nta, l.demand, c.bbl IS NOT NULL AS covered
 FROM located l LEFT JOIN covered_parcels c ON c.bbl = l.bbl
 WHERE l.units > 0 AND l.valid_location
), access_metrics AS (
 SELECT nta, SUM(demand) AS total,
 COALESCE(SUM(demand) FILTER (WHERE covered), 0) AS covered,
 COALESCE(SUM(demand) FILTER (WHERE NOT covered), 0) AS uncovered,
 COUNT(*) AS eligible_parcels
 FROM access_classified WHERE nta IS NOT NULL GROUP BY nta
), access_totals AS (
 SELECT COALESCE(SUM(demand), 0) AS eligible_demand,
 COALESCE(SUM(demand) FILTER (WHERE covered), 0) AS covered_demand,
 COALESCE(SUM(demand) FILTER (WHERE NOT covered), 0) AS uncovered_demand,
 COALESCE(SUM(demand) FILTER (WHERE nta IS NOT NULL), 0) AS nta_total_demand,
 COALESCE(SUM(demand) FILTER (WHERE nta IS NOT NULL AND covered), 0) AS nta_covered_demand,
 COALESCE(SUM(demand) FILTER (WHERE nta IS NOT NULL AND NOT covered), 0) AS nta_uncovered_demand,
 COALESCE(SUM(demand) FILTER (WHERE nta IS NULL), 0) AS unassigned_nta_demand,
 COUNT(*) AS eligible_parcels,
 COUNT(*) FILTER (WHERE nta IS NULL) AS unassigned_nta_parcels
 FROM access_classified
), access_exclusions AS (
 SELECT COALESCE(SUM(demand) FILTER (WHERE location IS NOT NULL AND NOT valid_location), 0) AS invalid_location_demand
 FROM located
)
SELECT dp.payload || jsonb_build_object(
 'metadata', dp.payload->'metadata' || jsonb_build_object('accessibility', jsonb_build_object(
 'radiusMeters', 800, 'activeDogRuns', (SELECT run_count FROM active_run_summary),
 'distanceMethod', 'Straight-line spheroidal geography distance to nearest active dog-run polygon boundary or interior; not walking distance')),
 'accessibilitySummary', (SELECT to_jsonb(t) || jsonb_build_object(
 'coverage_percentage', covered_demand * 100 / NULLIF(eligible_demand, 0),
 'conservation_error', eligible_demand - covered_demand - uncovered_demand,
 'nta_conservation_error', nta_total_demand - nta_covered_demand - nta_uncovered_demand,
 'allocation_conservation_error', (SELECT allocated_parcel_demand - missing_coordinate_demand FROM totals)
     - eligible_demand - (SELECT invalid_location_demand FROM access_exclusions),
 'missing_coordinate_demand', (SELECT missing_coordinate_demand FROM totals),
 'invalid_location_demand', (SELECT invalid_location_demand FROM access_exclusions)
 ) FROM access_totals t),
 'ntas', (SELECT jsonb_agg(j.value || jsonb_build_object(
 'accessibilityTotalDemand', CASE WHEN a.licenses_available THEN am.total END,
 'coveredDemand', CASE WHEN a.licenses_available AND am.total IS NOT NULL THEN am.covered END,
 'uncoveredDemand', CASE WHEN a.licenses_available AND am.total IS NOT NULL THEN am.uncovered END,
 'coveragePercentage', CASE WHEN a.licenses_available THEN am.covered * 100 / NULLIF(am.total, 0) END,
 'flags', j.value->'flags' || jsonb_build_object(
 'accessibilityMissingData', NOT a.licenses_available OR am.total IS NULL,
 'noActiveDogRuns', (SELECT run_count = 0 FROM active_run_summary))
 ) ORDER BY j.value->>'id')
 FROM jsonb_array_elements(dp.payload->'ntas') j(value)
 LEFT JOIN access_metrics am ON am.nta = j.value->>'id' CROSS JOIN availability a)
) AS payload FROM demand_payload dp;
