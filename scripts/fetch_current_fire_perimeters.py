"""Fetch active BC wildfire perimeters and incident points for the webmap.

The BC Open Maps WFS endpoint can return GeoJSON directly, but browser CORS
headers are not reliable for GitHub Pages. This script snapshots the active
perimeters into data/current-fire-perimeters.geojson for the webmap to load.
"""

from __future__ import annotations

import argparse
import gzip
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_OUTPUT = Path("data/current-fire-perimeters.geojson")
DEFAULT_INCIDENT_OUTPUT = Path("data/current-fire-incidents.geojson")
LAYER_NAME = "pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_POLYS_SP"
CATALOGUE_URL = "https://catalogue.data.gov.bc.ca/dataset/bc-wildfire-fire-perimeters-current"
WFS_ENDPOINT = "https://openmaps.gov.bc.ca/geo/pub/ows"
WFNEWS_ENDPOINT = "https://wildfiresituation.nrs.gov.bc.ca/wfnews-api/publicPublishedIncident/features"
STAGE_OF_CONTROL = {
    "OUT_CNTRL": "Out of Control",
    "HOLDING": "Being Held",
    "UNDR_CNTRL": "Under Control",
}

# Include current-season perimeters that are not out. BCWS status values
# observed include Out, Under Control, Being Held, Out of Control, and
# sometimes blank.
EXCLUDED_FIRE_STATUS = "Out"
FETCH_ATTEMPTS = 5
FETCH_TIMEOUT_SECONDS = 45
RETRY_STATUS_CODES = {429, 500, 502, 503, 504}


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


def fetch_bytes(url: str, attempts: int = FETCH_ATTEMPTS, timeout: int = FETCH_TIMEOUT_SECONDS) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "frontera-webmaps/1.0 (+https://github.com/timmcburneylin/frontera-webmaps)"
        },
    )

    for attempt in range(1, attempts + 1):
        try:
            print(f"Fetching {url} (attempt {attempt}/{attempts})", flush=True)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            should_retry = error.code in RETRY_STATUS_CODES and attempt < attempts
            print(f"HTTP {error.code} fetching {url}", flush=True)
            if not should_retry:
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            should_retry = attempt < attempts
            print(f"Error fetching {url}: {error}", flush=True)
            if not should_retry:
                raise

        sleep_seconds = min(60, 2 ** (attempt - 1) * 5)
        print(f"Retrying in {sleep_seconds} seconds", flush=True)
        time.sleep(sleep_seconds)

    raise RuntimeError(f"Failed to fetch {url} after {attempts} attempts")


def fetch_geojson(url: str) -> dict:
    body = fetch_bytes(url)
    if body.startswith(b"\x1f\x8b"):
        body = gzip.decompress(body)

    return json.loads(body.decode("utf-8"))


def fetch_active_incidents() -> dict[str, dict]:
    incidents = {}

    for stage_code, status in STAGE_OF_CONTROL.items():
        url = f"{WFNEWS_ENDPOINT}?{urllib.parse.urlencode({'stageOfControl': stage_code})}"
        geojson = fetch_geojson(url)

        for feature in geojson.get("features") or []:
            properties = feature.get("properties", {})
            fire_number = properties.get("incident_number_label")
            if not fire_number:
                continue

            incidents[fire_number] = {
                "feature": feature,
                "incident_name": properties.get("incident_name"),
                "incident_number_label": fire_number,
                "incident_fire_year": properties.get("fire_year"),
                "fire_status": status,
            }

    return incidents


def enrich_perimeters(geojson: dict, incidents: dict[str, dict]) -> tuple[int, set[str]]:
    enriched_count = 0
    perimeter_fire_numbers = set()

    for feature in geojson.get("features", []):
        properties = feature.get("properties", {})
        fire_number = properties.get("FIRE_NUMBER")
        if fire_number:
            perimeter_fire_numbers.add(fire_number)

        properties["DATA_SOURCE"] = "perimeter"
        incident = incidents.get(fire_number)
        if not incident:
            continue

        properties["INCIDENT_NAME"] = incident.get("incident_name")
        properties["INCIDENT_NUMBER_LABEL"] = incident.get("incident_number_label")
        properties["INCIDENT_FIRE_YEAR"] = incident.get("incident_fire_year")
        properties["FIRE_STATUS"] = incident.get("fire_status") or properties.get("FIRE_STATUS")
        enriched_count += 1

    return enriched_count, perimeter_fire_numbers


def incident_point_features(incidents: dict[str, dict], perimeter_fire_numbers: set[str]) -> list[dict]:
    point_features = []

    for fire_number, incident in incidents.items():
        if fire_number in perimeter_fire_numbers:
            continue

        source_feature = incident.get("feature", {})
        geometry = source_feature.get("geometry")
        if not geometry or geometry.get("type") != "Point":
            continue

        fire_year = incident.get("incident_fire_year")
        point_features.append(
            {
                "type": "Feature",
                "id": f"bcws-incident-{fire_number}",
                "geometry": geometry,
                "properties": {
                    "FIRE_NUMBER": fire_number,
                    "INCIDENT_NAME": incident.get("incident_name"),
                    "INCIDENT_NUMBER_LABEL": fire_number,
                    "INCIDENT_FIRE_YEAR": fire_year,
                    "FIRE_STATUS": incident.get("fire_status"),
                    "FIRE_SIZE_HECTARES": None,
                    "TRACK_DATE": None,
                    "FIRE_URL": (
                        "https://wildfiresituation.nrs.gov.bc.ca/incidents"
                        f"?fireYear={fire_year}&incidentNumber={fire_number}"
                    ),
                    "DATA_SOURCE": "incident-point",
                },
            }
        )

    return point_features


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--incident-output", type=Path, default=DEFAULT_INCIDENT_OUTPUT)
    args = parser.parse_args()

    url = build_wfs_url()
    geojson = fetch_geojson(url)
    incidents = fetch_active_incidents()
    enriched_count, perimeter_fire_numbers = enrich_perimeters(geojson, incidents)
    point_features = incident_point_features(incidents, perimeter_fire_numbers)
    geojson["metadata"] = {
        "source": CATALOGUE_URL,
        "wfs_url": url,
        "incident_names_url": WFNEWS_ENDPOINT,
        "incident_names_enriched_count": enriched_count,
        "excluded_status": EXCLUDED_FIRE_STATUS,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": "Reference only. This file contains published current-fire perimeters.",
    }

    incident_geojson = {
        "type": "FeatureCollection",
        "features": point_features,
        "metadata": {
            "source": WFNEWS_ENDPOINT,
            "incident_point_count": len(point_features),
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "note": "Active BCWS incidents without a published perimeter.",
        },
    }

    args.output.write_text(json.dumps(geojson, indent=2) + "\n", encoding="utf-8")
    args.incident_output.write_text(
        json.dumps(incident_geojson, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"Wrote {len(perimeter_fire_numbers)} not-out fire perimeters to {args.output} "
        f"and {len(point_features)} incident-only points to {args.incident_output}"
    )


if __name__ == "__main__":
    main()
