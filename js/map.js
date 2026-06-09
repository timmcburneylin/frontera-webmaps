// Frontera community webmap.
// To add communities later, add a point feature to data/communities.geojson
// and place its graph PNG in graphs/<slug>.png.

const COMMUNITY_DATA_URL = "data/communities.geojson";
const HILLSHADE_IMAGE_URL = "data/hillshade.png";
const BURN_PROBABILITY_TILE_URL = "tiles/burn-probability/{z}/{x}/{y}.png";
const BC_CENTER = [54.3, -125.2];
const DEFAULT_ZOOM = 5;
const SELECTED_ZOOM = 10;
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
map.getPane("hillshadePane").style.zIndex = 350;
map.getPane("burnProbabilityPane").style.zIndex = 360;

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

const sidebar = document.querySelector("#community-sidebar");
const searchInput = document.querySelector("#community-search");
const searchOptions = document.querySelector("#community-options");
const clearButton = document.querySelector("#clear-search");
const graphModal = document.querySelector("#graph-modal");
const graphModalContent = document.querySelector("#graph-modal-content");

const communitiesBySlug = new Map();
const communitiesByName = new Map();
const layersBySlug = new Map();
let selectedLayer = null;
let selectedFeature = null;

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function markerForFeature(feature, latlng) {
  const rank = feature.properties.population_rank;
  const radius = rank <= 2 ? 10 : 8;

  return L.circleMarker(latlng, {
    radius,
    className: "community-marker",
    color: "#ffffff",
    weight: 2,
    fillColor: "#c2410c",
    fillOpacity: 0.92
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

  if (selectedLayer) {
    selectedLayer.setStyle({ fillColor: "#c2410c" });
    selectedLayer.getElement()?.classList.remove("is-selected");
  }

  selectedFeature = feature;
  selectedLayer = layer;
  selectedLayer.setStyle({ fillColor: "#2d6a4f" });
  selectedLayer.getElement()?.classList.add("is-selected");

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
        pointToLayer: markerForFeature,
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
  searchInput.value = "";
  map.setView(BC_CENTER, DEFAULT_ZOOM);

  if (selectedLayer) {
    selectedLayer.setStyle({ fillColor: "#c2410c" });
    selectedLayer.getElement()?.classList.remove("is-selected");
    selectedLayer.closePopup();
    selectedLayer = null;
  }

  selectedFeature = null;
  closeGraphModal();
  sidebar.innerHTML = `
    <div class="sidebar-empty">
      <h1>Frontera Wildfire Risk</h1>
      <p>Select a community on the map or search by name to view its graph.</p>
    </div>
  `;
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

window.addEventListener("resize", () => {
  map.invalidateSize();
});
