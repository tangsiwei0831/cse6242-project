#!/usr/bin/env bash
set -Eeuo pipefail

csv_file="${1:-}"
if [[ -z "${csv_file}" ]]; then
  csv_file="$(find /datasets -maxdepth 1 -type f -iname 'Parks_Inspection_Program_*_Inventory_*.csv' -print | sort | tail -n 1)"
fi
if [[ -z "${csv_file}" || ! -f "${csv_file}" ]]; then
  echo "No Parks_Inspection_Program_*_Inventory_*.csv file found in /datasets" >&2
  exit 1
fi

echo "Importing ${csv_file}"
psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --set=csv_file="${csv_file}" <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS park_inspection_inventory (
    inventory_id integer PRIMARY KEY,
    property_id text NOT NULL,
    feature text NOT NULL,
    feature_type text NOT NULL,
    category text,
    sub_category text,
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS park_inspection_inventory_property_idx
    ON park_inspection_inventory (property_id);
CREATE INDEX IF NOT EXISTS park_inspection_inventory_feature_idx
    ON park_inspection_inventory (feature);
CREATE INDEX IF NOT EXISTS park_inspection_inventory_type_idx
    ON park_inspection_inventory (feature_type);
CREATE INDEX IF NOT EXISTS park_inspection_inventory_category_idx
    ON park_inspection_inventory (category);

CREATE TEMP TABLE park_inspection_inventory_stage (
    inventory_id text,
    property_id text,
    feature text,
    feature_type text,
    category text,
    sub_category text
) ON COMMIT DROP;

SELECT format(
    'COPY park_inspection_inventory_stage FROM %L WITH (FORMAT csv, HEADER true, ENCODING ''UTF8'')',
    :'csv_file'
) \gexec

INSERT INTO park_inspection_inventory (
    inventory_id, property_id, feature, feature_type, category, sub_category,
    source_file
)
SELECT
    replace(trim(inventory_id), ',', '')::integer,
    trim(property_id),
    trim(feature),
    trim(feature_type),
    nullif(trim(category), ''),
    nullif(trim(sub_category), ''),
    regexp_replace(:'csv_file', '^.*/', '')
FROM park_inspection_inventory_stage
ON CONFLICT (inventory_id) DO UPDATE SET
    property_id = EXCLUDED.property_id,
    feature = EXCLUDED.feature,
    feature_type = EXCLUDED.feature_type,
    category = EXCLUDED.category,
    sub_category = EXCLUDED.sub_category,
    source_file = EXCLUDED.source_file,
    imported_at = now(),
    updated_at = now();

DELETE FROM park_inspection_inventory target
WHERE NOT EXISTS (
    SELECT 1 FROM park_inspection_inventory_stage stage
    WHERE replace(trim(stage.inventory_id), ',', '')::integer = target.inventory_id
);

INSERT INTO data_imports (dataset_name, source_file, rows_staged)
SELECT 'park_inspection_inventory', regexp_replace(:'csv_file', '^.*/', ''), count(*)::integer
FROM park_inspection_inventory_stage;

COMMIT;
SQL

echo "Parks Inspection Inventory import complete"
