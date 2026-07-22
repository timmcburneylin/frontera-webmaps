// Frontera community webmap.
// Community risk comparison charts are rendered from data/communities.geojson.

const COMMUNITY_DATA_URL = "data/communities.geojson";
const WUI_POLYGON_DATA_URL = "data/wui-polygons.geojson";
const CURRENT_FIRE_DATA_URL = "data/current-fire-perimeters.geojson";
const CURRENT_FIRE_INCIDENT_DATA_URL = "data/current-fire-incidents.geojson";
const HILLSHADE_IMAGE_URL = "data/hillshade.png";
const BURN_PROBABILITY_TILE_URL = "tiles/burn-probability/{z}/{x}/{y}.png";
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
    <div class="fire-status-legend-item is-outline">
      <svg class="wui-outline-swatch" width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
        <rect x="2" y="2" width="14" height="10" rx="2" fill="none" stroke="#92400e" stroke-opacity="0.78" stroke-width="2" />
      </svg>
      <span>WUI Risk Class polygon</span>
    </div>
  `;
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  return container;
};
fireStatusLegend.addTo(map);

const sidebar = document.querySelector("#community-sidebar");
const searchInput = document.querySelector("#community-search");
const clearButton = document.querySelector("#clear-search");
const fireSelect = document.querySelector("#fire-select");
const clearFireButton = document.querySelector("#clear-fire");
const graphModal = document.querySelector("#graph-modal");
const graphModalContent = document.querySelector("#graph-modal-content");
const riskChartTooltip = document.createElement("div");
riskChartTooltip.className = "risk-chart-tooltip";
riskChartTooltip.setAttribute("role", "tooltip");
document.body.appendChild(riskChartTooltip);

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
let communityRiskRows = [];

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatOrdinal(value) {
  const remainder100 = value % 100;
  const remainder10 = value % 10;
  const suffix =
    remainder100 >= 11 && remainder100 <= 13
      ? "th"
      : remainder10 === 1
        ? "st"
        : remainder10 === 2
          ? "nd"
          : remainder10 === 3
            ? "rd"
            : "th";
  return `${value}${suffix}`;
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
    fillOpacity: 0
  };
}

function setWuiPolygonSelected(layer, isSelected) {
  layer.setStyle(
    isSelected
      ? {
          color: "#1b4332",
          weight: 3,
          fillOpacity: 0
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
      <h1>Provincial Wildfire Prediction Mapping</h1>
      <p>
        Compare burn probability across BC's 100 most populated Wildland Urban Interface (WUI) communities.
        WUI communities are places where people and wildland vegetation meet, while burn probability shows how
        likely an area could experience wildfire. Population is included because the potential impacts of
        wildfire depend not only on wildfire likelihood, but also on how many people and homes could be affected.
        Each blue dot represents one community. Select a community in the scatterplot to highlight it and the map
        will move directly to that community.
      </p>
      ${riskComparisonChartHtml(null, "is-clickable")}
      <button class="sidebar-action" type="button" data-open-overview>View larger</button>
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
                layer.setStyle({ fillOpacity: 0 });
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
    burn_probability_rank: burnProbabilityRank,
    median_bp: medianBurnProbability,
    wui_places: wuiPlaces = [],
  } = feature.properties;

  return {
    name,
    slug,
    wuiName,
    population: wuiPopulation,
    medianBurnProbability,
    burnProbabilityRank,
    places: wuiPlaces,
    placesLabel: wuiPlaces.length ? wuiPlaces.join(", ") : "Not listed",
    populationLabel:
      typeof wuiPopulation === "number" ? wuiPopulation.toLocaleString() : "Needs lookup",
    rankLabel: burnProbabilityRank ? `#${burnProbabilityRank} of ${communityRiskRows.length || 100}` : "Unavailable",
    standingLabel: burnProbabilityRank
      ? `${formatOrdinal(
          Math.round(
            ((communityRiskRows.length - burnProbabilityRank + 1) / communityRiskRows.length) * 100
          )
        )} percentile among communities`
      : "Relative standing unavailable"
  };
}

