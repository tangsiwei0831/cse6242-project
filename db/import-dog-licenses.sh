#!/usr/bin/env bash
set -Eeuo pipefail

csv_file="${1:-}"

if [[ -z "${csv_file}" ]]; then
  csv_file="$(find /datasets -maxdepth 1 -type f -iname 'NYC_Dog_Licensing_Dataset_*.csv' -print | sort | tail -n 1)"
fi

if [[ -z "${csv_file}" || ! -f "${csv_file}" ]]; then
  echo "No NYC_Dog_Licensing_Dataset_*.csv file found in /datasets" >&2
  exit 1
fi

echo "Importing ${csv_file}"

psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --set=csv_file="${csv_file}" <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS dog_licenses (
    license_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    animal_name text,
    animal_gender text,
    animal_birth_year smallint,
    breed_name text,
    zipcode text,
    license_issued_date date,
    license_expired_date date,
    extract_year smallint,
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dog_licenses_zipcode_idx ON dog_licenses (zipcode);
CREATE INDEX IF NOT EXISTS dog_licenses_breed_name_idx ON dog_licenses (breed_name);
CREATE INDEX IF NOT EXISTS dog_licenses_extract_year_idx ON dog_licenses (extract_year);

CREATE TEMP TABLE dog_licenses_stage (
    animal_name text,
    animal_gender text,
    animal_birth_year text,
    breed_name text,
    zipcode text,
    license_issued_date text,
    license_expired_date text,
    extract_year text
) ON COMMIT DROP;

SELECT format(
    'COPY dog_licenses_stage FROM %L WITH (FORMAT csv, HEADER true, ENCODING ''UTF8'')',
    :'csv_file'
) \gexec

TRUNCATE TABLE dog_licenses RESTART IDENTITY;

INSERT INTO dog_licenses (
    animal_name, animal_gender, animal_birth_year, breed_name, zipcode,
    license_issued_date, license_expired_date, extract_year, source_file
)
SELECT
    nullif(trim(animal_name), ''),
    nullif(trim(animal_gender), ''),
    CASE WHEN trim(animal_birth_year) ~ '^\d{1,4}$'
        THEN trim(animal_birth_year)::smallint END,
    nullif(trim(breed_name), ''),
    nullif(trim(zipcode), ''),
    CASE WHEN trim(license_issued_date) ~ '^\d{2}/\d{2}/\d{4}$'
        THEN to_date(trim(license_issued_date), 'MM/DD/YYYY') END,
    CASE WHEN trim(license_expired_date) ~ '^\d{2}/\d{2}/\d{4}$'
        THEN to_date(trim(license_expired_date), 'MM/DD/YYYY') END,
    CASE WHEN trim(extract_year) ~ '^\d{4}$'
        THEN trim(extract_year)::smallint END,
    regexp_replace(:'csv_file', '^.*/', '')
FROM dog_licenses_stage;

INSERT INTO data_imports (dataset_name, source_file, rows_staged)
SELECT 'dog_licenses', regexp_replace(:'csv_file', '^.*/', ''), count(*)::integer
FROM dog_licenses_stage;

COMMIT;
SQL

echo "Dog Licensing import complete"
