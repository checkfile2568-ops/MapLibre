const DISPLAY_GIS_QUERY_URL = "https://services1.arcgis.com/jSaRWj2TDlcN1zOC/arcgis/rest/services/Thailand_Subdistrict_Boundaries_%28%E0%B8%82%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B8%B9%E0%B8%A5%E0%B8%82%E0%B8%AD%E0%B8%9A%E0%B9%80%E0%B8%82%E0%B8%95%E0%B8%95%E0%B8%B3%E0%B8%9A%E0%B8%A5%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%97%E0%B8%A8%E0%B9%84%E0%B8%97%E0%B8%A2%29/FeatureServer/1/query";
const DISPLAY_SHARED_DATA_URL = "data/assignments.json";
const DISPLAY_MAIN_COURT_DISTRICTS = new Set(["เมืองลพบุรี", "พัฒนานิคม", "โคกสำโรง", "ท่าวุ้ง", "บ้านหมี่", "หนองม่วง"]);
const DISPLAY_VERSION = "V1.0";

const displayDom = {
  loading: document.querySelector("#loading"),
  title: document.querySelector("#display-title"),
  search: document.querySelector("#search-input"),
  stats: document.querySelector("#overview-stats"),
  updatedAt: document.querySelector("#updated-at"),
  dataStatus: document.querySelector("#data-status"),
  coverageMain: document.querySelector("#coverage-main"),
  coverageExclusion: document.querySelector("#coverage-exclusion"),
  displayContent: document.querySelector("#display-content"),
  legendPanel: document.querySelector("#legend-panel"),
  legend: document.querySelector("#legend"),
  results: document.querySelector("#search-results"),
  centralNotice: document.querySelector("#central-notice"),
  tambonLabelsButton: document.querySelector("#toggle-tambon-labels"),
  districtLabelsButton: document.querySelector("#toggle-district-labels"),
  legendToggleButton: document.querySelector("#toggle-legend-button"),
  staffFilter: document.querySelector("#staff-filter"),
  clearStaffFilter: document.querySelector("#clear-staff-filter"),
  personDetail: document.querySelector("#person-detail"),
};

let displayFeatures = [];
let displayState = { staff: [], assignments: {}, updatedAt: null };
let displayMap;
let displayDataRevision = null;
let displayLabelMarkers = { tambon: [], district: [] };
let displayUi = { selectedStaffId: "", showTambonLabels: true, showDistrictLabels: true, showLegend: true };
let displayResizeTimer;

function typeDisplayTitle() {
  const title = displayDom.title;
  if (!title || title.dataset.typed === "true") return;
  const fullText = title.dataset.text || title.textContent.trim();
  if (!fullText) return;
  title.dataset.typed = "true";
  title.setAttribute("aria-label", fullText);
  title.textContent = "";
  const graphemes = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(fullText)].map((item) => item.segment)
    : Array.from(fullText);
  let index = 0;
  const typeNext = () => {
    title.textContent += graphemes[index] || "";
    index += 1;
    if (index < graphemes.length) window.setTimeout(typeNext, 105);
  };
  window.setTimeout(typeNext, 1000);
}

function formatDisplayDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" }).format(date);
}

function renderDataStatus(online = true) {
  if (!displayDom.dataStatus) return;
  const status = online ? "● ออนไลน์" : "● ออฟไลน์";
  displayDom.dataStatus.textContent = `${status} · ข้อมูลล่าสุด ${DISPLAY_VERSION} · ${formatDisplayDate(displayState.updatedAt)}`;
  displayDom.dataStatus.className = `read-only-badge ${online ? "online" : "offline"}`;
}

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

function displaySharedDataUrl() {
  const url = new URL(DISPLAY_SHARED_DATA_URL, window.location.href);
  url.searchParams.set("_", String(Date.now()));
  return url;
}

function displayRevision(data) {
  return data.updatedAt || JSON.stringify(data);
}

function displaySearchText() {
  return displayDom.search.value.trim().toLocaleLowerCase("th");
}

function featureMatchesSearch(feature, query = displaySearchText()) {
  if (!query) return true;
  const owner = displayOwner(feature);
  return `${displayTambon(feature)} ${displayDistrict(feature)} ${owner?.name || ""}`.toLocaleLowerCase("th").includes(query);
}

