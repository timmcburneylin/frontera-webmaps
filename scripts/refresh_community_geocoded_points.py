"""Refresh WUI community marker points from the BC Geocoder.

The map markers should point at recognizable community/townsite locations.
Census subdivision centroids often fall far from the settled area for large or
irregular municipal boundaries, so this script caches BC Geocoder locality
points and updates data/communities.geojson in place.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_COMMUNITIES = Path("data/communities.geojson")
DEFAULT_GEOCODED_POINTS = Path("data/wui-geocoded-points.json")
GEOCODER_ENDPOINT = "https://geocoder.api.gov.bc.ca/addresses.json"
QUERY_ALIASES = {
    "Kamloops 1": "Kamloops",
    "Penticton 1": "Penticton",
    "Skidegate 1": "Skidegate",
    "Village of Queen Charlotte": "Daajing Giids",
}


def geocode_query(query: str) -> dict:
    params = {
        "addressString": f"{query}, BC",
        "maxResults": "1",
        "echo": "true",
    }
    url = f"{GEOCODER_ENDPOINT}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "frontera-webmaps/1.0 (+https://github.com/timmcburneylin/frontera-webmaps)"
        },
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))

    features = payload.get("features") or []
    if not features:
        raise RuntimeError(f"No BC Geocoder result for {query}")

    feature = features[0]
    properties = feature.get("properties") or {}
    coordinates = feature.get("geometry", {}).get("coordinates")
    if not coordinates or len(coordinates) != 2:
        raise RuntimeError(f"BC Geocoder result for {query} did not include a point")

    return {
        "query": query,
        "coordinates": [round(float(coordinates[0]), 7), round(float(coordinates[1]), 7)],
        "full_address": properties.get("fullAddress"),
        "match_precision": properties.get("matchPrecision"),
        "score": properties.get("score"),
        "locality_type": properties.get("localityType"),
        "source": "BC Geocoder API",
    }


def marker_query(properties: dict) -> str:
    if properties.get("coordinate_override_query"):
        return str(properties["coordinate_override_query"])

    name = str(properties["name"])
    return QUERY_ALIASES.get(name, name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--communities", type=Path, default=DEFAULT_COMMUNITIES)
    parser.add_argument("--geocoded-points", type=Path, default=DEFAULT_GEOCODED_POINTS)
    parser.add_argument("--sleep-seconds", type=float, default=0.1)
    parser.add_argument("--force", action="store_true", help="Refresh cached points too")
    args = parser.parse_args()

    communities = json.loads(args.communities.read_text(encoding="utf-8"))
    geocoded_points = json.loads(args.geocoded_points.read_text(encoding="utf-8"))

    for feature in communities["features"]:
        properties = feature["properties"]
        raw_wui_name = properties["wui_name"]
        query = marker_query(properties)

        if args.force or raw_wui_name not in geocoded_points:
            print(f"Geocoding {raw_wui_name} as {query}", flush=True)
            geocoded_points[raw_wui_name] = geocode_query(query)
            time.sleep(args.sleep_seconds)

        point = geocoded_points[raw_wui_name]
        feature["geometry"]["coordinates"] = point["coordinates"]
        properties["coordinate_source"] = point.get("source", "BC Geocoder API")
        properties["geocoder_query"] = point.get("query")
        properties["geocoder_full_address"] = point.get("full_address")
        properties["geocoder_match_precision"] = point.get("match_precision")
        properties["geocoder_score"] = point.get("score")
        properties["geocoder_locality_type"] = point.get("locality_type")

        for stale_key in (
            "census_subdivision_id",
            "census_subdivision_name",
            "census_subdivision_type",
            "land_area_sq_km",
            "coordinate_override_query",
            "coordinate_override_full_address",
        ):
            properties.pop(stale_key, None)

    args.geocoded_points.write_text(
        json.dumps(geocoded_points, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    args.communities.write_text(
        json.dumps(communities, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Updated {len(communities['features'])} community marker points")


if __name__ == "__main__":
    main()
