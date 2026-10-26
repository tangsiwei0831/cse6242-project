FROM postgis/postgis:17-3.5

COPY db/init/01-schema.sql /docker-entrypoint-initdb.d/01-schema.sql
COPY db/pluto-schema.sql /docker-entrypoint-initdb.d/pluto-schema.sql
COPY db/pluto-schema.sql /usr/local/share/pluto-schema.sql
COPY db/service-requests-311-schema.sql /docker-entrypoint-initdb.d/service-requests-311-schema.sql
COPY db/service-requests-311-schema.sql /usr/local/share/service-requests-311-schema.sql
COPY db/init/02-import-dog-runs.sh /docker-entrypoint-initdb.d/02-import-dog-runs.sh
COPY web/sql/map-aggregates-schema.sql /docker-entrypoint-initdb.d/03-map-aggregates.sql
COPY db/import-dog-runs.sh /usr/local/bin/import-dog-runs
COPY db/import-dog-licenses.sh /usr/local/bin/import-dog-licenses
COPY db/import-parks-recreation.sh /usr/local/bin/import-parks-recreation
COPY db/import-pluto.sh /usr/local/bin/import-pluto
COPY db/import-park-inspection-inventory.sh /usr/local/bin/import-park-inspection-inventory
COPY db/import-service-requests-311.sh /usr/local/bin/import-service-requests-311
COPY db/import-dog-bites.sh /usr/local/bin/import-dog-bites
COPY db/import-walk-to-park-service-areas.sh /usr/local/bin/import-walk-to-park-service-areas
COPY db/import-nta-2020.sh /usr/local/bin/import-nta-2020

RUN sed -i 's/\r$//' /docker-entrypoint-initdb.d/02-import-dog-runs.sh \
    /usr/local/bin/import-dog-runs \
    /usr/local/bin/import-dog-licenses \
    /usr/local/bin/import-parks-recreation \
    /usr/local/bin/import-pluto \
    /usr/local/bin/import-park-inspection-inventory \
    /usr/local/bin/import-service-requests-311 \
    /usr/local/bin/import-dog-bites \
    /usr/local/bin/import-walk-to-park-service-areas \
    /usr/local/bin/import-nta-2020 && \
    chmod +x /docker-entrypoint-initdb.d/02-import-dog-runs.sh \
    /usr/local/bin/import-dog-runs \
    /usr/local/bin/import-dog-licenses \
    /usr/local/bin/import-parks-recreation \
    /usr/local/bin/import-pluto \
    /usr/local/bin/import-park-inspection-inventory \
    /usr/local/bin/import-service-requests-311 \
    /usr/local/bin/import-dog-bites \
    /usr/local/bin/import-walk-to-park-service-areas \
    /usr/local/bin/import-nta-2020
