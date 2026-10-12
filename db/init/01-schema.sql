CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS dog_runs (
    object_id integer PRIMARY KEY,
    system_id text,
    geometry geometry(MultiPolygon, 4326) NOT NULL,
    gis_property_number text,
    department text NOT NULL,
    parent_id text,
    community_board text,
    council_district text,
    precinct text,
    zipcode text,
    borough text NOT NULL,
    dog_area_type text NOT NULL,
    name text NOT NULL,
    seating text,
    surface text,
    feature_status text NOT NULL,
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dog_runs_geometry_gix ON dog_runs USING gist (geometry);
CREATE INDEX IF NOT EXISTS dog_runs_borough_idx ON dog_runs (borough);
CREATE INDEX IF NOT EXISTS dog_runs_zipcode_idx ON dog_runs (zipcode);
CREATE INDEX IF NOT EXISTS dog_runs_feature_status_idx ON dog_runs (feature_status);

CREATE TABLE IF NOT EXISTS data_imports (
    import_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dataset_name text NOT NULL,
    source_file text NOT NULL,
    rows_staged integer NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);
