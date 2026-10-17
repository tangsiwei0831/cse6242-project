CREATE TABLE IF NOT EXISTS service_requests_311 (
    unique_key bigint PRIMARY KEY,
    created_date timestamp NOT NULL,
    closed_date timestamp,
    agency text,
    agency_name text,
    problem text,
    problem_detail text,
    additional_details text,
    location_type text,
    incident_zip text,
    incident_address text,
    street_name text,
    cross_street_1 text,
    cross_street_2 text,
    intersection_street_1 text,
    intersection_street_2 text,
    address_type text,
    city text,
    landmark text,
    facility_type text,
    status text,
    due_date timestamp,
    resolution_description text,
    resolution_action_updated_date timestamp,
    community_board text,
    council_district smallint,
    police_precinct text,
    bbl bigint,
    borough text,
    x_coordinate integer,
    y_coordinate integer,
    open_data_channel_type text,
    park_facility_name text,
    park_borough text,
    vehicle_type text,
    taxi_company_borough text,
    taxi_pick_up_location text,
    bridge_highway_name text,
    bridge_highway_direction text,
    road_ramp text,
    bridge_highway_segment text,
    latitude double precision,
    longitude double precision,
    location geometry(Point, 4326),
    source_file text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_requests_311_created_date_idx ON service_requests_311 (created_date);
CREATE INDEX IF NOT EXISTS service_requests_311_agency_idx ON service_requests_311 (agency);
CREATE INDEX IF NOT EXISTS service_requests_311_problem_idx ON service_requests_311 (problem);
CREATE INDEX IF NOT EXISTS service_requests_311_status_idx ON service_requests_311 (status);
CREATE INDEX IF NOT EXISTS service_requests_311_borough_idx ON service_requests_311 (borough);
CREATE INDEX IF NOT EXISTS service_requests_311_incident_zip_idx ON service_requests_311 (incident_zip);
CREATE INDEX IF NOT EXISTS service_requests_311_location_gix ON service_requests_311 USING gist (location);
