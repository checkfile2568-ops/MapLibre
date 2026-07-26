"use strict";

const Core = window.MapLibreCore;
// Keep this endpoint identical to the management page.  The former
// display-only endpoint returned HTTP 400, so MapLibre was never created.
const GIS_QUERY_URL = "https://services1.arcgis.com/jSaRWj2TDlcN1zOC/arcgis/rest/services/Thailand_Subdistrict_Boundaries_%28%E0%B8%82%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B8%B9%E0%B8%A5%E0%B8%82%E0%B8%AD%E0%B8%9A%E0%B9%80%E0%B8%82%E0%B8%95%E0%B8%95%E0%B8%B3%E0%B8%9A%E0%B8%A5%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%97%E0%B8%A8%E0%B9%84%E0%B8%97%E0%B8%A2%29/FeatureServer/1/query";
const SHARED_DATA_URL = "data/assignments.json";
const DISPLAY_VERSION = "V4";
const DISPLAY_UPDATED_LABEL = "ปรับปรุงล่าสุด: 24 ก.ค. 2569";

const dom = Object.fromEntries([
  "loading", "display-title", "search-input", "overview-stats", "updated-at", "data-status", "coverage-main", "coverage-exclusion",
  "display-content", "search-menu", "legend-panel", "legend", "search-results", "central-notice", "toggle-tambon-labels", "toggle-district-labels",
  "toggle-legend-button", "staff-filter", "clear-staff-filter", "person-detail", "price-privacy-note"
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

let features = [];
let state = Core.initialState();
let map = null;
let revision = null;
let markers = { tambon: [], district: [] };
let ui = { selectedStaffId: "", showTambonLabels: true, showDistrictLabels: true, showLegend: true };
let resizeTimer = null;

function sharedDataUrl() {
  const url = new URL(SHARED_DATA_URL, location.href);
  url.searchParams.set("_", Date.now().toString());
  return url;
}

function typeTitle() {
  const title = dom.display_title;
  if (!title || title.dataset.typed === "true") return;
  const fullText = title.dataset.text || title.textContent.trim();
  title.dataset.typed = "true";
  title.setAttribute("aria-label", fullText);
  title.textContent = "";
  const graphemes = typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(fullText)].map((item) => item.segment) : Array.from(fullText);
  let index = 0;
  const tick = () => { title.textContent += graphemes[index] || ""; index += 1; if (index < graphemes.length) setTimeout(tick, 75); };
  setTimeout(tick, 420);
}

function areaPrice(feature) {
  const value = state.prices[Core.areaId(feature)];
  return Number.isFinite(value) ? value : null;
}

function owner(feature) {
  return state.staff.find((person) => person.id === state.assignments[Core.areaId(feature)]) || null;
}

function publicPricesEnabled() {
  return state.publishPrices !== false;
}

function searchText() {
  return Core.sanitizeName(dom.search_input.value).toLocaleLowerCase("th");
}

function matchesSelectedStaff(feature) {
  return !ui.selectedStaffId || owner(feature)?.id === ui.selectedStaffId;
}

function matchesSearch(feature, query = searchText()) {
  if (!query) return true;
  return `${Core.tambonName(feature)} ${Core.districtName(feature)} ${owner(feature)?.name || ""}`.toLocaleLowerCase("th").includes(query);
}

function matchesDisplay(feature, query = searchText()) {
  return matchesSelectedStaff(feature) && matchesSearch(feature, query);
}

function currentFeatures() {
  return features.filter(matchesSelectedStaff);
}

function mapData() {
  const query = searchText();
  const filtered = Boolean(query || ui.selectedStaffId);
  return { type: "FeatureCollection", features: features.map((feature) => {
    const person = owner(feature);
    const match = matchesDisplay(feature, query);
    const dimmed = filtered && !match;
    const selected = Boolean(ui.selectedStaffId && person?.id === ui.selectedStaffId);
    return {
      ...feature,
      id: Core.areaId(feature),
      properties: {
        ...feature.properties,
        id: Core.areaId(feature),
        color: dimmed ? "#dce5e9" : person ? person.color : (match && query ? "#e1a14d" : "#d4e1e6"),
        height: dimmed ? 180 : (selected ? 2450 : (match && query ? 1450 : person ? 1100 : 320)),
      },
    };
  }) };
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(date);
}

function renderDataStatus(online = true) {
  dom.data_status.textContent = `${online ? "● ออนไลน์" : "● ออฟไลน์"} · ${DISPLAY_VERSION} · ${formatDate(state.updatedAt)}`;
  dom.data_status.className = `read-only-badge ${online ? "online" : "offline"}`;
}

function renderStats() {
  const total = features.length;
  const assigned = features.filter((feature) => owner(feature)).length;
  const selected = state.staff.find((person) => person.id === ui.selectedStaffId);
  const values = [`${state.staff.length} ผู้รับผิดชอบ`, `มอบหมาย ${assigned}/${total} ตำบล`, `ยังไม่มอบหมาย ${total - assigned} ตำบล`];
  if (selected) values.push(`กำลังแสดง: ${selected.name}`);
  dom.overview_stats.replaceChildren(...values.map((text) => { const span = document.createElement("span"); span.className = "stat"; span.textContent = text; return span; }));
  dom.updated_at.textContent = DISPLAY_UPDATED_LABEL;
  dom.coverage_main.textContent = `เขตทั้งหมด ${new Set(features.map(Core.districtName)).size} อำเภอ · ${total} ตำบล`;
  dom.coverage_exclusion.textContent = "(ไม่รวมเขตศาลจังหวัดชัยบาดาล)";
  const hasData = Core.hasSharedData(state);
  dom.central_notice.hidden = hasData;
  dom.central_notice.textContent = hasData ? "" : "ยังไม่มีข้อมูลส่วนกลาง ผู้ดูแลต้องบันทึกจากหน้าจัดการก่อน";
  dom.price_privacy_note.hidden = publicPricesEnabled();
  renderDataStatus(true);
}

function renderLegend() {
  if (!state.staff.length) { dom.legend.innerHTML = '<p class="empty-state">ยังไม่มีผู้รับผิดชอบ</p>'; return; }
  const fragment = document.createDocumentFragment();
  for (const person of state.staff) {
    const areas = features.filter((feature) => owner(feature)?.id === person.id);
    const row = document.createElement("button"); row.type = "button"; row.className = "legend-item legend-person"; row.setAttribute("aria-pressed", String(person.id === ui.selectedStaffId));
    const dot = document.createElement("span"); dot.className = "legend-dot"; dot.style.background = person.color;
    const name = document.createElement("strong"); name.textContent = person.name;
    const summary = document.createElement("span"); summary.className = "legend-count"; summary.textContent = `${areas.length} ตำบล`;
    row.append(dot, name, summary); row.addEventListener("click", () => selectStaff(person.id === ui.selectedStaffId ? "" : person.id, true)); fragment.append(row);
  }
  dom.legend.replaceChildren(fragment);
}

function renderSearchResults() {
  const query = searchText();
  if (!query) { dom.search_results.className = "search-results"; dom.search_results.replaceChildren(); return; }
  const matches = features.filter((feature) => matchesDisplay(feature, query)).slice(0, 14);
  dom.search_results.className = "search-results visible";
  const heading = document.createElement("p"); heading.className = "result-heading"; heading.textContent = matches.length ? `พบ ${matches.length} ตำบล — แตะเพื่อซูม` : "ไม่พบข้อมูลที่ค้นหา";
  const list = document.createElement("div"); list.className = "result-list";
  for (const feature of matches) {
    const row = document.createElement("button"); row.type = "button"; row.className = "result";
    const first = document.createElement("span"); first.textContent = `${Core.tambonName(feature)} · ${owner(feature)?.name || "ยังไม่มอบหมาย"}`;
    const small = document.createElement("small"); small.textContent = Core.districtName(feature);
    row.append(first, small); row.addEventListener("click", () => focusFeature(feature)); list.append(row);
  }
  dom.search_results.replaceChildren(heading, list);
}

function renderStaffFilter() {
  const current = ui.selectedStaffId;
  dom.staff_filter.replaceChildren(new Option("ทุกคน", ""));
  for (const person of state.staff) dom.staff_filter.add(new Option(person.name, person.id));
  if (current && state.staff.some((person) => person.id === current)) dom.staff_filter.value = current;
  else ui.selectedStaffId = "";
  dom.clear_staff_filter.hidden = !ui.selectedStaffId;
}

function renderPersonDetail() {
  const person = state.staff.find((item) => item.id === ui.selectedStaffId);
  dom.person_detail.hidden = !person;
  dom.person_detail.replaceChildren();
  if (!person) return;
  const assigned = features.filter((feature) => owner(feature)?.id === person.id);
  const byDistrict = new Map();
  for (const feature of assigned) { const district = Core.districtName(feature); if (!byDistrict.has(district)) byDistrict.set(district, []); byDistrict.get(district).push(feature); }
  const heading = document.createElement("div"); heading.className = "person-detail-heading";
  const title = document.createElement("h3"); title.textContent = `เขตรับผิดชอบ: ${person.name}`;
  const zoom = document.createElement("button"); zoom.type = "button"; zoom.className = "clear-filter"; zoom.textContent = "ซูมดูพื้นที่"; zoom.addEventListener("click", () => focusFeatures(assigned)); heading.append(title, zoom);
  const summary = document.createElement("div"); summary.className = "person-summary";
  const values = [`${assigned.length} ตำบล`, `${byDistrict.size} อำเภอ`];
  for (const text of values) { const span = document.createElement("span"); span.textContent = text; summary.append(span); }
  const groups = document.createElement("div"); groups.className = "district-assignment-list";
  for (const [district, districtFeatures] of [...byDistrict.entries()].sort(([a], [b]) => a.localeCompare(b, "th"))) {
    const section = document.createElement("section"); section.className = "district-assignment";
    const h4 = document.createElement("h4"); h4.textContent = `อำเภอ${district} (${districtFeatures.length} ตำบล)`;
    const chips = document.createElement("div"); chips.className = "area-chip-list";
    for (const feature of districtFeatures.sort((a, b) => Core.tambonName(a).localeCompare(Core.tambonName(b), "th"))) {
      const chip = document.createElement("button"); chip.type = "button"; chip.className = "area-chip";
      chip.textContent = Core.tambonName(feature);
      chip.addEventListener("click", () => focusFeature(feature)); chips.append(chip);
    }
    section.append(h4, chips); groups.append(section);
  }
  dom.person_detail.append(heading, summary, groups);
}

function renderControls() {
  dom.toggle_tambon_labels.setAttribute("aria-checked", String(ui.showTambonLabels));
  dom.toggle_district_labels.setAttribute("aria-checked", String(ui.showDistrictLabels));
  dom.legend_panel.hidden = !ui.showLegend; dom.search_menu.classList.toggle("legend-hidden", !ui.showLegend); dom.toggle_legend_button.setAttribute("aria-checked", String(ui.showLegend));
}

function selectStaff(id, focus = false) {
  ui.selectedStaffId = id;
  dom.staff_filter.value = id;
  dom.clear_staff_filter.hidden = !id;
  renderStats(); renderLegend(); renderPersonDetail(); updateMap();
  if (focus) {
    if (id) focusFeatures(features.filter((feature) => owner(feature)?.id === id));
    else fitMap({ duration: 500 });
  }
}

function resetMapToOverview() {
  dom.search_input.value = "";
  selectStaff("", false);
  fitMap({ duration: 350 });
}

function boundsForFeature(feature) {
  const bounds = new maplibregl.LngLatBounds();
  const extend = (coordinates) => { if (typeof coordinates?.[0] === "number") bounds.extend(coordinates); else for (const coordinate of coordinates || []) extend(coordinate); };
  extend(feature.geometry.coordinates); return bounds;
}

function centerForFeature(feature) {
  const center = boundsForFeature(feature).getCenter(); return [center.lng, center.lat];
}

function focusFeature(feature) {
  const bounds = boundsForFeature(feature); map.fitBounds(bounds, { padding: 70, maxZoom: 12.2, duration: 500 });
  setTimeout(() => new maplibregl.Popup({ offset: 12 }).setLngLat(bounds.getCenter()).setDOMContent(popupForFeature(feature)).addTo(map), 520);
}

function focusFeatures(items) {
  if (!items.length) return;
  const bounds = new maplibregl.LngLatBounds(); for (const feature of items) bounds.extend(boundsForFeature(feature)); map.fitBounds(bounds, { padding: 70, maxZoom: 11.5, duration: 500 });
}

function fitMap({ duration = 0 } = {}) {
  if (!map || !features.length) return;
  const assigned = features.filter((feature) => owner(feature)); const items = assigned.length ? assigned : features; const bounds = new maplibregl.LngLatBounds(); for (const feature of items) bounds.extend(boundsForFeature(feature));
  map.fitBounds(bounds, { padding: { top: 28, right: 30, bottom: 28, left: 30 }, maxZoom: 10.8, duration }); scheduleLabels();
}

function popupForFeature(feature) {
  const card = document.createElement("div");
  const title = document.createElement("div"); title.className = "popup-title"; title.textContent = Core.tambonName(feature);
  const district = document.createElement("div"); district.className = "popup-sub"; district.textContent = `อำเภอ${Core.districtName(feature)}`;
  const assignment = document.createElement("div"); assignment.className = "popup-sub"; assignment.textContent = owner(feature) ? `ผู้รับผิดชอบ: ${owner(feature).name}` : "ยังไม่มอบหมายผู้รับผิดชอบ";
  card.append(title, district, assignment);
  if (publicPricesEnabled()) { const price = document.createElement("div"); price.className = "popup-price"; price.textContent = `ยอด: ${Core.formatAmount(areaPrice(feature))}`; card.append(price); }
  return card;
}

function supportsWebGL() {
  if (!window.WebGLRenderingContext) return false;
  try { const canvas = document.createElement("canvas"); return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")); } catch { return false; }
}

function createMap() {
  if (!window.maplibregl) throw new Error("ไม่พบ MapLibre GL");
  if (!supportsWebGL() && !window.__MAPLIBRE_TEST__) throw new Error("อุปกรณ์นี้ไม่รองรับ WebGL");
  map = new maplibregl.Map({ container: "display-map", style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#edf4f5" } }] }, center: [100.68, 14.83], zoom: 8.9, pitch: 30, bearing: 0, antialias: true });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl({ onAdd() { const group = document.createElement("div"); group.className = "maplibregl-ctrl maplibregl-ctrl-group"; const btn = document.createElement("button"); btn.type = "button"; btn.className = "map-reset-button"; btn.textContent = "⌖"; btn.addEventListener("click", resetMapToOverview); group.append(btn); return group; }, onRemove() {} }, "top-right");
  map.addControl(createTrueNorthControl(), "top-left");
  decorateMapControls();
  configureInteraction();
  map.on("load", () => {
    decorateMapControls();
    map.addSource("tambons", { type: "geojson", data: mapData(), promoteId: "id" });
    map.addLayer({ id: "tambon-ground", type: "fill", source: "tambons", paint: { "fill-color": ["get", "color"], "fill-opacity": .74 } });
    map.addLayer({ id: "tambon-3d", type: "fill-extrusion", source: "tambons", paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": 0, "fill-extrusion-opacity": .84 } });
    map.addLayer({ id: "tambon-outline", type: "line", source: "tambons", paint: { "line-color": "#fff", "line-width": 1.1, "line-opacity": .96 } });
    map.on("click", "tambon-3d", (event) => { const id = String(event.features?.[0]?.properties?.id || ""); const feature = features.find((item) => Core.areaId(item) === id); if (feature) new maplibregl.Popup({ offset: 12 }).setLngLat(event.lngLat).setDOMContent(popupForFeature(feature)).addTo(map); });
    map.on("moveend", renderLabels); fitMap(); scheduleLabels();
  });
}

function createTrueNorthControl() {
  let mapInstance = null; let needle = null; let updateNeedle = null;
  return {
    onAdd(instance) {
      mapInstance = instance;
      const control = document.createElement("div"); control.className = "maplibregl-ctrl true-north-control";
      const controlButton = document.createElement("button"); controlButton.type = "button"; controlButton.className = "true-north-button";
      controlButton.title = "หันแผนที่สู่ทิศเหนือจริง"; controlButton.setAttribute("aria-label", "หันแผนที่สู่ทิศเหนือจริง");
      const rose = document.createElement("span"); rose.className = "true-north-rose";
      needle = document.createElement("span"); needle.className = "true-north-needle";
      const letter = document.createElement("span"); letter.className = "true-north-letter"; letter.textContent = "N";
      rose.append(needle, letter); controlButton.append(rose); control.append(controlButton);
      updateNeedle = () => { if (needle && mapInstance) needle.style.transform = `rotate(${-mapInstance.getBearing()}deg)`; };
      controlButton.addEventListener("click", () => mapInstance?.easeTo({ bearing: 0, duration: 350 }));
      mapInstance.on("rotate", updateNeedle); updateNeedle();
      return control;
    },
    onRemove() { if (mapInstance && updateNeedle) mapInstance.off("rotate", updateNeedle); mapInstance = null; needle = null; updateNeedle = null; },
  };
}

function decorateMapControls() {
  if (!map) return;
  const controls = [
    [".maplibregl-ctrl-zoom-in", "ขยายภาพ"],
    [".maplibregl-ctrl-zoom-out", "ลดขนาดภาพ"],
    [".maplibregl-ctrl-compass", "ปรับมุมมอง 3 มิติ"],
    [".map-reset-button", "กลับสู่ภาพรวม"],
  ];
  for (const [selector, label] of controls) {
    const button = map.getContainer().querySelector(selector);
    if (!button) continue;
    button.dataset.tooltip = label;
    button.title = label;
    button.setAttribute("aria-label", label);
  }
}

function configureInteraction() {
  if (!map) return;
  const compact = matchMedia?.("(pointer: coarse) and (orientation: landscape) and (max-height:620px)")?.matches;
  if (compact) { map.dragPan.disable(); map.touchZoomRotate.disable(); map.getCanvas().style.touchAction = "pan-y"; }
  else { map.dragPan.enable(); map.touchZoomRotate.enable(); map.touchZoomRotate.disableRotation(); map.getCanvas().style.touchAction = ""; }
}

function clearMarkers(type) { for (const marker of markers[type]) marker.remove(); markers[type] = []; }
function boxesOverlap(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }

function renderLabels() {
  clearMarkers("tambon"); clearMarkers("district");
  if (!map?.isStyleLoaded()) return;
  const bounds = map.getBounds(); const filtered = currentFeatures(); const visible = filtered.filter((feature) => bounds.contains(centerForFeature(feature)));
  const occupied = [];
  if (ui.showTambonLabels && map.getZoom() >= 8.1) {
    for (const feature of visible) {
      const center = centerForFeature(feature); const point = map.project(center); const text = Core.tambonName(feature); const width = Math.max(34, text.length * 7.8); const box = { left: point.x - width / 2, right: point.x + width / 2, top: point.y - 10, bottom: point.y + 10 };
      if (occupied.some((item) => boxesOverlap(box, item))) continue; occupied.push(box);
      const el = document.createElement("span"); el.className = "display-tambon-label"; el.textContent = text; markers.tambon.push(new maplibregl.Marker({ element: el }).setLngLat(center).addTo(map));
    }
  }
  if (ui.showDistrictLabels) {
    const groups = new Map(); for (const feature of filtered) { const district = Core.districtName(feature); if (!groups.has(district)) groups.set(district, []); groups.get(district).push(feature); }
    for (const [district, items] of groups) { const districtBounds = new maplibregl.LngLatBounds(); for (const feature of items) districtBounds.extend(boundsForFeature(feature)); const center = districtBounds.getCenter(); if (!bounds.contains(center)) continue; const el = document.createElement("span"); el.className = "display-district-label"; el.textContent = `อำเภอ${district}`; markers.district.push(new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -8] }).setLngLat(center).addTo(map)); }
  }
}

function scheduleLabels() { if (!map) return; const run = () => { if (!map.isStyleLoaded()) return; map.resize(); renderLabels(); }; map.once("idle", run); setTimeout(run, 220); }

function updateMap() {
  if (map?.isStyleLoaded() && map.getSource("tambons")) map.getSource("tambons").setData(mapData());
  renderLabels(); renderSearchResults();
}

async function loadData() {
  const params = new URLSearchParams({ where: "ADMIN_ID1 = '16'", outFields: "ADMIN_ID1,ADMIN_ID2,ADMIN_ID3,NAME1,NAME2,NAME3", returnGeometry: "true", outSR: "4326", f: "geojson" });
  const [boundariesResponse, dataResponse] = await Promise.all([fetch(`${GIS_QUERY_URL}?${params}`), fetch(sharedDataUrl(), { cache: "no-store" })]);
  if (!boundariesResponse.ok) throw new Error("โหลดขอบเขตตำบลไม่สำเร็จ"); if (!dataResponse.ok) throw new Error("โหลดข้อมูลส่วนกลางไม่สำเร็จ");
  const [collection, rawState] = await Promise.all([boundariesResponse.json(), dataResponse.json()]);
  features = collection.features.filter((feature) => Core.areaId(feature) && Core.isCourtFeature(feature)).map((feature) => ({ ...feature, id: Core.areaId(feature) }));
  if (!features.length) throw new Error("ไม่พบตำบลในเขตศาลจังหวัดลพบุรี");
  state = Core.filterStateToFeatures(Core.normalizeState(rawState), features); revision = rawState.updatedAt || JSON.stringify(rawState);
}

async function refreshData() {
  try {
    const response = await fetch(sharedDataUrl(), { cache: "no-store" });
    if (!response.ok) return renderDataStatus(false);
    const raw = await response.json(); const nextRevision = raw.updatedAt || JSON.stringify(raw);
    if (nextRevision === revision) return renderDataStatus(true);
    state = Core.filterStateToFeatures(Core.normalizeState(raw), features); revision = nextRevision;
    renderStaffFilter(); renderStats(); renderLegend(); renderPersonDetail(); renderControls(); updateMap();
  } catch (error) { console.warn(error); renderDataStatus(false); }
}

function bindEvents() {
  dom.search_input.addEventListener("input", updateMap);
  dom.staff_filter.addEventListener("change", () => selectStaff(dom.staff_filter.value, true));
  dom.clear_staff_filter.addEventListener("click", () => selectStaff("", true));
  dom.toggle_tambon_labels.addEventListener("click", () => { ui.showTambonLabels = !ui.showTambonLabels; renderControls(); renderLabels(); });
  dom.toggle_district_labels.addEventListener("click", () => { ui.showDistrictLabels = !ui.showDistrictLabels; renderControls(); renderLabels(); });
  dom.toggle_legend_button.addEventListener("click", () => { ui.showLegend = !ui.showLegend; renderControls(); refitViewport(); });
  addEventListener("resize", refitViewport); addEventListener("orientationchange", refitViewport);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshData(); });
}

function refitViewport() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!map) return; map.resize(); configureInteraction(); if (!ui.selectedStaffId && !searchText()) fitMap(); scheduleLabels(); }, 160);
}

async function init() {
  typeTitle();
  try {
    await loadData();
    renderStaffFilter(); renderStats(); renderLegend(); renderPersonDetail(); renderControls(); createMap(); bindEvents();
    setInterval(refreshData, 30000);
  } catch (error) {
    console.error(error); dom.updated_at.textContent = error.message || "ไม่สามารถโหลดข้อมูลได้"; renderDataStatus(false);
  } finally { dom.loading.hidden = true; }
}

init();
