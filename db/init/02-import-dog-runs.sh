#!/usr/bin/env bash
set -Eeuo pipefail

/usr/local/bin/import-dog-runs

if find /datasets -maxdepth 1 -type f -iname 'NYC_Dog_Licensing_Dataset_*.csv' -print -quit | grep -q .; then
  /usr/local/bin/import-dog-licenses
else
  echo "No NYC_Dog_Licensing_Dataset_*.csv file found; skipping Dog Licensing import"
fi
