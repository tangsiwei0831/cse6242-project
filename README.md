# CSE6242 Project

The interactive dog-run planning map uses these six datasets:

- [NYC Open Data Dog Runs](https://data.cityofnewyork.us/Recreation/Dog-Runs/hxx3-bwgv)
- [NYC Dog Licensing](https://data.cityofnewyork.us/Health/NYC-Dog-Licensing-Dataset/nu7n-tubp)
- [NYC Parks Active and Passive Recreation](https://data.cityofnewyork.us/Recreation/NYC-Parks-Active-and-Passive-Recreation/kcqe-vnci)
- [Primary Land Use Tax Lot Output (PLUTO)](https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks/about_data)
- [311 Service Requests from 2020 to Present](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2020-to-Present/erm2-nwe9)
- [2020 Neighborhood Tabulation Areas (NTAs)](https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd/about_data)

## Initial setup

Create a `datasets/` folder and place the CSV exports in it using these filename
patterns:

- Dog Runs: `Dog_Runs_*.csv`
- Dog Licensing: `NYC_Dog_Licensing_Dataset_*.csv`
- Parks Active and Passive Recreation: `NYC_Parks_Active_and_Passive_Recreation_*.csv`
- PLUTO: `Primary_Land_Use_Tax_Lot_Output_(PLUTO)_*.csv`
- 311 Service Requests: `311_Service_Requests_from_2020_to_Present_*.csv`
- 2020 Neighborhood Tabulation Areas: `2020_Neighborhood_Tabulation_Areas_(NTAs)_*.csv`

The wildcard accommodates dated exports. The `datasets/` folder and its contents are excluded from
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
matching CSV for each dataset. Missing Dog Licensing, Parks Recreation, PLUTO, 311 Service Requests, and 2020 Neighborhood Tabulation Areas CSVs are skipped; a
Dog Runs CSV is required.

Verify the import:

```bash
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM dog_runs;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM dog_licenses;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM parks_recreation;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM pluto;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM service_requests_311;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM nta_2020;"
```

## Interactive dog run map

The Docker stack includes a responsive D3 map backed by the PostGIS `dog_runs`
and `nta_2020` tables. After starting the stack, open:

<http://localhost:3000>

The map has three independent layers: **Candidate parks**, **Dog-run demand**,
and **Dog-related complaints**. Candidate parks are shown as green outlined
squares; squares are filled when an active dog run is mapped to that park, and
rank numbers appear inside markers included in the configurable top-candidate
list (10 parks by default). Hover over a square for its score context and
strongest scoring factor, or select it for the full factor breakdown. The left
panel separates parks with existing dog runs from the top-ranked candidate
parks; use the top-count field to change how many candidates are listed.

Use the **Existing dog-run parks** radio options to include or exclude parks
that already have a mapped active dog run from scoring and the top-candidate
list; the separate existing-dog-run section continues to show those parks. The
map continues to show every park in either setting. Scores use
adjustable weights for latest-year license demand, distance to the nearest
active dog run, neighborhood dog-related 311 volume, and reported park
acreage. Restore the default weights with **Reset to default**. These scores are
exploratory comparisons rather than construction recommendations or site
approvals.

The Dog-run demand layer maps the latest dog-license extract by NTA. Since
licenses contain ZIP codes rather than coordinates, ZIP totals are apportioned
among overlapping NTAs using the distribution of PLUTO address points, then
divided by NTA area. The Dog-related complaints layer groups mapped requests
into roughly 100-meter cells. Set `WEB_PORT` in `.env` to expose the map on a
different host port.

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
docker compose exec db import-service-requests-311
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

The 311 importer transactionally replaces `service_requests_311` using the
export's unique request key. Source dates are stored as local timestamps and the
`Location` WKT is stored as nullable PostGIS `Point` geometry in SRID 4326.

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
docker compose exec db import-service-requests-311
docker compose exec db import-nta-2020
```

> **Note:** Automatic schema initialization runs only when Docker creates a new
> database volume. It does not run again for an existing database volume.
