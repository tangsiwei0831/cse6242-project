# CSE6242 Project

This database importer supports CSV exports from the official
[NYC Open Data Dog Runs dataset](https://data.cityofnewyork.us/Recreation/Dog-Runs/hxx3-bwgv)
and [NYC Dog Licensing dataset](https://data.cityofnewyork.us/Health/NYC-Dog-Licensing-Dataset/nu7n-tubp).

## Initial setup

Create a `datasets/` folder and place the CSV exports in it. Name Dog Runs files
`Dog_Runs_*.csv` (for example, `Dog_Runs_20261012.csv`) and Dog Licensing files
`NYC_Dog_Licensing_Dataset_*.csv` (for example,
`NYC_Dog_Licensing_Dataset_20261013.csv`). The folder and its contents are
excluded from Git.

Create the folder first:

```bash
mkdir -p datasets
```

Download one or both CSV exports into `datasets/`, using the filenames above,
before starting Docker:

```bash
docker compose up --build -d
```

On initial startup, Docker creates the PostGIS schema and bulk-imports the newest
matching CSV for each dataset. A missing Dog Licensing CSV is skipped; a Dog Runs
CSV is required.

Verify the import:

```bash
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM dog_runs;"
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM dog_licenses;"
```

## Refresh the data

After placing a later matching CSV in `datasets/`, refresh the relevant table
with:

```bash
docker compose exec db import-dog-runs
docker compose exec db import-dog-licenses
```

The Dog Runs importer updates records by `OBJECTID`. Because the licensing export
has no stable record ID, its importer replaces the `dog_licenses` table contents
with the selected CSV as one transaction. Invalid or missing year values are
stored as `NULL`.

Rebuild the database image before the first Dog Licensing import into an existing
database volume:

```bash
docker compose up --build -d
docker compose exec db import-dog-licenses
```

> **Note:** Automatic schema initialization runs only when Docker creates a new
> database volume. It does not run again for an existing database volume.
