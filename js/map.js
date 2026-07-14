// Frontera community webmap.
// To add communities later, add a point feature to data/communities.geojson
// and place its graph PNG in graphs/<slug>.png.

const COMMUNITY_DATA_URL = "data/communities.geojson";
const WUI_POLYGON_DATA_URL = "data/wui-polygons.geojson";
const CURRENT_FIRE_DATA_URL = "data/current-fire-perimeters.geojson";
const CURRENT_FIRE_INCIDENT_DATA_URL = "data/current-fire-incidents.geojson";
const HILLSHADE_IMAGE_URL = "data/hillshade.png";
const BURN_PROBABILITY_TILE_URL = "tiles/burn-probability/{z}/{x}/{y}.png";
const GRAPH_ASSET_VERSION = "20260714-density-curves";
const BC_CENTER = [54.3, -125.2];
const DEFAULT_ZOOM = 5;
const SELECTED_ZOOM = 10;
const SELECTED_FIRE_ZOOM = 11;
const RASTER_BOUNDS = [
  [47.68780370640384, -139.0523932936093],
  [61.3704441896773, -110.4227492482696]
];

const map = L.map("map", {
  scrollWheelZoom: true,
  zoomControl: true
}).setView(BC_CENTER, DEFAULT_ZOOM);

map.createPane("hillshadePane");
map.createPane("burnProbabilityPane");
map.createPane("wuiPolygonPane");
map.createPane("firePerimeterPane");
map.createPane("communityPane");
map.createPane("fireMarkerPane");
map.getPane("hillshadePane").style.zIndex = 350;
map.getPane("burnProbabilityPane").style.zIndex = 360;
map.getPane("wuiPolygonPane").style.zIndex = 390;
map.getPane("firePerimeterPane").style.zIndex = 420;
map.getPane("communityPane").style.zIndex = 460;
map.getPane("fireMarkerPane").style.zIndex = 520;

const streetBasemap = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});

const imageryBasemap = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution:
      "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community"
  }
);

const hillshadeOverlay = L.imageOverlay(HILLSHADE_IMAGE_URL, RASTER_BOUNDS, {
  opacity: 0.45,
  interactive: false,
  pane: "hillshadePane",
  className: "raster-overlay raster-overlay-hillshade"
});

const burnProbabilityOverlay = L.tileLayer(BURN_PROBABILITY_TILE_URL, {
  minZoom: 5,
  maxNativeZoom: 10,
  maxZoom: 12,
  opacity: 0.65,
  bounds: RASTER_BOUNDS,
  noWrap: true,
  keepBuffer: 4,
  pane: "burnProbabilityPane",
  className: "raster-overlay raster-overlay-burn-probability",
  attribution: "Burn probability raster"
});

streetBasemap.addTo(map);
burnProbabilityOverlay.addTo(map);

const layerControl = L.control
  .layers(
    {
      Streets: streetBasemap,
      Imagery: imageryBasemap
    },
    {
      "Burn Probability (%)": burnProbabilityOverlay,
      Hillshade: hillshadeOverlay
    },
    {
      collapsed: false
    }
  )
  .addTo(map);

const burnLegend = L.control({ position: "bottomleft" });
burnLegend.onAdd = () => {
  const container = L.DomUtil.create("div", "burn-legend leaflet-control");
  container.innerHTML = `
    <div class="burn-legend-title">Burn probability</div>
    <div class="burn-legend-ramp" aria-hidden="true"></div>
    <div class="burn-legend-labels">
      <span>Low</span>
      <span>Medium</span>
      <span>High</span>
    </div>
  `;
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  return container;
};
burnLegend.addTo(map);

