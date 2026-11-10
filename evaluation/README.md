# NYC Dog Run evaluation

Reproducible evaluation of ranking sensitivity, distance sensitivity, and hypothetical coverage improvement. Run from the repository root against the existing database and web service. No application, database, branch, or Docker configuration changes are required. SQL runs in explicit `REPEATABLE READ READ ONLY` transactions and uses only SELECT/CTEs; Python sends GET requests only. Results below describe the existing dataset, not future refreshed imports.

## Run

Requirements: Python 3 (standard library only), Docker Compose, and the existing running `db` and `web` services. These commands use the project's default database user/name; adjust them if your existing installation differs. Allow several minutes for spatial queries and uncached API requests.

```bash
python3 evaluation/ranking_sensitivity.py > evaluation/results/ranking_sensitivity.json

docker compose exec -T db psql -X -q --csv -v ON_ERROR_STOP=1 \
  -U cse6242 -d cse6242 \
  < evaluation/distance_sensitivity.sql \
  > evaluation/results/distance_sensitivity.csv

docker compose exec -T db psql -X -q -A -t -v ON_ERROR_STOP=1 \
  -U cse6242 -d cse6242 \
  < evaluation/coverage_improvement.sql \
  > evaluation/results/coverage_improvement.json
```

For another web port, use `--base-url http://localhost:PORT`. `--timeout` controls each API request's timeout (default 1800 seconds). An existing host `psql` connection can also execute either SQL file with `-f`, using the same output flags. No imports, refreshes, service restarts, migrations, or index creation are part of this evaluation. SQL files require PostGIS and the current schema, including `map_aggregate_snapshots` and `map_source_versions` for coverage diagnostics.

Commands overwrite the corresponding local result file. Check the exit status before using an output file; a failed invocation can leave an empty file. Python reports errors on stderr. `ON_ERROR_STOP` makes SQL errors fail the command. The `-q` flags suppress transaction status text so captured files remain CSV/JSON.

## Provenance

The previous Codex runs' exact executed SQL remained available as `/tmp/distance-sensitivity.sql` and `/tmp/spatial-coverage-analysis.sql`. These were copied into this folder with provenance comments only; their calculations were not reconstructed or changed. The allocation originated in the accessibility snapshot SQL preserved in Git commit `bc1a757`; the coverage ranking reproduces `web/server.js`'s current `opportunityQuery` with Balanced weights and `includeExisting=false`.

No previous ranking-sensitivity script or complete ranking results were available in this conversation or the recovered temporary files. `ranking_sensitivity.py` therefore calls the existing API rather than inventing a scoring query. The saved ranking results are a fresh evaluation run.

## Ranking sensitivity

Weights are ordered Demand / Access / Complaints / Acreage:

| Scenario | Weights |
|---|---|
| Equal | 25 / 25 / 25 / 25 |
| Demand-heavy | 55 / 15 / 15 / 15 |
| Access-heavy | 15 / 55 / 15 / 15 |
| Balanced | 35 / 25 / 20 / 20 |

Each request explicitly sets `includeExisting=false`. The application excludes parks whose property ID matches an active run or whose geometry intersects one. It groups park source rows by property ID, assigns `ST_PointOnSurface`, and scores eligible candidates using its existing demand/access/complaint/acreage factors. Demand, complaints, and acreage use candidate percentile ranks; access is nearest-run representative-point distance capped at 5000m. Scores are rounded to one decimal before ranking, with name as the ranking tie-breaker. The script adds property ID as a final deterministic tie-breaker, returns exactly ten candidates, and rejects duplicate candidate IDs.

JSON includes request URLs, weights, Top 10 IDs/names/scores/API ranks, and all six pairwise comparisons. Overlap is `shared IDs / 10 * 100`; Jaccard is `shared IDs / union IDs`. API ranks may contain ties. The API caches results in its process; this script does not refresh that cache. Run against an unchanged dataset when comparing it with the live SQL results.

Observed pairwise overlap in the submission run:

