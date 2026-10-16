#!/usr/bin/env bash
set -Eeuo pipefail

csv_file="${1:-/datasets/pluto.csv}"

if [[ ! -f "${csv_file}" ]]; then
  echo "No pluto.csv file found in /datasets" >&2
  exit 1
fi

echo "Importing ${csv_file}"

psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --set=csv_file="${csv_file}" <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS pluto (
    bbl bigint PRIMARY KEY,
    borough text,
    tax_block text,
    tax_lot text,
    community_board text,
    postcode text,
    address text,
    landuse text,
    lotarea numeric,
    bldgarea numeric,
    resarea numeric,
    numbldgs numeric,
    numfloors numeric,
    unitsres numeric,
    unitstotal numeric,
    yearbuilt integer,
    latitude double precision,
    longitude double precision,
    geometry geometry(Point, 4326),
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TEMP TABLE pluto_stage (
    borough text,
    tax_block text,
    tax_lot text,
    community_board text,
    census_tract_2010 text,
    cb2010 text,
    schooldist text,
    council_district text,
    postcode text,
    firecomp text,
    policeprct text,
    healtharea text,
    sanitboro text,
    sanitsub text,
    address text,
    zonedist1 text,
    zonedist2 text,
    zonedist3 text,
    zonedist4 text,
    overlay1 text,
    overlay2 text,
    spdist1 text,
    spdist2 text,
    spdist3 text,
    ltdheight text,
    splitzone text,
    bldgclass text,
    landuse text,
    easements text,
    ownertype text,
    ownername text,
    lotarea text,
    bldgarea text,
    comarea text,
    resarea text,
    officearea text,
    retailarea text,
    garagearea text,
    strgearea text,
    factryarea text,
    otherarea text,
    areasource text,
    numbldgs text,
    numfloors text,
    unitsres text,
    unitstotal text,
    lotfront text,
    lotdepth text,
    bldgfront text,
    bldgdepth text,
    ext text,
    proxcode text,
    irrlotcode text,
    lottype text,
    bsmtcode text,
    assessland text,
    assesstot text,
    exempttot text,
    yearbuilt text,
    yearalter1 text,
    yearalter2 text,
    histdist text,
    landmark text,
    builtfar text,
    residfar text,
    commfar text,
    facilfar text,
    affresfar text,
    mnffar text,
    borocode text,
    bbl text,
    condono text,
    tract2010 text,
    xcoord text,
    ycoord text,
    latitude text,
    longitude text,
    zonemap text,
    zmcode text,
    sanborn text,
    taxmap text,
    edesignum text,
    appbbl text,
    appdate text,
    plutomapid text,
    version text,
    sanitdistrict text,
    healthcenterdistrict text,
    firm07_flag text,
    pfirm15_flag text,
    dcpedited text,
    notes text,
    bct2020 text,
    bctcb2020 text,
    mihopt1 text,
    mihopt2 text,
    mihopt3 text,
    mihopt4 text,
    transitzone text,
    geom text,
    basempdate text,
    dcasdate text,
    edesigdate text,
    landmkdate text,
    masdate text,
    polidate text,
    rpaddate text,
    zoningdate text
) ON COMMIT DROP;

SELECT format(
    'COPY pluto_stage FROM %L WITH (FORMAT csv, HEADER true, ENCODING ''UTF8'')',
    :'csv_file'
) \gexec

TRUNCATE TABLE pluto;

INSERT INTO pluto (
    bbl, borough, tax_block, tax_lot, community_board,
    postcode, address, landuse, lotarea, bldgarea,
    resarea, numbldgs, numfloors, unitsres, unitstotal,
    yearbuilt, latitude, longitude, geometry, source_file
)
SELECT
    CASE WHEN trim(bbl) ~ '^\d+$' THEN trim(bbl)::bigint END,
    nullif(trim(borough), ''),
    nullif(trim(tax_block), ''),
    nullif(trim(tax_lot), ''),
    nullif(trim(community_board), ''),
    nullif(trim(postcode), ''),
    nullif(trim(address), ''),
    nullif(trim(landuse), ''),
    CASE WHEN trim(lotarea) ~ '^\d+(\.\d+)?$' THEN trim(lotarea)::numeric END,
    CASE WHEN trim(bldgarea) ~ '^\d+(\.\d+)?$' THEN trim(bldgarea)::numeric END,
    CASE WHEN trim(resarea) ~ '^\d+(\.\d+)?$' THEN trim(resarea)::numeric END,
    CASE WHEN trim(numbldgs) ~ '^\d+(\.\d+)?$' THEN trim(numbldgs)::numeric END,
    CASE WHEN trim(numfloors) ~ '^\d+(\.\d+)?$' THEN trim(numfloors)::numeric END,
    CASE WHEN trim(unitsres) ~ '^\d+(\.\d+)?$' THEN trim(unitsres)::numeric END,
    CASE WHEN trim(unitstotal) ~ '^\d+(\.\d+)?$' THEN trim(unitstotal)::numeric END,
    CASE WHEN trim(yearbuilt) ~ '^\d{4}$' THEN trim(yearbuilt)::integer END,
    CASE WHEN trim(latitude) ~ '^-?\d+(\.\d+)?$' THEN trim(latitude)::double precision END,
    CASE WHEN trim(longitude) ~ '^-?\d+(\.\d+)?$' THEN trim(longitude)::double precision END,
    CASE
        WHEN trim(longitude) ~ '^-?\d+(\.\d+)?$'
         AND trim(latitude) ~ '^-?\d+(\.\d+)?$'
        THEN ST_SetSRID(
            ST_MakePoint(
                trim(longitude)::double precision,
                trim(latitude)::double precision
            ),
            4326
        )
    END,
    regexp_replace(:'csv_file', '^.*/', '')
FROM pluto_stage
WHERE trim(bbl) ~ '^\d+$';

INSERT INTO data_imports (dataset_name, source_file, rows_staged)
SELECT
    'pluto',
    regexp_replace(:'csv_file', '^.*/', ''),
    count(*)::integer
FROM pluto_stage;

COMMIT;
SQL

echo "PLUTO import complete"