const fireStatusLegend = L.control({ position: "bottomleft" });
fireStatusLegend.onAdd = () => {
  const container = L.DomUtil.create("div", "fire-status-legend leaflet-control");
  container.innerHTML = `
    <div class="fire-status-legend-title">Wildfire Status</div>
    <div class="fire-status-legend-item">
      ${fireLegendIcon("is-fire-of-note")}
      <span>Fire of Note</span>
    </div>
    <div class="fire-status-legend-item">
      ${fireLegendIcon("is-out-of-control")}
      <span>Out of Control</span>
    </div>
    <div class="fire-status-legend-item">
      ${fireLegendIcon("is-being-held")}
      <span>Being Held</span>
    </div>
    <div class="fire-status-legend-item">
      ${fireLegendIcon("is-under-control")}
      <span>Under Control</span>
    </div>
    <div class="fire-status-legend-item">
      ${fireLegendIcon("is-unknown-status")}
      <span>Unknown</span>
    </div>
    <div class="fire-status-legend-item is-perimeter">
      <svg class="fire-perimeter-swatch" width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
        <path d="M1 7h16" fill="none" stroke="#0891b2" stroke-width="3" />
      </svg>
      <span>Current fire perimeter</span>
    </div>
  `;
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  return container;
};
fireStatusLegend.addTo(map);

const sidebar = document.querySelector("#community-sidebar");
const searchInput = document.querySelector("#community-search");
const searchOptions = document.querySelector("#community-options");
const clearButton = document.querySelector("#clear-search");
const fireSelect = document.querySelector("#fire-select");
const clearFireButton = document.querySelector("#clear-fire");
const graphModal = document.querySelector("#graph-modal");
const graphModalContent = document.querySelector("#graph-modal-content");

const communitiesBySlug = new Map();
const communitiesByName = new Map();
const layersBySlug = new Map();
const fireLayersById = new Map();
const FIRE_STATUS_ORDER = [
  "Fire of Note",
  "Out of Control",
  "Being Held",
  "Under Control",
  "Unknown"
];
let selectedLayer = null;
let selectedFeature = null;
let selectedFireMarker = null;
let selectedFireFeature = null;
let selectedWuiLayer = null;
let selectedWuiFeature = null;

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function fireLegendIcon(className) {
  return `
    <svg class="fire-status-swatch ${className}" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 16c3.314 0 6-2 6-5.5 0-1.5-.5-4-2.5-6 .25 1.5-1.25 2-1.25 2C11 4 9 .5 6 0c.357 2 .5 4-2 6-1.25 1-2 2.729-2 4.5C2 14 4.686 16 8 16m0-1c-1.657 0-3-1-3-2.75 0-.75.25-2 1.25-3C6.125 10 7 10.5 7 10.5c-.375-1.25.5-3.25 2-3.5-.179 1-.25 2 1 3 .625.5 1 1.364 1 2.25C11 14 9.657 15 8 15" />
    </svg>
  `;
}

function communityMarkerSize(population) {
  const minimumSize = 16;
  const maximumSize = 30;

  if (typeof population !== "number" || population <= 0) {
    return minimumSize;
  }

  // A logarithmic scale keeps smaller communities distinct without allowing
  // the largest population centres to overwhelm the map.
  const scaledSize = minimumSize + Math.log10(population / 1000) * 5;
  return Math.round(Math.min(maximumSize, Math.max(minimumSize, scaledSize)));
}

