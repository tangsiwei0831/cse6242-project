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

## Estimated Licensed-Dog Demand and 800m Accessibility

The D3 map offers independent **Estimated demand** and **Accessibility / Underserved
Demand** neighborhood layers. Demand can show totals or licenses per 1,000 units;
accessibility colors NTAs by uncovered estimated demand. Hover for metrics, use
**Data coverage** for exclusions, and **Reload estimates** after preparing new data.
White represents zero demand for the selected metric; gray represents missing
allocatable data. Dog-run markers, filters, zoom, and detail cards remain independent.
The colors use a citywide square-root scale, unaffected by marker filters.

These are **Estimated Licensed-Dog Demand** values, not actual dog population or
observed dog locations. The allocation has not changed:

1. Use extract year 2026 and licenses active on **2025-12-31**, with inclusive dates.
2. Deduplicate the seven fields from `db/demand_eda.sql`: animal name, gender,
   birth year, breed, ZIP, issue date, and expiration date. Exact-record
   deduplication does not identify individual animals across different renewals.
3. Aggregate licensing records by trimmed ZIP before joining PLUTO. Require five
   ZIP digits for allocation; do not infer ZIP padding or ZIP+4 conversion.
4. Remove commas from `unitsres`; accept nonnegative integer strings. Invalid or
   missing capacity is unknown and flagged; zero-unit parcels get no allocation.
5. Allocate each ZIP's count in proportion to known positive residential units.
   Parcels without coordinates remain in the ZIP denominator; their shares are
   excluded from mapped demand rather than redistributed. Unknown capacity cannot
   be quantified, so results assume the known unit totals represent usable capacity.
6. Assign parcel points using full-resolution NTA polygons and `ST_Covers`.
   Zero/multiple matches remain unassigned; shared boundaries never double-count.

NTA `residentialUnits` includes all known spatially assigned units;
`coveredResidentialUnits` means units with allocatable ZIP data, **not** units
within 800m of a run. The demand rate uses this allocatable-unit denominator.
Unmatched/invalid ZIPs, ZIPs without positive units, missing coordinates, invalid
locations, outside-NTA demand, ambiguous assignment, and partial data remain
explicitly accounted for. Licensing participation and source vintages can bias estimates.

### Accessibility definition

Only positive-unit residential parcels with valid nonempty WGS84 point locations
are eligible. A parcel is covered if its **spheroidal geography distance to an active
dog-run polygon boundary or interior is ≤800 meters**. Points inside runs have zero
distance. Inactive runs are excluded; overlapping service areas never duplicate demand.

The optimized query tests `ST_DWithin(point::geography, polygon::geography, 800, true)`.
This is the same condition as minimum active-polygon distance ≤800m; it avoids
computing unused nearest distances for every distant parcel. It uses no approximate
buffers, projected distances, or spherical nearest-neighbor ranking. A run-first
lateral join searches the parcel geography GiST index once per active run; `OFFSET 0`
keeps PostgreSQL from reversing that join because of poor validity selectivity estimates.

Per NTA, the API reports `accessibilityTotalDemand`, `coveredDemand`,
`uncoveredDemand`, and `coveragePercentage = 100 * covered / total`. Zero total demand
has an undefined (`null`) coverage percentage. If there are no active runs, all eligible
demand is uncovered and flagged. Valid-location demand without a unique NTA is counted
globally but excluded from NTA metrics. Missing/invalid coordinates are never redistributed.

**800m is a straight-line service radius, not walking distance.** Streets, entrances,
barriers, opening hours, and run capacity are not modeled; coverage does not establish
service quality.

### First preparation and refresh after imports

Start the existing stack, then prepare the aggregates:

```bash
docker compose up --build -d
docker compose exec -T web node scripts/refresh-map-data.js
```

For an existing stack, the second command installs the additive schema, revision
triggers, and parcel geography index automatically. It never deletes/reimports source
data. Index creation on the first installation can briefly block source writes; readers
remain available. Fresh database images also install this schema during initialization.
Snapshots still need to be prepared explicitly.

After the existing dataset import commands finish, run the same refresh command, then
click **Reload estimates** or reload <http://localhost:3000>. No volume reset is needed.
No importer changes are required. Optional maintenance commands:

```bash
# Publish demand without waiting for accessibility.
docker compose exec -T web node scripts/refresh-map-data.js --demand-only

# Sufficient after changing only Dog Runs.
docker compose exec -T web node scripts/refresh-map-data.js --accessibility-only

# Install schema/indexes without computing aggregates.
docker compose exec -T web node scripts/refresh-map-data.js --install-only
```

The default command publishes **demand first**, commits it, then prepares accessibility.
Each calculation uses a repeatable-read transaction. Conservation validation must pass
before a single atomic upsert publishes its result. A source-version check at publication
rejects imports committed during calculation; rerun after imports finish. The final version
lock is short, rather than blocking imports throughout the spatial calculation. A session
advisory lock prevents overlapping refresh commands. Errors/cancellation retain previously
published snapshots; a default run may successfully publish demand even if accessibility
later fails. Incomplete/missing source datasets are not published as zero-demand results.

Run refresh explicitly after SQL/model changes as well. HTTP requests never perform DDL,
spatial calculations, or automatic refreshes.

### Persistence, API states, and cache invalidation

`map_aggregate_snapshots` stores two durable aggregate JSON snapshots, keyed by `demand`
and `accessibility`, plus revision, unique publication generation, timestamp, and duration.
Only aggregate statistics are stored/returned; no animal attributes or individual license
records are exposed. Snapshots survive web/database restarts.

