# BC Burn Probability Webmap

This repository is a static Leaflet webmap designed for GitHub Pages. Wix should
embed the published GitHub Pages URL and does not need to contain any map logic.

## Project Structure

```text
index.html
css/styles.css
js/map.js
data/communities.geojson
data/current-fire-perimeters.geojson
data/wui-polygons.geojson
data/communities.geojson
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
  "burn_probability_rank": 15,
  "median_bp": 0.002380487
}
```

To regenerate `data/communities.geojson` from the local Census shapefile, run:

```powershell
python scripts\generate_communities_geojson.py
```

If the Census shapefile lives somewhere else, pass the shapefile prefix without
the extension:

```powershell
python scripts\generate_communities_geojson.py --csd-prefix C:\path\to\lcsd000b21a_e
```

## WUI Population And Risk Comparison Data

Community comparison charts are rendered directly in the browser from
`data/communities.geojson`. The source-of-truth table is
`C:\Users\Teej\Downloads\wuis_top100.xlsx`. Communities are ordered and ranked
by median burn probability, from highest to lowest. The chart compares median
burn probability with WUI population on a logarithmic population axis.
Some WUI populations aggregate multiple populated places, such as Vancouver or
Chilliwack, so the sidebar labels these as `WUI population` rather than city
population.

Regenerate `data/communities.geojson` with:

```powershell
python scripts\generate_communities_geojson.py
```

The generator prefers cached BC Geocoder locality points from
`data/wui-geocoded-points.json`, then falls back to the 2021 Statistics Canada
Census subdivision shapefile only if a locality point is unavailable. This keeps
markers on recognizable community centres instead of polygon centroids, which
can fall far away from the settled area for large or irregular municipalities.
Refresh the cached locality points and `data/communities.geojson` with:

```powershell
python scripts\refresh_community_geocoded_points.py --force
```

The display name can differ from the source WUI polygon name. For example, the
source WUI named `Kimberley` contains Cranbrook and Kimberley, but its map marker
and community-facing label are `Cranbrook`; the original WUI name remains the
stable key used to attach its risk values.

## WUI Polygons

The optional WUI area overlay is exported from
`C:\Users\tgmcb\Downloads\wuis_top100.gpkg`:

```powershell
python scripts\export_wui_polygons_geojson.py
```

This writes `data/wui-polygons.geojson`, which the map loads as the clickable
`WUI Risk Class Polygons` layer. The GeoPackage includes WUI polygon name,
population, source, and combined community names. It does not currently include
a separate risk-class field, so the overlay explains WUI grouping but is not
styled by class.

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