function riskComparisonChartHtml(details = null, className = "") {
  if (
    !communityRiskRows.length ||
    (details && typeof details.medianBurnProbability !== "number")
  ) {
    return `
      <div class="graph-missing">
        <strong>Comparison unavailable</strong>
        <span>Community burn probability data could not be loaded.</span>
      </div>
    `;
  }

  const width = 920;
  const height = 500;
  const margin = { left: 92, right: 42, top: 38, bottom: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const populations = communityRiskRows.map((row) => row.population);
  const probabilities = communityRiskRows.map((row) => row.medianBp);
  const sortedProbabilities = [...probabilities].sort((a, b) => a - b);
  const medianIndex = (sortedProbabilities.length - 1) / 2;
  const medianProbability =
    (sortedProbabilities[Math.floor(medianIndex)] + sortedProbabilities[Math.ceil(medianIndex)]) / 2;
  const logMin = Math.log10(Math.min(...populations));
  const logMax = Math.log10(Math.max(...populations));
  const bpMax = Math.max(...probabilities) * 1.06;
  const x = (value) => margin.left + (value / bpMax) * plotWidth;
  const y = (value) =>
    margin.top + plotHeight - ((Math.log10(value) - logMin) / (logMax - logMin)) * plotHeight;
  const percent = (value) => `${(value * 100).toFixed(2)}%`;
  const number = (value) => Math.round(value).toLocaleString();
  const grid = Array.from({ length: 6 }, (_, index) => {
    const fraction = index / 5;
    const gridX = margin.left + fraction * plotWidth;
    const gridY = margin.top + plotHeight - fraction * plotHeight;
    const populationTick = 10 ** (logMin + (logMax - logMin) * fraction);
    return `
      <line x1="${gridX}" y1="${margin.top}" x2="${gridX}" y2="${margin.top + plotHeight}" class="risk-chart-grid" />
      <line x1="${margin.left}" y1="${gridY}" x2="${margin.left + plotWidth}" y2="${gridY}" class="risk-chart-grid" />
      <text x="${margin.left - 12}" y="${gridY + 4}" text-anchor="end" class="risk-chart-tick">${number(populationTick)}</text>
    `;
  }).join("");
  const medianX = x(medianProbability);
  const medianLine = `
    <line
      x1="${medianX}"
      y1="${margin.top}"
      x2="${medianX}"
      y2="${margin.top + plotHeight}"
      class="risk-chart-percentile-line"
    />
    <text
      x="${medianX + 8}"
      y="${margin.top + 15}"
      class="risk-chart-percentile-label"
    >50th percentile burn probability</text>
  `;
  const points = communityRiskRows
    .filter((row) => !details || row.wuiName !== details.wuiName)
    .map(
      (row) => `
        <circle
          cx="${x(row.medianBp)}"
          cy="${y(row.population)}"
          r="5"
          class="risk-chart-point"
          tabindex="0"
          role="button"
          aria-label="${escapeHtml(
            `Select ${row.name}: ${percent(row.medianBp)} median burn probability; population ${number(row.population)}; rank #${row.rank}`
          )}"
          data-community-slug="${escapeHtml(row.slug)}"
          data-risk-tooltip="${escapeHtml(
            `${row.name}|${percent(row.medianBp)}|${number(row.population)}|#${row.rank} of ${communityRiskRows.length}`
          )}"
        ></circle>
      `
    )
    .join("");
  let selectedMarkup = "";
  if (details) {
    const selectedX = x(details.medianBurnProbability);
    const selectedY = y(details.population);
    const labelOnRight = selectedX < margin.left + plotWidth * 0.68;
    const labelX = Math.max(
      margin.left + 70,
      Math.min(margin.left + plotWidth - 70, selectedX + (labelOnRight ? 46 : -46))
    );
    const labelY = Math.max(
      margin.top + 20,
      Math.min(margin.top + plotHeight - 16, selectedY - 34)
    );
    selectedMarkup = `
      <line x1="${selectedX}" y1="${selectedY}" x2="${labelX}" y2="${labelY}" class="risk-chart-leader" />
      <circle cx="${selectedX}" cy="${selectedY}" r="12" class="risk-chart-selected-halo" />
      <circle
        cx="${selectedX}"
        cy="${selectedY}"
        r="7"
        class="risk-chart-selected"
        tabindex="0"
        role="button"
        aria-label="${escapeHtml(
          `Select ${details.name}: ${percent(details.medianBurnProbability)} median burn probability; ${details.rankLabel}`
        )}"
        data-community-slug="${escapeHtml(details.slug)}"
        data-risk-tooltip="${escapeHtml(
          `${details.name}|${percent(details.medianBurnProbability)}|${details.populationLabel}|${details.rankLabel}`
        )}"
      ></circle>
      <text x="${labelX + (labelOnRight ? 6 : -6)}" y="${labelY - 4}" text-anchor="${labelOnRight ? "start" : "end"}" class="risk-chart-label">${escapeHtml(details.name)}</text>
    `;
  }

  return `
    <div class="graph-frame risk-chart-frame ${className}">
      ${
        details
          ? `<div class="risk-chart-stats">
              <div><span>Burn probability rank</span><strong>${details.rankLabel}</strong></div>
              <div><span>Community risk percentile</span><strong>${details.standingLabel}</strong></div>
              <div><span>WUI population</span><strong>${details.populationLabel}</strong></div>
            </div>`
          : ""
      }
      <svg class="risk-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${
        details
          ? `${escapeHtml(details.name)} compared with 100 WUI communities by median burn probability and population`
          : "All 100 WUI communities compared by median burn probability and population"
      }">
        ${grid}
        ${medianLine}
        <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" class="risk-chart-axis" />
        <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" class="risk-chart-axis" />
        <text x="${margin.left + plotWidth / 2}" y="${height - 18}" text-anchor="middle" class="risk-chart-axis-title">Median annual burn probability</text>
        <text x="22" y="${margin.top + plotHeight / 2}" transform="rotate(-90 22 ${margin.top + plotHeight / 2})" text-anchor="middle" class="risk-chart-axis-title">WUI population (log scale)</text>
        ${points}
        ${selectedMarkup}
      </svg>
      <p class="graph-caption">Each point is one WUI community. Population uses a logarithmic scale so communities of very different sizes remain visible.</p>
    </div>
  `;
}

function popupHtml(feature) {
  const details = formatCommunity(feature);

  return `
    <div class="community-popup">
      <strong>${details.name}</strong>
      <span>WUI population ${details.populationLabel}</span><br />
      <span>Burn probability rank ${details.rankLabel}</span>
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
        <span>Burn probability rank: ${details.rankLabel}</span>
      </div>
      <section class="wui-places" aria-label="Populated places included in this WUI">
        <h2>Included places</h2>
        <p>${details.placesLabel}</p>
      </section>
      ${riskComparisonChartHtml(details, "is-clickable")}
      <button class="sidebar-action" type="button" data-open-modal="${details.slug}">View larger</button>
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
          <p>Burn probability rank ${details.rankLabel} | WUI population ${details.populationLabel}</p>
        </div>
      </div>
      ${riskComparisonChartHtml(details)}
    </div>
  `;
  graphModal.classList.add("is-open");
  graphModal.setAttribute("aria-hidden", "false");
}

function openOverviewGraphModal() {
  graphModalContent.innerHTML = `
    <div class="graph-modal-body">
      <div class="graph-card-header">
        <div>
          <h1 id="graph-modal-title">Provincial Wildfire Prediction Mapping</h1>
          <p>
            Compare burn probability across BC's 100 most populated Wildland Urban Interface (WUI) communities.
            Select a community in the scatterplot to highlight it and move the map directly there.
          </p>
        </div>
      </div>
      ${riskComparisonChartHtml()}
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

