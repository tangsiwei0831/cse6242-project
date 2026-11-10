-- Recovered unchanged calculation from /tmp/distance-sensitivity.sql, validated
-- in the preceding Codex Distance Sensitivity Analysis (2026-11-09).
-- Source allocation: accessibility snapshot SQL in Git commit bc1a757.
-- Run with psql -X -v ON_ERROR_STOP=1; no temporary or persistent table writes.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH active AS MATERIALIZED (
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
), thresholds(m) AS (VALUES (500),(800),(1000)), covered AS MATERIALIZED (
 SELECT DISTINCT t.m,p.bbl FROM thresholds t CROSS JOIN dog_runs d
 CROSS JOIN LATERAL (
 SELECT p.bbl FROM pluto p
 WHERE p.location IS NOT NULL AND NOT ST_IsEmpty(p.location) AND ST_IsValid(p.location)
 AND ST_X(p.location) BETWEEN -180 AND 180 AND ST_Y(p.location) BETWEEN -90 AND 90
 AND ST_DWithin(p.location::geography,d.geometry::geography,t.m,true) OFFSET 0
 ) p WHERE d.feature_status='Active'
)
SELECT t.m threshold_m,sum(e.demand) eligible_demand,
 sum(e.demand) FILTER (WHERE c.bbl IS NOT NULL) covered_demand,
 sum(e.demand) FILTER (WHERE c.bbl IS NULL) uncovered_demand,
 100*sum(e.demand) FILTER (WHERE c.bbl IS NOT NULL)/sum(e.demand) coverage_percentage
FROM thresholds t CROSS JOIN eligible e LEFT JOIN covered c ON c.m=t.m AND c.bbl=e.bbl GROUP BY t.m ORDER BY t.m;
COMMIT;
