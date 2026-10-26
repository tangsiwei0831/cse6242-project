-- Append to the shared demand and accessibility definitions.
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
