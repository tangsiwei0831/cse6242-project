, park_properties AS MATERIALIZED (
 SELECT gis_property_number AS id,
 MIN(sign_name COLLATE "C") AS name, MIN(borough COLLATE "C") AS borough,
 array_agg(DISTINCT sign_name ORDER BY sign_name) AS aliases,
 array_agg(DISTINCT type_category ORDER BY type_category) AS types,
 COUNT(*) AS source_rows, COUNT(DISTINCT sign_name) > 1 AS multiple_names,
 COUNT(DISTINCT borough) > 1 AS conflicting_boroughs,
 COUNT(DISTINCT type_category) > 1 AS multiple_types,
 BOOL_OR(sign_name IS NULL OR borough IS NULL OR type_category IS NULL) AS missing_attributes,
 BOOL_OR(open_space_acres IS NULL OR open_space_acres <= 0) AS questionable_acreage,
 COUNT(DISTINCT (open_space_acres, active_percent, passive_percent, active_acres, passive_acres)) > 1 AS inconsistent_area_attributes,
 BOOL_OR(type_category IN ('Neighborhood Park','Community Park','Flagship Park')) AS screened
 FROM parks_recreation GROUP BY gis_property_number
), screened_properties AS MATERIALIZED (
 SELECT * FROM park_properties WHERE screened AND NULLIF(TRIM(id),'') IS NOT NULL
), excluded_properties AS MATERIALIZED (
 SELECT p.*, ARRAY(SELECT d.object_id FROM dog_runs d WHERE d.feature_status='Active'
                  AND d.gis_property_number=p.id ORDER BY d.object_id) AS active_run_ids
 FROM screened_properties p WHERE EXISTS (
   SELECT 1 FROM dog_runs d WHERE d.feature_status='Active' AND d.gis_property_number=p.id)
), candidate_sources AS MATERIALIZED (
 SELECT p.* FROM screened_properties p WHERE NOT EXISTS (SELECT 1 FROM excluded_properties e WHERE e.id=p.id)
), park_shapes AS MATERIALIZED (
 SELECT p.gis_property_number AS id,
 COALESCE(NOT ST_IsValid(p.geometry,0),true) AS repaired,
 p.geometry IS NULL OR ST_IsEmpty(p.geometry) AS missing_geometry_part,
 CASE WHEN ST_IsValid(p.geometry,0) THEN p.geometry
      ELSE ST_CollectionExtract(ST_MakeValid(p.geometry),3) END AS geometry
 FROM parks_recreation p JOIN candidate_sources c ON c.id=p.gis_property_number
), candidate_geometries AS MATERIALIZED (
 SELECT id, BOOL_OR(repaired) AS repaired, BOOL_OR(missing_geometry_part) AS missing_geometry_part,
 -- Canonical collection order and normalized output stabilize PointOnSurface
 -- across source row order changes within the same PostGIS/GEOS version.
 ST_Normalize(ST_Multi(ST_CollectionExtract(ST_UnaryUnion(
   ST_Collect(geometry ORDER BY ST_AsEWKB(geometry))),3))) AS geometry
 FROM park_shapes GROUP BY id
), candidate_points AS MATERIALIZED (
 SELECT c.*, g.geometry, g.repaired, g.missing_geometry_part,
 ST_NumGeometries(g.geometry)>1 AS multipart,
 ST_PointOnSurface(g.geometry) AS point
 FROM candidate_sources c JOIN candidate_geometries g USING(id)
 WHERE g.geometry IS NOT NULL AND NOT ST_IsEmpty(g.geometry) AND ST_IsValid(g.geometry,0)
 AND ST_XMin(Box3D(g.geometry)) >= -180 AND ST_XMax(Box3D(g.geometry)) <= 180
 AND ST_YMin(Box3D(g.geometry)) >= -90 AND ST_YMax(Box3D(g.geometry)) <= 90
), uncertain_overlaps AS MATERIALIZED (
 -- Flag footprint intersections, including boundary contacts, without claiming
 -- that the property hosts a run. The property-ID exclusion is applied above.
 SELECT c.id, array_agg(DISTINCT d.object_id ORDER BY d.object_id) AS active_run_ids
 FROM candidate_points c JOIN dog_runs d ON d.feature_status='Active'
 AND c.geometry && d.geometry AND ST_Intersects(c.geometry,d.geometry)
 GROUP BY c.id
), candidate_neighbors AS MATERIALIZED (
 SELECT c.id, p.bbl FROM candidate_points c
 CROSS JOIN LATERAL (
   SELECT p.bbl FROM pluto p
   WHERE p.location IS NOT NULL AND NOT ST_IsEmpty(p.location) AND ST_IsValid(p.location)
   AND ST_X(p.location) BETWEEN -180 AND 180 AND ST_Y(p.location) BETWEEN -90 AND 90
   -- A 0.1-micrometer index margin handles point-projection roundoff at
   -- exactly 800m. The final geography distance threshold stays <=800m.
   AND ST_DWithin(p.location::geography,c.point::geography,800.0000001,true)
   AND ST_Distance(p.location::geography,c.point::geography,true) <= 800
   OFFSET 0
 ) p
), candidate_scores AS (
 SELECT n.id,
 COALESCE(SUM(a.demand) FILTER(WHERE NOT a.covered),0) AS incremental_demand,
 COALESCE(SUM(a.demand) FILTER(WHERE NOT a.covered AND a.nta IS NOT NULL),0) AS incremental_nta_demand,
 COALESCE(SUM(a.demand) FILTER(WHERE NOT a.covered AND a.nta IS NULL),0) AS incremental_unassigned_nta_demand,
 COUNT(*) FILTER(WHERE NOT a.covered AND a.demand IS NOT NULL) AS newly_reached_parcels,
 COUNT(*) FILTER(WHERE l.units>0 AND l.demand IS NULL) AS unallocatable_residential_parcels,
 COUNT(*) FILTER(WHERE l.units IS NULL) AS invalid_units_parcels
 FROM candidate_neighbors n JOIN located l USING(bbl)
 LEFT JOIN access_classified a USING(bbl) GROUP BY n.id
), ranked_candidates AS (
 SELECT c.*, COALESCE(s.incremental_demand,0) AS incremental_demand,
 COALESCE(s.incremental_nta_demand,0) AS incremental_nta_demand,
 COALESCE(s.incremental_unassigned_nta_demand,0) AS incremental_unassigned_nta_demand,
 COALESCE(s.newly_reached_parcels,0) AS newly_reached_parcels,
 COALESCE(s.unallocatable_residential_parcels,0) AS unallocatable_residential_parcels,
 COALESCE(s.invalid_units_parcels,0) AS invalid_units_parcels,
 u.active_run_ids AS uncertain_run_ids,
 ROW_NUMBER() OVER(ORDER BY COALESCE(s.incremental_demand,0) DESC, c.id COLLATE "C") AS rank
 FROM candidate_points c LEFT JOIN candidate_scores s USING(id) LEFT JOIN uncertain_overlaps u USING(id)
)
SELECT ap.payload || jsonb_build_object(
 'metadata', ap.payload->'metadata' || jsonb_build_object(
   'availability', ap.payload->'metadata'->'availability' || jsonb_build_object('parks_available',EXISTS(SELECT 1 FROM parks_recreation)),
   'candidateModel', jsonb_build_object('label','Hypothetical Candidate Parks', 'radiusMeters',800,
    'locationMethod','PointOnSurface of repaired, combined property geometry',
    'scope','First-run-per-park screening; not verified construction sites or a feasibility assessment',
    'ranking','Independent incremental currently-uncovered licensed-dog demand; ties by property ID; gains are not additive')),
 'candidateSummary', jsonb_build_object(
   'sourceProperties',(SELECT COUNT(*) FROM park_properties),
   'screenedProperties',(SELECT COUNT(*) FROM screened_properties),
   'excludedActiveProperties',(SELECT COUNT(*) FROM excluded_properties),
   'rankableProperties',(SELECT COUNT(*) FROM candidate_points),
   'excludedGeometryProperties',(SELECT COUNT(*) FROM candidate_sources)-(SELECT COUNT(*) FROM candidate_points),
   'repairedProperties',(SELECT COUNT(*) FROM candidate_points WHERE repaired),
   'uncertainSpatialOverlapProperties',(SELECT COUNT(*) FROM uncertain_overlaps),
   'pointsInsideProperties',COALESCE((SELECT BOOL_AND(ST_Covers(geometry,point)) FROM candidate_points),true),
   'currentlyUncoveredDemand',(SELECT uncovered_demand FROM access_totals)),
 'excludedProperties',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,
    'reason','active_run_property_id','activeRunIds',active_run_ids) ORDER BY id COLLATE "C"),'[]'::jsonb) FROM excluded_properties),
 'geometryExclusions',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,
    'reason','empty_invalid_or_out_of_range_geometry') ORDER BY c.id COLLATE "C"),'[]'::jsonb)
    FROM candidate_sources c WHERE NOT EXISTS(SELECT 1 FROM candidate_points p WHERE p.id=c.id)),
 'uncertainSpatialOverlaps',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'activeRunIds',active_run_ids)
    ORDER BY id COLLATE "C"),'[]'::jsonb) FROM uncertain_overlaps),
 'candidates',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',id,'name',COALESCE(name,id),'borough',borough,'aliases',aliases,'types',types,'sourceRows',source_rows,
   'rank',rank,'geometry',ST_AsGeoJSON(point)::jsonb,'longitude',ST_X(point),'latitude',ST_Y(point),
   'incrementalDemand',incremental_demand,'incrementalNtaDemand',incremental_nta_demand,
   'incrementalUnassignedNtaDemand',incremental_unassigned_nta_demand,'newlyReachedParcels',newly_reached_parcels,
   'uncertainRunIds',COALESCE(uncertain_run_ids,ARRAY[]::integer[]),
   'flags',jsonb_build_object('hypothetical',true,'geometryRepaired',repaired,'missingGeometryPart',missing_geometry_part,
     'multipartGeometry',multipart,'multipleNames',multiple_names,'conflictingBoroughs',conflicting_boroughs,
     'multipleTypes',multiple_types,'missingAttributes',missing_attributes,'questionableAcreage',questionable_acreage,
     'inconsistentAreaAttributes',inconsistent_area_attributes,'uncertainSpatialOverlap',uncertain_run_ids IS NOT NULL,
     'sourceCoverageIncomplete',unallocatable_residential_parcels>0 OR invalid_units_parcels>0,
     'includesUnassignedNtaDemand',incremental_unassigned_nta_demand>0),
   'sourceCoverage',jsonb_build_object('unallocatableResidentialParcels',unallocatable_residential_parcels,'invalidUnitsParcels',invalid_units_parcels)
 ) ORDER BY rank),'[]'::jsonb) FROM ranked_candidates)
) AS payload FROM accessibility_payload ap;
