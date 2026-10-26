-- Optional performance index; works for existing volumes as well as fresh installs.
-- The query remains correct without it, but parcel-by-parcel distance is slower.
CREATE INDEX IF NOT EXISTS dog_runs_active_geography_gix
    ON dog_runs USING gist ((geometry::geography))
    WHERE feature_status = 'Active';
