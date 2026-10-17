# CSE6242 Project

This database importer supports these datasets:

- [NYC Open Data Dog Runs](https://data.cityofnewyork.us/Recreation/Dog-Runs/hxx3-bwgv)
- [NYC Dog Licensing](https://data.cityofnewyork.us/Health/NYC-Dog-Licensing-Dataset/nu7n-tubp)
- [NYC Parks Active and Passive Recreation](https://data.cityofnewyork.us/Recreation/NYC-Parks-Active-and-Passive-Recreation/kcqe-vnci)
- [Primary Land Use Tax Lot Output (PLUTO)](https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks/about_data)
- [Parks Inspection Program Inventory](https://data.cityofnewyork.us/City-Government/Parks-Inspection-Program-Inventory/86a8-pqby)
- [311 Service Requests from 2020 to Present](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2020-to-Present/erm2-nwe9)

## Initial setup

Create a `datasets/` folder and place the CSV exports in it using these filename
patterns:

- Dog Runs: `Dog_Runs_*.csv`
- Dog Licensing: `NYC_Dog_Licensing_Dataset_*.csv`
- Parks Active and Passive Recreation: `NYC_Parks_Active_and_Passive_Recreation_*.csv`
- PLUTO: `Primary_Land_Use_Tax_Lot_Output_(PLUTO)_*.csv`
- Parks Inspection Inventory: `Parks_Inspection_Program_*_Inventory_*.csv`
- 311 Service Requests: `311_Service_Requests_from_2020_to_Present_*.csv`

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
Parks Inspection Inventory, and 311 Service Requests CSVs are skipped; a Dog Runs
CSV is required.

Verify the import:

```bash
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM dog_runs;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM dog_licenses;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM parks_recreation;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM pluto;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM park_inspection_inventory;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM service_requests_311;"
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

Rebuild the database image before the first Dog Licensing import into an existing
database volume:

```bash
docker compose up --build -d
docker compose exec db import-dog-licenses
docker compose exec db import-parks-recreation
docker compose exec db import-pluto
docker compose exec db import-park-inspection-inventory
docker compose exec db import-service-requests-311
```

> **Note:** Automatic schema initialization runs only when Docker creates a new
> database volume. It does not run again for an existing database volume.
