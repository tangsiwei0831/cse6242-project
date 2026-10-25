WITH active_licenses AS (
    SELECT DISTINCT
        animal_name,
        animal_gender,
        animal_birth_year,
        breed_name,
        zipcode,
        license_issued_date,
        license_expired_date
    FROM dog_licenses
    WHERE extract_year = 2026
      AND license_issued_date <= DATE '2025-12-31'
      AND license_expired_date >= DATE '2025-12-31'
),
dog_counts AS (
    SELECT
        TRIM(zipcode) AS zip,
        COUNT(*) AS dogs
    FROM active_licenses
    WHERE zipcode IS NOT NULL
      AND TRIM(zipcode) <> ''
    GROUP BY TRIM(zipcode)
),
residential_units AS (
    SELECT
        TRIM(postcode) AS zip,
        SUM(
            CASE
                WHEN REPLACE(TRIM(unitsres), ',', '') ~ '^[0-9]+$'
                THEN REPLACE(TRIM(unitsres), ',', '')::numeric
                ELSE 0
            END
        ) AS units
    FROM pluto
    WHERE postcode IS NOT NULL
      AND TRIM(postcode) <> ''
    GROUP BY TRIM(postcode)
)
SELECT
    d.zip,
    d.dogs,
    r.units,
    ROUND(
        d.dogs * 1000.0 / NULLIF(r.units, 0),
        2
    ) AS dogs_per_1000_units
FROM dog_counts d
JOIN residential_units r
    ON d.zip = r.zip
WHERE r.units > 0
ORDER BY dogs_per_1000_units DESC
LIMIT 20;