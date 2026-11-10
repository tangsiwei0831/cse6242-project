#!/usr/bin/env python3
"""Validate saved allocation JSON and export all NTA comparisons to CSV."""

import argparse
import csv
import json
from decimal import Decimal
from pathlib import Path


TOLERANCE = Decimal("1e-8")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def near(a, b, message):
    require(a is not None and b is not None and abs(a - b) < TOLERANCE, message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path,
                        default=Path("evaluation/results/demand_allocation_comparison.json"))
    parser.add_argument("--csv", type=Path,
                        default=Path("evaluation/results/demand_allocation_ntas.csv"))
    args = parser.parse_args()
    data = json.loads(args.input.read_text(), parse_float=Decimal)
    s, ntas = data["summary"], data["ntas"]
    require(len(ntas) == s["nta_count"] == len({n["nta"] for n in ntas}),
            "NTA rows must be unique and complete")
    require(len(data["top10"]) == 10, "Expected ten largest changes")
    expected_top = sorted(ntas, key=lambda n: (-n["absolute_difference"], n["nta"]))[:10]
    require(data["top10"] == expected_top, "Top ten must match full NTA output")
    for method in ("parcel", "unit"):
        near(sum(n[f"{method}_demand"] for n in ntas), s["eligible_nta_demand"],
             f"{method} method must conserve common eligible demand")
        near(s[f"{method}_allocated_demand"], s["eligible_nta_demand"],
             f"{method} summary must conserve common eligible demand")
        near(s[f"max_zip_{method}_conservation_error"], Decimal(0),
             f"{method} must conserve every ZIP budget")
    for z in data["zip_checks"]:
        near(z["parcel_demand"], z["eligible_demand"], f"ZIP {z['zip']} parcel conservation")
        near(z["unit_demand"], z["eligible_demand"], f"ZIP {z['zip']} unit conservation")
    for n in ntas:
        require(n["parcel_demand"] >= 0 and n["unit_demand"] >= 0, "Negative demand")
        near(n["unit_demand"], n["validated_unit_demand"], "Original unit model reproduction")
        near(n["difference"], n["unit_demand"] - n["parcel_demand"], "Signed difference")
        near(n["absolute_difference"], abs(n["difference"]), "Absolute difference")
        if n["parcel_demand"] == 0:
            require(n["percentage_difference"] is None, "Zero-denominator percentage must be null")
        else:
            near(n["percentage_difference"], 100 * n["difference"] / n["parcel_demand"],
                 "Percentage difference")
    near(sum(n["difference"] for n in ntas), Decimal(0), "Signed changes must sum to zero")
    near(s["unit_allocated_demand"], s["stored_nta_demand"], "Stored NTA snapshot match")
    near(s["valid_location_demand"], s["stored_valid_location_demand"], "Accessibility denominator match")
    near(s["eligible_nta_demand"], Decimal("63697.425617441324"), "Historical NTA demand match")
    near(s["valid_location_demand"], Decimal("63732.115433017466"), "Historical coverage demand match")
    near(s["redistributed_demand"], sum(n["absolute_difference"] for n in ntas) / 2,
         "Redistributed amount")
    near(s["redistributed_percentage"], 100 * s["redistributed_demand"] / s["eligible_nta_demand"],
         "Redistributed percentage")
    for label, group in [("all_ntas", ntas),
                         ("eligible_ntas", [n for n in ntas if n["residential_parcels"] > 0])]:
        x = [n["parcel_demand"] for n in group]
        y = [n["unit_demand"] for n in group]
        mean_x, mean_y = sum(x) / len(x), sum(y) / len(y)
        numerator = sum((a - mean_x) * (b - mean_y) for a, b in zip(x, y))
        denominator = (sum((a - mean_x) ** 2 for a in x)
                       * sum((b - mean_y) ** 2 for b in y)).sqrt()
        near(s[f"pearson_{label}"], numerator / denominator, "Pearson correlation")
    with args.csv.open("w", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=["nta", "name", "borough",
            "residential_parcels", "residential_units", "parcel_demand", "unit_demand",
            "validated_unit_demand", "difference", "absolute_difference", "percentage_difference"])
        writer.writeheader()
        writer.writerows(ntas)
    print(f"PASS: {len(ntas)} unique NTAs; ten largest changes verified.")
    print(f"PASS: {len(data['zip_checks'])} ZIP budgets conserved under both methods.")
    print("PASS: nonnegative allocations; original unit model reproduced per NTA.")
    print("PASS: differences, percentages, zero denominators, and redistribution checked.")
    print("PASS: Pearson correlations independently reproduced from NTA rows.")
    print("PASS: shared demand matches historical NTA and accessibility snapshot totals.")
    print(f"NTA demand per method: {s['eligible_nta_demand']}")
    print(f"Redistributed demand: {s['redistributed_demand']} ({s['redistributed_percentage']}%)")
    print(f"Pearson r, all NTAs: {s['pearson_all_ntas']}")
    print(f"CSV: {args.csv}")


if __name__ == "__main__":
    main()
