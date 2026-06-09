"""Generate Leaflet-ready community points from the graph manifest and CSD polygons.

This script intentionally uses only the Python standard library so the static
webmap can be maintained without installing GDAL, geopandas, or pyproj.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
from pathlib import Path


DEFAULT_CSD_PREFIX = Path(r"C:\Users\Teej\Downloads\lcsd000b21a_e\lcsd000b21a_e")
DEFAULT_MANIFEST = Path("data/graph-manifest.json")
DEFAULT_OUTPUT = Path("data/communities.geojson")

# NAD83 / Statistics Canada Lambert parameters from lcsd000b21a_e.prj.
SEMI_MAJOR_AXIS = 6378137.0
INVERSE_FLATTENING = 298.2572221008916
STANDARD_PARALLEL_1 = math.radians(49)
STANDARD_PARALLEL_2 = math.radians(77)
LATITUDE_OF_ORIGIN = math.radians(63.390675)
CENTRAL_MERIDIAN = math.radians(-91.86666666666666)
FALSE_EASTING = 6200000
FALSE_NORTHING = 3000000


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def read_dbf(path: Path) -> list[dict[str, str | int]]:
    with path.open("rb") as dbf:
        header = dbf.read(32)
        record_count = struct.unpack("<I", header[4:8])[0]
        header_length = struct.unpack("<H", header[8:10])[0]
        record_length = struct.unpack("<H", header[10:12])[0]

        fields = []
        while True:
            descriptor = dbf.read(32)
            if descriptor[0] == 0x0D:
                break

            field_name = descriptor[:11].split(b"\0", 1)[0].decode("ascii")
            field_length = descriptor[16]
            fields.append((field_name, field_length))

        dbf.seek(header_length)
        rows = []
        for index in range(record_count):
            record = dbf.read(record_length)
            if not record or record[0:1] == b"*":
                continue

            position = 1
            row: dict[str, str | int] = {"_index": index}
            for field_name, field_length in fields:
                raw_value = record[position : position + field_length]
                position += field_length
                row[field_name] = raw_value.decode("latin1").strip()

            rows.append(row)

    return rows


def read_shx_offsets(path: Path, record_count: int) -> list[tuple[int, int]]:
    with path.open("rb") as shx:
        shx.seek(100)
        return [struct.unpack(">2i", shx.read(8)) for _ in range(record_count)]


def ring_centroid(points: list[tuple[float, float]]) -> tuple[tuple[float, float] | None, float]:
    area = 0.0
    centroid_x = 0.0
    centroid_y = 0.0

    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        cross = x1 * y2 - x2 * y1
        area += cross
        centroid_x += (x1 + x2) * cross
        centroid_y += (y1 + y2) * cross

    area *= 0.5
    if abs(area) < 1e-9:
        return None, 0.0

    return (centroid_x / (6 * area), centroid_y / (6 * area)), area


def polygon_centroid(shp_path: Path, shx_offsets: list[tuple[int, int]], row_index: int) -> tuple[float, float]:
    offset_words, length_words = shx_offsets[row_index]
    with shp_path.open("rb") as shp:
        shp.seek(offset_words * 2 + 8)
        content = shp.read(length_words * 2)

    shape_type = struct.unpack("<i", content[:4])[0]
    if shape_type != 5:
        raise ValueError(f"Expected polygon shape type 5, got {shape_type}")

    part_count, point_count = struct.unpack("<2i", content[36:44])
    parts = list(struct.unpack("<" + "i" * part_count, content[44 : 44 + 4 * part_count]))
    points_start = 44 + 4 * part_count
    points = [
        struct.unpack("<2d", content[points_start + index * 16 : points_start + (index + 1) * 16])
        for index in range(point_count)
    ]

    weighted_parts = []
    for part_index, start in enumerate(parts):
        end = parts[part_index + 1] if part_index + 1 < len(parts) else len(points)
        centroid, area = ring_centroid(points[start:end])
        if centroid:
            weighted_parts.append((centroid, area))

    total_area = sum(area for _, area in weighted_parts)
    if abs(total_area) > 1e-9:
        x = sum(centroid[0] * area for centroid, area in weighted_parts) / total_area
        y = sum(centroid[1] * area for centroid, area in weighted_parts) / total_area
        return x, y

    largest_part, _ = max(weighted_parts, key=lambda item: abs(item[1]))
    return largest_part


def inverse_statscan_lambert(x: float, y: float) -> tuple[float, float]:
    flattening = 1 / INVERSE_FLATTENING
    eccentricity = math.sqrt(2 * flattening - flattening * flattening)

    def m(phi: float) -> float:
        return math.cos(phi) / math.sqrt(1 - eccentricity**2 * math.sin(phi) ** 2)

    def t(phi: float) -> float:
        eccentricity_term = (
            (1 - eccentricity * math.sin(phi)) / (1 + eccentricity * math.sin(phi))
        ) ** (eccentricity / 2)
        return math.tan(math.pi / 4 - phi / 2) / eccentricity_term

    n = (math.log(m(STANDARD_PARALLEL_1)) - math.log(m(STANDARD_PARALLEL_2))) / (
        math.log(t(STANDARD_PARALLEL_1)) - math.log(t(STANDARD_PARALLEL_2))
    )
    big_f = m(STANDARD_PARALLEL_1) / (n * t(STANDARD_PARALLEL_1) ** n)
    rho_origin = SEMI_MAJOR_AXIS * big_f * t(LATITUDE_OF_ORIGIN) ** n

    dx = x - FALSE_EASTING
    dy = rho_origin - (y - FALSE_NORTHING)
    theta = math.atan2(dx, dy)
    rho = math.copysign(math.hypot(dx, dy), n)
    t_value = (rho / (SEMI_MAJOR_AXIS * big_f)) ** (1 / n)

    latitude = math.pi / 2 - 2 * math.atan(t_value)
    for _ in range(8):
        eccentricity_term = (
            (1 - eccentricity * math.sin(latitude))
            / (1 + eccentricity * math.sin(latitude))
        ) ** (eccentricity / 2)
        latitude = math.pi / 2 - 2 * math.atan(t_value * eccentricity_term)

    longitude = CENTRAL_MERIDIAN + theta / n
    return math.degrees(longitude), math.degrees(latitude)


def match_csd_record(community: dict, by_code: dict[str, dict], by_name: dict[str, list[dict]]) -> dict:
    source_code = community.get("source_census_geo_code")
    if source_code and source_code in by_code:
        return by_code[source_code]

    matches = by_name.get(normalize_name(community["name"]), [])
    if len(matches) == 1:
        return matches[0]

    if matches:
        candidates = ", ".join(f"{row['CSDNAME']} ({row['CSDUID']})" for row in matches)
        raise ValueError(f"Ambiguous Census subdivision match for {community['name']}: {candidates}")

    raise ValueError(f"No Census subdivision match for {community['name']}")


def build_geojson(csd_prefix: Path, manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rows = read_dbf(csd_prefix.with_suffix(".dbf"))
    shx_offsets = read_shx_offsets(csd_prefix.with_suffix(".shx"), len(rows))

    by_code = {str(row["CSDUID"]): row for row in rows}
    by_name: dict[str, list[dict]] = {}
    for row in rows:
        if row.get("PRUID") == "59":
            by_name.setdefault(normalize_name(str(row["CSDNAME"])), []).append(row)

    features = []
    for community in manifest["communities"]:
        csd_record = match_csd_record(community, by_code, by_name)
        x, y = polygon_centroid(csd_prefix.with_suffix(".shp"), shx_offsets, int(csd_record["_index"]))
        longitude, latitude = inverse_statscan_lambert(x, y)

        properties = {
            "name": community["name"],
            "slug": community["slug"],
            "population": community.get("population"),
            "population_rank": community.get("population_rank"),
            "population_source": community.get("population_source"),
            "matched_population_name": community.get("matched_population_name"),
            "graph": community["graph"],
            "census_subdivision_id": csd_record["CSDUID"],
            "census_subdivision_name": csd_record["CSDNAME"],
            "census_subdivision_type": csd_record["CSDTYPE"],
            "land_area_sq_km": float(csd_record["LANDAREA"]),
            "coordinate_source": "2021 Statistics Canada Census subdivision polygon centroid",
        }

        if community.get("source_census_dguid"):
            properties["source_census_dguid"] = community["source_census_dguid"]
        if community.get("source_census_geo_code"):
            properties["source_census_geo_code"] = community["source_census_geo_code"]
        if community.get("source_csv_city_id") is not None:
            properties["source_csv_city_id"] = community["source_csv_city_id"]
        if community.get("data_quality_flag"):
            properties["data_quality_flag"] = community["data_quality_flag"]

        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(longitude, 6), round(latitude, 6)],
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "metadata": {
            "generated_from": {
                "graph_manifest": str(manifest_path).replace("\\", "/"),
                "census_subdivision_shapefile": str(csd_prefix.with_suffix(".shp")).replace("\\", "/"),
            },
            "feature_count": len(features),
            "coordinate_reference_system": "WGS84 lon/lat, transformed from NAD83 Statistics Canada Lambert",
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csd-prefix", type=Path, default=DEFAULT_CSD_PREFIX)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    geojson = build_geojson(args.csd_prefix, args.manifest)
    args.output.write_text(json.dumps(geojson, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(geojson['features'])} communities to {args.output}")


if __name__ == "__main__":
    main()