function featureMatchesSelectedStaff(feature) {
  return !displayUi.selectedStaffId || displayOwner(feature)?.id === displayUi.selectedStaffId;
}

function featureMatchesDisplay(feature, query = displaySearchText()) {
  return featureMatchesSelectedStaff(feature) && featureMatchesSearch(feature, query);
}

function displayMapData() {
  const query = displaySearchText();
  const hasFilter = Boolean(query || displayUi.selectedStaffId);
  return {
    type: "FeatureCollection",
    features: displayFeatures.map((feature) => {
      const owner = displayOwner(feature);
      const matches = featureMatchesDisplay(feature, query);
      const dimmed = hasFilter && !matches;
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
  const districtCount = new Set(displayFeatures.map(displayDistrict)).size;
  const assigned = displayFeatures.filter((feature) => displayOwner(feature)).length;
  const selected = displayState.staff.find((person) => person.id === displayUi.selectedStaffId);
  const values = [`${displayState.staff.length} ผู้รับผิดชอบ`, `มอบหมายแล้ว ${assigned}/${total} ตำบล`, `ยังไม่มอบหมาย ${total - assigned} ตำบล`];
  if (selected) values.push(`กำลังแสดง: ${selected.name}`);
  displayDom.stats.replaceChildren(...values.map((text) => {
    const item = document.createElement("span");
    item.className = "stat";
    item.textContent = text;
    return item;
  }));
  displayDom.updatedAt.textContent = displayState.updatedAt
    ? `ปรับปรุงล่าสุด: ${new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(new Date(displayState.updatedAt))}`
    : "ยังไม่มีการบันทึกการมอบหมาย";
  if (displayDom.coverageMain) displayDom.coverageMain.textContent = `เขตทั้งหมดรวม ${districtCount} อำเภอ · ตำบลทั้งหมด ${total} ตำบล`;
  if (displayDom.coverageExclusion) displayDom.coverageExclusion.textContent = "(ไม่รวมเขตศาลจังหวัดชัยบาดาล)";
  renderDataStatus(true);
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
    const row = document.createElement("button");
    row.type = "button";
    row.className = "legend-item legend-person";
    row.setAttribute("aria-pressed", String(person.id === displayUi.selectedStaffId));
    row.title = `แสดงเขตรับผิดชอบของ ${person.name}`;
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = person.color;
    const name = document.createElement("strong");
    name.textContent = person.name;
    const countText = document.createElement("span");
    countText.className = "legend-count";
    countText.textContent = `${count} ตำบล`;
    row.append(dot, name, countText);
    row.addEventListener("click", () => selectStaff(person.id === displayUi.selectedStaffId ? "" : person.id, true));
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
  const matches = displayFeatures.filter((feature) => featureMatchesDisplay(feature, query)).slice(0, 12);
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
    button.addEventListener("click", () => focusFeature(feature));
    list.append(button);
  }
  displayDom.results.replaceChildren(heading, list);
}

function updateDisplayMap() {
  if (displayMap?.isStyleLoaded() && displayMap.getSource("tambons")) displayMap.getSource("tambons").setData(displayMapData());
  renderDisplayLabels();
  renderSearchResults();
}

function focusFeature(feature) {
  const bounds = boundsForFeature(feature);
  displayMap.fitBounds(bounds, { padding: 70, maxZoom: 12.2, duration: 650 });
  const center = bounds.getCenter();
  window.setTimeout(() => new maplibregl.Popup({ offset: 12 }).setLngLat(center).setDOMContent(popupForFeature(feature)).addTo(displayMap), 700);
}

function featuresForStaff(staffId) {
  return displayFeatures.filter((feature) => displayOwner(feature)?.id === staffId);
}

function selectStaff(staffId, focus = false) {
  displayUi.selectedStaffId = staffId;
  displayDom.staffFilter.value = staffId;
  renderStats();
  renderLegend();
  renderPersonDetail();
  updateDisplayMap();
  if (focus && staffId) {
    const selectedFeatures = featuresForStaff(staffId);
    if (selectedFeatures.length) focusFeatures(selectedFeatures);
  }
}

function focusFeatures(featuresToFocus) {
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of featuresToFocus) bounds.extend(boundsForFeature(feature));
  displayMap.fitBounds(bounds, { padding: 70, maxZoom: 11.5, duration: 650 });
}

function displayFitPadding() {
  const container = displayMap?.getContainer?.();
  const isLandscape = container && container.clientWidth > container.clientHeight;
  return isLandscape
    ? { top: 48, right: 72, bottom: 58, left: 72 }
    : { top: 66, right: 74, bottom: 82, left: 74 };
}

function fitDisplayToAssignedAreas({ duration = 0 } = {}) {
  if (!displayMap || !displayFeatures.length) return;
  const assigned = displayFeatures.filter((feature) => Boolean(displayOwner(feature)));
  const featuresToFit = assigned.length ? assigned : displayFeatures;
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of featuresToFit) bounds.extend(boundsForFeature(feature));
  const zoomInOneStep = () => {
    if (typeof displayMap?.getZoom !== "function" || typeof displayMap?.zoomTo !== "function") return;
    displayMap.zoomTo(Math.min(displayMap.getZoom() + 1, 12), { duration: 0 });
  };
  displayMap.fitBounds(bounds, { padding: displayFitPadding(), maxZoom: 10.3, duration });
  window.setTimeout(() => {
    zoomInOneStep();
    scheduleDisplayLabels();
  }, Math.max(duration, 0));
}