function selectCommunityBySlug(slug) {
  const feature = communitiesBySlug.get(slug);
  const layer = layersBySlug.get(slug);
  if (!feature || !layer) {
    return;
  }

  closeGraphModal();
  riskChartTooltip.classList.remove("is-visible");
  showCommunity(feature, layer);
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
  option.textContent = name;
  searchInput.appendChild(option);
}

function sortCommunityOptions() {
  const options = [...searchInput.options].slice(1);
  options.sort((a, b) => a.textContent.localeCompare(b.textContent));
  options.forEach((option) => searchInput.appendChild(option));
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
      geojson.features = [...(geojson.features || [])].sort(
        (a, b) =>
          Number(a.properties?.burn_probability_rank || Infinity) -
          Number(b.properties?.burn_probability_rank || Infinity)
      );
      communityRiskRows = geojson.features.map((feature) => ({
        name: feature.properties.name,
        slug: feature.properties.slug,
        wuiName: feature.properties.wui_name,
        population: feature.properties.wui_population,
        medianBp: feature.properties.median_bp,
        rank: feature.properties.burn_probability_rank
      }));
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
      sortCommunityOptions();

      layerControl.addOverlay(communityLayer, "Communities");
      requestAnimationFrame(() => map.invalidateSize());
      map.fitBounds(RASTER_BOUNDS);
      if (!selectedFeature && !selectedFireFeature && !selectedWuiFeature) {
        renderDefaultSidebar();
      }
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
  if (searchInput.value) {
    selectCommunityByName(searchInput.value);
  } else {
    const hadSelectedCommunity = Boolean(selectedFeature);
    clearSelectedCommunity();
    if (hadSelectedCommunity) {
      renderDefaultSidebar();
    }
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
  const chartPoint = event.target.closest("[data-community-slug]");
  const modalButton = event.target.closest("[data-open-modal]");
  const overviewButton = event.target.closest("[data-open-overview]");
  const graphFrame = event.target.closest(".graph-frame.is-clickable");

  if (chartPoint) {
    selectCommunityBySlug(chartPoint.dataset.communitySlug);
    return;
  }

  if (closeButton) {
    closeSidebarPane();
    return;
  }

  if (overviewButton || (graphFrame && !selectedFeature)) {
    openOverviewGraphModal();
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
    return;
  }

  const chartPoint = event.target.closest("[data-community-slug]");
  if (chartPoint) {
    selectCommunityBySlug(chartPoint.dataset.communitySlug);
  }
});

