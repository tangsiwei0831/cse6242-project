# CSE6242 Project

This database importer supports these datasets:

- [NYC Open Data Dog Runs](https://data.cityofnewyork.us/Recreation/Dog-Runs/hxx3-bwgv)
- [NYC Dog Licensing](https://data.cityofnewyork.us/Health/NYC-Dog-Licensing-Dataset/nu7n-tubp)
- [NYC Parks Active and Passive Recreation](https://data.cityofnewyork.us/Recreation/NYC-Parks-Active-and-Passive-Recreation/kcqe-vnci)
- [Primary Land Use Tax Lot Output (PLUTO)](https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks/about_data)
- [Parks Inspection Program Inventory](https://data.cityofnewyork.us/City-Government/Parks-Inspection-Program-Inventory/86a8-pqby)
- [311 Service Requests from 2020 to Present](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2020-to-Present/erm2-nwe9)
- [DOHMH Dog Bite Data](https://data.cityofnewyork.us/Health/DOHMH-Dog-Bite-Data/rsgh-akpg/about_data)
- [Walk to a Park Service Area for CEQR Open Space Assessment](https://data.cityofnewyork.us/dataset/Walk-to-a-Park-Service-Area-for-CEQR-Open-Space-As/k66c-pzws/about_data)
- [2020 Neighborhood Tabulation Areas (NTAs)](https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd/about_data)

## Initial setup

Create a `datasets/` folder and place the CSV exports in it using these filename
patterns:

- Dog Runs: `Dog_Runs_*.csv`
- Dog Licensing: `NYC_Dog_Licensing_Dataset_*.csv`
- Parks Active and Passive Recreation: `NYC_Parks_Active_and_Passive_Recreation_*.csv`
- PLUTO: `Primary_Land_Use_Tax_Lot_Output_(PLUTO)_*.csv`
- Parks Inspection Inventory: `Parks_Inspection_Program_*_Inventory_*.csv`
- 311 Service Requests: `311_Service_Requests_from_2020_to_Present_*.csv`
- DOHMH Dog Bite Data: `DOHMH_Dog_Bite_Data_*.csv`
- Walk to a Park Service Area: `Walk_to_a_Park_Service_Area_for_CEQR_Open_Space_Assessment_*.csv`
- 2020 Neighborhood Tabulation Areas: `2020_Neighborhood_Tabulation_Areas_(NTAs)_*.csv`

The wildcard accommodates dated exports and the punctuation used in the Parks
Inspection filename. The `datasets/` folder and its contents are excluded from
Git.

Create the folder first:

```bash
mkdir -p datasets
```

Download the desired CSV exports into `datasets/`, using the filenames above,
before starting Docker:

```bash
docker compose up --build -d
```

On initial startup, Docker creates the PostGIS schema and bulk-imports the newest
matching CSV for each dataset. Missing Dog Licensing, Parks Recreation, PLUTO,
Parks Inspection Inventory, 311 Service Requests, DOHMH Dog Bite Data, Walk to a
Park Service Area, and 2020 Neighborhood Tabulation Areas CSVs are skipped; a
Dog Runs CSV is required.

Verify the import:

```bash
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM dog_runs;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM dog_licenses;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM parks_recreation;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM pluto;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM park_inspection_inventory;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM service_requests_311;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM dog_bites;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM walk_to_park_service_areas;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM nta_2020;"
```

## Interactive dog run map

The Docker stack includes a responsive D3 map backed by the PostGIS `dog_runs`
and `nta_2020` tables. After starting the stack, open:

<http://localhost:3000>

The map shows active NYC dog runs, supports borough and name/ZIP filtering,
zooming and panning, and displays surface, seating, area, and directions for a
selected run. Set `WEB_PORT` in `.env` to expose it on a different host port.

The Compose web service runs in development mode. Files under `web/` are mounted
into the container, server changes restart Node automatically, and changes to
`web/public/` refresh an open browser tab. A rebuild is only needed after changing
`web/package.json` or the web `Dockerfile`.

## Connect with Docker Desktop

Open the terminal for the `db` container in Docker Desktop, then connect to the
database with:

```bash
psql -U cse6242 -d cse6242
```

List tables:

```sql
\dt
```

Describe a table:

```sql
\d service_requests_311
```

List large objects:

```sql
\dl
```

Exit `psql`:

```sql
\q
```

## Refresh the data

After placing a later matching CSV in `datasets/`, refresh the relevant table
with:

```bash
docker compose exec db import-dog-runs
docker compose exec db import-dog-licenses
docker compose exec db import-parks-recreation
docker compose exec db import-pluto
docker compose exec db import-park-inspection-inventory
docker compose exec db import-service-requests-311
docker compose exec db import-dog-bites
docker compose exec db import-walk-to-park-service-areas
docker compose exec db import-nta-2020
```

The Dog Runs importer updates records by `OBJECTID`. Because the licensing export
has no stable record ID, its importer replaces the `dog_licenses` table contents
with the selected CSV as one transaction. Invalid or missing year values are
stored as `NULL`. The Parks export also has repeated `GISPROPNUM` values, so its
importer transactionally replaces `parks_recreation` and assigns an internal
`recreation_id`. Comma-formatted acreage values are normalized before being
stored as numeric values, and `SHAPE` is stored as PostGIS `MultiPolygon` geometry
in SRID 4326.

PLUTO refreshes atomically by its unique `BBL`. Its 108 source fields are retained
without lossy coercion, while `location` provides an indexed SRID 4326 point made
from longitude and latitude. The nullable `geom` column preserves source polygon
geometry when an export supplies it; the 2026-10-16 export leaves it empty.

The Parks Inspection Inventory importer updates records by `Inventory ID` and
removes records no longer present in the latest export within the same transaction.
`property_id` retains the source `Prop ID` used to associate inventory with parks.

The 311 importer transactionally replaces `service_requests_311` using the
export's unique request key. Source dates are stored as local timestamps and the
`Location` WKT is stored as nullable PostGIS `Point` geometry in SRID 4326.

The Dog Bite Data importer transactionally replaces `dog_bites`. `UniqueID` is
retained as a non-unique source field because it repeats in the export; each
record has an internal `dog_bite_id`. Dog ages are stored as text to preserve
values such as months and age ranges, and `SpayNeuter` is stored as a nullable
boolean.

The Walk to a Park Service Area importer transactionally replaces
`walk_to_park_service_areas` and stores its polygon as SRID 4326 PostGIS
`MultiPolygon` geometry.

The 2020 Neighborhood Tabulation Areas importer transactionally replaces
`nta_2020`. NTA codes are retained as text, source area and length values as
numeric, and neighborhood boundaries as SRID 4326 `MultiPolygon` geometry.

Rebuild the database image before the first Dog Licensing import into an existing
database volume:

```bash
docker compose up --build -d
docker compose exec db import-dog-licenses
docker compose exec db import-parks-recreation
docker compose exec db import-pluto
docker compose exec db import-park-inspection-inventory
docker compose exec db import-service-requests-311
docker compose exec db import-dog-bites
docker compose exec db import-walk-to-park-service-areas
docker compose exec db import-nta-2020
```

> **Note:** Automatic schema initialization runs only when Docker creates a new
> database volume. It does not run again for an existing database volume.

## Estimated Licensed-Dog Demand

The map includes an optional NTA choropleth with a metric selector for estimated
licensed-dog totals or estimated licenses per 1,000 covered residential units.
Hover over neighborhoods for metrics and coverage flags; expand **Data coverage**
for excluded demand and residential-parcel assignment counts. Dog-run filters
continue to affect markers and the places list; demand colors keep a citywide
scale and are independent of name/borough filters.

Run the existing stack with `docker compose up --build -d` and open
<http://localhost:3000>. Existing volumes must already have Dog Licensing, PLUTO,
and NTA data imported (see refresh commands above). No schema migration or new
source dataset is needed. The first demand request does spatial processing (about 78 seconds on the local
validation stack);
subsequent requests share a five-minute in-memory cache. After importing new data,
wait for expiry or restart the web service, then reload the page.

`GET /api/dog-demand` returns aggregate `ntas`, `zipDiagnostics`, `summary`, and
`metadata`. It never returns animal attributes or individual license records.
The calculation lives in `web/sql/dog-demand.sql`:

- Select extract year 2026 and licenses active on 2025-12-31 (inclusive dates).
  Deduplicate the same seven fields as `db/demand_eda.sql` before ZIP aggregation.
  Exact-record deduplication does not identify distinct animals across renewals.
- Trim ZIPs and require five digits for allocation. Remove commas from PLUTO
  `unitsres`, accept nonnegative integer strings, and treat invalid/missing units
  as unknown. Zero-unit parcels receive no allocation. No ZIP padding or ZIP+4
  conversion is inferred.
- Allocate each ZIP's license count proportionally over its known positive
  residential units, including parcels without coordinates in the denominator.
  Invalid residential capacity cannot be quantified and is flagged; estimates
  assume the known unit totals represent the ZIP's usable residential capacity.
- Use full-resolution NTA polygons and `ST_Covers` to assign each parcel point.
  Exclude parcels matching zero or multiple NTAs; never duplicate or arbitrarily
  assign demand at shared boundaries. Missing-coordinate allocations remain
  excluded rather than redistributed. Borough/name filters do not change this.
- Report unmatched/invalid licensing ZIPs and ZIPs without positive units in
  `zipDiagnostics`. `summary` separates unallocatable demand, missing-coordinate
  demand, outside-NTA demand, and ambiguous-NTA demand. Conservation identities:
  active records = unallocatable + parcel allocations; parcel allocations = NTA
  allocations + missing-coordinate + outside-NTA + ambiguous allocations.
  Numeric residuals should be zero within floating-point tolerance.
- NTA residential units include all known units spatially assigned there; covered
  units include only those with an allocatable ZIP. The rate uses covered units,
  so missing ZIPs are not interpreted as zero demand. Partial coverage and invalid
  unit counts are flagged. Gray means no covered units or no 2026 license source;
  white means covered residential units with zero active licenses in their ZIPs.

These are **Estimated Licensed-Dog Demand** values, not actual dog population or
observed dog locations. The model assumes uniform license density per residential
unit within each ZIP. Licensing participation, unknown residential capacity, and
different source vintages can bias estimates. Missing coordinates cannot be
attributed to a particular NTA, so those exclusions are reported globally/by ZIP.

Validation against PostGIS uses temporary tables in a rolled-back transaction;
production tables are not changed:

```bash
docker compose exec -T web env RUN_DB_TESTS=1 npm test
```

The fixture checks exact duplicates, date/extract filtering, comma-formatted
units, invalid/zero units, unmatched/invalid ZIPs, missing coordinates, outside
NTAs, shared-boundary ambiguity, zero versus missing demand, and conservation.
For live data, inspect `/api/dog-demand`: `conservation_error` and
`spatial_conservation_error` should be near zero; each allocatable ZIP's
`allocated_demand` should equal its `dogs`. `assigned_residential_parcels` divided
by `residential_parcels` measures point assignment coverage. Tests are skipped
unless `RUN_DB_TESTS` is set and use the configured `DATABASE_URL`.