function refitDisplayForViewport() {
  window.clearTimeout(displayResizeTimer);
  displayResizeTimer = window.setTimeout(() => {
    if (!displayMap) return;
    displayMap.resize();
    configureDisplayMapInteraction();
    if (!displayUi.selectedStaffId && !displaySearchText()) fitDisplayToAssignedAreas();
    scheduleDisplayLabels();
  }, 160);
}

function renderStaffFilter() {
  const current = displayUi.selectedStaffId;
  displayDom.staffFilter.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "ทุกคน";
  displayDom.staffFilter.append(all);
  for (const person of displayState.staff) {
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = person.name;
    displayDom.staffFilter.append(option);
  }
  if (current && displayState.staff.some((person) => person.id === current)) displayDom.staffFilter.value = current;
  else displayUi.selectedStaffId = "";
  displayDom.clearStaffFilter.hidden = !displayUi.selectedStaffId;
}

function renderPersonDetail() {
  const person = displayState.staff.find((candidate) => candidate.id === displayUi.selectedStaffId);
  displayDom.personDetail.hidden = !person;
  displayDom.personDetail.replaceChildren();
  if (!person) return;

  const assigned = featuresForStaff(person.id);
  const byDistrict = new Map();
  for (const feature of assigned) {
    const district = displayDistrict(feature);
    if (!byDistrict.has(district)) byDistrict.set(district, []);
    byDistrict.get(district).push(feature);
  }
  const heading = document.createElement("div");
  heading.className = "person-detail-heading";
  const title = document.createElement("h3");
  title.textContent = `เขตรับผิดชอบ: ${person.name}`;
  const showOnMap = document.createElement("button");
  showOnMap.type = "button";
  showOnMap.className = "clear-filter";
  showOnMap.textContent = "ซูมดูพื้นที่";
  showOnMap.addEventListener("click", () => focusFeatures(assigned));
  heading.append(title, showOnMap);

  const summary = document.createElement("div");
  summary.className = "person-summary";
  for (const text of [`${assigned.length} ตำบล`, `${byDistrict.size} อำเภอ`]) {
    const item = document.createElement("span");
    item.textContent = text;
    summary.append(item);
  }

  const list = document.createElement("div");
  list.className = "district-assignment-list";
  for (const [district, districtFeatures] of [...byDistrict.entries()].sort(([first], [second]) => first.localeCompare(second, "th"))) {
    const group = document.createElement("section");
    group.className = "district-assignment";
    const districtName = document.createElement("h4");
    districtName.textContent = `อำเภอ${district} (${districtFeatures.length} ตำบล)`;
    const chips = document.createElement("div");
    chips.className = "area-chip-list";
    for (const feature of districtFeatures.sort((first, second) => displayTambon(first).localeCompare(displayTambon(second), "th"))) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "area-chip";
      chip.textContent = displayTambon(feature);
      chip.addEventListener("click", () => focusFeature(feature));
      chips.append(chip);
    }
    group.append(districtName, chips);
    list.append(group);
  }
  displayDom.personDetail.append(heading, summary, list);
}

function clearDisplayLabels(type) {
  for (const marker of displayLabelMarkers[type]) marker.remove();
  displayLabelMarkers[type] = [];
}

