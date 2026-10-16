FROM postgis/postgis:17-3.5

COPY db/init/01-schema.sql /docker-entrypoint-initdb.d/01-schema.sql
COPY db/init/02-import-dog-runs.sh /docker-entrypoint-initdb.d/02-import-dog-runs.sh
COPY db/import-dog-runs.sh /usr/local/bin/import-dog-runs
COPY db/import-dog-licenses.sh /usr/local/bin/import-dog-licenses
COPY db/import-pluto.sh /usr/local/bin/import-pluto

RUN chmod +x /docker-entrypoint-initdb.d/02-import-dog-runs.sh \
    /usr/local/bin/import-dog-runs \
    /usr/local/bin/import-dog-licenses