function communityMarkerForFeature(feature, latlng) {
  const size = communityMarkerSize(feature.properties.wui_population || feature.properties.population);

  return L.marker(latlng, {
    pane: "communityPane",
    icon: L.divIcon({
      className: "community-marker-icon",
      html: `
        <svg class="community-marker-symbol" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L2 8.207V13.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V8.207l.646.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293zM13 7.207V13.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V7.207l5-5z" />
        </svg>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    }),
    title: feature.properties.name
  });
}

function setCommunitySelected(layer, isSelected) {
  const element = layer.getElement();
  element?.classList.toggle("is-selected", isSelected);

  if (layer.setStyle) {
    layer.setStyle({ fillColor: isSelected ? "#2d6a4f" : "#2563eb" });
  }
}

function wuiPolygonStyle(feature) {
  const population = feature.properties?.wui_population || 0;
  const weight = population > 100000 ? 2 : 1;

  return {
    pane: "wuiPolygonPane",
    color: "#92400e",
    weight,
    opacity: 0.78,
    fillColor: "#f59e0b",
    fillOpacity: 0.12
  };
}

function setWuiPolygonSelected(layer, isSelected) {
  layer.setStyle(
    isSelected
      ? {
          color: "#1b4332",
          weight: 3,
          fillOpacity: 0.26
        }
      : wuiPolygonStyle(layer.feature)
  );
  if (isSelected) {
    layer.bringToFront();
  }
}

function formatFireDate(value) {
  if (!value) {
    return "Unknown";
  }

  const dateOnly = String(value).replace("Z", "");
  const parsed = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function firePerimeterStyle() {
  return {
    pane: "firePerimeterPane",
    color: "#0891b2",
    weight: 2,
    opacity: 0.95,
    fill: false
  };
}

function fireId(feature) {
  const properties = feature.properties || {};
  return String(properties.FIRE_NUMBER || properties.OBJECTID || "");
}

function fireLabel(feature) {
  const properties = feature.properties || {};
  const fireNumber = properties.FIRE_NUMBER || "Unknown";
  const incidentName = properties.INCIDENT_NAME;
  const displayName = incidentName && incidentName !== fireNumber ? incidentName : `Fire ${fireNumber}`;
  const status = properties.FIRE_STATUS || "Unknown status";
  const size =
    typeof properties.FIRE_SIZE_HECTARES === "number"
      ? `${properties.FIRE_SIZE_HECTARES.toLocaleString(undefined, {
          maximumFractionDigits: 1
        })} ha`
      : "Unknown size";

  return `${displayName} - ${status} - ${size}`;
}

function firePopupHtml(feature) {
  const properties = feature.properties || {};
  const fireNumber = properties.FIRE_NUMBER || "Unknown";
  const incidentName = properties.INCIDENT_NAME;
  const displayName = incidentName && incidentName !== fireNumber ? incidentName : `Fire ${fireNumber}`;
  const sizeLabel =
    typeof properties.FIRE_SIZE_HECTARES === "number"
      ? `${properties.FIRE_SIZE_HECTARES.toLocaleString(undefined, {
          maximumFractionDigits: 1
        })} ha`
      : "Unknown";
  const fireUrl = properties.FIRE_URL
    ? `<a href="${properties.FIRE_URL}" target="_blank" rel="noopener">BCWS incident page</a>`
    : "";
  const isIncidentPoint = properties.DATA_SOURCE === "incident-point";
  const spatialNote = isIncidentPoint
    ? "<span>Perimeter not yet published</span><br />"
    : `<span>Tracked ${formatFireDate(properties.TRACK_DATE)}</span><br />`;

  return `
    <div class="fire-popup">
      <strong>${displayName}</strong>
      <span>Fire Number: ${fireNumber}</span><br />
      <span>Status: ${properties.FIRE_STATUS || "Unknown"}</span><br />
      <span>Size: ${sizeLabel}</span><br />
      ${spatialNote}
      ${fireUrl ? `<div>${fireUrl}</div>` : ""}
    </div>
  `;
}

function fireMarkerIcon(feature) {
  const status = feature.properties?.FIRE_STATUS || "";
  const className = fireStatusClass(status);

  return L.divIcon({
    className: `fire-marker-icon ${className}`,
    html: `
      <svg class="fire-marker-symbol" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 16c3.314 0 6-2 6-5.5 0-1.5-.5-4-2.5-6 .25 1.5-1.25 2-1.25 2C11 4 9 .5 6 0c.357 2 .5 4-2 6-1.25 1-2 2.729-2 4.5C2 14 4.686 16 8 16m0-1c-1.657 0-3-1-3-2.75 0-.75.25-2 1.25-3C6.125 10 7 10.5 7 10.5c-.375-1.25.5-3.25 2-3.5-.179 1-.25 2 1 3 .625.5 1 1.364 1 2.25C11 14 9.657 15 8 15" />
      </svg>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10]
  });
}

function fireStatusClass(status) {
  const statusClassByName = {
    "Fire of Note": "is-fire-of-note",
    "Out of Control": "is-out-of-control",
    "Being Held": "is-being-held",
    "Under Control": "is-under-control"
  };

  return statusClassByName[status] || "is-unknown-status";
}

function normalizedFireStatus(feature) {
  return feature.properties?.FIRE_STATUS || "Unknown";
}

function fireStatusSortIndex(status) {
  const index = FIRE_STATUS_ORDER.indexOf(status);
  return index === -1 ? FIRE_STATUS_ORDER.length : index;
}

function populateFireSelect(features) {
  fireSelect.innerHTML = '<option value="">Select an active wildfire</option>';

  const groupsByStatus = new Map(FIRE_STATUS_ORDER.map((status) => [status, []]));
  features.forEach((feature) => {
    const status = normalizedFireStatus(feature);
    if (!groupsByStatus.has(status)) {
      groupsByStatus.set(status, []);
    }
    groupsByStatus.get(status).push(feature);
  });

  [...groupsByStatus.entries()]
    .sort(([statusA], [statusB]) => fireStatusSortIndex(statusA) - fireStatusSortIndex(statusB))
    .forEach(([status, statusFeatures]) => {
      if (!statusFeatures.length) {
        return;
      }

      const group = document.createElement("optgroup");
      group.label = status;
      statusFeatures
        .sort((a, b) => fireLabel(a).localeCompare(fireLabel(b)))
        .forEach((feature) => {
          const option = document.createElement("option");
          option.value = fireId(feature);
          option.textContent = fireLabel(feature);
          group.appendChild(option);
        });
      fireSelect.appendChild(group);
    });
}

function clearSelectedCommunity() {
  searchInput.value = "";

  if (selectedLayer) {
    setCommunitySelected(selectedLayer, false);
    selectedLayer.closePopup();
    selectedLayer = null;
  }

  selectedFeature = null;
  closeGraphModal();
}

function clearSelectedWuiPolygon() {
  if (selectedWuiLayer) {
    setWuiPolygonSelected(selectedWuiLayer, false);
    selectedWuiLayer.closePopup();
    selectedWuiLayer = null;
  }

  selectedWuiFeature = null;
}

function closeSidebarPane() {
  const hadSelection = Boolean(selectedFeature || selectedFireFeature || selectedWuiFeature);
  clearSelectedCommunity();
  clearSelectedFire();
  clearSelectedWuiPolygon();

  if (hadSelection) {
    renderDefaultSidebar();
  }
}

function sidebarCloseButton(label = "Close details") {
  return `
    <button class="sidebar-close" type="button" aria-label="${label}" title="${label}" data-close-sidebar>
      <span aria-hidden="true">&times;</span>
    </button>
  `;
}

function renderDefaultSidebar() {
  sidebar.innerHTML = `
    <div class="sidebar-empty">
      <h1>Frontera Wildfire Risk</h1>
      <p>Select a community or active wildfire to view its details.</p>
    </div>
  `;
}

function renderFireSidebar(feature) {
  const properties = feature.properties || {};
  const fireNumber = properties.FIRE_NUMBER || "Unknown";
  const incidentName = properties.INCIDENT_NAME;
  const displayName = incidentName && incidentName !== fireNumber ? incidentName : `Fire ${fireNumber}`;
  const status = properties.FIRE_STATUS || "Unknown";
  const sizeLabel =
    typeof properties.FIRE_SIZE_HECTARES === "number"
      ? `${properties.FIRE_SIZE_HECTARES.toLocaleString(undefined, {
          maximumFractionDigits: 1
        })} ha`
      : "Not available";
  const isIncidentPoint = properties.DATA_SOURCE === "incident-point";
  const dataType = isIncidentPoint ? "Incident location only" : "Published perimeter";
  const trackingDate = isIncidentPoint ? "Not available" : formatFireDate(properties.TRACK_DATE);
  const fireYear = properties.INCIDENT_FIRE_YEAR || properties.FIRE_YEAR || "Unknown";
  const source = isIncidentPoint ? "BCWS active incident feed" : properties.SOURCE || "BCWS current fire perimeters";
  const fireLink = properties.FIRE_URL
    ? `<a class="sidebar-action fire-detail-link" href="${properties.FIRE_URL}" target="_blank" rel="noopener">Open BCWS incident page</a>`
    : "";

  sidebar.innerHTML = `
    <article class="fire-detail">
      ${sidebarCloseButton("Close wildfire details")}
      <div class="fire-detail-heading">
        <div>
          <h1>${displayName}</h1>
          <p>Fire Number: ${fireNumber}</p>
        </div>
        <span class="fire-status-badge ${fireStatusClass(status)}">${status}</span>
      </div>
      ${isIncidentPoint ? '<p class="fire-detail-notice">BCWS has published an incident location, but no perimeter yet.</p>' : ""}
      <dl class="fire-detail-list">
        <div><dt>Size</dt><dd>${sizeLabel}</dd></div>
        <div><dt>Fire year</dt><dd>${fireYear}</dd></div>
        <div><dt>Map data</dt><dd>${dataType}</dd></div>
        <div><dt>Perimeter tracked</dt><dd>${trackingDate}</dd></div>
        <div><dt>Source</dt><dd>${source}</dd></div>
      </dl>
      ${fireLink}
    </article>
  `;
}

function formatWuiPolygon(feature) {
  const properties = feature.properties || {};
  const communities = properties.communities || [];

  return {
    name: properties.name || "WUI area",
    populationLabel:
      typeof properties.wui_population === "number"
        ? properties.wui_population.toLocaleString()
        : "Unavailable",
    source: properties.population_source || "Unavailable",
    communities,
    communitiesLabel: communities.length ? communities.join(", ") : "Not listed"
  };
}

function wuiPolygonPopupHtml(feature) {
  const details = formatWuiPolygon(feature);

  return `
    <div class="wui-popup">
      <strong>${details.name}</strong>
      <span>WUI population ${details.populationLabel}</span><br />
      <span>${details.communities.length} included place${details.communities.length === 1 ? "" : "s"}</span>
    </div>
  `;
}

function renderWuiPolygonSidebar(feature) {
  const details = formatWuiPolygon(feature);

  sidebar.innerHTML = `
    <article class="wui-detail">
      ${sidebarCloseButton("Close WUI polygon details")}
      <h1>${details.name}</h1>
      <p>Wildland urban interface polygon for this mapped WUI area.</p>
      <div class="detail-meta" aria-label="WUI polygon metadata">
        <span>WUI population: ${details.populationLabel}</span>
        <span>Source: ${details.source}</span>
      </div>
      <section class="wui-places" aria-label="Populated places included in this WUI polygon">
        <h2>Included places</h2>
        <p>${details.communitiesLabel}</p>
      </section>
    </article>
  `;
}

function selectFireById(id) {
  const fireRecord = fireLayersById.get(id);
  if (!fireRecord) {
    return;
  }

  if (selectedFireMarker) {
    selectedFireMarker.getElement()?.classList.remove("is-selected");
  }

  selectedFireMarker = fireRecord.marker;
  selectedFireFeature = fireRecord.feature;
  selectedFireMarker.getElement()?.classList.add("is-selected");
  clearSelectedCommunity();
  clearSelectedWuiPolygon();

  const latlng = fireRecord.marker.getLatLng();
  const targetZoom = Math.max(map.getZoom(), SELECTED_FIRE_ZOOM);
  map.stop();
  map.setView(latlng, targetZoom, { animate: true });
  fireRecord.marker.openPopup();
  fireSelect.value = id;
  renderFireSidebar(fireRecord.feature);
}

function clearSelectedFire() {
  fireSelect.value = "";

  if (selectedFireMarker) {
    selectedFireMarker.getElement()?.classList.remove("is-selected");
    selectedFireMarker.closePopup();
    selectedFireMarker = null;
  }

  selectedFireFeature = null;
}

function loadCurrentFirePerimeters() {
  const cacheKey = Date.now();
  Promise.all(
    [CURRENT_FIRE_DATA_URL, CURRENT_FIRE_INCIDENT_DATA_URL].map((url) =>
      fetch(`${url}?updated=${cacheKey}`).then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load ${url}`);
        }

        return response.json();
      })
    )
  )
    .then(([perimeterGeojson, incidentGeojson]) => {
      const geojson = {
        type: "FeatureCollection",
        features: [
          ...(perimeterGeojson.features || []),
          ...(incidentGeojson.features || [])
        ]
      };
      const fireMarkerLayer = L.layerGroup();
      const perimeterLayersById = new Map();
      const firePerimeterLayer = L.geoJSON(geojson, {
        pane: "firePerimeterPane",
        filter: (feature) => feature.geometry?.type !== "Point",
        style: firePerimeterStyle,
        onEachFeature: (feature, layer) => {
          const id = fireId(feature);
          const popup = firePopupHtml(feature);
          layer.bindPopup(popup, {
            autoPan: false,
            keepInView: false
          });
          layer.on("click", () => selectFireById(id));
          perimeterLayersById.set(id, layer);
        }
      });

      geojson.features.forEach((feature) => {
        const id = fireId(feature);
        const popup = firePopupHtml(feature);
        const perimeter = perimeterLayersById.get(id) || null;
        const coordinates = feature.geometry?.coordinates;
        const markerLocation =
          feature.geometry?.type === "Point"
            ? L.latLng(coordinates[1], coordinates[0])
            : perimeter.getBounds().getCenter();
        const marker = L.marker(markerLocation, {
            pane: "fireMarkerPane",
            icon: fireMarkerIcon(feature),
            title: fireLabel(feature)
        });

        marker.bindPopup(popup, {
          autoPan: false,
          keepInView: false
        });
        marker.on("click", () => selectFireById(id));
        marker.addTo(fireMarkerLayer);

        fireLayersById.set(id, {
          feature,
          marker,
          perimeter
        });
      });
      populateFireSelect(geojson.features);
      const fireLayer = L.layerGroup([firePerimeterLayer, fireMarkerLayer]).addTo(map);

      layerControl.addOverlay(fireLayer, "Current Wildfires");
    })
    .catch((error) => {
      console.warn(error);
    });
}

function showWuiPolygon(feature, layer) {
  clearSelectedCommunity();
  clearSelectedFire();

  if (selectedWuiLayer) {
    setWuiPolygonSelected(selectedWuiLayer, false);
  }

  selectedWuiLayer = layer;
  selectedWuiFeature = feature;
  setWuiPolygonSelected(selectedWuiLayer, true);
  layer.setPopupContent(wuiPolygonPopupHtml(feature));
  layer.openPopup();
  renderWuiPolygonSidebar(feature);
}

function loadWuiPolygons() {
  fetch(WUI_POLYGON_DATA_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${WUI_POLYGON_DATA_URL}`);
      }

      return response.json();
    })
    .then((geojson) => {
      const wuiPolygonLayer = L.geoJSON(geojson, {
        pane: "wuiPolygonPane",
        style: wuiPolygonStyle,
        onEachFeature: (feature, layer) => {
          layer.bindPopup(wuiPolygonPopupHtml(feature), {
            autoPan: false,
            keepInView: false
          });
          layer.on({
            click: () => showWuiPolygon(feature, layer),
            mouseover: () => {
              if (layer !== selectedWuiLayer) {
                layer.setStyle({ fillOpacity: 0.2 });
              }
            },
            mouseout: () => {
              if (layer !== selectedWuiLayer) {
                setWuiPolygonSelected(layer, false);
              }
            }
          });
        }
      }).addTo(map);

      layerControl.addOverlay(wuiPolygonLayer, "WUI Risk Class Polygons");
    })
    .catch((error) => {
      console.warn(error);
    });
}

