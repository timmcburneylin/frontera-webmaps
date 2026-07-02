# Frontera Wildfire Risk Webmap

This repository is a static Leaflet webmap designed for GitHub Pages. Wix should
embed the published GitHub Pages URL and does not need to contain any map logic.

## Project Structure

```text
index.html
css/styles.css
js/map.js
data/communities.geojson
data/current-fire-perimeters.geojson
data/graph-manifest.json
graphs/
  kamloops.png
  kelowna.png
  prince-george.png
tiles/
  burn-probability/
    {z}/{x}/{y}.png
```

## Updating Communities

Community points are generated from `data/graph-manifest.json` and the 2021
Statistics Canada Census subdivision boundary shapefile. Each feature needs:

```json
{
  "name": "Kamloops",
  "slug": "kamloops",
  "population": 97902,
  "population_rank": 3,
  "graph": "graphs/kamloops.png"
}
```

The `slug` should match the PNG filename in `graphs/`. For example,
`slug: "prince-george"` should use `graphs/prince-george.png`.

To regenerate `data/communities.geojson` from the local Census shapefile, run:

```powershell
python scripts\generate_communities_geojson.py
```

If the Census shapefile lives somewhere else, pass the shapefile prefix without
the extension:

```powershell
python scripts\generate_communities_geojson.py --csd-prefix C:\path\to\lcsd000b21a_e
```

## WUI Population And Graph Data

Community graph PNGs are stored in `graphs/` with slug filenames. The
source-of-truth population table is `C:\Users\Teej\Downloads\wuis_top100.xlsx`,
which ranks the 100 most populous WUI communities by 2021 Census population.
Some WUI populations aggregate multiple populated places, such as Vancouver or
Chilliwack, so the sidebar labels these as `WUI population` rather than city
population.

Regenerate `data/communities.geojson` with:

```powershell
python scripts\generate_communities_geojson.py
```

The generator uses the 2021 Statistics Canada Census subdivision shapefile for
most map points. WUI titles that are localities rather than Census subdivisions
are cached in `data/wui-geocoded-points.json` from the BC Geocoder API. The map
has graph PNGs for all 100 WUI communities.

## Current Wildfires

Active wildfire perimeters are pulled from the BC Data Catalogue dataset
`BC Wildfire Fire Perimeters - Current`:

```text
https://catalogue.data.gov.bc.ca/dataset/bc-wildfire-fire-perimeters-current
```

The map displays current-season fires that are `Out of Control`, `Being Held`,
or `Under Control`. Published perimeter polygons come from BC Open Maps. Active
fires that BCWS has published without a perimeter are added from the public
incident point feed, then automatically replaced by their polygon location when
a perimeter becomes available. The wildfire dropdown searches both types.

Refresh the local GeoJSON snapshot with:

```powershell
python scripts\fetch_current_fire_perimeters.py
```

The script writes polygons to `data/current-fire-perimeters.geojson` and
fallback points to `data/current-fire-incidents.geojson`. Keeping these files
separate also prevents an older cached map script from misreading point data as
perimeters. Both snapshots keep the GitHub Pages site static and avoid browser
CORS issues with the live services.

## Local Preview

Because the app loads GeoJSON with `fetch`, preview it with a local web server:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8000/
```

## Regenerating Burn Probability Tiles

The map displays `data/burn-probability.png` as XYZ tiles so it stays clearer
while zooming. If the source PNG changes, regenerate the tiles with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\generate_burn_tiles.ps1 -MinZoom 5 -MaxZoom 10
```

The script writes tiles to `tiles/burn-probability/{z}/{x}/{y}.png`. The source
PNG is still kept in `data/` as the tile-generation input.
