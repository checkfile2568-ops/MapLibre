/**
 * view.js — หน้าจอแสดงผล (view.html)
 *
 * อ่านอย่างเดียว ไม่มีการเขียนข้อมูลใด ๆ
 * ใช้ map-engine.js ตัวเดียวกับหน้าตั้งค่าระบบ แผนที่จึงหน้าตาเหมือนกันทุกประการ
 *
 * การรับข้อมูลใหม่ (แก้ผลตรวจ ตร-08)
 *   ถาม GitHub Pages ด้วย ETag ทุก 90 วินาที ถ้าไม่มีการเปลี่ยนแปลง
 *   เซิร์ฟเวอร์ตอบ 304 ตัวเปล่า แทนที่จะส่งไฟล์เต็มทุกครั้งเหมือนรุ่นก่อน
 *   และรีเฟรชทันทีเมื่อผู้ใช้กลับมาที่แท็บ
 */
"use strict";

const Core = window.MapLibreCore;
const Boundaries = window.MapLibreBoundaries;

const SHARED_DATA_URL = "data/assignments.json";
const REFRESH_INTERVAL_MS = 90000;

const dom = Object.fromEntries([
  "loading", "theme-toggle", "display-title", "map-title", "search-input", "overview-stats", "updated-at", "data-status",
  "coverage-main", "coverage-exclusion", "display-content", "search-menu", "legend-panel", "legend", "search-results",
  "central-notice", "toggle-tambon-labels", "toggle-district-labels", "toggle-amount-labels", "toggle-legend-button",
  "staff-filter", "clear-staff-filter", "person-detail", "price-privacy-note", "province-overview-button",
  "tambon-view-button", "three-d-button", "staff-area-summary-card", "staff-area-summary-title",
  "staff-area-summary-groups", "tambon-info-card", "close-tambon-info-button", "tambon-info-title",
  "tambon-info-district", "tambon-info-list", "boundary-source", "display-map",
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

let features = [];
let villageCounts = {};
let state = Core.initialState();
let engine = null;
let revision = null;
let etag = null;
let ui = { selectedStaffId: "", selectedFeatureId: "", showTambonLabels: true, showDistrictLabels: true, showAmountLabels: true, showLegend: true };

/* ------------------------------------------------------------ ตัวช่วย */

function owner(feature) {
  return state.staff.find((person) => person.id === state.assignments[Core.areaId(feature)]) || null;
}

function areaAmount(feature) {
  const value = state.prices[Core.areaId(feature)];
  return Number.isFinite(value) ? value : null;
}

/** ยอดจะแสดงบนหน้านี้ก็ต่อเมื่อผู้ดูแลเปิดสวิตช์ และผู้ดูไม่ได้ปิดเอง */
function amountsPublished() {
  return state.publishPrices !== false;
}

function amountsVisible() {
  return amountsPublished() && ui.showAmountLabels;
}

function searchText() {
  return Core.sanitizeName(dom.search_input.value).toLocaleLowerCase("th");
}

function matchesStaff(feature) {
  return !ui.selectedStaffId || owner(feature)?.id === ui.selectedStaffId;
}

function matchesSearch(feature, query = searchText()) {
  if (!query) return true;
  const amount = areaAmount(feature);
  const amountText = amountsVisible() && amount !== null ? String(amount) : "";
  return `${Core.tambonName(feature)} ${Core.districtName(feature)} ${owner(feature)?.name || ""} ${amountText}`
    .toLocaleLowerCase("th")
    .includes(query);
}

function matchesDisplay(feature, query = searchText()) {
  return matchesStaff(feature) && matchesSearch(feature, query);
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ringAreaSquareMetres(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const radius = 6378137;
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [lngA, latA] = ring[index] || [];
    const [lngB, latB] = ring[(index + 1) % ring.length] || [];
    if (![lngA, latA, lngB, latB].every(Number.isFinite)) continue;
    sum += ((lngB - lngA) * Math.PI) / 180 * (2 + Math.sin((latA * Math.PI) / 180) + Math.sin((latB * Math.PI) / 180));
  }
  return (Math.abs(sum) * radius * radius) / 2;
}

function polygonAreaSquareMetres(rings) {
  if (!Array.isArray(rings) || !rings.length) return 0;
  return Math.max(0, ringAreaSquareMetres(rings[0]) - rings.slice(1).reduce((total, ring) => total + ringAreaSquareMetres(ring), 0));
}

function featureAreaSquareKilometres(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  const squareMetres = geometry.type === "Polygon"
    ? polygonAreaSquareMetres(geometry.coordinates)
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates.reduce((total, rings) => total + polygonAreaSquareMetres(rings), 0)
      : 0;
  return squareMetres > 0 ? squareMetres / 1000000 : null;
}

function formatArea(feature) {
  const area = featureAreaSquareKilometres(feature);
  return area === null ? "คำนวณไม่ได้" : `${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(area)} ตร.กม.`;
}

function villageCount(feature) {
  const saved = numericValue(villageCounts[Core.areaId(feature)]);
  if (saved !== null && saved >= 0) return saved;
  for (const field of ["VILLAGES", "VILLAGE_COUNT", "VILLAGE", "MOO_COUNT", "MOO"]) {
    const value = numericValue(feature?.properties?.[field]);
    if (value !== null && value >= 0) return value;
  }
  return null;
}

/* ------------------------------------------------------ การวาดหน้าจอ */

function renderDataStatus(online = true) {
  dom.data_status.textContent = `${online ? "● เชื่อมต่ออยู่" : "● ออฟไลน์"} · ${Core.formatThaiDate(state.updatedAt)}`;
  dom.data_status.className = `read-only-badge ${online ? "online" : "offline"}`;
}

function renderStats() {
  const total = features.length;
  const assigned = features.filter((feature) => owner(feature)).length;
  const selected = state.staff.find((person) => person.id === ui.selectedStaffId);
  const values = [
    [state.staff.length, "ผู้รับผิดชอบ"],
    [`${assigned}/${total}`, "มอบหมายแล้ว"],
    [total - assigned, "ยังไม่มอบหมาย"],
  ];
  if (amountsVisible()) values.push([Core.formatAmount(Core.sumPrices(features, state.prices)), "ยอดรวมทั้งเขต"]);
  dom.overview_stats.replaceChildren(...values.map(([value, label]) => {
    const item = document.createElement("span");
    item.className = "stat";
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    const caption = document.createElement("span");
    caption.textContent = label;
    item.append(strong, caption);
    return item;
  }));

  dom.updated_at.textContent = state.updatedAt
    ? `ปรับปรุงล่าสุด: ${Core.formatThaiDate(state.updatedAt, { withTime: true })}${state.updatedBy ? ` · ${state.updatedBy}` : ""}`
    : "ยังไม่มีการบันทึกจากหน้าตั้งค่าระบบ";
  dom.coverage_main.textContent = `${new Set(features.map(Core.districtName)).size} อำเภอ · ${features.length} ตำบล`;
  dom.coverage_exclusion.textContent = "(ไม่รวมเขตศาลจังหวัดชัยบาดาล)";
  if (selected) dom.coverage_exclusion.textContent += ` · กำลังแสดง ${selected.name}`;

  const hasData = Core.hasSharedData(state);
  dom.central_notice.hidden = hasData;
  dom.central_notice.textContent = hasData ? "" : "ยังไม่มีข้อมูลส่วนกลาง ผู้ดูแลต้องบันทึกจากหน้าตั้งค่าระบบก่อน";
  dom.price_privacy_note.hidden = amountsPublished();
  dom.toggle_amount_labels.hidden = !amountsPublished();
  renderDataStatus(true);
}

function renderLegend() {
  if (!state.staff.length) {
    dom.legend.innerHTML = '<p class="empty-state">ยังไม่มีผู้รับผิดชอบ</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const person of state.staff) {
    const areas = features.filter((feature) => owner(feature)?.id === person.id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `legend-item${person.active ? "" : " inactive"}`;
    row.setAttribute("aria-pressed", String(person.id === ui.selectedStaffId));
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = person.color;
    const name = document.createElement("span");
    name.className = "legend-person";
    name.textContent = person.name;
    const summary = document.createElement("span");
    summary.className = "legend-count";
    summary.textContent = `${areas.length} ตำบล`;
    row.append(dot, name, summary);
    row.addEventListener("click", () => selectStaff(person.id === ui.selectedStaffId ? "" : person.id, true));
    fragment.append(row);
  }
  dom.legend.replaceChildren(fragment);
}

function renderSearchResults() {
  const query = searchText();
  if (!query) {
    dom.search_results.className = "search-results";
    dom.search_results.replaceChildren();
    return;
  }
  const matches = features.filter((feature) => matchesDisplay(feature, query)).slice(0, 14);
  dom.search_results.className = "search-results visible";
  const heading = document.createElement("p");
  heading.className = "result-heading";
  heading.textContent = matches.length ? `พบ ${matches.length} ตำบล — แตะเพื่อซูม` : "ไม่พบข้อมูลที่ค้นหา";
  const list = document.createElement("div");
  list.className = "result-list";
  for (const feature of matches) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "result";
    const first = document.createElement("span");
    const amount = areaAmount(feature);
    first.textContent = `${Core.tambonName(feature)} · ${owner(feature)?.name || "ยังไม่มอบหมาย"}`;
    const small = document.createElement("small");
    small.textContent = amountsVisible() && amount !== null
      ? `อำเภอ${Core.districtName(feature)} · ยอด ${Core.formatAmount(amount)}`
      : `อำเภอ${Core.districtName(feature)}`;
    row.append(first, small);
    row.addEventListener("click", () => focusFeature(feature));
    list.append(row);
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

function renderTambonInfoCard() {
  const feature = features.find((item) => Core.areaId(item) === ui.selectedFeatureId);
  if (!feature) {
    dom.tambon_info_card.hidden = true;
    return;
  }
  dom.tambon_info_card.hidden = false;
  dom.tambon_info_title.textContent = `ตำบล${Core.tambonName(feature)}`;
  dom.tambon_info_district.textContent = `อำเภอ${Core.districtName(feature)}`;
  const villages = villageCount(feature);
  const population = Core.featureNumber(feature, "POPULATION");
  const houses = Core.featureNumber(feature, "HOUSE");
  const amount = areaAmount(feature);
  const items = [
    ["ผู้รับผิดชอบ", owner(feature)?.name || "ยังไม่มอบหมาย"],
    ["จำนวนหมู่บ้าน", villages === null ? "ไม่พบข้อมูล" : `${Core.formatCount(villages)} หมู่`],
    ["เนื้อที่", formatArea(feature)],
    ["ประชากร", population === null ? "ไม่พบข้อมูล" : `${Core.formatCount(population)} คน`],
    ["ครัวเรือน", houses === null ? "ไม่พบข้อมูล" : `${Core.formatCount(houses)} ครัวเรือน`],
  ];
  if (amountsVisible()) items.push(["ยอด", amount === null ? "ยังไม่กำหนด" : Core.formatAmount(amount)]);

  dom.tambon_info_list.replaceChildren(...items.flatMap(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    return [term, detail];
  }));
}

function renderStaffAreaSummary() {
  const person = state.staff.find((item) => item.id === ui.selectedStaffId);
  const show = Boolean(person && !ui.selectedFeatureId);
  dom.staff_area_summary_card.hidden = !show;
  dom.staff_area_summary_groups.replaceChildren();
  if (!show) return;

  const areas = features.filter((item) => owner(item)?.id === person.id);
  dom.staff_area_summary_title.textContent = `ผู้รับผิดชอบ: ${person.name}`;
  const byDistrict = new Map();
  for (const feature of areas) {
    const district = Core.districtName(feature);
    if (!byDistrict.has(district)) byDistrict.set(district, []);
    byDistrict.get(district).push(feature);
  }
  const fragment = document.createDocumentFragment();
  for (const [district, districtFeatures] of [...byDistrict.entries()].sort(([a], [b]) => a.localeCompare(b, "th"))) {
    const group = document.createElement("section");
    const heading = document.createElement("p");
    heading.className = "staff-area-summary-district";
    heading.textContent = `อำเภอ${district} (${districtFeatures.length} ตำบล)`;
    const tambons = document.createElement("p");
    tambons.className = "staff-area-summary-tambons";
    tambons.textContent = districtFeatures
      .sort((a, b) => Core.tambonName(a).localeCompare(Core.tambonName(b), "th"))
      .map((feature) => Core.tambonName(feature))
      .join(" · ");
    group.append(heading, tambons);
    fragment.append(group);
  }
  dom.staff_area_summary_groups.append(fragment);
}

function renderPersonDetail() {
  const person = state.staff.find((item) => item.id === ui.selectedStaffId);
  dom.person_detail.hidden = !person;
  dom.person_detail.replaceChildren();
  if (!person) return;
  const assigned = features.filter((feature) => owner(feature)?.id === person.id);
  const byDistrict = new Map();
  for (const feature of assigned) {
    const district = Core.districtName(feature);
    if (!byDistrict.has(district)) byDistrict.set(district, []);
    byDistrict.get(district).push(feature);
  }
  const heading = document.createElement("div");
  heading.className = "person-detail-heading";
  const title = document.createElement("h3");
  title.textContent = `เขตรับผิดชอบ: ${person.name}`;
  const zoom = document.createElement("button");
  zoom.type = "button";
  zoom.className = "clear-filter";
  zoom.textContent = "ซูมดูพื้นที่";
  zoom.addEventListener("click", () => engine?.flyToAreas(assigned, { duration: 1800 }));
  heading.append(title, zoom);

  const summary = document.createElement("div");
  summary.className = "person-summary";
  const parts = [`${assigned.length} ตำบล`, `${byDistrict.size} อำเภอ`];
  if (amountsVisible()) parts.push(`ยอดรวม ${Core.formatAmount(Core.sumPrices(assigned, state.prices))}`);
  summary.textContent = parts.join(" · ");

  const groups = document.createElement("div");
  groups.className = "district-assignment-list";
  for (const [district, districtFeatures] of [...byDistrict.entries()].sort(([a], [b]) => a.localeCompare(b, "th"))) {
    const section = document.createElement("section");
    section.className = "district-assignment";
    const label = document.createElement("h4");
    label.textContent = `อำเภอ${district} (${districtFeatures.length} ตำบล)`;
    const chips = document.createElement("div");
    chips.className = "area-chip-list";
    for (const feature of districtFeatures.sort((a, b) => Core.tambonName(a).localeCompare(Core.tambonName(b), "th"))) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "area-chip";
      chip.textContent = Core.tambonName(feature);
      chip.addEventListener("click", () => focusFeature(feature));
      chips.append(chip);
    }
    section.append(label, chips);
    groups.append(section);
  }
  dom.person_detail.append(heading, summary, groups);
}

function renderControls() {
  const setSwitch = (element, on) => element?.setAttribute("aria-checked", String(on));
  setSwitch(dom.toggle_tambon_labels, ui.showTambonLabels);
  setSwitch(dom.toggle_district_labels, ui.showDistrictLabels);
  setSwitch(dom.toggle_amount_labels, ui.showAmountLabels);
  setSwitch(dom.toggle_legend_button, ui.showLegend);
  dom.legend_panel.hidden = !ui.showLegend;
  dom.toggle_amount_labels.hidden = !amountsPublished();
  if (dom.three_d_button) {
    const on = engine?.isThreeD?.() ?? true;
    dom.three_d_button.setAttribute("aria-pressed", String(on));
    dom.three_d_button.textContent = on ? "◧ มุมมอง 3 มิติ" : "▱ มุมมองปกติ";
  }
}

function syncMap() {
  engine?.setPresentation({
    staffById: new Map(state.staff.map((person) => [person.id, person])),
    assignments: state.assignments,
    prices: state.prices,
    showTambonLabels: ui.showTambonLabels,
    showDistrictLabels: ui.showDistrictLabels,
    showAmountLabels: amountsVisible(),
    filterStaffId: ui.selectedStaffId,
    selectedAreaId: ui.selectedFeatureId,
    searchText: dom.search_input.value,
  });
}

function renderAll() {
  renderStaffFilter();
  renderStats();
  renderLegend();
  renderSearchResults();
  renderPersonDetail();
  renderControls();
  renderTambonInfoCard();
  renderStaffAreaSummary();
  syncMap();
}

/* ------------------------------------------------------ การโต้ตอบ */

function popupForFeature(feature) {
  const card = document.createElement("div");
  const title = document.createElement("div");
  title.className = "popup-title";
  title.textContent = `ตำบล${Core.tambonName(feature)}`;
  const district = document.createElement("div");
  district.className = "popup-sub";
  district.textContent = `อำเภอ${Core.districtName(feature)}`;
  const assignment = document.createElement("div");
  assignment.className = "popup-sub";
  assignment.textContent = owner(feature) ? `ผู้รับผิดชอบ: ${owner(feature).name}` : "ยังไม่มอบหมายผู้รับผิดชอบ";
  card.append(title, district, assignment);
  if (amountsVisible()) {
    const amount = document.createElement("div");
    amount.className = "popup-price";
    amount.textContent = `ยอด ${Core.formatAmount(areaAmount(feature))}`;
    card.append(amount);
  }
  return card;
}

function showTambonInfoCard(feature) {
  ui.selectedFeatureId = Core.areaId(feature);
  renderTambonInfoCard();
  renderStaffAreaSummary();
  syncMap();
}

function focusFeature(feature) {
  showTambonInfoCard(feature);
  engine?.flyToArea(feature);
  const center = engine?.centerOfFeature(feature);
  if (center) setTimeout(() => engine.openPopup(center, popupForFeature(feature)), 760);
}

function selectStaff(id, focus = false) {
  ui.selectedStaffId = id;
  ui.selectedFeatureId = "";
  dom.staff_filter.value = id;
  dom.clear_staff_filter.hidden = !id;
  renderAll();
  if (!focus) return;
  if (id) engine?.flyToAreas(features.filter((feature) => owner(feature)?.id === id), { duration: 1800 });
  else engine?.flyToOverview({ duration: 800 });
}

function resetToOverview() {
  dom.search_input.value = "";
  selectStaff("", false);
  engine?.flyToOverview({ duration: 900 });
}

/* ---------------------------------------------------- การรับข้อมูล */

function sharedDataUrl() {
  const url = new URL(SHARED_DATA_URL, location.href);
  url.searchParams.set("v", Core.APP_VERSION);
  return url;
}

function applyState(raw) {
  state = Core.filterStateToFeatures(Core.normalizeState(raw), features);
  revision = raw.updatedAt || JSON.stringify(raw);
}

async function loadSharedData() {
  const response = await fetch(sharedDataUrl(), { cache: "no-store" });
  if (!response.ok) throw new Error("โหลดข้อมูลส่วนกลางไม่สำเร็จ");
  etag = response.headers.get("ETag");
  applyState(await response.json());
}

/** ถามด้วย ETag — ถ้าไม่มีการเปลี่ยนแปลง เซิร์ฟเวอร์ตอบ 304 โดยไม่ส่งไฟล์ */
async function refreshData() {
  try {
    const headers = etag ? { "If-None-Match": etag } : {};
    const response = await fetch(sharedDataUrl(), { headers, cache: "no-store" });
    if (response.status === 304) return renderDataStatus(true);
    if (!response.ok) return renderDataStatus(false);
    const nextEtag = response.headers.get("ETag");
    const raw = await response.json();
    const nextRevision = raw.updatedAt || JSON.stringify(raw);
    etag = nextEtag;
    if (nextRevision === revision) return renderDataStatus(true);
    applyState(raw);
    renderAll();
  } catch (error) {
    console.warn(error);
    renderDataStatus(false);
  }
}

function setBoundarySource(origin) {
  if (!dom.boundary_source) return;
  const text = {
    local: "ขอบเขตตำบล: ไฟล์ในระบบ",
    cache: "ขอบเขตตำบล: ความละเอียดสูง (เก็บไว้ในเครื่อง)",
    network: "ขอบเขตตำบล: ความละเอียดสูงจาก ArcGIS",
  };
  dom.boundary_source.textContent = text[origin] || text.local;
}

/* ------------------------------------------------------ เริ่มต้นระบบ */

function createMapEngine() {
  engine = window.MapEngine.create({
    container: "display-map",
    startThreeD: true,
    onAreaClick: (feature, event) => {
      showTambonInfoCard(feature);
      engine.openPopup(event.lngLat, popupForFeature(feature));
    },
    onReady: () => {
      syncMap();
      renderControls();
      engine.playIntro();
    },
  });
  window.ThemeController?.subscribe(() => engine?.refreshPalette());
}

function bindEvents() {
  window.ThemeController?.mount(dom.theme_toggle);

  dom.search_input.addEventListener("input", () => { renderSearchResults(); syncMap(); });
  dom.staff_filter.addEventListener("change", () => selectStaff(dom.staff_filter.value, true));
  dom.clear_staff_filter.addEventListener("click", () => selectStaff("", true));
  dom.province_overview_button.addEventListener("click", resetToOverview);
  dom.tambon_view_button.addEventListener("click", () => {
    if (ui.selectedStaffId) return selectStaff(ui.selectedStaffId, true);
    engine?.zoomToTambonLevel();
  });
  dom.three_d_button.addEventListener("click", () => { engine?.setThreeD(!engine.isThreeD()); renderControls(); });
  dom.close_tambon_info_button.addEventListener("click", () => {
    ui.selectedFeatureId = "";
    renderTambonInfoCard();
    renderStaffAreaSummary();
    syncMap();
  });
  dom.toggle_tambon_labels.addEventListener("click", () => { ui.showTambonLabels = !ui.showTambonLabels; renderControls(); syncMap(); });
  dom.toggle_district_labels.addEventListener("click", () => { ui.showDistrictLabels = !ui.showDistrictLabels; renderControls(); syncMap(); });
  dom.toggle_amount_labels.addEventListener("click", () => { ui.showAmountLabels = !ui.showAmountLabels; renderControls(); renderAll(); });
  dom.toggle_legend_button.addEventListener("click", () => { ui.showLegend = !ui.showLegend; renderControls(); });

  let resizeTimer = null;
  const refit = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => engine?.resize(), 180);
  };
  addEventListener("resize", refit);
  addEventListener("orientationchange", refit);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshData(); });
}

async function init() {
  bindEvents();
  try {
    const boundaries = await Boundaries.load();
    features = boundaries.features;
    villageCounts = boundaries.villageCounts;
    await loadSharedData();
    createMapEngine();
    engine.setContext(boundaries.context);
    engine.setFeatures(features);
    renderAll();
    setBoundarySource("local");
    setInterval(refreshData, REFRESH_INTERVAL_MS);

    Boundaries.upgrade({
      villageCounts: boundaries.villageCounts,
      onReady: (detailed, origin) => {
        features = detailed;
        applyStateToNewFeatures();
        engine.setFeatures(features);
        renderAll();
        setBoundarySource(origin);
      },
    });
  } catch (error) {
    console.error(error);
    dom.updated_at.textContent = error.message || "ไม่สามารถโหลดข้อมูลได้";
    renderDataStatus(false);
  } finally {
    dom.loading.hidden = true;
  }
}

function applyStateToNewFeatures() {
  state = Core.filterStateToFeatures(state, features);
}

init();
