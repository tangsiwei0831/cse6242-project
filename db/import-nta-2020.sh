#!/usr/bin/env bash
set -Eeuo pipefail

csv_file="${1:-}"

if [[ -z "${csv_file}" ]]; then
  csv_file="$(find /datasets -maxdepth 1 -type f -iname '2020_Neighborhood_Tabulation_Areas_(NTAs)_*.csv' -print | sort | tail -n 1)"
fi

if [[ -z "${csv_file}" || ! -f "${csv_file}" ]]; then
  echo "No 2020_Neighborhood_Tabulation_Areas_(NTAs)_*.csv file found in /datasets" >&2
  exit 1
fi

echo "Importing ${csv_file}"

psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --set=csv_file="${csv_file}" <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS nta_2020 (
    nta_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    borocode smallint NOT NULL,
    boroname text NOT NULL,
    countyfips text NOT NULL,
    nta2020 text NOT NULL UNIQUE,
    ntaname text NOT NULL,
    ntaabbrev text,
    ntatype text,
    cdta2020 text,
    cdtaname text,
    shape_length numeric,
    shape_area numeric,
    geometry geometry(MultiPolygon, 4326) NOT NULL,
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nta_2020_geometry_gix ON nta_2020 USING gist (geometry);
CREATE INDEX IF NOT EXISTS nta_2020_boroname_idx ON nta_2020 (boroname);
CREATE INDEX IF NOT EXISTS nta_2020_cdta2020_idx ON nta_2020 (cdta2020);
CREATE INDEX IF NOT EXISTS nta_2020_ntaname_idx ON nta_2020 (ntaname);

CREATE TEMP TABLE nta_2020_stage (
    borocode text,
    boroname text,
    countyfips text,
    nta2020 text,
    ntaname text,
    ntaabbrev text,
    ntatype text,
    cdta2020 text,
    cdtaname text,
    shape_length text,
    shape_area text,
    geometry_wkt text
) ON COMMIT DROP;

SELECT format(
    'COPY nta_2020_stage FROM %L WITH (FORMAT csv, HEADER true, ENCODING ''UTF8'')',
    :'csv_file'
) \gexec

TRUNCATE TABLE nta_2020 RESTART IDENTITY;

INSERT INTO nta_2020 (
    borocode, boroname, countyfips, nta2020, ntaname, ntaabbrev, ntatype,
    cdta2020, cdtaname, shape_length, shape_area, geometry, source_file
)
SELECT
    trim(borocode)::smallint,
    trim(boroname),
    trim(countyfips),
    trim(nta2020),
    trim(ntaname),
    nullif(trim(ntaabbrev), ''),
    nullif(trim(ntatype), ''),
    nullif(trim(cdta2020), ''),
    nullif(trim(cdtaname), ''),
    nullif(replace(trim(shape_length), ',', ''), '')::numeric,
    nullif(replace(trim(shape_area), ',', ''), '')::numeric,
    ST_GeomFromText(trim(geometry_wkt), 4326)::geometry(MultiPolygon, 4326),
    regexp_replace(:'csv_file', '^.*/', '')
FROM nta_2020_stage;

INSERT INTO data_imports (dataset_name, source_file, rows_staged)
SELECT 'nta_2020', regexp_replace(:'csv_file', '^.*/', ''), count(*)::integer
FROM nta_2020_stage;

COMMIT;
SQL

echo "2020 Neighborhood Tabulation Areas import complete"