| Endpoint | Prepared output |
| --- | --- |
| `GET /api/dog-demand` | Demand-only NTA metrics, ZIP diagnostics, source availability, conservation summary |
| `GET /api/dog-accessibility` | Accessibility metrics/summary plus the same demand diagnostics for its source snapshot |

Statement triggers track normal inserts, updates, deletes, and truncates, including the
existing import scripts. Licensing, PLUTO, and NTA changes invalidate both kinds; Dog Run
changes invalidate accessibility only. Each kind has its own revision counter, so revision
numbers across the two kinds need not be equal.

Every API read checks the current PostgreSQL source revision and published generation.
An in-memory hit avoids transferring/parsing the stored JSON again; it never skips that
check. A new publication invalidates memory caches immediately, even when sources did not
change. There is **no five-minute expiry that starts spatial work**. `X-Aggregate-Cache`
reports `miss`/`hit`; browser responses use `Cache-Control: no-store`.

Before preparation, the endpoint returns HTTP 503 with `status: not_ready`. After imports,
an obsolete snapshot returns HTTP 503 with `status: stale` until refreshed; it is retained
in storage but never silently served as current. During refresh of unchanged sources,
readers continue to receive the previous valid generation. Database errors do not fall
back to unchecked cached values.

The frontend loads markers, demand, and accessibility independently. A pending, stale,
or failed accessibility response cannot hold up demand. Each view shows its own loading,
preparation, stale, or unavailable message and prepared timestamp. Changing layers never
mixes demand data from one response with accessibility data from another.

### Files

| File | Responsibility |
| --- | --- |
| `web/sql/demand-base.sql` | Single shared ZIP → PLUTO → NTA model and demand diagnostics/payload |
| `web/sql/dog-demand.sql` | Demand-only output, with no run-distance computation |
| `web/sql/dog-accessibility.sql` | Exact 800m classification and accessibility aggregates |
| `web/lib/queries.js` | Compose both queries from the shared definition |
| `web/sql/map-aggregates-schema.sql` | Snapshot/version tables, source triggers, parcel geography index |
| `web/lib/refresh-aggregates.js` | Validation, consistent snapshots, atomic publication, refresh lock |
| `web/lib/aggregate-store.js` | Revision/generation-aware API memory cache |
| `web/scripts/refresh-map-data.js` | Explicit preparation/refresh CLI |
| `web/server.js`, `web/public/app.js` | Independent API routes and layer loading/rendering |

### Validation and benchmarks

```bash
# Includes isolated PostGIS fixtures; public source tables are not modified.
docker compose exec -T web env RUN_DB_TESTS=1 npm test

# Check the running server's conservation, persistence reads, and existing APIs.
docker compose exec -T web node scripts/verify-accessibility.js

# Fresh app instance guarantees application-cache misses, then measures hits.
# No server/source-data reset or OS/PostgreSQL buffer-cache flush is performed.
docker compose exec -T web node scripts/benchmark-map.js
```

Tests cover exact deduplication and unchanged demand-only/full results, invalid/zero units,
missing/invalid coordinates, ZIP/NTA exclusions, polygon interiors/boundaries,
799.9m/800m/800.1m, inactive/overlapping runs, and zero demand. Classification is compared
with brute-force minimum `ST_Distance`. Other tests cover import-trigger invalidation,
new publication generations, restart persistence, stale/not-ready responses, failure and
conservation-validation rollback, a concurrent import during calculation, concurrent
refresh rejection, independent frontend loading, colors/tooltips, and original marker
filters. Rendering tests use real D3 scales and a DOM adapter; they do not replace a
browser check of layout, pointer delivery, and zoom.

Conservation is checked at tolerance `1e-7` for API JSON numbers:

- Active records = unallocatable ZIP demand + all parcel allocations.
- Parcel allocations = NTA demand + missing-coordinate + outside-NTA + ambiguous demand.
- Parcel allocations = eligible accessibility demand + missing/invalid-location demand.
- Eligible accessibility demand = covered + uncovered = NTA total + unassigned NTA demand.
- Each NTA total = its covered + uncovered demand.

The optimized live results match the previous full calculation:

| Metric | Estimated licensed-dog demand |
| --- | ---: |
| NTA total | 63,697.425617 |
| NTA covered within 800m | 25,802.526867 |
| NTA uncovered beyond 800m | 37,894.898750 |
| Valid-location demand without a unique NTA | 34.689816 |
| Missing-coordinate demand | 2.884567 |
| Invalid-location demand | 0 |

Another 275 records remain unallocatable by ZIP/units. All accessibility conservation
residuals were zero; the original ZIP residual was approximately `3.46e-15` and original
spatial residual was zero. Existing APIs returned 95 active runs, 41 Manhattan runs,
and 262 NTA polygons.

Measured local maintenance time (outside API requests): **57.251s demand** and
**112.605s accessibility** with the final run-first plan, versus **1,335.143s** for the
previous combined cold query. Accessibility refresh is about **11.9× faster**. First
installation/index-build time is separate. Refresh is still substantial spatial work,
but visitors never wait for it and current valid snapshots remain readable during it.

Final application-cache benchmark (a fresh app/pool; PostgreSQL buffers were not reset):

| API | Memory-cache miss | Memory-cache hit |
| --- | ---: | ---: |
| Demand | 111.03ms | 7.38ms |
| Accessibility | 12.12ms | 3.66ms |

The first demand request includes connection/app startup overhead. These are local samples,
not latency guarantees. `metadata.queryDurationMs` reports maintenance calculation time,
not API read time; `computedAt`, `sourceRevision`, and `generation` identify its snapshot.
