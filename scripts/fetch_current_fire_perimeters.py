"""Fetch active BC wildfire perimeters for the static Leaflet map.

The BC Open Maps WFS endpoint can return GeoJSON directly, but browser CORS
headers are not reliable for GitHub Pages. This script snapshots the active
perimeters into data/current-fire-perimeters.geojson for the webmap to load.
"""

from __future__ import annotations

import argparse
import gzip
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_OUTPUT = Path("data/current-fire-perimeters.geojson")
LAYER_NAME = "pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_POLYS_SP"
CATALOGUE_URL = "https://catalogue.data.gov.bc.ca/dataset/bc-wildfire-fire-perimeters-current"
WFS_ENDPOINT = "https://openmaps.gov.bc.ca/geo/pub/ows"
WFNEWS_ENDPOINT = "https://wildfiresituation.nrs.gov.bc.ca/wfnews-api/publicPublishedIncident/features"
STAGE_OF_CONTROL_CODES = ("OUT_CNTRL", "HOLDING", "UNDR_CNTRL")

# Include current-season perimeters that are not out. BCWS status values
# observed include Out, Under Control, Being Held, Out of Control, and
# sometimes blank.
EXCLUDED_FIRE_STATUS = "Out"


def build_wfs_url() -> str:
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": LAYER_NAME,
        "outputFormat": "json",
        "srsName": "EPSG:4326",
        "CQL_FILTER": f"FIRE_STATUS <> '{EXCLUDED_FIRE_STATUS}'",
    }
    return f"{WFS_ENDPOINT}?{urllib.parse.urlencode(params)}"


def fetch_geojson(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "frontera-webmaps/1.0 (+https://github.com/timmcburneylin/frontera-webmaps)"
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
        if response.headers.get("Content-Encoding") == "gzip" or body.startswith(b"\x1f\x8b"):
            body = gzip.decompress(body)

        return json.loads(body.decode("utf-8"))


def fetch_incident_names() -> dict[str, dict[str, str | int]]:
    incident_names = {}

    for stage_code in STAGE_OF_CONTROL_CODES:
        url = f"{WFNEWS_ENDPOINT}?{urllib.parse.urlencode({'stageOfControl': stage_code})}"
        geojson = fetch_geojson(url)

        for feature in geojson.get("features") or []:
            properties = feature.get("properties", {})
            fire_number = properties.get("incident_number_label")
            if not fire_number:
                continue

            incident_names[fire_number] = {
                "incident_name": properties.get("incident_name"),
                "incident_number_label": fire_number,
                "incident_fire_year": properties.get("fire_year"),
            }

    return incident_names


def enrich_perimeters_with_incident_names(geojson: dict, incident_names: dict[str, dict[str, str | int]]) -> int:
    enriched_count = 0

    for feature in geojson.get("features", []):
        properties = feature.get("properties", {})
        fire_number = properties.get("FIRE_NUMBER")
        incident = incident_names.get(fire_number)
        if not incident:
            continue

        properties["INCIDENT_NAME"] = incident.get("incident_name")
        properties["INCIDENT_NUMBER_LABEL"] = incident.get("incident_number_label")
        properties["INCIDENT_FIRE_YEAR"] = incident.get("incident_fire_year")
        enriched_count += 1

    return enriched_count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    url = build_wfs_url()
    geojson = fetch_geojson(url)
    incident_names = fetch_incident_names()
    enriched_count = enrich_perimeters_with_incident_names(geojson, incident_names)
    geojson["metadata"] = {
        "source": CATALOGUE_URL,
        "wfs_url": url,
        "incident_names_url": WFNEWS_ENDPOINT,
        "incident_names_enriched_count": enriched_count,
        "excluded_status": EXCLUDED_FIRE_STATUS,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": "Reference only. BC wildfire perimeters are dynamic and update frequency varies.",
    }

    args.output.write_text(json.dumps(geojson, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(geojson.get('features', []))} not-out fire perimeters to {args.output}")


if __name__ == "__main__":
    main()
