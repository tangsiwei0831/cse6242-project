CREATE TABLE IF NOT EXISTS pluto (
    borough text, tax_block text, tax_lot text, community_board text,
    census_tract_2010 text, cb2010 text, schooldist text, council_district text,
    postcode text, firecomp text, policeprct text, healtharea text,
    sanitboro text, sanitsub text, address text, zonedist1 text,
    zonedist2 text, zonedist3 text, zonedist4 text, overlay1 text,
    overlay2 text, spdist1 text, spdist2 text, spdist3 text,
    ltdheight text, splitzone text, bldgclass text, landuse text,
    easements text, ownertype text, ownername text, lotarea text,
    bldgarea text, comarea text, resarea text, officearea text,
    retailarea text, garagearea text, strgearea text, factryarea text,
    otherarea text, areasource text, numbldgs text, numfloors text,
    unitsres text, unitstotal text, lotfront text, lotdepth text,
    bldgfront text, bldgdepth text, ext text, proxcode text,
    irrlotcode text, lottype text, bsmtcode text, assessland text,
    assesstot text, exempttot text, yearbuilt text, yearalter1 text,
    yearalter2 text, histdist text, landmark text, builtfar text,
    residfar text, commfar text, facilfar text, affresfar text,
    mnffar text, borocode text, bbl text PRIMARY KEY, condono text,
    tract2010 text, xcoord text, ycoord text, latitude text,
    longitude text, zonemap text, zmcode text, sanborn text,
    taxmap text, edesignum text, appbbl text, appdate text,
    plutomapid text, version text, sanitdistrict text, healthcenterdistrict text,
    firm07_flag text, pfirm15_flag text, dcpedited text, notes text,
    bct2020 text, bctcb2020 text, mihopt1 text, mihopt2 text,
    mihopt3 text, mihopt4 text, transitzone text,
    geom geometry(MultiPolygon, 4326), basempdate text, dcasdate text,
    edesigdate text, landmkdate text, masdate text, polidate text,
    rpaddate text, zoningdate text,
    location geometry(Point, 4326),
    source_file text NOT NULL DEFAULT 'unknown',
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pluto_location_gix ON pluto USING gist (location);
CREATE INDEX IF NOT EXISTS pluto_geom_gix ON pluto USING gist (geom);
CREATE INDEX IF NOT EXISTS pluto_borough_idx ON pluto (borough);
CREATE INDEX IF NOT EXISTS pluto_postcode_idx ON pluto (postcode);
CREATE INDEX IF NOT EXISTS pluto_landuse_idx ON pluto (landuse);
CREATE INDEX IF NOT EXISTS pluto_community_board_idx ON pluto (community_board);
