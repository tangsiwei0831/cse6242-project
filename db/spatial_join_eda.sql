SELECT
    'PLUTO' AS dataset,
    COUNT(*) AS total_rows,
    COUNT(location) AS rows_with_geometry,
    COUNT(*) FILTER (
        WHERE location IS NOT NULL
          AND ST_IsValid(location)
    ) AS valid_geometry
FROM pluto

UNION ALL

SELECT
    'Dog Runs',
    COUNT(*),
    COUNT(geometry),
    COUNT(*) FILTER (
        WHERE geometry IS NOT NULL
          AND ST_IsValid(geometry)
    )
FROM dog_runs;

SELECT
    p.bbl,
    p.postcode,
    ROUND(
        ST_Distance(
            p.location::geography,
            nearest.geometry::geography
        )::numeric,
        2
    ) AS distance_meters
FROM pluto p
CROSS JOIN LATERAL (
    SELECT d.geometry
    FROM dog_runs d
    ORDER BY p.location <-> d.geometry
    LIMIT 1
) nearest
WHERE p.location IS NOT NULL
  AND REPLACE(TRIM(p.unitsres), ',', '') ~ '^[0-9]+$'
  AND REPLACE(TRIM(p.unitsres), ',', '')::numeric > 0
LIMIT 10;