| Pair | Shared Top 10 IDs | Overlap |
|---|---:|---:|
| Equal / Demand-heavy | 0 | 0% |
| Equal / Access-heavy | 10 | 100% |
| Equal / Balanced | 9 | 90% |
| Demand-heavy / Access-heavy | 0 | 0% |
| Demand-heavy / Balanced | 1 | 10% |
| Access-heavy / Balanced | 9 | 90% |

The Top 10 membership is stable between Equal and Access-heavy but changes substantially under Demand-heavy. Full names, scores, IDs, ranks, and Jaccard values are preserved in `results/ranking_sensitivity.json`.

## Shared coverage model

- Use extract year 2026 and licenses active on **2025-12-31** (issued on/before and expired on/after that date). Deduplicate by animal name, gender, birth year, breed, ZIP, issued date, and expiration date.
- Trim ZIPs; allocate each ZIP's license count to parcels in proportion to valid positive residential units. Unit parsing accepts comma-stripped nonnegative integer strings. ZIP residential-unit denominators include parcels without coordinates; demand is not redistributed when their coordinates are missing.
- Eligible coverage demand requires a five-digit ZIP, positive units and ZIP unit total, and a valid, nonempty WGS84 point in longitude/latitude bounds. Include eligible demand even without an unambiguous NTA assignment. Unmatched license ZIPs cannot contribute allocated parcel demand. A residential ZIP with no matching licenses contributes zero.
- `ST_DWithin(...::geography, ...::geography, radius, true)` measures straight-line spheroidal distance in meters, with an inclusive threshold. This is not walking distance. Existing facilities retain full dog-run polygon boundaries/interiors, with `feature_status='Active'` (95 runs in the validated dataset).
- Modeled demand is fractional, not observed dog locations. Covered plus uncovered equals eligible demand before display rounding.

The application's ranking demand factor deliberately retains its existing implementation: latest-year license records apportioned to NTAs, rather than the deduplicated as-of cohort used to measure coverage. Its ranking access factor also uses run representative points. These differences are inherited ranking rules; scenario coverage consistently uses the validated parcel demand and existing-run polygon distances.

## Expected distance results

`distance_sensitivity.sql` returns one row per radius with eligible, covered, uncovered, and percentage fields. It deduplicates covered BBLs per radius before joining demand.

| Radius | Eligible demand | Covered | Uncovered | Coverage |
|---|---:|---:|---:|---:|
| 500m | 63,732.12 | 13,898.81 | 49,833.30 | 21.808180% |
| 800m | 63,732.12 | 25,802.66 | 37,929.46 | 40.486119% |
| 1000m | 63,732.12 | 32,213.34 | 31,518.78 | 50.544909% |

The 800m result matches the stored snapshot's 40.48611907660786%, displayed as 40.49%. Increasing the radius from 500m to 1000m increases coverage by 28.74 percentage points.

## Expected coverage improvement

`coverage_improvement.sql` returns JSON containing scenario metrics, selected candidate IDs/coordinates/scores, active-run count, ranking extract year, candidate counts, stored baseline, and source revisions. `k=0`, `5`, and `10` identify the scenarios. It selects a fixed Top 10 Balanced list, not a sequential optimization. Each new facility is a hypothetical point at its park's representative point. Grouping all facility hits by BBL and retaining the earliest selected facility counts each parcel once in every scenario.

| Scenario | Eligible demand | Covered | Uncovered | Coverage | Improvement (pp) |
|---|---:|---:|---:|---:|---:|
| Existing 95 runs | 63,732.12 | 25,802.66 | 37,929.46 | 40.486119% | 0.000000 |
| Existing + Top 5 | 63,732.12 | 25,898.46 | 37,833.66 | 40.636429% | 0.150310 |
| Existing + Top 10 | 63,732.12 | 26,131.39 | 37,600.72 | 41.001922% | 0.515803 |

| Rank | Property ID | Name | Balanced score |
|---|---|---|---:|
| 1 | R143 | Staten Island Industrial Park | 84.2 |
| 2 | R030 | Willowbrook Park | 84.2 |
| 3 | R130 | Saw Mill Creek Marsh | 84.1 |
| 4 | R122 | Pralls Island | 83.9 |
| 5 | R159 | Old Place Creek Park | 83.5 |
| 6 | R112 | Meredith Woods | 83.4 |
| 7 | R163 | Meredith Woods | 82.9 |
| 8 | R075A | Father Macris Park | 82.7 |
| 9 | R017A | Greenbelt Native Plant Center | 82.7 |
| 10 | R121 | Siedenburg Park | 82.7 |