function formatCommunity(feature) {
  const {
    name,
    slug,
    wui_name: wuiName,
    wui_population: wuiPopulation,
    wui_population_rank: wuiPopulationRank,
    wui_places: wuiPlaces = [],
    graph,
    has_graph: hasGraph
  } = feature.properties;

  return {
    name,
    slug,
    wuiName,
    graph,
    hasGraph: Boolean(hasGraph && graph),
    places: wuiPlaces,
    placesLabel: wuiPlaces.length ? wuiPlaces.join(", ") : "Not listed",
    populationLabel:
      typeof wuiPopulation === "number" ? wuiPopulation.toLocaleString() : "Needs lookup",
    rankLabel: wuiPopulationRank ? `#${wuiPopulationRank} of 100` : "Unavailable"
  };
}

function graphImageHtml(details, className = "") {
  if (!details.hasGraph) {
    return `
      <div class="graph-missing">
        <strong>Graph pending</strong>
        <span>No wildfire risk graph PNG has been added for this WUI yet.</span>
      </div>
    `;
  }

  return `
    <div class="graph-frame ${className}">
      <img src="${details.graph}?v=${GRAPH_ASSET_VERSION}" alt="Wildfire risk graph for ${details.name}" />
    </div>
  `;
}

function popupHtml(feature) {
  const details = formatCommunity(feature);

  return `
    <div class="community-popup">
      <strong>${details.name}</strong>
      <span>WUI population ${details.populationLabel}</span><br />
      <span>WUI Population Rank ${details.rankLabel}</span>
    </div>
  `;
}

