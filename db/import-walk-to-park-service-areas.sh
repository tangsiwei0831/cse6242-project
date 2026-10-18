#!/usr/bin/env bash
set -Eeuo pipefail

csv_file="${1:-}"

if [[ -z "${csv_file}" ]]; then
  csv_file="$(find /datasets -maxdepth 1 -type f -iname 'Walk_to_a_Park_Service_Area_for_CEQR_Open_Space_Assessment_*.csv' -print | sort | tail -n 1)"
fi

if [[ -z "${csv_file}" || ! -f "${csv_file}" ]]; then
  echo "No Walk_to_a_Park_Service_Area_for_CEQR_Open_Space_Assessment_*.csv file found in /datasets" >&2
  exit 1
fi

echo "Importing ${csv_file}"

psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --set=csv_file="${csv_file}" <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS walk_to_park_service_areas (
    walk_area_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    area text NOT NULL,
    geometry geometry(MultiPolygon, 4326) NOT NULL,
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS walk_to_park_service_areas_geometry_gix
    ON walk_to_park_service_areas USING gist (geometry);

CREATE TEMP TABLE walk_to_park_service_areas_stage (
    area text,
    polygon text
) ON COMMIT DROP;

SELECT format(
    'COPY walk_to_park_service_areas_stage FROM %L WITH (FORMAT csv, HEADER true, ENCODING ''UTF8'')',
    :'csv_file'
) \gexec

TRUNCATE TABLE walk_to_park_service_areas RESTART IDENTITY;

INSERT INTO walk_to_park_service_areas (area, geometry, source_file)
SELECT
    trim(area),
    ST_Multi(ST_GeomFromText(trim(polygon), 4326)),
    regexp_replace(:'csv_file', '^.*/', '')
FROM walk_to_park_service_areas_stage;

INSERT INTO data_imports (dataset_name, source_file, rows_staged)
SELECT
    'walk_to_park_service_areas',
    regexp_replace(:'csv_file', '^.*/', ''),
    count(*)::integer
FROM walk_to_park_service_areas_stage;

COMMIT;
SQL

echo "Walk to Park Service Areas import complete"