function labelPosition(feature) {
  const bounds = boundsForFeature(feature);
  const center = bounds.getCenter();
  return [center.lng, center.lat];
}

function labelBoxesOverlap(first, second) {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
}

function renderDisplayLabels() {
  clearDisplayLabels("tambon");
  clearDisplayLabels("district");
  if (!displayMap?.isStyleLoaded()) return;
  const filtered = displayFeatures.filter(featureMatchesSelectedStaff);
  const bounds = displayMap.getBounds();

  if (displayUi.showTambonLabels && displayMap.getZoom() >= 8.1) {
    const occupied = [];
    for (const feature of filtered.map((feature) => ({ feature, coordinate: labelPosition(feature) })).filter(({ coordinate }) => bounds.contains(coordinate))) {
      const point = displayMap.project(feature.coordinate);
      const name = displayTambon(feature.feature);
      const width = Math.max(34, name.length * 7.8);
      const box = { left: point.x - width / 2, right: point.x + width / 2, top: point.y - 10, bottom: point.y + 10 };
      if (occupied.some((other) => labelBoxesOverlap(box, other))) continue;
      occupied.push(box);
      const element = document.createElement("span");
      element.className = "display-tambon-label";
      element.textContent = name;
      displayLabelMarkers.tambon.push(new maplibregl.Marker({ element, anchor: "center" }).setLngLat(feature.coordinate).addTo(displayMap));
    }
  }

  if (displayUi.showDistrictLabels) {
    const groups = new Map();
    for (const feature of filtered) {
      const district = displayDistrict(feature);
      if (!groups.has(district)) groups.set(district, []);
      groups.get(district).push(feature);
    }
    for (const [district, districtFeatures] of groups) {
      const districtBounds = new maplibregl.LngLatBounds();
      for (const feature of districtFeatures) districtBounds.extend(boundsForFeature(feature));
      const center = districtBounds.getCenter();
      if (!bounds.contains(center)) continue;
      const element = document.createElement("span");
      element.className = "display-district-label";
      element.textContent = `อำเภอ${district}`;
      displayLabelMarkers.district.push(new maplibregl.Marker({ element, anchor: "bottom", offset: [0, -7] }).setLngLat(center).addTo(displayMap));
    }
  }
}

function scheduleDisplayLabels() {
  if (!displayMap) return;
  const renderWhenReady = () => {
    if (!displayMap?.isStyleLoaded()) return;
    displayMap.resize();
    renderDisplayLabels();
  };
  displayMap.once("idle", renderWhenReady);
  window.setTimeout(renderWhenReady, 220);
}

function usesCompactDisplayTouchLandscape() {
  const query = window.matchMedia?.("(pointer: coarse) and (orientation: landscape) and (max-height: 620px)");
  return Boolean(query?.matches);
}

function configureDisplayMapInteraction() {
  if (!displayMap) return;
  if (usesCompactDisplayTouchLandscape()) {
    displayMap.dragPan.disable();
    displayMap.touchZoomRotate.disable();
    displayMap.getCanvas().style.touchAction = "pan-y";
    return;
  }
  displayMap.dragPan.enable();
  displayMap.touchZoomRotate.enable();
  displayMap.touchZoomRotate.disableRotation();
  displayMap.getCanvas().style.touchAction = "";
}

function renderDisplayControls() {
  displayDom.tambonLabelsButton.setAttribute("aria-pressed", String(displayUi.showTambonLabels));
  displayDom.districtLabelsButton.setAttribute("aria-pressed", String(displayUi.showDistrictLabels));
  displayDom.tambonLabelsButton.textContent = displayUi.showTambonLabels ? "ซ่อนชื่อตำบล" : "แสดงชื่อตำบล";
  displayDom.districtLabelsButton.textContent = displayUi.showDistrictLabels ? "ซ่อนชื่ออำเภอ" : "แสดงชื่ออำเภอ";
  displayDom.legendPanel.hidden = !displayUi.showLegend;
  displayDom.displayContent.classList.toggle("legend-hidden", !displayUi.showLegend);
  displayDom.legendToggleButton.setAttribute("aria-pressed", String(displayUi.showLegend));
  displayDom.legendToggleButton.textContent = displayUi.showLegend ? "ซ่อนคำอธิบายสี" : "แสดงคำอธิบายสี";
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
  displayMap.addControl(createDisplayResetControl(() => fitDisplayToAssignedAreas()), "top-right");
  configureDisplayMapInteraction();
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
    displayMap.on("moveend", renderDisplayLabels);
    displayMap.on("mouseenter", "tambon-3d", () => { displayMap.getCanvas().style.cursor = "pointer"; });
    displayMap.on("mouseleave", "tambon-3d", () => { displayMap.getCanvas().style.cursor = ""; });
    displayMap.on("click", "tambon-3d", (event) => {
      const id = String(event.features?.[0]?.properties?.id || "");
      const feature = displayFeatures.find((candidate) => displayAreaId(candidate) === id);
      if (!feature) return;
      new maplibregl.Popup({ offset: 12 }).setLngLat(event.lngLat).setDOMContent(popupForFeature(feature)).addTo(displayMap);
    });
    fitDisplayToAssignedAreas();
    scheduleDisplayLabels();
  });
}