function showRiskChartTooltip(point, clientX, clientY) {
  const [name, burnProbability, population, rank] = point.dataset.riskTooltip.split("|");
  riskChartTooltip.innerHTML = `
    <strong>${escapeHtml(name)}</strong>
    <span>Median burn probability: ${escapeHtml(burnProbability)}</span>
    <span>WUI population: ${escapeHtml(population)}</span>
    <span>Burn probability rank: ${escapeHtml(rank)}</span>
  `;
  riskChartTooltip.classList.add("is-visible");

  const padding = 14;
  const tooltipRect = riskChartTooltip.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY - tooltipRect.height / 2;
  if (left + tooltipRect.width > window.innerWidth - padding) {
    left = clientX - tooltipRect.width - 14;
  }
  top = Math.max(padding, Math.min(window.innerHeight - tooltipRect.height - padding, top));
  riskChartTooltip.style.left = `${left}px`;
  riskChartTooltip.style.top = `${top}px`;
}

document.addEventListener("pointermove", (event) => {
  const point = event.target.closest("[data-risk-tooltip]");
  if (point) {
    showRiskChartTooltip(point, event.clientX, event.clientY);
  } else {
    riskChartTooltip.classList.remove("is-visible");
  }
});

document.addEventListener("focusin", (event) => {
  const point = event.target.closest("[data-risk-tooltip]");
  if (!point) {
    return;
  }
  const rect = point.getBoundingClientRect();
  showRiskChartTooltip(point, rect.right, rect.top + rect.height / 2);
});

document.addEventListener("focusout", (event) => {
  if (event.target.closest("[data-risk-tooltip]")) {
    riskChartTooltip.classList.remove("is-visible");
  }
});

window.addEventListener("keydown", (event) => {
  const chartPoint = event.target.closest?.("[data-community-slug]");
  if (chartPoint && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    selectCommunityBySlug(chartPoint.dataset.communitySlug);
    return;
  }

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
