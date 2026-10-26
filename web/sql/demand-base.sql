-- One statement/snapshot: ZIP denominators include parcels without coordinates.
WITH active AS MATERIALIZED (
 SELECT DISTINCT animal_name, animal_gender, animal_birth_year, breed_name,
                 zipcode, license_issued_date, license_expired_date
 FROM dog_licenses
 WHERE extract_year = 2026 AND license_issued_date <= DATE '2025-12-31'
 AND license_expired_date >= DATE '2025-12-31'
), dogs AS (
 SELECT NULLIF(TRIM(zipcode), '') AS zip, COUNT(*)::numeric AS dogs
 FROM active GROUP BY 1
), parcels AS MATERIALIZED (
 SELECT bbl, NULLIF(TRIM(postcode), '') AS zip, location,
 CASE WHEN REPLACE(TRIM(unitsres), ',', '') ~ '^[0-9]+$'
 THEN REPLACE(TRIM(unitsres), ',', '')::numeric END AS units,
 location IS NOT NULL AND NOT ST_IsEmpty(location) AND ST_IsValid(location)
 AND ST_X(location) BETWEEN -180 AND 180 AND ST_Y(location) BETWEEN -90 AND 90 AS valid_location
 FROM pluto
), housing AS (
 SELECT zip, COUNT(*) AS parcels, SUM(COALESCE(units, 0)) AS units
 FROM parcels GROUP BY zip
), allocated AS MATERIALIZED (
 SELECT p.*, d.dogs, h.units AS zip_units,
 CASE WHEN p.zip ~ '^[0-9]{5}$' AND h.units > 0 AND p.units > 0
 THEN COALESCE(d.dogs, 0) * p.units / h.units END AS demand
 FROM parcels p LEFT JOIN housing h ON p.zip = h.zip
 LEFT JOIN dogs d ON p.zip = d.zip
), assignments AS MATERIALIZED (
 -- Join native indexed tables before attaching allocation CTEs. Count distinct
 -- NTAs so shared boundaries/overlaps are excluded rather than double counted.
 SELECT p.bbl, COUNT(DISTINCT n.nta2020) AS matches, MIN(n.nta2020) AS nta
 FROM nta_2020 n JOIN pluto p ON ST_Covers(n.geometry, p.location)
 GROUP BY p.bbl
), located AS MATERIALIZED (
 SELECT a.*, COALESCE(n.matches, 0) AS matches,
 CASE WHEN n.matches = 1 THEN n.nta END AS nta
 FROM allocated a LEFT JOIN assignments n ON n.bbl = a.bbl
), metrics AS (
 SELECT nta, SUM(COALESCE(units, 0)) AS units,
 SUM(units) FILTER (WHERE demand IS NOT NULL) AS covered_units,
 SUM(demand) AS demand,
 COUNT(*) FILTER (WHERE units IS NULL) AS invalid_units_parcels,
 COUNT(*) FILTER (WHERE units > 0 AND demand IS NULL) AS unknown_zip_parcels,
 COUNT(*) AS parcels
 FROM located WHERE nta IS NOT NULL GROUP BY nta
), zip_diagnostics AS (
 SELECT d.zip, d.dogs,
 CASE WHEN d.zip IS NULL OR d.zip !~ '^[0-9]{5}$' THEN 'missing_or_invalid_zip'
 WHEN h.zip IS NULL THEN 'unmatched_zip'
 WHEN h.units <= 0 THEN 'no_valid_residential_units'
 ELSE 'allocatable' END AS status,
 COALESCE(h.units, 0) AS residential_units
 FROM dogs d LEFT JOIN housing h ON h.zip = d.zip
), zip_allocations AS (
 SELECT zip, SUM(demand) AS allocated_demand,
 SUM(demand) FILTER (WHERE nta IS NOT NULL) AS nta_demand
 FROM located GROUP BY zip
), totals AS (
 SELECT COALESCE((SELECT SUM(dogs) FROM dogs), 0) AS active_license_records,
 COALESCE((SELECT SUM(dogs) FROM zip_diagnostics WHERE status <> 'allocatable'), 0) AS unallocatable_demand,
 COALESCE(SUM(demand), 0) AS allocated_parcel_demand,
 COALESCE(SUM(demand) FILTER (WHERE nta IS NOT NULL), 0) AS nta_demand,
 COALESCE(SUM(demand) FILTER (WHERE location IS NULL), 0) AS missing_coordinate_demand,
 COALESCE(SUM(demand) FILTER (WHERE location IS NOT NULL AND matches = 0), 0) AS outside_nta_demand,
 COALESCE(SUM(demand) FILTER (WHERE matches > 1), 0) AS ambiguous_nta_demand,
 COUNT(*) FILTER (WHERE units > 0) AS residential_parcels,
 COUNT(*) FILTER (WHERE units > 0 AND nta IS NOT NULL) AS assigned_residential_parcels,
 COUNT(*) FILTER (WHERE units > 0 AND location IS NULL) AS missing_coordinate_parcels,
 COUNT(*) FILTER (WHERE units > 0 AND location IS NOT NULL AND matches = 0) AS outside_nta_parcels,
 COUNT(*) FILTER (WHERE units > 0 AND matches > 1) AS ambiguous_nta_parcels,
 COUNT(*) FILTER (WHERE units IS NULL) AS invalid_units_parcels,
 COUNT(*) FILTER (WHERE units = 0) AS zero_units_parcels
 FROM located
), availability AS (
 SELECT EXISTS(SELECT 1 FROM dog_licenses WHERE extract_year = 2026) AS licenses_available,
 EXISTS(SELECT 1 FROM pluto) AS pluto_available,
 EXISTS(SELECT 1 FROM nta_2020) AS ntas_available
), demand_payload AS (
SELECT jsonb_build_object(
 'metadata', jsonb_build_object('label', 'Estimated Licensed-Dog Demand',
 'extractYear', 2026, 'asOf', '2025-12-31',
 'assumption', 'Uniform license density per residential unit within each ZIP; modeled estimates, not observed dog locations.',
 'availability', (SELECT to_jsonb(a) FROM availability a)),
 'summary', (SELECT to_jsonb(t) || jsonb_build_object(
 'excluded_demand', active_license_records - nta_demand,
 'conservation_error', active_license_records - unallocatable_demand - allocated_parcel_demand,
 'spatial_conservation_error', allocated_parcel_demand - nta_demand - missing_coordinate_demand - outside_nta_demand - ambiguous_nta_demand
 ) FROM totals t),
 'zipDiagnostics', (SELECT COALESCE(jsonb_agg(to_jsonb(z) || jsonb_build_object(
 'allocated_demand', COALESCE(za.allocated_demand, 0),
 'nta_demand', COALESCE(za.nta_demand, 0)
 ) ORDER BY z.zip), '[]'::jsonb) FROM zip_diagnostics z LEFT JOIN zip_allocations za ON za.zip = z.zip),
 'ntas', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
 'id', n.nta2020, 'name', n.ntaname,
 'estimatedDemand', CASE WHEN a.licenses_available AND m.covered_units > 0 THEN m.demand END,
 'residentialUnits', COALESCE(m.units, 0),
 'coveredResidentialUnits', COALESCE(m.covered_units, 0),
 'demandPer1000Units', CASE WHEN a.licenses_available THEN m.demand * 1000 / NULLIF(m.covered_units, 0) END,
 'flags', jsonb_build_object('missingData', NOT a.licenses_available OR COALESCE(m.covered_units, 0) = 0,
 'partialCoverage', COALESCE(m.unknown_zip_parcels, 0) > 0 OR COALESCE(m.invalid_units_parcels, 0) > 0,
 'invalidUnitsParcels', COALESCE(m.invalid_units_parcels, 0),
 'unknownZipParcels', COALESCE(m.unknown_zip_parcels, 0))
 ) ORDER BY n.nta2020), '[]'::jsonb)
 FROM nta_2020 n LEFT JOIN metrics m ON m.nta = n.nta2020 CROSS JOIN availability a)
) AS payload
)
