#!/usr/bin/env bash
set -Eeuo pipefail

csv_file="${1:-}"
if [[ -z "${csv_file}" ]]; then
  csv_file="$(find /datasets -maxdepth 1 -type f -iname 'Primary_Land_Use_Tax_Lot_Output_(PLUTO)_*.csv' -print | sort | tail -n 1)"
fi
if [[ -z "${csv_file}" || ! -f "${csv_file}" ]]; then
  echo "No Primary_Land_Use_Tax_Lot_Output_(PLUTO)_*.csv file found in /datasets" >&2
  exit 1
fi

echo "Importing ${csv_file}"
psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --file=/usr/local/share/pluto-schema.sql

psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --set=csv_file="${csv_file}" <<'SQL'
BEGIN;
TRUNCATE TABLE pluto;

SELECT format($copy$
COPY pluto (
    borough, tax_block, tax_lot, community_board, census_tract_2010, cb2010,
    schooldist, council_district, postcode, firecomp, policeprct, healtharea,
    sanitboro, sanitsub, address, zonedist1, zonedist2, zonedist3, zonedist4,
    overlay1, overlay2, spdist1, spdist2, spdist3, ltdheight, splitzone,
    bldgclass, landuse, easements, ownertype, ownername, lotarea, bldgarea,
    comarea, resarea, officearea, retailarea, garagearea, strgearea, factryarea,
    otherarea, areasource, numbldgs, numfloors, unitsres, unitstotal, lotfront,
    lotdepth, bldgfront, bldgdepth, ext, proxcode, irrlotcode, lottype,
    bsmtcode, assessland, assesstot, exempttot, yearbuilt, yearalter1,
    yearalter2, histdist, landmark, builtfar, residfar, commfar, facilfar,
    affresfar, mnffar, borocode, bbl, condono, tract2010, xcoord, ycoord,
    latitude, longitude, zonemap, zmcode, sanborn, taxmap, edesignum, appbbl,
    appdate, plutomapid, version, sanitdistrict, healthcenterdistrict,
    firm07_flag, pfirm15_flag, dcpedited, notes, bct2020, bctcb2020,
    mihopt1, mihopt2, mihopt3, mihopt4, transitzone, geom, basempdate,
    dcasdate, edesigdate, landmkdate, masdate, polidate, rpaddate, zoningdate
) FROM %L WITH (FORMAT csv, HEADER true, NULL '', ENCODING 'UTF8')
$copy$, :'csv_file') \gexec

UPDATE pluto
SET location = ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326),
    source_file = regexp_replace(:'csv_file', '^.*/', ''),
    imported_at = now()
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

UPDATE pluto
SET source_file = regexp_replace(:'csv_file', '^.*/', ''), imported_at = now()
WHERE latitude IS NULL OR longitude IS NULL;

INSERT INTO data_imports (dataset_name, source_file, rows_staged)
SELECT 'pluto', regexp_replace(:'csv_file', '^.*/', ''), count(*)::integer FROM pluto;
COMMIT;
SQL

echo "PLUTO import complete"
