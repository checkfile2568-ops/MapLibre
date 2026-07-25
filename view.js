const DISPLAY_GIS_QUERY_URL = "https://services1.arcgis.com/jSaRWj2TDlcN1zOC/arcgis/rest/services/Thailand_Subdistrict_Boundaries_%28%E0%B8%82%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B8%B9%E0%B8%A5%E0%B8%82%E0%B8%AD%E0%B8%9A%E0%B9%80%E0%B8%82%E0%B8%95%E0%B8%95%E0%B8%B3%E0%B8%9A%E0%B8%A5%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%97%E0%B8%A8%E0%B9%84%E0%B8%97%E0%B8%A2%29/FeatureServer/1/query";
const DISPLAY_SHARED_DATA_API = "https://api.github.com/repos/checkfile2568-ops/MapLibre/contents/data/assignments.json";
const DISPLAY_MAIN_COURT_DISTRICTS = new Set(["เมืองลพบุรี", "พัฒนานิคม", "โคกสำโรง", "ท่าวุ้ง", "บ้านหมี่", "หนองม่วง"]);

const displayDom = {
  loading: document.querySelector("#loading"),
  search: document.querySelector("#search-input"),
  stats: document.querySelector("#overview-stats"),
  updatedAt: document.querySelector("#updated-at"),
  legend: document.querySelector("#legend"),
  results: document.querySelector("#search-results"),
  centralNotice: document.querySelector("#central-notice"),
};

let displayFeatures = [];
let displayState = { staff: [], assignments: {}, updatedAt: null };
let displayMap;
let displayDataSha = null;

function displayAreaId(feature) {
  return String(feature.properties.ADMIN_ID3 || feature.properties.OBJECTID || feature.id);
}

function displayDistrict(feature) {
  return feature.properties.NAME2;
}

function displayTambon(feature) {
  return feature.properties.NAME3;
}

function displayOwner(feature) {
  const staffId = displayState.assignments[displayAreaId(feature)];
  return displayState.staff.find((person) => person.id === staffId) || null;
}

