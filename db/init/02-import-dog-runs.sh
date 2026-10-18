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

if find /datasets -maxdepth 1 -type f -iname 'DOHMH_Dog_Bite_Data_*.csv' -print -quit | grep -q .; then
  /usr/local/bin/import-dog-bites
else
  echo "No DOHMH_Dog_Bite_Data_*.csv file found; skipping Dog Bites import"
fi

if find /datasets -maxdepth 1 -type f -iname 'Walk_to_a_Park_Service_Area_for_CEQR_Open_Space_Assessment_*.csv' -print -quit | grep -q .; then
  /usr/local/bin/import-walk-to-park-service-areas
else
  echo "No Walk_to_a_Park_Service_Area_for_CEQR_Open_Space_Assessment_*.csv file found; skipping Walk to Park Service Areas import"
fi

if find /datasets -maxdepth 1 -type f -iname '2020_Neighborhood_Tabulation_Areas_(NTAs)_*.csv' -print -quit | grep -q .; then
  /usr/local/bin/import-nta-2020
else
  echo "No 2020_Neighborhood_Tabulation_Areas_(NTAs)_*.csv file found; skipping 2020 Neighborhood Tabulation Areas import"
fi
