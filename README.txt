NYC DOG-RUN PLANNING MAP - USER GUIDE

DESCRIPTION
This package provides an interactive map for exploring existing dog runs and
potential dog-run locations in New York City. It combines NYC Open Data on parks,
dog licenses, dog-related 311 complaints, land use, and neighborhood boundaries.

A D3 web interface displays candidate parks, neighborhood dog-run demand, and
complaints. Users can rank parks by adjusting weights for license demand,
distance to existing dog runs, complaint volume, and park acreage. A Node.js web
server and PostgreSQL/PostGIS database run together using Docker Compose.
Scores support exploratory comparisons, not site approvals.

INSTALLATION
1. Install Docker Desktop with Docker Compose and start Docker Desktop.
2. Extract this package and open a terminal in the project root (the folder
   containing docker-compose.yml).
3. Place NYC Open Data CSV exports in datasets/. Preserve these filename patterns:
   Dog_Runs_*.csv
   NYC_Dog_Licensing_Dataset_*.csv
   NYC_Parks_Active_and_Passive_Recreation_*.csv
   Primary_Land_Use_Tax_Lot_Output_(PLUTO)_*.csv
   311_Service_Requests_from_2020_to_Present_*.csv
   2020_Neighborhood_Tabulation_Areas_(NTAs)_*.csv
   Dataset download links are provided below. Dog Runs is required;
   include the other five listed datasets for the full demo. Missing files are
   skipped, so related layers or scores may be incomplete.
4. Optionally copy .env.example to .env to customize database settings.
   Defaults work without this file. Ports 3000 and 5432 must be available;
   set WEB_PORT and POSTGRES_PORT in .env if different ports are needed.
5. Build and start the application:
   docker compose up --build -d
   The first startup initializes the database and imports the newest matching
   CSV for each dataset. Allow the imports to finish before using the map.


EXECUTION
1. Open http://localhost:3000 in a browser (or use your configured WEB_PORT).
2. Toggle Candidate parks, Dog-run demand, and Dog-related complaints to explore
   the map. Hover over a park marker for a summary; select it for score details.
3. Adjust scoring weights and the top-candidate count to compare park rankings.
   Use Existing dog-run parks to include or exclude parks with active dog runs
   from scoring. Select Reset to default to restore the original weights.
4. Check startup status or troubleshoot an empty map with:
   docker compose ps
   docker compose logs db web
5. Stop the demo while keeping imported data:
   docker compose down
   Restart it later with:
   docker compose up -d

Automatic data import runs only when the database volume is first created.
For updated CSV files or an existing database, see the import commands under
"Refresh the data" in README.md.

DATASET DOWNLOAD LINKS
Open each page and use Export to download CSV, then save it in datasets/
with the filename pattern listed above.

NYC Open Data Dog Runs
https://data.cityofnewyork.us/Recreation/Dog-Runs/hxx3-bwgv

NYC Dog Licensing
https://data.cityofnewyork.us/Health/NYC-Dog-Licensing-Dataset/nu7n-tubp

NYC Parks Active and Passive Recreation
https://data.cityofnewyork.us/Recreation/NYC-Parks-Active-and-Passive-Recreation/kcqe-vnci

Primary Land Use Tax Lot Output (PLUTO)
https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks/about_data

311 Service Requests from 2020 to Present
https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2020-to-Present/erm2-nwe9/explore/query/SELECT%0A%20%20%60unique_key%60%2C%0A%20%20%60created_date%60%2C%0A%20%20%60closed_date%60%2C%0A%20%20%60agency%60%2C%0A%20%20%60agency_name%60%2C%0A%20%20%60complaint_type%60%2C%0A%20%20%60descriptor%60%2C%0A%20%20%60descriptor_2%60%2C%0A%20%20%60location_type%60%2C%0A%20%20%60incident_zip%60%2C%0A%20%20%60incident_address%60%2C%0A%20%20%60street_name%60%2C%0A%20%20%60cross_street_1%60%2C%0A%20%20%60cross_street_2%60%2C%0A%20%20%60intersection_street_1%60%2C%0A%20%20%60intersection_street_2%60%2C%0A%20%20%60address_type%60%2C%0A%20%20%60city%60%2C%0A%20%20%60landmark%60%2C%0A%20%20%60facility_type%60%2C%0A%20%20%60status%60%2C%0A%20%20%60due_date%60%2C%0A%20%20%60resolution_description%60%2C%0A%20%20%60resolution_action_updated_date%60%2C%0A%20%20%60community_board%60%2C%0A%20%20%60council_district%60%2C%0A%20%20%60police_precinct%60%2C%0A%20%20%60bbl%60%2C%0A%20%20%60borough%60%2C%0A%20%20%60x_coordinate_state_plane%60%2C%0A%20%20%60y_coordinate_state_plane%60%2C%0A%20%20%60open_data_channel_type%60%2C%0A%20%20%60park_facility_name%60%2C%0A%20%20%60park_borough%60%2C%0A%20%20%60vehicle_type%60%2C%0A%20%20%60taxi_company_borough%60%2C%0A%20%20%60taxi_pick_up_location%60%2C%0A%20%20%60bridge_highway_name%60%2C%0A%20%20%60bridge_highway_direction%60%2C%0A%20%20%60road_ramp%60%2C%0A%20%20%60bridge_highway_segment%60%2C%0A%20%20%60latitude%60%2C%0A%20%20%60longitude%60%2C%0A%20%20%60location%60%0AWHERE%0A%20%20caseless_contains(%60complaint_type%60%2C%20%22dog%22)%0A%20%20%20%20OR%20caseless_contains(%60descriptor%60%2C%20%22dog%22)%0AORDER%20BY%20%60created_date%60%20DESC%20NULL%20FIRST/page/filter

2020 Neighborhood Tabulation Areas (NTAs)
https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd/about_data

311 filter: Problem (formerly Complaint Type) contains dog OR Problem Detail
(formerly Descriptor) contains dog, case-insensitive. Export the filtered view.

