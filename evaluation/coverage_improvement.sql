-- Recovered unchanged calculation from /tmp/spatial-coverage-analysis.sql,
-- validated in the preceding Codex Spatial Coverage Improvement Analysis.
-- Ranking: web/server.js opportunityQuery, Balanced weights, no existing runs.
-- Allocation: same validated residential-unit ZIP model as distance_sensitivity.
-- Grouping reached parcels by BBL prevents overlap double-counting.
-- Run with psql -X -v ON_ERROR_STOP=1; no temporary or persistent table writes.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

  WITH parks AS (
    SELECT gis_property_number AS property_id,
           coalesce(mode() WITHIN GROUP (ORDER BY sign_name) FILTER (WHERE sign_name IS NOT NULL), 'Unnamed park') AS name,
           max(borough) AS borough, coalesce(max(open_space_acres), 0) AS acres,
           ST_Multi(ST_UnaryUnion(ST_Collect(geometry))) AS geometry
    FROM parks_recreation
    WHERE gis_property_number IS NOT NULL
    GROUP BY gis_property_number
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
  ), park_context AS (
    SELECT p.property_id, p.name, p.borough, p.acres,
           ST_PointOnSurface(p.geometry) AS point,
           EXISTS (
             SELECT 1 FROM dog_runs d
             WHERE d.feature_status = 'Active'
               AND (d.gis_property_number = p.property_id OR ST_Intersects(d.geometry, p.geometry))
           ) AS has_dog_run,
           coalesce(l.license_estimate, 0) AS license_estimate,
           coalesce(c.complaint_count, 0) AS complaint_count,
           coalesce((SELECT min(ST_Distance(ST_PointOnSurface(d.geometry)::geography, ST_PointOnSurface(p.geometry)::geography))
                     FROM dog_runs d WHERE d.feature_status = 'Active'), 5000) AS nearest_run_meters
    FROM parks p
    LEFT JOIN nta_2020 n ON ST_Covers(n.geometry, ST_PointOnSurface(p.geometry))
    LEFT JOIN licenses l ON l.nta2020 = n.nta2020
    LEFT JOIN complaints c ON c.nta2020 = n.nta2020
  ), candidates AS (
    SELECT * FROM park_context
    WHERE false::boolean OR NOT has_dog_run
  ), normalized AS (
    SELECT *, percent_rank() OVER (ORDER BY license_estimate) * 100 AS demand_score,
           least(nearest_run_meters / 5000.0, 1) * 100 AS access_score,
           percent_rank() OVER (ORDER BY complaint_count) * 100 AS complaint_score,
           percent_rank() OVER (ORDER BY acres) * 100 AS acreage_score
    FROM candidates
  ), scored AS (
    SELECT *, round(((35*demand_score + 25*access_score + 20*complaint_score + 20*acreage_score)/100)::numeric, 1) AS score
    FROM normalized
  ), ranked AS (
    SELECT *, rank() OVER (ORDER BY score DESC, name) AS rank
    FROM scored
  ), selected AS MATERIALIZED (
 SELECT *,row_number() OVER (ORDER BY score DESC,name,property_id) selection_order
 FROM ranked
 ORDER BY score DESC,name,property_id LIMIT 10
), active AS MATERIALIZED (
 SELECT DISTINCT animal_name, animal_gender, animal_birth_year, breed_name,
 zipcode, license_issued_date, license_expired_date FROM dog_licenses
 WHERE extract_year=2026 AND license_issued_date<=DATE '2025-12-31'
 AND license_expired_date>=DATE '2025-12-31'
), dogs AS (
 SELECT NULLIF(TRIM(zipcode),'') zip,count(*)::numeric dogs FROM active GROUP BY 1
), parcels AS MATERIALIZED (
 SELECT bbl,NULLIF(TRIM(postcode),'') zip,location,
 CASE WHEN REPLACE(TRIM(unitsres),',','') ~ '^[0-9]+$'
 THEN REPLACE(TRIM(unitsres),',','')::numeric END units,
 location IS NOT NULL AND NOT ST_IsEmpty(location) AND ST_IsValid(location)
 AND ST_X(location) BETWEEN -180 AND 180 AND ST_Y(location) BETWEEN -90 AND 90 valid_location FROM pluto
), housing AS (
 SELECT zip,sum(coalesce(units,0)) units FROM parcels GROUP BY zip
), eligible AS MATERIALIZED (
 SELECT p.bbl,p.location,coalesce(d.dogs,0)*p.units/h.units demand
 FROM parcels p JOIN housing h ON h.zip=p.zip LEFT JOIN dogs d ON d.zip=p.zip
 WHERE p.zip ~ '^[0-9]{5}$' AND h.units>0 AND p.units>0 AND p.valid_location
), facilities AS MATERIALIZED (
 SELECT 0::bigint selection_order, geometry FROM dog_runs WHERE feature_status='Active'
 UNION ALL SELECT selection_order,point FROM selected
), reached AS MATERIALIZED (
 SELECT p.bbl,min(f.selection_order) first_facility
 FROM facilities f CROSS JOIN LATERAL (
 SELECT p.bbl FROM pluto p
 WHERE p.location IS NOT NULL AND NOT ST_IsEmpty(p.location) AND ST_IsValid(p.location)
 AND ST_X(p.location) BETWEEN -180 AND 180 AND ST_Y(p.location) BETWEEN -90 AND 90
 AND ST_DWithin(p.location::geography,f.geometry::geography,800,true) OFFSET 0
 ) p GROUP BY p.bbl
), scenarios(k) AS (VALUES (0),(5),(10)), results AS (
 SELECT s.k,sum(e.demand) eligible_demand,
 coalesce(sum(e.demand) FILTER(WHERE r.first_facility<=s.k),0) covered_demand,
 coalesce(sum(e.demand) FILTER(WHERE r.first_facility IS NULL OR r.first_facility>s.k),0) uncovered_demand,
 100*coalesce(sum(e.demand) FILTER(WHERE r.first_facility<=s.k),0)/sum(e.demand) coverage_percentage
 FROM scenarios s CROSS JOIN eligible e LEFT JOIN reached r USING(bbl) GROUP BY s.k
)
SELECT jsonb_pretty(jsonb_build_object(
 'scenarios',(SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('improvement_pp',coverage_percentage-(SELECT coverage_percentage FROM results WHERE k=0)) ORDER BY k) FROM results r),
 'top10',(SELECT jsonb_agg(jsonb_build_object('selection_order',selection_order,'rank',rank,'property_id',property_id,'name',name,'borough',borough,'score',score,'has_dog_run',has_dog_run,'longitude',ST_X(point),'latitude',ST_Y(point)) ORDER BY selection_order) FROM selected),
 'active_runs',(SELECT count(*) FROM dog_runs WHERE feature_status='Active'),
 'ranking_extract_year',(SELECT extract_year FROM latest),
 'candidate_count',(SELECT count(*) FROM candidates),
 'unique_candidate_count',(SELECT count(DISTINCT property_id) FROM candidates),
 'stored_baseline',(SELECT payload->'accessibilitySummary' FROM map_aggregate_snapshots WHERE kind='accessibility'),
 'source_versions',(SELECT jsonb_agg(to_jsonb(v)) FROM map_source_versions v)
));
COMMIT;
