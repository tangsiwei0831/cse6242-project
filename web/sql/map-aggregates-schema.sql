-- Idempotent installation; source tables/data are never replaced.
CREATE TABLE IF NOT EXISTS map_source_versions (
    kind text PRIMARY KEY CHECK (kind IN ('demand', 'accessibility')),
    revision bigint NOT NULL DEFAULT 1
);
INSERT INTO map_source_versions(kind) VALUES ('demand'), ('accessibility') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS map_aggregate_snapshots (
    kind text PRIMARY KEY REFERENCES map_source_versions(kind),
    source_revision bigint NOT NULL,
    generation text NOT NULL,
    computed_at timestamptz NOT NULL,
    duration_ms bigint NOT NULL,
    payload jsonb NOT NULL
);

CREATE OR REPLACE FUNCTION bump_map_source_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- Resolve to the source table's schema, including in isolated test schemas.
    IF TG_TABLE_NAME = 'dog_runs' THEN
        EXECUTE format('UPDATE %I.map_source_versions SET revision = revision + 1 WHERE kind = ''accessibility''', TG_TABLE_SCHEMA);
    ELSE
        EXECUTE format('UPDATE %I.map_source_versions SET revision = revision + 1', TG_TABLE_SCHEMA);
    END IF;
    RETURN NULL;
END;
$$;
DO $$
DECLARE source text;
BEGIN
    FOREACH source IN ARRAY ARRAY['dog_licenses', 'pluto', 'nta_2020', 'dog_runs'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = source::regclass AND tgname = 'map_source_changed') THEN
            EXECUTE format('CREATE TRIGGER map_source_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION bump_map_source_version()', source);
        END IF;
    END LOOP;
END;
$$;

-- Readers remain available during installation; the first index build can
-- briefly block source writes. Subsequent refreshes only check index existence.
CREATE INDEX IF NOT EXISTS pluto_valid_location_geography_gix
    ON pluto USING gist ((location::geography))
    WHERE location IS NOT NULL AND NOT ST_IsEmpty(location) AND ST_IsValid(location)
      AND ST_X(location) BETWEEN -180 AND 180 AND ST_Y(location) BETWEEN -90 AND 90;