function renderSidebar(feature) {
  const details = formatCommunity(feature);
  sidebar.innerHTML = `
    <article class="community-detail">
      <h1>${details.name}</h1>
      <p>Wildfire risk information for this WUI community.</p>
      ${sidebarCloseButton("Close community details")}
      <div class="detail-meta" aria-label="Community metadata">
        <span>WUI population: ${details.populationLabel}</span>
        <span>WUI Population Rank: ${details.rankLabel}</span>
      </div>
      <section class="wui-places" aria-label="Populated places included in this WUI">
        <h2>Included places</h2>
        <p>${details.placesLabel}</p>
      </section>
      ${graphImageHtml(details, "is-clickable")}
      ${details.hasGraph ? `<button class="sidebar-action" type="button" data-open-modal="${details.slug}">View larger</button>` : ""}
    </article>
  `;
}

function openGraphModal(feature) {
  const details = formatCommunity(feature);

  graphModalContent.innerHTML = `
    <div class="graph-modal-body">
      <div class="graph-card-header">
        <div>
          <h1 id="graph-modal-title">${details.name}</h1>
          <p>WUI population ${details.populationLabel} | WUI Population Rank ${details.rankLabel}</p>
        </div>
      </div>
      ${graphImageHtml(details)}
    </div>
  `;
  graphModal.classList.add("is-open");
  graphModal.setAttribute("aria-hidden", "false");
}