function createDisplayResetControl(onReset) {
  return {
    onAdd() {
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group map-reset-control";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-reset-button";
      button.title = "กลับพิกัดเริ่มต้น";
      button.setAttribute("aria-label", "กลับพิกัดเริ่มต้นของแผนที่");
      button.textContent = "⌖";
      button.addEventListener("click", onReset);
      container.append(button);
      return container;
    },
    onRemove() {},
  };
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
    fetch(displaySharedDataUrl(), { cache: "no-store" }),
  ]);
  if (!boundariesResponse.ok) throw new Error("ไม่สามารถโหลดขอบเขตตำบลได้");
  if (!sharedResponse.ok) throw new Error("ไม่สามารถโหลดข้อมูลการมอบหมายได้");
  const [collection, sharedData] = await Promise.all([boundariesResponse.json(), sharedResponse.json()]);
  applyDisplaySharedData(sharedData);
  displayDataRevision = displayRevision(sharedData);
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
    const response = await fetch(displaySharedDataUrl(), { cache: "no-store" });
    if (!response.ok) {
      renderDataStatus(false);
      return;
    }
    const sharedData = await response.json();
    const revision = displayRevision(sharedData);
    if (revision === displayDataRevision) {
      renderDataStatus(true);
      return;
    }
    applyDisplaySharedData(sharedData);
    displayDataRevision = revision;
    filterDisplayAssignments();
    renderStaffFilter();
    renderStats();
    renderLegend();
    updateDisplayMap();
    renderPersonDetail();
    if (!displayUi.selectedStaffId && !displaySearchText()) fitDisplayToAssignedAreas();
  } catch (error) {
    console.warn("Unable to refresh display data", error);
    renderDataStatus(false);
  }
}

async function initDisplay() {
  typeDisplayTitle();
  try {
    await loadDisplayData();
    renderStaffFilter();
    renderStats();
    renderLegend();
    renderPersonDetail();
    renderDisplayControls();
    createDisplayMap();
    displayDom.search.addEventListener("input", updateDisplayMap);
    displayDom.staffFilter.addEventListener("change", () => selectStaff(displayDom.staffFilter.value, true));
    displayDom.clearStaffFilter.addEventListener("click", () => selectStaff(""));
    displayDom.tambonLabelsButton.addEventListener("click", () => {
      displayUi.showTambonLabels = !displayUi.showTambonLabels;
      renderDisplayControls();
      renderDisplayLabels();
    });
    displayDom.districtLabelsButton.addEventListener("click", () => {
      displayUi.showDistrictLabels = !displayUi.showDistrictLabels;
      renderDisplayControls();
      renderDisplayLabels();
    });
    displayDom.legendToggleButton.addEventListener("click", () => {
      displayUi.showLegend = !displayUi.showLegend;
      renderDisplayControls();
      refitDisplayForViewport();
    });
    window.addEventListener("resize", refitDisplayForViewport);
    window.addEventListener("orientationchange", refitDisplayForViewport);
    window.setInterval(refreshDisplayData, 30000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshDisplayData();
    });
  } catch (error) {
    console.error(error);
    displayDom.updatedAt.textContent = "ไม่สามารถโหลดข้อมูลได้ กรุณารีเฟรชหน้าเว็บ";
    renderDataStatus(false);
  } finally {
    displayDom.loading.hidden = true;
  }
}

initDisplay();
