-- Compare weights on a shared NTA-assignable ZIP demand budget.
-- Preserve the validated model's all-parcel ZIP unit denominators and exclusions.
-- A parcel is a distinct PLUTO BBL, never a ZIP centroid.
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
 AND ST_X(location) BETWEEN -180 AND 180 AND ST_Y(location) BETWEEN -90 AND 90 valid_location
 FROM pluto
), housing AS (
 SELECT zip,sum(coalesce(units,0)) units FROM parcels GROUP BY zip
), allocated AS MATERIALIZED (
 SELECT p.*,coalesce(d.dogs,0)*p.units/h.units demand
 FROM parcels p JOIN housing h ON h.zip=p.zip LEFT JOIN dogs d ON d.zip=p.zip
 WHERE p.zip ~ '^[0-9]{5}$' AND h.units>0 AND p.units>0
), assignments AS MATERIALIZED (
 SELECT p.bbl,count(DISTINCT n.nta2020) matches,min(n.nta2020) nta
 FROM nta_2020 n JOIN pluto p ON ST_Covers(n.geometry,p.location)
 GROUP BY p.bbl
), eligible AS MATERIALIZED (
 SELECT a.*,n.nta FROM allocated a JOIN assignments n USING(bbl)
 WHERE a.valid_location AND n.matches=1
), zip_parts AS MATERIALIZED (
 SELECT zip,nta,count(*)::numeric parcels,sum(units) units,
 sum(demand) validated_unit_demand FROM eligible GROUP BY zip,nta
), zip_budgets AS MATERIALIZED (
 SELECT zip,sum(parcels) parcels,sum(units) units,
 sum(validated_unit_demand) eligible_demand FROM zip_parts GROUP BY zip
), estimates AS MATERIALIZED (
 SELECT p.zip,p.nta,p.parcels,p.units,p.validated_unit_demand,
 b.eligible_demand*p.parcels/b.parcels parcel_demand,
 b.eligible_demand*p.units/b.units unit_demand
 FROM zip_parts p JOIN zip_budgets b USING(zip)
), nta_totals AS (
 SELECT nta,sum(parcels) residential_parcels,sum(units) residential_units,
 sum(parcel_demand) parcel_demand,sum(unit_demand) unit_demand,
 sum(validated_unit_demand) validated_unit_demand
 FROM estimates GROUP BY nta
), differences AS MATERIALIZED (
 SELECT n.nta2020 nta,n.ntaname name,n.boroname borough,
 coalesce(t.residential_parcels,0) residential_parcels,
 coalesce(t.residential_units,0) residential_units,
 coalesce(t.parcel_demand,0) parcel_demand,coalesce(t.unit_demand,0) unit_demand,
 coalesce(t.validated_unit_demand,0) validated_unit_demand,
 coalesce(t.unit_demand,0)-coalesce(t.parcel_demand,0) difference,
 abs(coalesce(t.unit_demand,0)-coalesce(t.parcel_demand,0)) absolute_difference,
 100*(t.unit_demand-t.parcel_demand)/nullif(t.parcel_demand,0) percentage_difference
 FROM nta_2020 n LEFT JOIN nta_totals t ON t.nta=n.nta2020
), zip_checks AS (
 SELECT b.zip,b.eligible_demand,sum(e.parcel_demand) parcel_demand,
 sum(e.unit_demand) unit_demand FROM zip_budgets b JOIN estimates e USING(zip)
 GROUP BY b.zip,b.eligible_demand
), summary AS (
 SELECT sum(parcel_demand) parcel_allocated_demand,sum(unit_demand) unit_allocated_demand,
 sum(validated_unit_demand) validated_unit_nta_demand,
 sum(absolute_difference) total_absolute_difference,
 sum(absolute_difference)/2 redistributed_demand,
 100*sum(absolute_difference)/2/nullif(sum(unit_demand),0) redistributed_percentage,
 corr(parcel_demand::double precision,unit_demand::double precision) pearson_all_ntas,
 corr(parcel_demand::double precision,unit_demand::double precision)
 FILTER(WHERE residential_parcels>0) pearson_eligible_ntas,
 count(*) nta_count,count(*) FILTER(WHERE residential_parcels>0) eligible_nta_count,
 max(abs(unit_demand-validated_unit_demand)) max_nta_unit_reproduction_error
 FROM differences
)
SELECT jsonb_pretty(jsonb_build_object(
 'metadata',jsonb_build_object('extract_year',2026,'as_of','2025-12-31',
 'percentage_difference','100 * (unit - parcel) / parcel; null when parcel demand is zero',
 'budget','Per-ZIP sum of original unit allocations on valid positive-unit parcels with exactly one NTA match',
 'top10_order','Descending absolute estimated-dog difference; ties by NTA code'),
 'summary',(SELECT to_jsonb(s)||jsonb_build_object(
 'active_deduplicated_population',(SELECT sum(dogs) FROM dogs),
 'allocated_parcel_demand',(SELECT sum(demand) FROM allocated),
 'valid_location_demand',(SELECT sum(demand) FROM allocated WHERE valid_location),
 'eligible_nta_demand',(SELECT sum(eligible_demand) FROM zip_budgets),
 'valid_location_unassigned_demand',(SELECT sum(demand) FROM allocated WHERE valid_location)-(SELECT sum(eligible_demand) FROM zip_budgets),
 'max_zip_parcel_conservation_error',(SELECT max(abs(parcel_demand-eligible_demand)) FROM zip_checks),
 'max_zip_unit_conservation_error',(SELECT max(abs(unit_demand-eligible_demand)) FROM zip_checks),
 'stored_nta_demand',(SELECT (payload->'accessibilitySummary'->>'nta_total_demand')::numeric FROM map_aggregate_snapshots WHERE kind='accessibility'),
 'stored_valid_location_demand',(SELECT (payload->'accessibilitySummary'->>'eligible_demand')::numeric FROM map_aggregate_snapshots WHERE kind='accessibility')
 ) FROM summary s),
 'ntas',(SELECT jsonb_agg(to_jsonb(d) ORDER BY nta) FROM differences d),
 'top10',(SELECT jsonb_agg(to_jsonb(d) ORDER BY absolute_difference DESC,nta) FROM
 (SELECT * FROM differences ORDER BY absolute_difference DESC,nta LIMIT 10) d),
 'zip_checks',(SELECT jsonb_agg(to_jsonb(z) ORDER BY zip) FROM zip_checks z),
 'source_versions',(SELECT jsonb_agg(to_jsonb(v)) FROM map_source_versions v)
));
COMMIT;
