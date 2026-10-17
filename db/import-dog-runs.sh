#!/usr/bin/env bash
set -Eeuo pipefail

csv_file="${1:-}"

if [[ -z "${csv_file}" ]]; then
  csv_file="$(find /datasets -maxdepth 1 -type f -iname 'Dog_Runs_*.csv' -print | sort | tail -n 1)"
fi

if [[ -z "${csv_file}" || ! -f "${csv_file}" ]]; then
  echo "No Dog_Runs_*.csv file found in /datasets" >&2
  exit 1
fi

echo "Importing ${csv_file}"

psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --set=csv_file="${csv_file}" <<'SQL'
BEGIN;

CREATE TEMP TABLE dog_runs_stage (
    object_id text,
    system_id text,
    geometry_wkt text,
    gis_property_number text,
    department text,
    parent_id text,
    community_board text,
    council_district text,
    precinct text,
    zipcode text,
    borough text,
    dog_area_type text,
    name text,
    seating text,
    surface text,
    feature_status text
) ON COMMIT DROP;

SELECT format(
    'COPY dog_runs_stage FROM %L WITH (FORMAT csv, HEADER true, ENCODING ''UTF8'')',
    :'csv_file'
) \gexec

INSERT INTO dog_runs (
    object_id, system_id, geometry, gis_property_number, department,
    parent_id, community_board, council_district, precinct, zipcode,
    borough, dog_area_type, name, seating, surface, feature_status,
    source_file
)
SELECT
    replace(object_id, ',', '')::integer,
    nullif(trim(system_id), ''),
    ST_Multi(ST_GeomFromText(geometry_wkt, 4326)),
    nullif(trim(gis_property_number), ''),
    trim(department),
    nullif(trim(parent_id), ''),
    nullif(trim(community_board), ''),
    nullif(trim(council_district), ''),
    nullif(trim(precinct), ''),
    nullif(trim(zipcode), ''),
    trim(borough),
    trim(dog_area_type),
    trim(name),
    nullif(trim(seating), ''),
    nullif(trim(surface), ''),
    trim(feature_status),
    regexp_replace(:'csv_file', '^.*/', '')
FROM dog_runs_stage
ON CONFLICT (object_id) DO UPDATE SET
    system_id = EXCLUDED.system_id,
    geometry = EXCLUDED.geometry,
    gis_property_number = EXCLUDED.gis_property_number,
    department = EXCLUDED.department,
    parent_id = EXCLUDED.parent_id,
    community_board = EXCLUDED.community_board,
    council_district = EXCLUDED.council_district,
    precinct = EXCLUDED.precinct,
    zipcode = EXCLUDED.zipcode,
    borough = EXCLUDED.borough,
    dog_area_type = EXCLUDED.dog_area_type,
    name = EXCLUDED.name,
    seating = EXCLUDED.seating,
    surface = EXCLUDED.surface,
    feature_status = EXCLUDED.feature_status,
    source_file = EXCLUDED.source_file,
    imported_at = now(),
    updated_at = now();

INSERT INTO data_imports (dataset_name, source_file, rows_staged)
SELECT 'dog_runs', regexp_replace(:'csv_file', '^.*/', ''), count(*)::integer
FROM dog_runs_stage;

COMMIT;
SQL

echo "Dog Runs import complete"
