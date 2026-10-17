#!/usr/bin/env bash
set -Eeuo pipefail

csv_file="${1:-}"

if [[ -z "${csv_file}" ]]; then
  csv_file="$(find /datasets -maxdepth 1 -type f -iname 'NYC_Parks_Active_and_Passive_Recreation_*.csv' -print | sort | tail -n 1)"
fi

if [[ -z "${csv_file}" || ! -f "${csv_file}" ]]; then
  echo "No NYC_Parks_Active_and_Passive_Recreation_*.csv file found in /datasets" >&2
  exit 1
fi

echo "Importing ${csv_file}"

psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --set=csv_file="${csv_file}" <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS parks_recreation (
    recreation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gis_property_number text NOT NULL,
    sign_name text,
    recreation_category text,
    open_space_acres numeric,
    active_percent numeric,
    passive_percent numeric,
    active_acres numeric,
    passive_acres numeric,
    type_category text,
    location text,
    zipcodes text,
    borough_census_tracts text,
    borough text,
    geometry geometry(MultiPolygon, 4326) NOT NULL,
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parks_recreation_geometry_gix ON parks_recreation USING gist (geometry);
CREATE INDEX IF NOT EXISTS parks_recreation_gis_property_number_idx ON parks_recreation (gis_property_number);
CREATE INDEX IF NOT EXISTS parks_recreation_borough_idx ON parks_recreation (borough);
CREATE INDEX IF NOT EXISTS parks_recreation_category_idx ON parks_recreation (recreation_category);

CREATE TEMP TABLE parks_recreation_stage (
    gis_property_number text,
    sign_name text,
    recreation_category text,
    open_space_acres text,
    active_percent text,
    passive_percent text,
    active_acres text,
    passive_acres text,
    type_category text,
    location text,
    zipcodes text,
    borough_census_tracts text,
    borough text,
    geometry_wkt text
) ON COMMIT DROP;

SELECT format(
    'COPY parks_recreation_stage FROM %L WITH (FORMAT csv, HEADER true, ENCODING ''UTF8'')',
    :'csv_file'
) \gexec

TRUNCATE TABLE parks_recreation RESTART IDENTITY;

INSERT INTO parks_recreation (
    gis_property_number, sign_name, recreation_category, open_space_acres,
    active_percent, passive_percent, active_acres, passive_acres,
    type_category, location, zipcodes, borough_census_tracts, borough,
    geometry, source_file
)
SELECT
    trim(gis_property_number),
    nullif(trim(sign_name), ''),
    nullif(trim(recreation_category), ''),
    nullif(replace(trim(open_space_acres), ',', ''), '')::numeric,
    nullif(replace(trim(active_percent), ',', ''), '')::numeric,
    nullif(replace(trim(passive_percent), ',', ''), '')::numeric,
    nullif(replace(trim(active_acres), ',', ''), '')::numeric,
    nullif(replace(trim(passive_acres), ',', ''), '')::numeric,
    nullif(trim(type_category), ''),
    nullif(trim(location), ''),
    nullif(trim(zipcodes), ''),
    nullif(trim(borough_census_tracts), ''),
    nullif(trim(borough), ''),
    ST_Multi(ST_GeomFromText(geometry_wkt, 4326)),
    regexp_replace(:'csv_file', '^.*/', '')
FROM parks_recreation_stage;

INSERT INTO data_imports (dataset_name, source_file, rows_staged)
SELECT 'parks_recreation', regexp_replace(:'csv_file', '^.*/', ''), count(*)::integer
FROM parks_recreation_stage;

COMMIT;
SQL

echo "NYC Parks Recreation import complete"