function closeGraphModal() {
  graphModal.classList.remove("is-open");
  graphModal.setAttribute("aria-hidden", "true");
}

function showCommunity(feature, layer) {
  const details = formatCommunity(feature);
  const latlng = layer.getLatLng();

  clearSelectedFire();
  clearSelectedWuiPolygon();

  if (selectedLayer) {
    setCommunitySelected(selectedLayer, false);
  }

  selectedFeature = feature;
  selectedLayer = layer;
  setCommunitySelected(selectedLayer, true);

  const targetZoom = Math.max(map.getZoom(), SELECTED_ZOOM);
  map.stop();
  map.setView(latlng, targetZoom, { animate: true });
  layer.setPopupContent(popupHtml(feature));
  layer.openPopup(latlng);
  searchInput.value = details.name;
  renderSidebar(feature);
}

function selectCommunityByName(name) {
  const query = normalize(name);
  const feature =
    communitiesByName.get(query) ||
    [...communitiesByName.entries()].find(([communityName]) =>
      communityName.startsWith(query)
    )?.[1];

  if (!feature) {
    return;
  }

  const layer = layersBySlug.get(feature.properties.slug);
  if (!layer) {
    return;
  }

  layer.fire("click");
}

function registerCommunity(feature, layer) {
  const { name, slug } = feature.properties;

  communitiesBySlug.set(slug, feature);
  communitiesByName.set(normalize(name), feature);
  layersBySlug.set(slug, layer);

  const option = document.createElement("option");
  option.value = name;
  searchOptions.appendChild(option);
}

