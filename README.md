# CSE6242 Project

This project uses PostgreSQL 17 with PostGIS, running in Docker. CSV files stay
in `datasets/` and are mounted read-only into the database container.

## Prerequisites

- Docker Desktop with Docker Compose
- A Dog Runs CSV in `datasets/` named `Dog_Runs_*.csv`

## Start the database and import data

```powershell
docker compose up --build -d
```

On the first start, Docker creates the schema and imports the newest matching
Dog Runs CSV. Database files are retained in the `postgres_data` Docker volume.

Check container health and logs:

```powershell
docker compose ps
docker compose logs db
```

Verify the import:

```powershell
docker compose exec db psql -U cse6242 -d cse6242 -c "SELECT count(*) FROM dog_runs;"
```

The current file should produce 95 rows.

## Connect to PostgreSQL

Default local connection values:

| Setting | Value |
| --- | --- |
| Host | `localhost` |
| Port | `5432` |
| Database | `cse6242` |
| User | `cse6242` |
| Password | `cse6242_local` |

Override these values in `.env`. Do not commit `.env`.

Open an interactive connection inside the container:

```powershell
docker compose exec db psql -U cse6242 -d cse6242
```

Example spatial query returning the center point of each dog run:

```sql
SELECT name, ST_AsText(ST_Centroid(geometry)) AS center
FROM dog_runs
ORDER BY name;
```

## Import a newer Dog Runs CSV

Place the file in `datasets/`, then run:

```powershell
docker compose exec db import-dog-runs
```

The importer selects the last filename matching `Dog_Runs_*.csv`. To select a
specific file, pass its path inside the container:

```powershell
docker compose exec db import-dog-runs /datasets/Dog_Runs_20261012.csv
```

Imports use PostgreSQL `COPY` for bulk loading and then upsert on `OBJECTID`, so
running an import again updates existing rows rather than duplicating them. Each
run is recorded in `data_imports`.

## Schema

`dog_runs` contains the cleaned source fields. Important transformations are:

- `OBJECTID` is stored as an integer after removing thousands separators.
- `the_geom` is stored as PostGIS `geometry(MultiPolygon, 4326)`.
- Blank values become SQL `NULL` where appropriate.
- Administrative identifiers and `ZIPCODE` remain text because a row can
  contain multiple values (for example, precinct `20, 24`).
- `source_file`, `imported_at`, and `updated_at` preserve import provenance.

Indexes are provided for geometry, borough, ZIP code, and feature status.

## Adding large datasets

For each new CSV type, add:

1. A typed destination table in `db/init/01-schema.sql`.
2. A temporary all-text staging table in a new import script.
3. A `COPY` into staging followed by validation and conversion into the typed
   table.
4. Indexes on columns used for filtering, joining, and spatial queries.

This staging pattern works well for files with hundreds of thousands or
millions of rows and avoids loading an entire CSV into application memory.

## Recreate everything

Normal `docker compose down` keeps the database volume. To intentionally delete
the local database and rerun all initialization scripts from scratch:

```powershell
docker compose down -v
docker compose up --build -d
```

The `-v` command permanently removes the local database volume; the source CSV
files in `datasets/` are not removed.