function decodeDisplayBase64(value) {
  const bytes = Uint8Array.from(atob(value.replace(/\n/g, "")), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function displaySearchText() {
  return displayDom.search.value.trim().toLocaleLowerCase("th");
}

function featureMatchesSearch(feature, query = displaySearchText()) {
  if (!query) return true;
  const owner = displayOwner(feature);
  return `${displayTambon(feature)} ${displayDistrict(feature)} ${owner?.name || ""}`.toLocaleLowerCase("th").includes(query);
}

function displayMapData() {
  const query = displaySearchText();
  return {
    type: "FeatureCollection",
    features: displayFeatures.map((feature) => {
      const owner = displayOwner(feature);
      const matches = featureMatchesSearch(feature, query);
      const dimmed = Boolean(query) && !matches;
      return {
        ...feature,
        id: displayAreaId(feature),
        properties: {
          ...feature.properties,
          id: displayAreaId(feature),
          color: dimmed ? "#dce5e9" : (owner ? owner.color : (matches && query ? "#e1a14d" : "#d4e1e6")),
          height: dimmed ? 180 : (matches && query ? 1450 : (owner ? 1100 : 320)),
        },
      };
    }),
  };
}

function renderStats() {
  const total = displayFeatures.length;
  const assigned = displayFeatures.filter((feature) => displayOwner(feature)).length;
  const values = [`${displayState.staff.length} ผู้รับผิดชอบ`, `มอบหมายแล้ว ${assigned}/${total} ตำบล`, `ยังไม่มอบหมาย ${total - assigned} ตำบล`];
  displayDom.stats.replaceChildren(...values.map((text) => {
    const item = document.createElement("span");
    item.className = "stat";
    item.textContent = text;
    return item;
  }));
  displayDom.updatedAt.textContent = displayState.updatedAt
    ? `ปรับปรุงล่าสุด: ${new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(displayState.updatedAt))}`
    : "ยังไม่มีการบันทึกการมอบหมาย";
  const hasCentralAssignments = displayState.staff.length > 0 || Object.keys(displayState.assignments).length > 0;
  displayDom.centralNotice.hidden = hasCentralAssignments;
  displayDom.centralNotice.textContent = hasCentralAssignments
    ? ""
    : "ยังไม่มีข้อมูลการมอบหมายในข้อมูลกลาง ผู้ดูแลต้องกด “บันทึกส่วนกลาง” จากหน้าจัดการก่อน ข้อมูลจึงจะแสดงบนลิงก์นี้และทุกเครื่อง";
}

function renderLegend() {
  if (!displayState.staff.length) {
    displayDom.legend.innerHTML = '<p class="empty-state">ยังไม่มีผู้รับผิดชอบที่บันทึกไว้</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const person of displayState.staff) {
    const count = displayFeatures.filter((feature) => displayOwner(feature)?.id === person.id).length;
    const row = document.createElement("div");
    row.className = "legend-item";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = person.color;
    const name = document.createElement("strong");
    name.textContent = person.name;
    const countText = document.createElement("span");
    countText.className = "legend-count";
    countText.textContent = `${count} ตำบล`;
    row.append(dot, name, countText);
    fragment.append(row);
  }
  displayDom.legend.replaceChildren(fragment);
}

function boundsForFeature(feature) {
  const bounds = new maplibregl.LngLatBounds();
  const extend = (coordinates) => {
    if (typeof coordinates[0] === "number") bounds.extend(coordinates);
    else coordinates.forEach(extend);
  };
  extend(feature.geometry.coordinates);
  return bounds;
}

function renderSearchResults() {
  const query = displaySearchText();
  if (!query) {
    displayDom.results.className = "search-results";
    displayDom.results.replaceChildren();
    return;
  }
  const matches = displayFeatures.filter((feature) => featureMatchesSearch(feature, query)).slice(0, 12);
  displayDom.results.className = "search-results visible";
  const heading = document.createElement("p");
  heading.className = "result-heading";
  heading.textContent = matches.length ? `พบ ${matches.length} ตำบล — แตะชื่อเพื่อซูมบนแผนที่` : "ไม่พบตำบลหรือผู้รับผิดชอบที่ค้นหา";
  const list = document.createElement("div");
  list.className = "result-list";
  for (const feature of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result";
    const owner = displayOwner(feature);
    button.textContent = `${displayTambon(feature)} · ${owner ? owner.name : "ยังไม่มอบหมาย"}`;
    const district = document.createElement("small");
    district.textContent = displayDistrict(feature);
    button.append(district);
    button.addEventListener("click", () => displayMap.fitBounds(boundsForFeature(feature), { padding: 70, maxZoom: 12.2, duration: 650 }));
    list.append(button);
  }
  displayDom.results.replaceChildren(heading, list);
}

function updateDisplayMap() {
  if (displayMap?.isStyleLoaded() && displayMap.getSource("tambons")) displayMap.getSource("tambons").setData(displayMapData());
  renderSearchResults();
}

function popupForFeature(feature) {
  const owner = displayOwner(feature);
  const card = document.createElement("div");
  const title = document.createElement("div");
  title.className = "popup-title";
  title.textContent = displayTambon(feature);
  const district = document.createElement("div");
  district.className = "popup-sub";
  district.textContent = `อำเภอ${displayDistrict(feature)}`;
  const assignment = document.createElement("div");
  assignment.className = "popup-sub";
  assignment.textContent = owner ? `ผู้รับผิดชอบ: ${owner.name}` : "ยังไม่มอบหมายผู้รับผิดชอบ";
  card.append(title, district, assignment);
  return card;
}

function createDisplayMap() {
  displayMap = new maplibregl.Map({
    container: "display-map",
    style: {
      version: 8,
      sources: {},
      layers: [{ id: "background", type: "background", paint: { "background-color": "#edf4f5" } }],
    },
    center: [100.68, 14.83],
    zoom: 8.9,
    pitch: 47,
    bearing: -13,
    antialias: true,
  });
  displayMap.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  displayMap.on("load", () => {
    displayMap.addSource("tambons", { type: "geojson", data: displayMapData(), promoteId: "id" });
    displayMap.addLayer({ id: "tambon-ground", type: "fill", source: "tambons", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.74 } });
    displayMap.addLayer({
      id: "tambon-3d",
      type: "fill-extrusion",
      source: "tambons",
      paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.84 },
    });
    displayMap.addLayer({ id: "tambon-outline", type: "line", source: "tambons", paint: { "line-color": "#ffffff", "line-width": 1.1, "line-opacity": 0.96 } });
    displayMap.on("mouseenter", "tambon-3d", () => { displayMap.getCanvas().style.cursor = "pointer"; });
    displayMap.on("mouseleave", "tambon-3d", () => { displayMap.getCanvas().style.cursor = ""; });
    displayMap.on("click", "tambon-3d", (event) => {
      const id = String(event.features?.[0]?.properties?.id || "");
      const feature = displayFeatures.find((candidate) => displayAreaId(candidate) === id);
      if (!feature) return;
      new maplibregl.Popup({ offset: 12 }).setLngLat(event.lngLat).setDOMContent(popupForFeature(feature)).addTo(displayMap);
    });
    const allBounds = new maplibregl.LngLatBounds();
    for (const feature of displayFeatures) allBounds.extend(boundsForFeature(feature));
    displayMap.fitBounds(allBounds, { padding: 48, duration: 0, maxZoom: 10.2 });
  });
}

