#!/usr/bin/env bash
set -Eeuo pipefail

csv_file="${1:-}"

if [[ -z "${csv_file}" ]]; then
  csv_file="$(find /datasets -maxdepth 1 -type f -iname 'DOHMH_Dog_Bite_Data_*.csv' -print | sort | tail -n 1)"
fi

if [[ -z "${csv_file}" || ! -f "${csv_file}" ]]; then
  echo "No DOHMH_Dog_Bite_Data_*.csv file found in /datasets" >&2
  exit 1
fi

echo "Importing ${csv_file}"

psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --set=csv_file="${csv_file}" <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS dog_bites (
    dog_bite_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    unique_id text NOT NULL,
    date_of_bite date NOT NULL,
    species text,
    breed text,
    age text,
    gender text,
    spay_neuter boolean,
    borough text,
    zipcode text,
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dog_bites_unique_id_idx ON dog_bites (unique_id);
CREATE INDEX IF NOT EXISTS dog_bites_date_of_bite_idx ON dog_bites (date_of_bite);
CREATE INDEX IF NOT EXISTS dog_bites_borough_idx ON dog_bites (borough);
CREATE INDEX IF NOT EXISTS dog_bites_zipcode_idx ON dog_bites (zipcode);
CREATE INDEX IF NOT EXISTS dog_bites_breed_idx ON dog_bites (breed);

CREATE TEMP TABLE dog_bites_stage (
    unique_id text,
    date_of_bite text,
    species text,
    breed text,
    age text,
    gender text,
    spay_neuter text,
    borough text,
    zipcode text
) ON COMMIT DROP;

SELECT format(
    'COPY dog_bites_stage FROM %L WITH (FORMAT csv, HEADER true, ENCODING ''UTF8'')',
    :'csv_file'
) \gexec

TRUNCATE TABLE dog_bites RESTART IDENTITY;

INSERT INTO dog_bites (
    unique_id, date_of_bite, species, breed, age, gender, spay_neuter,
    borough, zipcode, source_file
)
SELECT
    trim(unique_id),
    to_date(trim(date_of_bite), 'FMMonth DD, YYYY'),
    nullif(trim(species), ''),
    nullif(trim(breed), ''),
    nullif(trim(age), ''),
    nullif(trim(gender), ''),
    nullif(lower(trim(spay_neuter)), '')::boolean,
    nullif(trim(borough), ''),
    nullif(trim(zipcode), ''),
    regexp_replace(:'csv_file', '^.*/', '')
FROM dog_bites_stage;

INSERT INTO data_imports (dataset_name, source_file, rows_staged)
SELECT 'dog_bites', regexp_replace(:'csv_file', '^.*/', ''), count(*)::integer
FROM dog_bites_stage;

COMMIT;
SQL

echo "Dog Bites import complete"