function loadCommunities() {
  fetch(COMMUNITY_DATA_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${COMMUNITY_DATA_URL}`);
      }

      return response.json();
    })
    .then((geojson) => {
      geojson.features = [...(geojson.features || [])].sort((a, b) =>
        String(a.properties?.name || "").localeCompare(String(b.properties?.name || ""))
      );
      const communityLayer = L.geoJSON(geojson, {
        pointToLayer: communityMarkerForFeature,
        onEachFeature: (feature, layer) => {
          registerCommunity(feature, layer);
          layer.bindPopup(popupHtml(feature), {
            autoPan: false,
            keepInView: false
          });
          layer.on("click", () => showCommunity(feature, layer));
        }
      }).addTo(map);

      layerControl.addOverlay(communityLayer, "Communities");
      requestAnimationFrame(() => map.invalidateSize());
      map.fitBounds(RASTER_BOUNDS);
    })
    .catch((error) => {
      sidebar.innerHTML = `
        <div class="sidebar-empty">
          <h1>Map Data Error</h1>
          <p>${error.message}</p>
        </div>
      `;
      console.error(error);
    });
}

searchInput.addEventListener("change", () => {
  selectCommunityByName(searchInput.value);
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    selectCommunityByName(searchInput.value);
  }
});

clearButton.addEventListener("click", () => {
  const hadSelectedCommunity = Boolean(selectedFeature);
  clearSelectedCommunity();

  if (hadSelectedCommunity) {
    map.setView(BC_CENTER, DEFAULT_ZOOM);
    renderDefaultSidebar();
  }
});

fireSelect.addEventListener("change", () => {
  if (fireSelect.value) {
    selectFireById(fireSelect.value);
  } else {
    const hadSelectedFire = Boolean(selectedFireFeature);
    clearSelectedFire();
    if (hadSelectedFire) {
      renderDefaultSidebar();
    }
  }
});

clearFireButton.addEventListener("click", () => {
  const hadSelectedFire = Boolean(selectedFireFeature);
  clearSelectedFire();
  if (hadSelectedFire) {
    renderDefaultSidebar();
  }
});

sidebar.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-close-sidebar]");
  const modalButton = event.target.closest("[data-open-modal]");
  const graphFrame = event.target.closest(".graph-frame.is-clickable");

  if (closeButton) {
    closeSidebarPane();
    return;
  }

  if (!selectedFeature || (!modalButton && !graphFrame)) {
    return;
  }

  openGraphModal(selectedFeature);
});

graphModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-modal]")) {
    closeGraphModal();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeGraphModal();
  }
});

loadWuiPolygons();
loadCommunities();
loadCurrentFirePerimeters();

window.addEventListener("resize", () => {
  map.invalidateSize();
});
