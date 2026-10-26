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