async function loadDisplayData() {
  const params = new URLSearchParams({
    where: "ADMIN_ID1 = '16'",
    outFields: "ADMIN_ID1,ADMIN_ID2,ADMIN_ID3,NAME1,NAME2,NAME3",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });
  const [boundariesResponse, sharedResponse] = await Promise.all([
    fetch(`${DISPLAY_GIS_QUERY_URL}?${params.toString()}`),
    fetch(`${DISPLAY_SHARED_DATA_API}?ref=main&_=${Date.now()}`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" }),
  ]);
  if (!boundariesResponse.ok) throw new Error("ไม่สามารถโหลดขอบเขตตำบลได้");
  if (!sharedResponse.ok) throw new Error("ไม่สามารถโหลดข้อมูลการมอบหมายได้");
  const [collection, sharedPayload] = await Promise.all([boundariesResponse.json(), sharedResponse.json()]);
  applyDisplaySharedData(JSON.parse(decodeDisplayBase64(sharedPayload.content)));
  displayDataSha = sharedPayload.sha || null;
  displayFeatures = collection.features
    .filter((feature) => feature.properties?.ADMIN_ID3 && DISPLAY_MAIN_COURT_DISTRICTS.has(feature.properties.NAME2))
    .map((feature) => ({ ...feature, id: displayAreaId(feature) }));
  filterDisplayAssignments();
}

function applyDisplaySharedData(sharedData) {
  displayState = {
    staff: Array.isArray(sharedData.staff) ? sharedData.staff : [],
    assignments: sharedData.assignments && typeof sharedData.assignments === "object" ? sharedData.assignments : {},
    updatedAt: sharedData.updatedAt || null,
  };
}

function filterDisplayAssignments() {
  const validIds = new Set(displayFeatures.map(displayAreaId));
  displayState.assignments = Object.fromEntries(Object.entries(displayState.assignments).filter(([id]) => validIds.has(id)));
}

async function refreshDisplayData() {
  try {
    const response = await fetch(`${DISPLAY_SHARED_DATA_API}?ref=main&_=${Date.now()}`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload.sha || payload.sha === displayDataSha) return;
    applyDisplaySharedData(JSON.parse(decodeDisplayBase64(payload.content)));
    displayDataSha = payload.sha;
    filterDisplayAssignments();
    renderStats();
    renderLegend();
    updateDisplayMap();
  } catch (error) {
    console.warn("Unable to refresh display data", error);
  }
}

async function initDisplay() {
  try {
    await loadDisplayData();
    renderStats();
    renderLegend();
    createDisplayMap();
    displayDom.search.addEventListener("input", updateDisplayMap);
    window.setInterval(refreshDisplayData, 30000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshDisplayData();
    });
  } catch (error) {
    console.error(error);
    displayDom.updatedAt.textContent = "ไม่สามารถโหลดข้อมูลได้ กรุณารีเฟรชหน้าเว็บ";
  } finally {
    displayDom.loading.hidden = true;
  }
}

initDisplay();
