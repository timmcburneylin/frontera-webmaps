# Frontera Wildfire Risk Webmap

This repository is a static Leaflet webmap designed for GitHub Pages. Wix should
embed the published GitHub Pages URL and does not need to contain any map logic.

## Project Structure

```text
index.html
css/styles.css
js/map.js
data/communities.geojson
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

## Graph And Population Data

Community graph PNGs are stored in `graphs/` with slug filenames. The original
top-60 population CSV is copied to `data/top_60_cities_by_population_with_wui.csv`.
The generated `data/graph-manifest.json` records which graph files already match
that CSV and which populations were filled from the Statistics Canada Census
profile CSV.

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
