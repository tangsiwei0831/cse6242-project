#!/usr/bin/env bash
set -Eeuo pipefail

/usr/local/bin/import-dog-runs

if find /datasets -maxdepth 1 -type f -iname 'NYC_Dog_Licensing_Dataset_*.csv' -print -quit | grep -q .; then
  /usr/local/bin/import-dog-licenses
else
  echo "No NYC_Dog_Licensing_Dataset_*.csv file found; skipping Dog Licensing import"
fi

if find /datasets -maxdepth 1 -type f -iname 'NYC_Parks_Active_and_Passive_Recreation_*.csv' -print -quit | grep -q .; then
  /usr/local/bin/import-parks-recreation
else
  echo "No NYC_Parks_Active_and_Passive_Recreation_*.csv file found; skipping Parks Recreation import"
fi

if find /datasets -maxdepth 1 -type f -iname 'Primary_Land_Use_Tax_Lot_Output_(PLUTO)_*.csv' -print -quit | grep -q .; then
  /usr/local/bin/import-pluto
else
  echo "No Primary_Land_Use_Tax_Lot_Output_(PLUTO)_*.csv file found; skipping PLUTO import"
fi

if find /datasets -maxdepth 1 -type f -iname 'Parks_Inspection_Program_*_Inventory_*.csv' -print -quit | grep -q .; then
  /usr/local/bin/import-park-inspection-inventory
else
  echo "No Parks_Inspection_Program_*_Inventory_*.csv file found; skipping Parks Inspection Inventory import"
fi

if find /datasets -maxdepth 1 -type f -iname '311_Service_Requests_from_2020_to_Present_*.csv' -print -quit | grep -q .; then
  /usr/local/bin/import-service-requests-311
else
  echo "No 311_Service_Requests_from_2020_to_Present_*.csv file found; skipping 311 Service Requests import"
fi
