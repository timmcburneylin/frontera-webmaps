// Frontera community webmap.
// To add communities later, add a point feature to data/communities.geojson
// and place its graph PNG in graphs/<slug>.png.

const COMMUNITY_DATA_URL = "data/communities.geojson";
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
map.createPane("firePerimeterPane");
map.createPane("communityPane");
map.createPane("fireMarkerPane");
map.getPane("hillshadePane").style.zIndex = 350;
map.getPane("burnProbabilityPane").style.zIndex = 360;
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
    <div class="fire-status-legend-title">Fire status</div>
    <div class="fire-status-legend-item">
      <span class="fire-status-swatch is-under-control" aria-hidden="true"></span>
      <span>Under Control</span>
    </div>
    <div class="fire-status-legend-item">
      <span class="fire-status-swatch is-being-held" aria-hidden="true"></span>
      <span>Being Held</span>
    </div>
    <div class="fire-status-legend-item">
      <span class="fire-status-swatch is-out-of-control" aria-hidden="true"></span>
      <span>Out of Control</span>
    </div>
    <div class="fire-status-legend-item">
      <span class="fire-status-swatch is-unknown-status" aria-hidden="true"></span>
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
let selectedLayer = null;
let selectedFeature = null;
let selectedFireMarker = null;
let selectedFireFeature = null;

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
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
  const size = communityMarkerSize(feature.properties.population);

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
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -13]
  });
}

function fireStatusClass(status) {
  const statusClassByName = {
    "Out of Control": "is-out-of-control",
    "Being Held": "is-being-held",
    "Under Control": "is-under-control"
  };

  return statusClassByName[status] || "is-unknown-status";
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

        const option = document.createElement("option");
        option.value = id;
        option.textContent = fireLabel(feature);
        fireSelect.appendChild(option);
      });
      const fireLayer = L.layerGroup([firePerimeterLayer, fireMarkerLayer]).addTo(map);

      layerControl.addOverlay(fireLayer, "Current Wildfires");
    })
    .catch((error) => {
      console.warn(error);
    });
}

function formatCommunity(feature) {
  const {
    name,
    slug,
    population,
    population_rank: populationRank,
    graph
  } = feature.properties;

  return {
    name,
    slug,
    graph,
    populationLabel:
      typeof population === "number" ? population.toLocaleString() : "Needs lookup",
    rankLabel: populationRank ? `#${populationRank}` : "Unavailable"
  };
}

function graphImageHtml(details, className = "") {
  return `
    <div class="graph-frame ${className}">
      <img src="${details.graph}" alt="Wildfire risk graph for ${details.name}" />
    </div>
  `;
}

function popupHtml(feature) {
  const details = formatCommunity(feature);

  return `
    <div class="community-popup">
      <strong>${details.name}</strong>
      <span>Population ${details.populationLabel}</span><br />
      <span>Population rank ${details.rankLabel}</span>
    </div>
  `;
}

function renderSidebar(feature) {
  const details = formatCommunity(feature);
  sidebar.innerHTML = `
    <article class="community-detail">
      <h1>${details.name}</h1>
      <p>Wildfire risk graph for this community.</p>
      <div class="detail-meta" aria-label="Community metadata">
        <span>Population: ${details.populationLabel}</span>
        <span>Population rank: ${details.rankLabel}</span>
      </div>
      ${graphImageHtml(details, "is-clickable")}
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
          <p>Population ${details.populationLabel} | Rank ${details.rankLabel}</p>
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
  const modalButton = event.target.closest("[data-open-modal]");
  const graphFrame = event.target.closest(".graph-frame.is-clickable");

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

loadCommunities();
loadCurrentFirePerimeters();

window.addEventListener("resize", () => {
  map.invalidateSize();
});
