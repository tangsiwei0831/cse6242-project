#!/usr/bin/env bash
set -Eeuo pipefail

csv_file="${1:-}"
if [[ -z "${csv_file}" ]]; then
  csv_file="$(find /datasets -maxdepth 1 -type f -iname '311_Service_Requests_from_2020_to_Present_*.csv' -print | sort | tail -n 1)"
fi
if [[ -z "${csv_file}" || ! -f "${csv_file}" ]]; then
  echo "No 311_Service_Requests_from_2020_to_Present_*.csv file found in /datasets" >&2
  exit 1
fi

echo "Importing ${csv_file}"
psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --file=/usr/local/share/service-requests-311-schema.sql

psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 --set=csv_file="${csv_file}" <<'SQL'
BEGIN;

CREATE TEMP TABLE service_requests_311_stage (
    unique_key text, created_date text, closed_date text, agency text,
    agency_name text, problem text, problem_detail text, additional_details text,
    location_type text, incident_zip text, incident_address text, street_name text,
    cross_street_1 text, cross_street_2 text, intersection_street_1 text,
    intersection_street_2 text, address_type text, city text, landmark text,
    facility_type text, status text, due_date text, resolution_description text,
    resolution_action_updated_date text, community_board text,
    council_district text, police_precinct text, bbl text, borough text,
    x_coordinate text, y_coordinate text, open_data_channel_type text,
    park_facility_name text, park_borough text, vehicle_type text,
    taxi_company_borough text, taxi_pick_up_location text,
    bridge_highway_name text, bridge_highway_direction text, road_ramp text,
    bridge_highway_segment text, latitude text, longitude text, location_wkt text
) ON COMMIT DROP;

SELECT format(
    'COPY service_requests_311_stage FROM %L WITH (FORMAT csv, HEADER true, ENCODING ''UTF8'')',
    :'csv_file'
) \gexec

TRUNCATE TABLE service_requests_311;

INSERT INTO service_requests_311 (
    unique_key, created_date, closed_date, agency, agency_name, problem,
    problem_detail, additional_details, location_type, incident_zip,
    incident_address, street_name, cross_street_1, cross_street_2,
    intersection_street_1, intersection_street_2, address_type, city, landmark,
    facility_type, status, due_date, resolution_description,
    resolution_action_updated_date, community_board, council_district,
    police_precinct, bbl, borough, x_coordinate, y_coordinate,
    open_data_channel_type, park_facility_name, park_borough, vehicle_type,
    taxi_company_borough, taxi_pick_up_location, bridge_highway_name,
    bridge_highway_direction, road_ramp, bridge_highway_segment, latitude,
    longitude, location, source_file
)
SELECT
    replace(trim(unique_key), ',', '')::bigint,
    to_timestamp(trim(created_date), 'MM/DD/YYYY HH12:MI:SS AM')::timestamp,
    CASE WHEN trim(closed_date) <> '' THEN to_timestamp(trim(closed_date), 'MM/DD/YYYY HH12:MI:SS AM')::timestamp END,
    nullif(trim(agency), ''), nullif(trim(agency_name), ''),
    nullif(trim(problem), ''), nullif(trim(problem_detail), ''),
    nullif(trim(additional_details), ''), nullif(trim(location_type), ''),
    nullif(trim(incident_zip), ''), nullif(trim(incident_address), ''),
    nullif(trim(street_name), ''), nullif(trim(cross_street_1), ''),
    nullif(trim(cross_street_2), ''), nullif(trim(intersection_street_1), ''),
    nullif(trim(intersection_street_2), ''), nullif(trim(address_type), ''),
    nullif(trim(city), ''), nullif(trim(landmark), ''),
    nullif(trim(facility_type), ''), nullif(trim(status), ''),
    CASE WHEN trim(due_date) <> '' THEN to_timestamp(trim(due_date), 'MM/DD/YYYY HH12:MI:SS AM')::timestamp END,
    nullif(trim(resolution_description), ''),
    CASE WHEN trim(resolution_action_updated_date) <> '' THEN to_timestamp(trim(resolution_action_updated_date), 'MM/DD/YYYY HH12:MI:SS AM')::timestamp END,
    nullif(trim(community_board), ''),
    CASE WHEN trim(council_district) ~ '^\d+$' THEN trim(council_district)::smallint END,
    nullif(trim(police_precinct), ''),
    CASE WHEN replace(trim(bbl), ',', '') ~ '^\d+$' THEN replace(trim(bbl), ',', '')::bigint END,
    nullif(trim(borough), ''),
    CASE WHEN replace(trim(x_coordinate), ',', '') ~ '^-?\d+$' THEN replace(trim(x_coordinate), ',', '')::integer END,
    CASE WHEN replace(trim(y_coordinate), ',', '') ~ '^-?\d+$' THEN replace(trim(y_coordinate), ',', '')::integer END,
    nullif(trim(open_data_channel_type), ''), nullif(trim(park_facility_name), ''),
    nullif(trim(park_borough), ''), nullif(trim(vehicle_type), ''),
    nullif(trim(taxi_company_borough), ''), nullif(trim(taxi_pick_up_location), ''),
    nullif(trim(bridge_highway_name), ''), nullif(trim(bridge_highway_direction), ''),
    nullif(trim(road_ramp), ''), nullif(trim(bridge_highway_segment), ''),
    CASE WHEN trim(latitude) ~ '^-?\d+(\.\d+)?$' THEN trim(latitude)::double precision END,
    CASE WHEN trim(longitude) ~ '^-?\d+(\.\d+)?$' THEN trim(longitude)::double precision END,
    CASE WHEN trim(location_wkt) <> '' THEN ST_GeomFromText(trim(location_wkt), 4326)::geometry(Point, 4326) END,
    regexp_replace(:'csv_file', '^.*/', '')
FROM service_requests_311_stage;

INSERT INTO data_imports (dataset_name, source_file, rows_staged)
SELECT 'service_requests_311', regexp_replace(:'csv_file', '^.*/', ''), count(*)::integer
FROM service_requests_311_stage;

COMMIT;
SQL

echo "311 Service Requests import complete"
