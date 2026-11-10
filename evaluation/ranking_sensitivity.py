#!/usr/bin/env python3
"""Read existing opportunities API; emit candidate rankings and overlap as JSON."""

import argparse
import itertools
import json
import math
import sys
from urllib.parse import urlencode
from urllib.request import urlopen


SCENARIOS = {
    "Equal": (25, 25, 25, 25),
    "Demand-heavy": (55, 15, 15, 15),
    "Access-heavy": (15, 55, 15, 15),
    "Balanced": (35, 25, 20, 20),
}


def run(base_url, timeout):
    rankings = {}
    requests = {}
    for scenario, weights in SCENARIOS.items():
        params = dict(zip(("demand", "access", "complaints", "acreage"), weights))
        params["includeExisting"] = "false"
        url = base_url.rstrip("/") + "/api/opportunities?" + urlencode(params)
        requests[scenario] = url
        with urlopen(url, timeout=timeout) as response:
            payload = json.load(response)
        if payload.get("type") != "FeatureCollection":
            raise ValueError(f"{scenario}: expected a GeoJSON FeatureCollection")
        candidates = []
        for feature in payload["features"]:
            p = feature["properties"]
            if p["hasDogRun"] or p["rank"] is None or p["score"] is None:
                continue
            if not math.isfinite(p["score"]) or not math.isfinite(p["rank"]):
                raise ValueError(f"{scenario}: invalid score or rank")
            candidates.append({"id": p["propertyId"], "name": p["name"],
                               "score": p["score"], "rank": p["rank"]})
        candidates.sort(key=lambda p: (p["rank"], p["name"], p["id"]))
        if len({p["id"] for p in candidates}) != len(candidates):
            raise ValueError(f"{scenario}: duplicate candidate property IDs")
        if len(candidates) < 10:
            raise ValueError(f"{scenario}: fewer than ten candidates")
        rankings[scenario] = candidates[:10]

    overlap = []
    for a, b in itertools.combinations(SCENARIOS, 2):
        ids_a = {p["id"] for p in rankings[a]}
        ids_b = {p["id"] for p in rankings[b]}
        common = sorted(ids_a & ids_b)
        overlap.append({"scenario_a": a, "scenario_b": b,
                        "shared_ids": common, "shared_count": len(common),
                        "overlap_percentage": len(common) * 10,
                        "jaccard": len(common) / len(ids_a | ids_b)})
    return {"weights_order": ["demand", "access", "complaints", "acreage"],
            "weights": SCENARIOS, "requests": requests,
            "top10": rankings, "pairwise_overlap": overlap}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--timeout", type=float, default=1800,
                        help="Per-request timeout in seconds (default: 1800)")
    args = parser.parse_args()
    try:
        result = run(args.base_url, args.timeout)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Ranking sensitivity failed: {error}", file=sys.stderr)
        return 1
    json.dump(result, sys.stdout, indent=2, allow_nan=False)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