All ten are in Staten Island; the two Meredith Woods entries have distinct property IDs. Top 5 adds 95.80 estimated covered dogs and Top 10 adds 328.73. Balanced ranks multiple factors, so it does not maximize incremental coverage. These are hypothetical placements, not verified feasible construction sites.

## Verification and saved results

The `results/` files preserve actual rerun outputs. Validate the baseline before interpreting improvement: compare the live `k=0` percentage with 40.486119% (six-decimal rounding), the live distance 800m result, and `stored_baseline.coverage_percentage`. For this dataset, eligible demand must remain 63,732.115433017466 across all scenarios. Verify conservation (covered + uncovered = eligible), monotonically increasing coverage, 95 active runs, ten distinct selected IDs, and agreement between the API Balanced Top 10 and SQL selections.

All three scripts were run successfully on the `evaluation` branch on 2026-11-09. Checks passed for all six historical coverage percentages (within 0.0000005 percentage points), demand conservation, fixed denominators, monotonic coverage, and improvement arithmetic. The live baseline matched the stored snapshot within 1e-10 percentage points. There were 95 active runs, 1,728 distinct eligible ranking candidates, and ten distinct selected candidate IDs without existing runs. The API Balanced IDs, order, and scores exactly matched SQL. All six pairwise overlaps were independently checked as set intersections. The saved SQL bodies were checked byte-for-byte against the recovered executed SQL after removing the added comment headers. No numerical discrepancies were found. Initial sandbox denial of the localhost request was resolved by an approved retry; all final invocations exited successfully.

If future inputs or application scoring change, inspect the returned source revisions, ranking year, run count, and candidate IDs before interpreting differences. The scripts return live values and do not replace mismatches with historical values. The stored snapshot may be stale; matching source revisions alone does not substitute for numerical baseline validation. Rounded demand columns may differ by 0.01 when summed.

## Demand allocation comparison

Run the additional read-only analysis and its local verifier from the repository root:

```bash
docker compose exec -T db psql -X -q -A -t -v ON_ERROR_STOP=1 \
  -U cse6242 -d cse6242 \
  < evaluation/demand_allocation_comparison.sql \
  > evaluation/results/demand_allocation_comparison.json

python3 evaluation/verify_demand_allocation.py \
  > evaluation/results/demand_allocation_validation.txt
```

The verifier also exports `results/demand_allocation_ntas.csv` with all 262 NTAs, names, boroughs, parcel/unit counts, both demand estimates, signed and absolute differences, and percentage differences. JSON preserves full-precision SQL numeric output, the ten largest absolute changes, per-ZIP conservation diagnostics, source revisions, and snapshot comparisons. The Python verifier uses Decimal arithmetic and fails on a mismatch; its historical-total checks intentionally target this evaluation dataset. It reads saved files and writes only evaluation output files.

### Shared eligibility and conserved budgets

This uses the same 64,010 deduplicated licenses active on 2025-12-31 from the 2026 extract, ZIP normalization, integer residential-unit parsing, and original all-parcel ZIP unit denominators as the accessibility model. Both methods use precisely the same residential parcels: positive parsed residential units, valid/nonempty WGS84 locations, five-digit ZIPs, and exactly one distinct NTA covering the parcel point (`ST_Covers`). Shared boundaries or overlaps with more than one NTA are excluded, rather than counted twice. Each parcel is one unique PLUTO BBL. No ZIP centroids or polygon-area allocation are used.

For ZIP z, let D_z be its deduplicated dog population, H_z the residential units across all its PLUTO parcels (including missing coordinates), and U_z the units on the common eligible NTA-assigned parcels. Preserve the existing model's NTA-assignable budget B_z = D_z * U_z / H_z. For each ZIP/NTA part:

- Parcel weighting: B_z * (eligible residential parcel count in the NTA / eligible residential parcel count in the ZIP).
- Unit weighting: B_z * (eligible residential units in the NTA / U_z). This is algebraically identical to the original allocation D_z * (NTA eligible units / H_z).

