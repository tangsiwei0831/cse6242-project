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
   Dataset download links are provided in README.md. Dog Runs is required;
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

