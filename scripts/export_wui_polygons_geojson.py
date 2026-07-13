"""Export top-100 WUI polygons from a GeoPackage to web-ready GeoJSON."""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import struct
from pathlib import Path


DEFAULT_INPUT = Path(r"C:\Users\tgmcb\Downloads\wuis_top100.gpkg")
DEFAULT_OUTPUT = Path("data/wui-polygons.geojson")

# EPSG:3005 NAD83 / BC Albers.
SEMI_MAJOR_AXIS = 6378137.0
INVERSE_FLATTENING = 298.257222101
STANDARD_PARALLEL_1 = math.radians(50)
STANDARD_PARALLEL_2 = math.radians(58.5)
LATITUDE_OF_ORIGIN = math.radians(45)
CENTRAL_MERIDIAN = math.radians(-126)
FALSE_EASTING = 1000000.0
FALSE_NORTHING = 0.0


def slugify(value: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def clean_wui_display_name(value: str) -> str:
    aliases = {
        "Kimberley": "Cranbrook",
        "Houston_388": "Houston",
        "Tumbler Ridge_422": "Tumbler Ridge",
        "Logan Lake_160": "Logan Lake",
        "Cherryville_145": "Cherryville",
        "Queen Charlotte, Village Of": "Village of Queen Charlotte",
        "Hudson'S Hope": "Hudson's Hope",
    }
    if value in aliases:
        return aliases[value]
    return value.rsplit("_", 1)[0] if "_" in value else value


def albers_constants() -> tuple[float, float, float, float]:
    flattening = 1 / INVERSE_FLATTENING
    eccentricity = math.sqrt(2 * flattening - flattening * flattening)
    eccentricity_squared = eccentricity * eccentricity

    def m(phi: float) -> float:
        return math.cos(phi) / math.sqrt(1 - eccentricity_squared * math.sin(phi) ** 2)

    def q(phi: float) -> float:
        sin_phi = math.sin(phi)
        return (1 - eccentricity_squared) * (
            sin_phi / (1 - eccentricity_squared * sin_phi * sin_phi)
            - (1 / (2 * eccentricity))
            * math.log((1 - eccentricity * sin_phi) / (1 + eccentricity * sin_phi))
        )

    m1 = m(STANDARD_PARALLEL_1)
    m2 = m(STANDARD_PARALLEL_2)
    q0 = q(LATITUDE_OF_ORIGIN)
    q1 = q(STANDARD_PARALLEL_1)
    q2 = q(STANDARD_PARALLEL_2)
    n = (m1 * m1 - m2 * m2) / (q2 - q1)
    c = m1 * m1 + n * q1
    rho0 = SEMI_MAJOR_AXIS * math.sqrt(c - n * q0) / n
    return eccentricity, n, c, rho0


ECCENTRICITY, ALBERS_N, ALBERS_C, ALBERS_RHO0 = albers_constants()


def q_for_latitude(phi: float) -> float:
    eccentricity_squared = ECCENTRICITY * ECCENTRICITY
    sin_phi = math.sin(phi)
    return (1 - eccentricity_squared) * (
        sin_phi / (1 - eccentricity_squared * sin_phi * sin_phi)
        - (1 / (2 * ECCENTRICITY))
        * math.log((1 - ECCENTRICITY * sin_phi) / (1 + ECCENTRICITY * sin_phi))
    )


def latitude_for_q(target_q: float) -> float:
    low = -math.pi / 2 + 1e-12
    high = math.pi / 2 - 1e-12
    for _ in range(50):
        middle = (low + high) / 2
        if q_for_latitude(middle) < target_q:
            low = middle
        else:
            high = middle
    return (low + high) / 2


def bc_albers_to_lonlat(x: float, y: float) -> list[float]:
    dx = x - FALSE_EASTING
    dy = ALBERS_RHO0 - (y - FALSE_NORTHING)
    rho = math.copysign(math.hypot(dx, dy), ALBERS_N)
    theta = math.atan2(dx, dy)
    q = (ALBERS_C - (rho * ALBERS_N / SEMI_MAJOR_AXIS) ** 2) / ALBERS_N
    latitude = latitude_for_q(q)
    longitude = CENTRAL_MERIDIAN + theta / ALBERS_N
    return [round(math.degrees(longitude), 6), round(math.degrees(latitude), 6)]


def point_line_distance(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    if start == end:
        return math.hypot(point[0] - start[0], point[1] - start[1])

    x, y = point
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify_line(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    if len(points) <= 2:
        return points

    start = points[0]
    end = points[-1]
    max_distance = -1.0
    max_index = 0
    for index, point in enumerate(points[1:-1], start=1):
        distance = point_line_distance(point, start, end)
        if distance > max_distance:
            max_distance = distance
            max_index = index

    if max_distance <= tolerance:
        return [start, end]

    left = simplify_line(points[: max_index + 1], tolerance)
    right = simplify_line(points[max_index:], tolerance)
    return left[:-1] + right


def simplify_ring(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    if len(points) <= 4 or tolerance <= 0:
        return points

    open_ring = points[:-1] if points[0] == points[-1] else points
    simplified = simplify_line(open_ring + [open_ring[0]], tolerance)
    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return simplified if len(simplified) >= 4 else points


def read_wkb_multipolygon(data: bytes, offset: int) -> list[list[list[tuple[float, float]]]]:
    byte_order = data[offset]
    endian = "<" if byte_order == 1 else ">"
    offset += 1
    geometry_type = struct.unpack_from(f"{endian}I", data, offset)[0] & 0xFFFF
    offset += 4
    if geometry_type != 6:
        raise ValueError(f"Expected WKB MultiPolygon, got geometry type {geometry_type}")

    polygon_count = struct.unpack_from(f"{endian}I", data, offset)[0]
    offset += 4
    multipolygon = []

    for _ in range(polygon_count):
        polygon_byte_order = data[offset]
        polygon_endian = "<" if polygon_byte_order == 1 else ">"
        offset += 1
        polygon_type = struct.unpack_from(f"{polygon_endian}I", data, offset)[0] & 0xFFFF
        offset += 4
        if polygon_type != 3:
            raise ValueError(f"Expected WKB Polygon, got geometry type {polygon_type}")

        ring_count = struct.unpack_from(f"{polygon_endian}I", data, offset)[0]
        offset += 4
        rings = []
        for _ in range(ring_count):
            point_count = struct.unpack_from(f"{polygon_endian}I", data, offset)[0]
            offset += 4
            ring = []
            for _ in range(point_count):
                ring.append(struct.unpack_from(f"{polygon_endian}2d", data, offset))
                offset += 16
            rings.append(ring)
        multipolygon.append(rings)

    return multipolygon


def read_gpkg_geometry(blob: bytes) -> list[list[list[tuple[float, float]]]]:
    if blob[:2] != b"GP":
        raise ValueError("Expected GeoPackage binary geometry header")

    flags = blob[3]
    is_little_endian = flags & 1
    endian = "<" if is_little_endian else ">"
    _srs_id = struct.unpack_from(f"{endian}i", blob, 4)[0]
    envelope_type = (flags >> 1) & 0b111
    envelope_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    offset = 8 + envelope_sizes[envelope_type]
    return read_wkb_multipolygon(blob, offset)


def convert_geometry(blob: bytes, tolerance: float) -> list:
    multipolygon = read_gpkg_geometry(blob)
    converted = []
    for polygon in multipolygon:
        converted_polygon = []
        for ring in polygon:
            simplified = simplify_ring(ring, tolerance)
            converted_polygon.append([bc_albers_to_lonlat(x, y) for x, y in simplified])
        converted.append(converted_polygon)
    return converted


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--tolerance-metres", type=float, default=75.0)
    args = parser.parse_args()

    connection = sqlite3.connect(args.input)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """
        select fid, geom, WUI_POLYGON_NAME, POPULATION, SOURCE, COMMUNITIES
        from wuis_top100
        order by POPULATION desc
        """
    )

    features = []
    for row in rows:
        raw_name = row["WUI_POLYGON_NAME"]
        display_name = clean_wui_display_name(raw_name)
        communities = [
            community.strip()
            for community in (row["COMMUNITIES"] or "").split(",")
            if community.strip()
        ]
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": row["fid"],
                    "name": display_name,
                    "slug": slugify(display_name),
                    "wui_name": raw_name,
                    "wui_population": row["POPULATION"],
                    "population_source": row["SOURCE"],
                    "communities": communities,
                },
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": convert_geometry(row["geom"], args.tolerance_metres),
                },
            }
        )

    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "source": str(args.input).replace("\\", "/"),
            "source_layer": "wuis_top100",
            "source_crs": "EPSG:3005",
            "coordinate_reference_system": "EPSG:4326",
            "simplification_tolerance_metres": args.tolerance_metres,
            "feature_count": len(features),
            "note": "Top-100 WUI polygons; attributes identify combined communities but do not include a risk-class field.",
        },
        "features": features,
    }
    args.output.write_text(json.dumps(collection, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(features)} WUI polygons to {args.output}")


if __name__ == "__main__":
    main()