Fixing B_z for both methods isolates the effect of weights without redistributing excluded demand back into NTAs. Allocating every ZIP's entire dog total over only geolocated parcels would change the previously validated model. Zero-license ZIPs contribute zero under both methods. NTAs without eligible parcels remain in the output with zero demand; percentage differences are null when parcel-weighted demand is zero.

### Results and interpretation

| Quantity | Estimated demand |
|---|---:|
| Allocatable to all residential parcels under original model | 63,735.00 |
| With valid locations (previous accessibility denominator) | 63,732.12 |
| Valid locations without exactly one NTA assignment | 34.69 |
| Common eligible NTA demand, each weighting method | 63,697.43 |

Of the 64,010-license population, 275 cannot be allocated to residential parcels under the existing ZIP/unit rules. A further 2.88456698 allocated dogs lack valid locations, and 34.68981558 have valid locations without exactly one NTA assignment. These exclusions explain why the NTA comparison conserves 63,697.42561744 rather than the accessibility denominator of 63,732.11543302. Neither weighting method changes those exclusions.

Across all NTAs, the sum of absolute changes is **10,769.89** estimated dogs. Half that sum, **5,384.94 (8.45394%)**, is the net amount shifted among NTA totals. Signed differences sum to zero. Pearson correlation is **0.949314** across the 206 NTAs with eligible residential parcels; including all 262 NTAs (56 additional zero/zero rows) gives **0.958643**. The correlation describes agreement of modeled NTA totals, not validation against observed dog locations.

Largest changes, ordered by absolute estimated-dog difference; signed difference and percentage are **unit minus parcel**, relative to parcel-weighted demand:

| NTA | Name | Parcel-weighted | Unit-weighted | Difference | Change |
|---|---|---:|---:|---:|---:|
| MN0802 | Upper East Side-Carnegie Hill | 1,772.45 | 1,088.70 | -683.76 | -38.58% |
| MN0303 | East Village | 1,437.44 | 1,085.39 | -352.04 | -24.49% |
| MN0801 | Upper East Side-Lenox Hill-Roosevelt Island | 958.69 | 1,303.41 | +344.72 | +35.96% |
| MN0601 | Stuyvesant Town-Peter Cooper Village | 2.61 | 340.94 | +338.34 | +12,984.01% |
| MN0701 | Upper West Side-Lincoln Square | 1,120.54 | 1,444.69 | +324.16 | +28.93% |
| MN0803 | Upper East Side-Yorkville | 1,210.82 | 1,509.08 | +298.27 | +24.63% |
| BK0202 | Downtown Brooklyn-DUMBO-Boerum Hill | 552.05 | 838.82 | +286.77 | +51.95% |
| MN0402 | Hell's Kitchen | 1,341.90 | 1,077.73 | -264.17 | -19.69% |
| MN0702 | Upper West Side (Central) | 2,085.82 | 1,829.28 | -256.53 | -12.30% |
| BK0201 | Brooklyn Heights | 634.96 | 430.66 | -204.30 | -32.18% |

Parcel weighting assumes equal dog demand per eligible residential parcel within each ZIP; unit weighting assumes equal demand per residential unit. The changes show sensitivity to how housing is divided into parcels and how residential units are concentrated within shared ZIPs. Stuyvesant Town-Peter Cooper Village illustrates the large relative change possible from a very small parcel-weighted base. Neither method is established as objectively more accurate by this comparison, and neither accounts for observed household dog ownership or unlicensed dogs.

Validation passed on 2026-11-09: all 184 ZIP budgets conserve under both methods (maximum numerical error 2e-20); both total NTA allocations conserve the common budget; unit weighting reproduces the original calculation at every NTA (maximum error 4.136e-16); totals match the stored NTA and accessibility snapshot within 1e-8 dogs. The verifier also checks nonnegative demand, every NTA's differences and percentages, zero denominators, the Top 10 ordering, redistribution arithmetic, and independently computed correlations. No substantive discrepancy was found; subprecision numeric differences are arithmetic rounding.
