"""Generate Leaflet-ready WUI community points from the top-100 workbook.

This script intentionally uses only the Python standard library so the static
webmap can be maintained without installing GDAL, geopandas, or pyproj.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


DEFAULT_CSD_PREFIX = Path(r"C:\Users\Teej\Downloads\lcsd000b21a_e\lcsd000b21a_e")
DEFAULT_WUI_WORKBOOK = Path(r"C:\Users\Teej\Downloads\wuis_top100.xlsx")
DEFAULT_GEOCODED_POINTS = Path("data/wui-geocoded-points.json")
DEFAULT_GRAPH_DIR = Path("graphs")
DEFAULT_OUTPUT = Path("data/communities.geojson")
XLSX_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

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


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def clean_wui_display_name(value: str) -> str:
    display_aliases = {
        "Queen Charlotte, Village Of": "Village of Queen Charlotte",
        "Hudson'S Hope": "Hudson's Hope",
        "Hudson’s Hope": "Hudson's Hope",
    }
    if value in display_aliases:
        return display_aliases[value]

    return re.sub(r"_\d+$", "", value)


def coordinate_lookup_name(value: str) -> str:
    coordinate_aliases = {
        "100 Mile House": "One Hundred Mile House",
        "Queen Charlotte, Village Of": "Queen Charlotte",
        "Village of Queen Charlotte": "Queen Charlotte",
        "Sun Peaks": "Sun Peaks Mountain",
        "Hudson'S Hope": "Hudson's Hope",
        "Hudson’s Hope": "Hudson's Hope",
    }
    cleaned = re.sub(r"_\d+$", "", value)
    return coordinate_aliases.get(value, coordinate_aliases.get(cleaned, cleaned))


def xlsx_col_index(cell_reference: str) -> int:
    letters = re.match(r"[A-Z]+", cell_reference).group(0)
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - 64

    return index - 1


def read_wui_workbook(path: Path) -> list[dict[str, str | int | float | list[str]]]:
    with zipfile.ZipFile(path) as workbook:
        shared_strings = []
        shared_root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
        for item in shared_root.findall("a:si", XLSX_NS):
            shared_strings.append("".join(text.text or "" for text in item.findall(".//a:t", XLSX_NS)))

        sheet_root = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in sheet_root.findall(".//a:sheetData/a:row", XLSX_NS):
            values = []
            for cell in row.findall("a:c", XLSX_NS):
                index = xlsx_col_index(cell.attrib["r"])
                while len(values) <= index:
                    values.append(None)

                value_node = cell.find("a:v", XLSX_NS)
                value = None if value_node is None else value_node.text
                if cell.attrib.get("t") == "s" and value is not None:
                    value = shared_strings[int(value)]

                values[index] = value
            rows.append(values)

    header = rows[0]
    records = []
    for row in rows[1:]:
        record = dict(zip(header, row + [None] * (len(header) - len(row))))
        if not record.get("WUI_POLYGON_NAME") or not record.get("POPULATION"):
            continue

        record["population"] = int(round(float(record["POPULATION"])))
        record["places"] = [
            place.strip()
            for place in str(record.get("COMMUNITIES") or "").split(",")
            if place.strip()
        ]
        records.append(record)

    records.sort(key=lambda item: int(item["population"]), reverse=True)
    for index, record in enumerate(records, start=1):
        record["population_rank"] = index

    return records


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


def match_csd_record(wui_name: str, by_name: dict[str, list[dict]]) -> dict | None:
    matches = by_name.get(normalize_name(coordinate_lookup_name(wui_name)), [])
    if len(matches) == 1:
        return matches[0]

    if matches:
        candidates = ", ".join(f"{row['CSDNAME']} ({row['CSDUID']})" for row in matches)
        raise ValueError(f"Ambiguous Census subdivision match for {wui_name}: {candidates}")

    return None


def graph_for_slug(graph_dir: Path, slug: str) -> str | None:
    graph_path = graph_dir / f"{slug}.png"
    if graph_path.exists():
        return graph_path.as_posix()

    return None


def build_geojson(
    csd_prefix: Path,
    wui_workbook_path: Path,
    geocoded_points_path: Path,
    graph_dir: Path,
) -> dict:
    wui_records = read_wui_workbook(wui_workbook_path)
    geocoded_points = json.loads(geocoded_points_path.read_text(encoding="utf-8"))
    rows = read_dbf(csd_prefix.with_suffix(".dbf"))
    shx_offsets = read_shx_offsets(csd_prefix.with_suffix(".shx"), len(rows))

    by_name: dict[str, list[dict]] = {}
    for row in rows:
        if row.get("PRUID") == "59":
            by_name.setdefault(normalize_name(str(row["CSDNAME"])), []).append(row)

    features = []
    for record in wui_records:
        raw_wui_name = str(record["WUI_POLYGON_NAME"])
        display_name = clean_wui_display_name(raw_wui_name)
        slug = slugify(display_name)
        csd_record = match_csd_record(raw_wui_name, by_name)
        coordinate_source = ""
        coordinate_metadata = {}

        if csd_record:
            x, y = polygon_centroid(csd_prefix.with_suffix(".shp"), shx_offsets, int(csd_record["_index"]))
            longitude, latitude = inverse_statscan_lambert(x, y)
            coordinate_source = "2021 Statistics Canada Census subdivision polygon centroid"
            coordinate_metadata = {
                "census_subdivision_id": csd_record["CSDUID"],
                "census_subdivision_name": csd_record["CSDNAME"],
                "census_subdivision_type": csd_record["CSDTYPE"],
                "land_area_sq_km": float(csd_record["LANDAREA"]),
            }
        else:
            geocoded_point = geocoded_points.get(raw_wui_name)
            if not geocoded_point:
                raise ValueError(f"No coordinate source for {raw_wui_name}")

            longitude, latitude = geocoded_point["coordinates"]
            coordinate_source = geocoded_point.get("source", "BC Geocoder API")
            coordinate_metadata = {
                "geocoder_query": geocoded_point.get("query"),
                "geocoder_full_address": geocoded_point.get("full_address"),
                "geocoder_match_precision": geocoded_point.get("match_precision"),
                "geocoder_score": geocoded_point.get("score"),
            }

        graph = graph_for_slug(graph_dir, slug)

        properties = {
            "name": display_name,
            "slug": slug,
            "wui_name": raw_wui_name,
            "wui_population": record["population"],
            "wui_population_rank": record["population_rank"],
            "wui_places": record["places"],
            "population": record["population"],
            "population_rank": record["population_rank"],
            "population_source": record.get("SOURCE") or "2021 census",
            "graph": graph,
            "has_graph": graph is not None,
            "mean_bp": float(record["mean_bp"]) if record.get("mean_bp") is not None else None,
            "median_bp": float(record["median_bp"]) if record.get("median_bp") is not None else None,
            "ecodivision_name": record.get("ECODIVISION_NAME"),
            "natural_disturbance_type_code": record.get("NATURAL_DISTURBANCE_TYPE_CODE"),
            "coordinate_source": coordinate_source,
            **coordinate_metadata,
        }

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
                "wui_workbook": str(wui_workbook_path).replace("\\", "/"),
                "geocoded_points": str(geocoded_points_path).replace("\\", "/"),
                "graph_dir": str(graph_dir).replace("\\", "/"),
                "census_subdivision_shapefile": str(csd_prefix.with_suffix(".shp")).replace("\\", "/"),
            },
            "feature_count": len(features),
            "graph_count": sum(1 for feature in features if feature["properties"]["has_graph"]),
            "population_source": "wuis_top100.xlsx; WUI population is the total population of listed populated places within each WUI.",
            "coordinate_reference_system": "WGS84 lon/lat",
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csd-prefix", type=Path, default=DEFAULT_CSD_PREFIX)
    parser.add_argument("--wui-workbook", type=Path, default=DEFAULT_WUI_WORKBOOK)
    parser.add_argument("--geocoded-points", type=Path, default=DEFAULT_GEOCODED_POINTS)
    parser.add_argument("--graph-dir", type=Path, default=DEFAULT_GRAPH_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    geojson = build_geojson(
        args.csd_prefix,
        args.wui_workbook,
        args.geocoded_points,
        args.graph_dir,
    )
    args.output.write_text(json.dumps(geojson, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(geojson['features'])} communities to {args.output}")


if __name__ == "__main__":
    main()
