CREATE EXTENSION IF NOT EXISTS postgis;

\ir pluto-schema.sql
\ir service-requests-311-schema.sql

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

CREATE TABLE IF NOT EXISTS dog_licenses (
    license_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    animal_name text,
    animal_gender text,
    animal_birth_year smallint,
    breed_name text,
    zipcode text,
    license_issued_date date,
    license_expired_date date,
    extract_year smallint,
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dog_licenses_zipcode_idx ON dog_licenses (zipcode);
CREATE INDEX IF NOT EXISTS dog_licenses_breed_name_idx ON dog_licenses (breed_name);
CREATE INDEX IF NOT EXISTS dog_licenses_extract_year_idx ON dog_licenses (extract_year);

CREATE TABLE IF NOT EXISTS parks_recreation (
    recreation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gis_property_number text NOT NULL,
    sign_name text,
    recreation_category text,
    open_space_acres numeric,
    active_percent numeric,
    passive_percent numeric,
    active_acres numeric,
    passive_acres numeric,
    type_category text,
    location text,
    zipcodes text,
    borough_census_tracts text,
    borough text,
    geometry geometry(MultiPolygon, 4326) NOT NULL,
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parks_recreation_geometry_gix ON parks_recreation USING gist (geometry);
CREATE INDEX IF NOT EXISTS parks_recreation_gis_property_number_idx ON parks_recreation (gis_property_number);
CREATE INDEX IF NOT EXISTS parks_recreation_borough_idx ON parks_recreation (borough);
CREATE INDEX IF NOT EXISTS parks_recreation_category_idx ON parks_recreation (recreation_category);

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

CREATE TABLE IF NOT EXISTS data_imports (
    import_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dataset_name text NOT NULL,
    source_file text NOT NULL,
    rows_staged integer NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);
