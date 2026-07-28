"use strict";

const Core = window.MapLibreCore;
const Overview = window.MapLibreOverview;
const Landmarks = window.MapLibreLandmarks;
const GIS_QUERY_URL = "https://services1.arcgis.com/jSaRWj2TDlcN1zOC/arcgis/rest/services/Thailand_Subdistrict_Boundaries_%28%E0%B8%82%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B8%B9%E0%B8%A5%E0%B8%82%E0%B8%AD%E0%B8%9A%E0%B9%80%E0%B8%82%E0%B8%95%E0%B8%95%E0%B8%B3%E0%B8%9A%E0%B8%A5%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%97%E0%B8%A8%E0%B9%84%E0%B8%97%E0%B8%A2%29/FeatureServer/1/query";
const SHARED_DATA_URL = "data/assignments.json";
const SHARED_DATA_API = "https://api.github.com/repos/checkfile2568-ops/MapLibre/contents/data/assignments.json";
const SHARED_BRANCH = "main";
const TOKEN_KEY = `${Core.STORAGE_KEY}:github-token`;
const TOKEN_META_KEY = `${Core.STORAGE_KEY}:github-token-metadata`;
const PALETTE = ["#1377b5", "#ca5d35", "#2c9a6d", "#7757b5", "#c04662", "#27858f", "#ae791a", "#4772af", "#a04d9a", "#537c3c", "#9c623f", "#27725a"];

const dom = Object.fromEntries([
  "loading", "staff-select", "new-staff-name", "add-staff-button", "staff-import-input", "color-swatch", "staff-help", "new-color-button",
  "toggle-staff-management", "staff-management-content", "staff-management-list", "district-list", "tambon-search", "tambon-list", "area-selection-count", "unassigned-summary",
  "price-search", "price-list", "price-paste", "price-import-button", "price-csv-input", "price-import-status", "price-progress",
  "price-labels-button", "publish-prices", "validation-list", "validate-button", "assignment-summary", "maps-layout", "legend-rail", "legend",
  "province-overview-button", "tambon-view-button", "three-d-button",
  "toggle-legend-button", "labels-button", "district-labels-button", "export-button", "print-map-button", "print-tambon-labels",
  "print-district-labels", "print-price-labels", "backup-button", "restore-input",
  "report-staff-select", "excel-report-button", "pdf-report-button", "report-summary", "save-shared-button", "reload-shared-button",
  "check-token-button", "github-token", "remember-github-token", "remembered-token-status", "forget-github-token-button", "shared-status",
  "token-status", "updated-at", "toast", "printable"
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

let features = [];
let state = loadLocalState();
let map = null;
let labelMarkers = { area: [], district: [], context: [] };
let overview = null;
let mapViewport = "province";
let mapIs3d = false;
let provinceOverviewZoom = null;
let mapCaptureMode = false;
let shared = { available: false, loading: false, error: null };
let tokenCheck = { checking: false, valid: false, login: null, expiresAt: null };
let toastTimer = null;
let staffManagementOpen = false;
let bypassLeaveGuard = false;
const EXPECTED_COURT_TAMBONS = 85;

function showToast(message) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 3200);
}

function loadLocalState() {
  try {
    return Core.normalizeState(JSON.parse(localStorage.getItem(Core.STORAGE_KEY)));
  } catch {
    return Core.initialState();
  }
}

function saveLocalState() {
  try {
    localStorage.setItem(Core.STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.warn("Unable to save local state", error);
    showToast("เบราว์เซอร์ไม่สามารถบันทึกข้อมูลในเครื่องได้");
    return false;
  }
}

function persist(message, { fullRender = true } = {}) {
  state.updatedAt = new Date().toISOString();
  state.pendingChanges = true;
  saveLocalState();
  if (fullRender) renderAll();
  else renderLightweight();
  if (message) showToast(message);
}


function persistPriceChange(message = "") {
  state.updatedAt = new Date().toISOString();
  state.pendingChanges = true;
  saveLocalState();
  renderSharedStatus();
  renderPriceProgress();
  renderSummary();
  renderValidation();
  updateMap();
  if (message) showToast(message);
}

function serializableState() {
  return Core.serializableState(state);
}

function selectedStaffId() {
  return dom.staff_select?.value || "";
}

function getStaff(id) {
  return state.staff.find((person) => person.id === id) || null;
}

function selectedStaff() {
  const person = getStaff(selectedStaffId());
  return person?.active ? person : null;
}

function activeStaff() {
  return state.staff.filter((person) => person.active);
}

function availableFeatures() {
  return features.filter(Core.isCourtFeature);
}

function featurePrice(feature) {
  const value = state.prices[Core.areaId(feature)];
  return Number.isFinite(value) ? value : null;
}

function assignedAreasFor(staffId) {
  return availableFeatures().filter((feature) => state.assignments[Core.areaId(feature)] === staffId);
}

function unassignedAreas() {
  return availableFeatures().filter((feature) => !getStaff(state.assignments[Core.areaId(feature)]));
}

function assignmentCount() {
  return availableFeatures().filter((feature) => getStaff(state.assignments[Core.areaId(feature)])).length;
}

function pricedCount() {
  return availableFeatures().filter((feature) => featurePrice(feature) !== null).length;
}

function ensureSelectedStaff() {
  if (selectedStaff()) return true;
  showToast("กรุณาเลือกผู้รับผิดชอบก่อนกำหนดพื้นที่");
  return false;
}

function filterStateToCourt() {
  const filtered = Core.filterStateToFeatures(state, availableFeatures());
  const removed = Object.keys(state.assignments).length - Object.keys(filtered.assignments).length + Object.keys(state.prices).length - Object.keys(filtered.prices).length;
  state = { ...filtered, pendingChanges: state.pendingChanges || removed > 0 };
  return removed;
}

function sharedDataUrl() {
  const url = new URL(SHARED_DATA_URL, window.location.href);
  url.searchParams.set("_", Date.now().toString());
  return url;
}

function sharedRevisionUrl() {
  const url = new URL(SHARED_DATA_API);
  url.searchParams.set("ref", SHARED_BRANCH);
  return url;
}

function githubHeaders(token) {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function readGitHubError(response) {
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, message: typeof payload.message === "string" ? payload.message : "" };
}

function explainGitHubError({ status, message }) {
  const detail = String(message).toLowerCase();
  if (status === 401) return "รหัสใช้ไม่ได้ ถูกยกเลิก หรือหมดอายุแล้ว";
  if (status === 403 && /rate limit/.test(detail)) return "GitHub จำกัดจำนวนการใช้งานชั่วคราว กรุณาลองใหม่";
  if (status === 403 && /resource not accessible|insufficient|personal access token/.test(detail)) return "รหัสไม่มีสิทธิ์แก้ไข MapLibre ให้ตั้ง Contents เป็น Read and write";
  if (status === 403) return `GitHub ปฏิเสธสิทธิ์${message ? `: ${message}` : ""}`;
  if (status === 404) return "ไม่พบ Repository หรือไฟล์ข้อมูลกลาง";
  return `GitHub ตอบกลับ ${status}${message ? `: ${message}` : ""}`;
}

function setTokenStatus(message, status = "") {
  if (!dom.token_status) return;
  dom.token_status.textContent = message;
  dom.token_status.className = `token-status ${status}`.trim();
}

function tokenMetadata() {
  try { return JSON.parse(localStorage.getItem(TOKEN_META_KEY)) || null; } catch { return null; }
}

function rememberedToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function renderRememberedTokenStatus(meta = tokenMetadata()) {
  if (!dom.remembered_token_status) return;
  const token = rememberedToken();
  dom.forget_github_token_button.hidden = !token;
  if (!token) {
    dom.remembered_token_status.textContent = "ยังไม่ได้จำรหัสไว้ในเครื่องนี้";
    dom.remembered_token_status.className = "remembered-token-status";
    return;
  }
  const expiry = meta?.expiresAt ? new Date(meta.expiresAt) : null;
  if (!expiry || Number.isNaN(expiry.getTime())) {
    dom.remembered_token_status.textContent = "จำรหัสไว้แล้ว แต่ GitHub ไม่ได้แจ้งวันหมดอายุ";
    dom.remembered_token_status.className = "remembered-token-status warning";
    return;
  }
  const days = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
  const dateText = new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeStyle: "short" }).format(expiry);
  dom.remembered_token_status.textContent = days < 0 ? `รหัสหมดอายุแล้วเมื่อ ${dateText}` : `รหัส ${meta.login || ""} หมดอายุ ${dateText} (ประมาณ ${days} วัน)`;
  dom.remembered_token_status.className = `remembered-token-status ${days < 0 ? "error" : days <= 7 ? "warning" : "ok"}`;
}

function rememberToken(token, metadata) {
  if (!dom.remember_github_token?.checked || !token) return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_META_KEY, JSON.stringify({ ...metadata, checkedAt: new Date().toISOString() }));
    renderRememberedTokenStatus({ ...metadata, checkedAt: new Date().toISOString() });
  } catch {
    dom.remembered_token_status.textContent = "เบราว์เซอร์นี้ไม่อนุญาตให้จำรหัส";
    dom.remembered_token_status.className = "remembered-token-status warning";
  }
}

function forgetToken({ clearInput = true } = {}) {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_META_KEY); } catch { /* no-op */ }
  if (clearInput && dom.github_token) dom.github_token.value = "";
  if (dom.remember_github_token) dom.remember_github_token.checked = false;
  renderRememberedTokenStatus();
}

function loadRememberedToken() {
  const token = rememberedToken();
  const meta = tokenMetadata();
  if (token && meta?.expiresAt && new Date(meta.expiresAt).getTime() <= Date.now()) {
    forgetToken();
    setTokenStatus("รหัสที่จำไว้หมดอายุแล้ว กรุณาวางรหัสใหม่", "warning");
    return;
  }
  if (token) {
    dom.github_token.value = token;
    dom.remember_github_token.checked = true;
  }
  renderRememberedTokenStatus(meta);
}

async function verifyGitHubToken() {
  const token = dom.github_token.value.trim();
  if (!token) {
    setTokenStatus("กรุณาวาง Fine-grained GitHub token ก่อน", "warning");
    return { valid: false, reason: "ยังไม่มีรหัส GitHub" };
  }
  tokenCheck.checking = true;
  renderSharedStatus();
  setTokenStatus("กำลังตรวจสอบรหัสกับ GitHub…");
  try {
    const response = await fetch("https://api.github.com/user", { headers: githubHeaders(token), cache: "no-store" });
    const expiresAt = response.headers.get("github-authentication-token-expiration");
    if (!response.ok) {
      const reason = explainGitHubError(await readGitHubError(response));
      if (response.status === 401 && token === rememberedToken()) forgetToken();
      tokenCheck = { checking: false, valid: false, login: null, expiresAt: null };
      setTokenStatus(reason, "error");
      return { valid: false, reason };
    }
    const account = await response.json();
    tokenCheck = { checking: false, valid: true, login: account.login, expiresAt };
    const expiryText = expiresAt ? new Intl.DateTimeFormat("th-TH", { dateStyle: "long" }).format(new Date(expiresAt)) : "ไม่ระบุวันหมดอายุ";
    setTokenStatus(`ตรวจสอบแล้ว: ${account.login} · ${expiryText}`, "ok");
    rememberToken(token, { login: account.login, expiresAt });
    return { valid: true, login: account.login, expiresAt };
  } catch (error) {
    console.error(error);
    tokenCheck = { checking: false, valid: false, login: null, expiresAt: null };
    const reason = "เชื่อมต่อ GitHub ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ต";
    setTokenStatus(reason, "error");
    return { valid: false, reason };
  } finally {
    tokenCheck.checking = false;
    renderSharedStatus();
  }
}

function renderSharedStatus() {
  if (!dom.shared_status) return;
  let text = "กำลังเชื่อมต่อข้อมูลส่วนกลาง…";
  let className = "";
  if (shared.loading) text = "กำลังโหลดหรือบันทึกข้อมูลส่วนกลาง…";
  else if (state.pendingChanges) { text = "มีข้อมูลแก้ไขในเครื่องที่ยังไม่ได้บันทึกส่วนกลาง"; className = "pending"; }
  else if (shared.available) { text = "เชื่อมต่อข้อมูลส่วนกลางแล้ว ทุกเครื่องใช้ข้อมูลชุดเดียวกัน"; className = "synced"; }
  else { text = "ยังเชื่อมต่อข้อมูลส่วนกลางไม่ได้ กำลังใช้สำเนาในเครื่อง"; className = "offline"; }
  dom.shared_status.textContent = text;
  dom.shared_status.className = `shared-status ${className}`.trim();
  dom.save_shared_button.disabled = shared.loading;
  dom.reload_shared_button.disabled = shared.loading;
  dom.check_token_button.disabled = shared.loading || tokenCheck.checking;
}

async function loadSharedState({ forceRemote = false } = {}) {
  shared.loading = true;
  renderSharedStatus();
  try {
    const response = await fetch(sharedDataUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error(`โหลดข้อมูลกลางไม่สำเร็จ (${response.status})`);
    const remote = Core.normalizeState(await response.json());
    const useRemote = forceRemote || (!state.pendingChanges && (Core.hasSharedData(remote) || !Core.hasSharedData(state)));
    if (useRemote) state = { ...remote, pendingChanges: false };
    else state.pendingChanges = true;
    filterStateToCourt();
    saveLocalState();
    shared = { available: true, loading: false, error: null };
    renderAll();
    return true;
  } catch (error) {
    console.error(error);
    shared = { available: false, loading: false, error: error.message };
    renderAll();
    return false;
  }
}

async function reloadSharedState() {
  if (state.pendingChanges && !confirm("มีข้อมูลที่ยังไม่ได้บันทึก ต้องการละทิ้งแล้วโหลดข้อมูลกลางใหม่หรือไม่?")) return;
  const ok = await loadSharedState({ forceRemote: true });
  showToast(ok ? "โหลดข้อมูลส่วนกลางล่าสุดแล้ว" : "โหลดข้อมูลส่วนกลางไม่สำเร็จ");
}

async function loadSharedRevision(token) {
  const response = await fetch(sharedRevisionUrl(), { headers: githubHeaders(token), cache: "no-store" });
  if (!response.ok) throw new Error(explainGitHubError(await readGitHubError(response)));
  const payload = await response.json();
  if (!payload.sha) throw new Error("ไม่พบรหัสอ้างอิงของไฟล์ข้อมูลกลาง");
  return payload.sha;
}

async function saveSharedState() {
  const token = dom.github_token.value.trim();
  const checked = await verifyGitHubToken();
  if (!checked.valid) { showToast(checked.reason); return false; }
  shared.loading = true;
  renderSharedStatus();
  try {
    const sha = await loadSharedRevision(token);
    state.updatedAt = new Date().toISOString();
    const payload = serializableState();
    const response = await fetch(SHARED_DATA_API, {
      method: "PUT",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Update Lopburi notice areas and prices",
        content: encodeBase64Utf8(JSON.stringify(payload, null, 2)),
        branch: SHARED_BRANCH,
        sha,
      }),
    });
    if (!response.ok) {
      if (response.status === 409 || response.status === 422) throw new Error("ข้อมูลกลางถูกแก้ไขจากเครื่องอื่น กรุณาโหลดค่ากลางใหม่ก่อนบันทึก");
      throw new Error(explainGitHubError(await readGitHubError(response)));
    }
    state.pendingChanges = false;
    saveLocalState();
    shared = { available: true, loading: false, error: null };
    renderAll();
    if (!dom.remember_github_token.checked) {
      dom.github_token.value = "";
      tokenCheck = { checking: false, valid: false, login: null, expiresAt: null };
      setTokenStatus("บันทึกสำเร็จและล้างรหัสออกจากช่องแล้ว");
    }
    showToast("บันทึกข้อมูลส่วนกลางแล้ว");
    return true;
  } catch (error) {
    console.error(error);
    shared = { ...shared, loading: false, error: error.message };
    renderSharedStatus();
    showToast(error.message || "บันทึกข้อมูลส่วนกลางไม่สำเร็จ");
    return false;
  }
}

function hexToRgb(hex) {
  const normalized = String(hex).replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
}

function colorDistance(first, second) {
  const [r1, g1, b1] = hexToRgb(first); const [r2, g2, b2] = hexToRgb(second);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function hslToHex(hue, saturation, lightness) {
  saturation /= 100; lightness /= 100;
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    const color = lightness - saturation * Math.min(lightness, 1 - lightness) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function nextDistinctColor(excluded = []) {
  const unused = PALETTE.find((candidate) => !excluded.includes(candidate));
  if (unused) return unused;
  for (let index = 0; index < 360; index += 17) {
    const candidate = hslToHex((state.staff.length * 137.508 + index) % 360, 62, 43);
    if (excluded.every((color) => colorDistance(candidate, color) > 95)) return candidate;
  }
  return hslToHex((state.staff.length * 71) % 360, 65, 45);
}

function addStaff(rawName) {
  const name = Core.sanitizeName(rawName);
  if (!name) return showToast("กรุณากรอกชื่อผู้รับผิดชอบ");
  if (state.staff.some((person) => person.name.localeCompare(name, "th", { sensitivity: "base" }) === 0)) return showToast("มีชื่อนี้อยู่แล้ว");
  const person = { id: `staff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, color: nextDistinctColor(state.staff.map((item) => item.color)), active: true };
  state.staff.push(person);
  persist(`เพิ่ม ${name} แล้ว`);
  dom.staff_select.value = person.id;
  renderAll();
}

function renameStaff(person) {
  const raw = prompt("แก้ไขชื่อเจ้าหน้าที่", person.name);
  if (raw === null) return;
  const name = Core.sanitizeName(raw);
  if (!name) return showToast("ชื่อเจ้าหน้าที่ต้องไม่ว่าง");
  if (state.staff.some((item) => item.id !== person.id && item.name.localeCompare(name, "th", { sensitivity: "base" }) === 0)) return showToast("มีชื่อนี้อยู่แล้ว");
  person.name = name;
  persist(`แก้ไขชื่อเป็น ${name} แล้ว`);
}

function toggleStaffActive(person) {
  if (person.active && !confirm(`ปิดใช้งาน ${person.name} หรือไม่? พื้นที่เดิมจะยังคงอยู่`)) return;
  person.active = !person.active;
  if (!person.active && selectedStaffId() === person.id) dom.staff_select.value = "";
  persist(`${person.active ? "เปิด" : "ปิด"}ใช้งาน ${person.name} แล้ว`);
}

function deleteStaff(person) {
  const count = assignedAreasFor(person.id).length;
  if (count) return showToast(`ลบไม่ได้ กรุณาโอนหรือยกเลิก ${count} ตำบลก่อน`);
  if (!confirm(`ลบ ${person.name} หรือไม่?`)) return;
  state.staff = state.staff.filter((item) => item.id !== person.id);
  persist(`ลบ ${person.name} แล้ว`);
}

function transferAreas(person, areas, targetId) {
  if (!areas.length) return showToast("ไม่มีพื้นที่ที่เลือก");
  if (targetId === "__unassign__") {
    if (!confirm(`ยกเลิกการมอบหมาย ${areas.length} ตำบลหรือไม่?`)) return;
    for (const feature of areas) delete state.assignments[Core.areaId(feature)];
    persist(`ยกเลิกการมอบหมาย ${areas.length} ตำบลแล้ว`);
    return;
  }
  const target = getStaff(targetId);
  if (!target?.active) return showToast("เลือกผู้รับโอนที่ยังปฏิบัติงานอยู่");
  if (!confirm(`โอน ${areas.length} ตำบลจาก ${person.name} ไปให้ ${target.name} หรือไม่?`)) return;
  for (const feature of areas) state.assignments[Core.areaId(feature)] = target.id;
  persist(`โอน ${areas.length} ตำบลให้ ${target.name} แล้ว`);
}

function assignFeatures(items, shouldAssign) {
  if (!ensureSelectedStaff()) return renderAll();
  const staff = selectedStaff();
  const foreign = items.filter((feature) => shouldAssign && state.assignments[Core.areaId(feature)] && state.assignments[Core.areaId(feature)] !== staff.id);
  if (foreign.length && !confirm(`${foreign.length} ตำบลมีผู้รับผิดชอบอยู่แล้ว ต้องการย้ายมาให้ ${staff.name} หรือไม่?`)) return renderAll();
  for (const feature of items) {
    const id = Core.areaId(feature);
    if (shouldAssign) state.assignments[id] = staff.id;
    else if (state.assignments[id] === staff.id) delete state.assignments[id];
  }
  persist(shouldAssign ? `กำหนด ${items.length} ตำบลให้ ${staff.name} แล้ว` : `ยกเลิก ${items.length} ตำบลแล้ว`);
}

function toggleFeatureFromMap(feature) {
  if (!ensureSelectedStaff()) return;
  const staff = selectedStaff();
  const id = Core.areaId(feature);
  const ownerId = state.assignments[id];
  if (ownerId === staff.id) {
    delete state.assignments[id];
    persist(`ยกเลิก ${Core.tambonName(feature)} แล้ว`);
    return;
  }
  if (ownerId && !confirm(`${Core.tambonName(feature)} อยู่กับ ${getStaff(ownerId)?.name || "ผู้รับผิดชอบเดิม"} ต้องการย้ายหรือไม่?`)) return;
  state.assignments[id] = staff.id;
  persist(`กำหนด ${Core.tambonName(feature)} ให้ ${staff.name} แล้ว`);
}

function setAreaPrice(feature, rawValue, { quiet = false } = {}) {
  const id = Core.areaId(feature);
  if (!id) return false;
  const text = String(rawValue ?? "").trim();
  if (!text) delete state.prices[id];
  else {
    const amount = Core.parseAmount(text);
    if (amount === null) return false;
    state.prices[id] = amount;
  }
  if (!quiet) persistPriceChange(`ปรับยอดตำบล${Core.tambonName(feature)}แล้ว`);
  return true;
}

function importPrices(text) {
  const parsed = Core.parsePriceLines(text, availableFeatures());
  for (const item of parsed.applied) state.prices[item.id] = item.amount;
  const parts = [`นำเข้า ${parsed.applied.length} ตำบล`];
  if (parsed.notFound.length) parts.push(`ไม่พบ ${parsed.notFound.length}`);
  if (parsed.ambiguous.length) parts.push(`ชื่อซ้ำ/กำกวม ${parsed.ambiguous.length}`);
  if (parsed.invalid.length) parts.push(`รูปแบบไม่ถูกต้อง ${parsed.invalid.length}`);
  if (dom.price_import_status) {
    const detail = [];
    if (parsed.notFound.length) detail.push(`ไม่พบ: ${parsed.notFound.slice(0, 5).join(" · ")}`);
    if (parsed.ambiguous.length) detail.push(`กำกวม: ${parsed.ambiguous.slice(0, 5).join(" · ")}`);
    if (parsed.invalid.length) detail.push(`ตรวจรูปแบบ: ${parsed.invalid.slice(0, 5).join(" · ")}`);
    dom.price_import_status.textContent = `${parts.join(" · ")}${detail.length ? ` — ${detail.join(" | ")}` : ""}`;
    dom.price_import_status.className = `helper-text ${parsed.notFound.length || parsed.ambiguous.length || parsed.invalid.length ? "warning" : "ok"}`;
  }
  if (parsed.applied.length) persist(`นำเข้ายอด ${parsed.applied.length} ตำบลแล้ว`);
  else renderAll();
}

async function importPriceFile(file) {
  if (!file) return;
  try { importPrices(await file.text()); }
  catch (error) { console.error(error); showToast("อ่านไฟล์ยอดไม่สำเร็จ"); }
  finally { dom.price_csv_input.value = ""; }
}

async function importStaffFile(file) {
  if (!file) return;
  try {
    const names = (await file.text()).split(/\r?\n/).map((line) => Core.sanitizeName(line.split(/[,;\t]/)[0].replace(/^"|"$/g, ""))).filter((name) => name && !/^ชื่อ|^name$/i.test(name));
    const existing = new Set(state.staff.map((person) => person.name.toLocaleLowerCase("th")));
    let added = 0;
    for (const name of names) {
      const key = name.toLocaleLowerCase("th");
      if (existing.has(key)) continue;
      state.staff.push({ id: `staff-${Date.now()}-${added}-${Math.random().toString(36).slice(2, 6)}`, name, color: nextDistinctColor(state.staff.map((person) => person.color)), active: true });
      existing.add(key); added += 1;
    }
    persist(added ? `นำเข้ารายชื่อ ${added} รายการแล้ว` : "ไม่พบรายชื่อใหม่");
  } catch (error) { console.error(error); showToast("นำเข้ารายชื่อไม่สำเร็จ"); }
  finally { dom.staff_import_input.value = ""; }
}

function renderStaffSelect() {
  const current = selectedStaffId();
  dom.staff_select.innerHTML = '<option value="">— เลือกผู้รับผิดชอบ —</option>';
  for (const person of activeStaff()) dom.staff_select.add(new Option(person.name, person.id));
  dom.staff_select.value = activeStaff().some((person) => person.id === current) ? current : "";
  const person = selectedStaff();
  dom.color_swatch.style.background = person ? person.color : "repeating-conic-gradient(#d3dde3 0 25%, #fff 0 50%) 50% / 10px 10px";
  dom.staff_help.textContent = person ? `กำลังกำหนดพื้นที่ให้ ${person.name}` : activeStaff().length ? "เลือกผู้รับผิดชอบเพื่อกำหนดพื้นที่" : "เพิ่มรายชื่อก่อน แล้วระบบจะคละสีให้อัตโนมัติ";
}

function renderStaffManagement() {
  dom.staff_management_content.hidden = !staffManagementOpen;
  dom.toggle_staff_management.textContent = staffManagementOpen ? "ซ่อนข้อมูล" : "แสดงข้อมูล";
  dom.toggle_staff_management.setAttribute("aria-expanded", String(staffManagementOpen));
  if (!state.staff.length) {
    dom.staff_management_list.innerHTML = '<p class="empty-result">ยังไม่มีรายชื่อเจ้าหน้าที่</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const person of state.staff) {
    const areas = assignedAreasFor(person.id).sort((a, b) => `${Core.districtName(a)} ${Core.tambonName(a)}`.localeCompare(`${Core.districtName(b)} ${Core.tambonName(b)}`, "th"));
    const card = document.createElement("article");
    card.className = `staff-card${person.active ? "" : " inactive"}`;

    const heading = document.createElement("div");
    heading.className = "staff-card-heading";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = person.color;
    const name = document.createElement("strong");
    name.textContent = person.name;
    const status = document.createElement("span");
    status.className = `staff-status${person.active ? "" : " inactive"}`;
    status.textContent = person.active ? "ปฏิบัติงาน" : "ปิดใช้งาน";
    heading.append(dot, name, status);

    const meta = document.createElement("p");
    meta.className = "staff-card-meta";
    meta.textContent = `${areas.length} ตำบล · ${new Set(areas.map(Core.districtName)).size} อำเภอ`;

    const actions = document.createElement("div");
    actions.className = "staff-card-actions";
    actions.append(
      button("แก้ชื่อ", "button button-muted", () => renameStaff(person)),
      button(person.active ? "ปิดใช้งาน" : "เปิดใช้งาน", "button button-muted", () => toggleStaffActive(person)),
      button("ลบ", "button button-danger", () => deleteStaff(person))
    );

    const clearRow = document.createElement("div");
    clearRow.className = "staff-clear-areas";
    const clearButton = button("ยกเลิกพื้นที่ทั้งหมด", "button button-danger", () => transferAreas(person, areas, "__unassign__"));
    clearButton.disabled = !areas.length;
    clearRow.append(clearButton);

    card.append(heading, meta, actions, clearRow);
    fragment.append(card);
  }
  dom.staff_management_list.replaceChildren(fragment);
}

function button(text, className, onClick) {
  const element = document.createElement("button"); element.type = "button"; element.className = className; element.textContent = text; element.addEventListener("click", onClick); return element;
}

function districtEntries() {
  return [...new Set(availableFeatures().map(Core.districtName))].sort((a, b) => a.localeCompare(b, "th"));
}

function renderDistrictList() {
  const staff = selectedStaff();
  const fragment = document.createDocumentFragment();
  const partials = [];
  for (const district of districtEntries()) {
    const districtFeatures = availableFeatures().filter((feature) => Core.districtName(feature) === district);
    const assigned = staff ? districtFeatures.filter((feature) => state.assignments[Core.areaId(feature)] === staff.id).length : 0;
    const row = document.createElement("label"); row.className = "district-option";
    const check = document.createElement("input"); check.type = "checkbox"; check.disabled = !staff; check.checked = Boolean(staff && assigned === districtFeatures.length); if (assigned > 0 && assigned < districtFeatures.length) partials.push(check);
    check.addEventListener("change", () => assignFeatures(districtFeatures, check.checked));
    const name = document.createElement("span"); name.className = "district-label"; name.textContent = district;
    const count = document.createElement("span"); count.className = "count-tag"; count.textContent = `${districtFeatures.length} ตำบล`;
    row.append(check, name, count); fragment.append(row);
  }
  dom.district_list.replaceChildren(fragment); partials.forEach((input) => { input.indeterminate = true; });
}

function renderTambonList() {
  const total = availableFeatures().length;
  const staff = selectedStaff();
  const query = Core.sanitizeName(dom.tambon_search.value).toLocaleLowerCase("th");
  if (dom.area_selection_count) dom.area_selection_count.textContent = `พื้นที่ทั้งหมด ${total} ตำบล`;
  if (!staff) {
    dom.tambon_list.innerHTML = '<p class="empty-result">กรุณาเลือกชื่อผู้รับผิดชอบก่อน แล้วระบบจะแสดงพื้นที่ทั้งหมดให้เลือก</p>';
    return;
  }
  const matches = availableFeatures()
    .filter((feature) => !query || `${Core.tambonName(feature)} ${Core.districtName(feature)}`.toLocaleLowerCase("th").includes(query))
    .sort((a, b) => `${Core.districtName(a)} ${Core.tambonName(a)}`.localeCompare(`${Core.districtName(b)} ${Core.tambonName(b)}`, "th"));
  if (!matches.length) {
    dom.tambon_list.innerHTML = '<p class="empty-result">ไม่พบตำบลที่ค้นหา</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const feature of matches) {
    const id = Core.areaId(feature);
    const owner = getStaff(state.assignments[id]);
    const row = document.createElement("label");
    row.className = "tambon-option";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = state.assignments[id] === staff.id;
    check.addEventListener("change", () => assignFeatures([feature], check.checked));
    const name = document.createElement("span");
    name.textContent = Core.tambonName(feature);
    const small = document.createElement("small");
    small.textContent = owner ? `อ.${Core.districtName(feature)} · ${owner.id === staff.id ? "รับผิดชอบอยู่" : `ผู้รับผิดชอบ: ${owner.name}`}` : `อ.${Core.districtName(feature)} · ยังไม่มอบหมาย`;
    row.append(check, name, small);
    fragment.append(row);
  }
  dom.tambon_list.replaceChildren(fragment);
}

function renderUnassignedSummary() {
  if (!dom.unassigned_summary) return;
  const total = availableFeatures().length;
  const items = unassignedAreas().sort((a, b) => `${Core.districtName(a)} ${Core.tambonName(a)}`.localeCompare(`${Core.districtName(b)} ${Core.tambonName(b)}`, "th"));
  dom.unassigned_summary.replaceChildren();
  dom.unassigned_summary.className = `unassigned-summary ${items.length ? "pending" : "complete"}`;
  const heading = document.createElement("strong");
  if (!items.length) {
    heading.textContent = `มอบหมายผู้รับผิดชอบครบ ${total} ตำบลแล้ว`;
    const note = document.createElement("p");
    note.textContent = total === EXPECTED_COURT_TAMBONS ? "ครบ 85 ตำบล" : `ครบ ${total} ตำบล`;
    dom.unassigned_summary.append(heading, note);
    return;
  }
  heading.textContent = `ตำบลที่ยังไม่มีผู้รับผิดชอบ ${items.length} ตำบล`;
  const note = document.createElement("p");
  note.textContent = `มอบหมายแล้ว ${total - items.length}/${total} ตำบล`;
  const list = document.createElement("div");
  list.className = "unassigned-area-list";
  for (const feature of items) {
    const chip = document.createElement("span");
    chip.className = "unassigned-area-chip";
    chip.textContent = `${Core.tambonName(feature)} · อ.${Core.districtName(feature)}`;
    list.append(chip);
  }
  dom.unassigned_summary.append(heading, note, list);
}

function renderPriceList() {
  const query = Core.sanitizeName(dom.price_search.value).toLocaleLowerCase("th");
  const items = availableFeatures()
    .filter((feature) => !query || `${Core.tambonName(feature)} ${Core.districtName(feature)}`.toLocaleLowerCase("th").includes(query))
    .sort((a, b) => `${Core.districtName(a)} ${Core.tambonName(a)}`.localeCompare(`${Core.districtName(b)} ${Core.tambonName(b)}`, "th"));
  const fragment = document.createDocumentFragment();
  let district = "";
  for (const feature of items) {
    if (Core.districtName(feature) !== district) {
      district = Core.districtName(feature);
      const heading = document.createElement("p");
      heading.className = "price-district-heading";
      heading.textContent = `อำเภอ${district}`;
      fragment.append(heading);
    }
    const row = document.createElement("label");
    row.className = "price-option";
    const info = document.createElement("span");
    info.className = "price-name";
    const name = document.createElement("span");
    name.className = "price-tambon";
    name.textContent = Core.tambonName(feature);
    const owner = getStaff(state.assignments[Core.areaId(feature)]);
    const small = document.createElement("small");
    small.textContent = owner ? `ผู้รับผิดชอบ: ${owner.name}` : "ยังไม่มอบหมาย";
    info.append(name, small);

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.className = "price-input";
    input.placeholder = "ยอด";
    input.dataset.areaId = Core.areaId(feature);
    input.value = featurePrice(feature) === null ? "" : Core.formatAmount(featurePrice(feature), { suffix: false });

    const commit = ({ notify = false } = {}) => {
      const previous = featurePrice(feature);
      if (!setAreaPrice(feature, input.value, { quiet: true })) {
        input.classList.add("invalid");
        if (notify) showToast("กรอกยอดเป็นตัวเลข 0 ขึ้นไป และทศนิยมไม่เกิน 2 ตำแหน่ง");
        input.value = previous === null ? "" : Core.formatAmount(previous, { suffix: false });
        return false;
      }
      input.classList.remove("invalid");
      const current = featurePrice(feature);
      input.value = current === null ? "" : Core.formatAmount(current, { suffix: false });
      persistPriceChange(notify ? `บันทึกยอดตำบล${Core.tambonName(feature)}แล้ว` : "");
      return true;
    };

    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const raw = input.value.trim();
      if (raw && Core.parseAmount(raw) === null) return;
      timer = setTimeout(() => commit(), 550);
    });
    input.addEventListener("change", () => { clearTimeout(timer); commit({ notify: true }); });
    input.addEventListener("blur", () => { clearTimeout(timer); commit(); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        clearTimeout(timer);
        commit({ notify: true });
        input.blur?.();
      }
    });

    row.append(info, input);
    fragment.append(row);
  }
  dom.price_list.replaceChildren(fragment);
  renderPriceProgress();
}

function renderPriceProgress() {
  if (dom.price_progress) dom.price_progress.textContent = `${pricedCount()}/${availableFeatures().length} ตำบล`;
}

function renderLegend() {
  if (!state.staff.length) {
    dom.legend.innerHTML = '<p class="empty-result">ยังไม่มีผู้รับผิดชอบ</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const person of state.staff) {
    const areas = assignedAreasFor(person.id);
    const row = document.createElement("div");
    row.className = "legend-item";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = person.color;
    const name = document.createElement("strong");
    name.textContent = `${person.name}${person.active ? "" : " (ปิดใช้งาน)"}`;
    const count = document.createElement("span");
    count.className = "legend-count";
    count.textContent = `${areas.length} ตำบล`;
    row.append(dot, name, count);
    fragment.append(row);
  }
  dom.legend.replaceChildren(fragment);
}

function renderSummary() {
  const total = availableFeatures().length;
  const assigned = assignmentCount();
  const values = [
    `${state.staff.length} ผู้รับผิดชอบ`,
    `มอบหมาย ${assigned}/${total} ตำบล`,
    `ยังไม่มอบหมาย ${total - assigned} ตำบล`,
    `กำหนดยอด ${pricedCount()}/${total} ตำบล`,
  ];
  dom.assignment_summary.replaceChildren(...values.map((text) => {
    const item = document.createElement("span");
    item.className = "summary-pill";
    item.textContent = text;
    return item;
  }));
  dom.updated_at.textContent = state.updatedAt
    ? `ปรับปรุง: ${new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.updatedAt))}`
    : "ยังไม่มีการบันทึก";
}

function renderValidation() {
  const validStaff = new Set(state.staff.map((person) => person.id));
  const unknown = Object.values(state.assignments).filter((id) => !validStaff.has(id)).length;
  const colors = state.staff.map((person) => person.color.toLowerCase());
  const closePairs = [];
  for (let i = 0; i < state.staff.length; i += 1) for (let j = i + 1; j < state.staff.length; j += 1) if (colorDistance(state.staff[i].color, state.staff[j].color) < 66) closePairs.push(`${state.staff[i].name}/${state.staff[j].name}`);
  const missingAssignments = availableFeatures().length - assignmentCount();
  const missingPrices = availableFeatures().length - pricedCount();
  const items = [
    [new Set(colors).size === colors.length ? "ok" : "error", new Set(colors).size === colors.length ? "สีไม่ซ้ำกัน" : "พบสีซ้ำ"],
    [closePairs.length ? "warn" : "ok", closePairs.length ? `สีใกล้กัน: ${closePairs.join(", ")}` : "สีต่างกันชัดเจน"],
    [unknown ? "error" : "ok", unknown ? `พบพื้นที่อ้างอิงเจ้าหน้าที่ที่ไม่มีชื่อ ${unknown} รายการ` : "การมอบหมายอ้างอิงรายชื่อถูกต้อง"],
    [missingAssignments ? "warn" : "ok", missingAssignments ? `ยังไม่มอบหมาย ${missingAssignments} ตำบล` : "มอบหมายครบทุกตำบล"],
    [missingPrices ? "warn" : "ok", missingPrices ? `ยังไม่กำหนดยอด ${missingPrices} ตำบล` : "กำหนดยอดครบทุกตำบล"],
    [state.publishPrices ? "warn" : "ok", state.publishPrices ? "เปิดแสดงยอดในหน้าสาธารณะ (ข้อมูล JSON ยังคงสาธารณะเสมอ)" : "ปิดการแสดงยอดบนหน้าดูผล"],
  ];
  dom.validation_list.replaceChildren(...items.map(([className, text]) => { const li = document.createElement("li"); li.className = className; li.textContent = text; return li; }));
}

function workloadFor(person) {
  const areas = assignedAreasFor(person.id);
  return { person, areas, districts: [...new Set(areas.map(Core.districtName))].sort((a, b) => a.localeCompare(b, "th")) };
}

function renderReportStaffSelect() {
  const current = dom.report_staff_select.value;
  dom.report_staff_select.replaceChildren(new Option("— รายงานทั้งหมด —", ""));
  for (const person of state.staff) dom.report_staff_select.add(new Option(`${person.name}${person.active ? "" : " (ปิดใช้งาน)"}`, person.id));
  dom.report_staff_select.value = state.staff.some((person) => person.id === current) ? current : "";
}

function renderReportSummary() {
  const fragment = document.createDocumentFragment();
  const unassigned = document.createElement("div");
  unassigned.className = "report-item report-unassigned";
  const unassignedName = document.createElement("strong");
  unassignedName.textContent = "พื้นที่ยังไม่มอบหมาย";
  const unassignedCount = document.createElement("span");
  unassignedCount.textContent = `${unassignedAreas().length} ตำบล`;
  unassigned.append(unassignedName, unassignedCount);
  fragment.append(unassigned);
  for (const person of state.staff) {
    const workload = workloadFor(person);
    const row = document.createElement("div");
    row.className = "report-item";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = person.color;
    const name = document.createElement("strong");
    name.textContent = person.name;
    const count = document.createElement("span");
    count.textContent = `${workload.areas.length} ตำบล · ${workload.districts.length} อำเภอ`;
    row.append(dot, name, count);
    fragment.append(row);
  }
  dom.report_summary.replaceChildren(fragment);
}

function mapData() {
  return { type: "FeatureCollection", features: availableFeatures().map((feature) => {
    const id = Core.areaId(feature); const owner = getStaff(state.assignments[id]); const price = featurePrice(feature);
    return { ...feature, id, properties: { ...feature.properties, id, color: owner ? owner.color : "#dce6ea", height: owner ? 1180 : 640, price: price ?? null } };
  }) };
}

function supportsWebGL() {
  if (!window.WebGLRenderingContext) return false;
  try { const canvas = document.createElement("canvas"); return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")); } catch { return false; }
}

function boundsForGeometry(geometry) {
  const bounds = new maplibregl.LngLatBounds();
  extendBounds(bounds, geometry.coordinates);
  return bounds;
}

function boundsForCollection(collection) {
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of collection?.features || []) extendBounds(bounds, feature.geometry.coordinates);
  return bounds;
}

function mapPadding(view = "province") {
  if (mapCaptureMode && view === "province") return { top: 44, right: 58, bottom: 66, left: 58 };
  const landscape = matchMedia?.("(orientation: landscape)")?.matches;
  if (view === "province") return landscape
    ? { top: 44, right: 30, bottom: 30, left: 30 }
    : { top: 70, right: 18, bottom: 120, left: 18 };
  return landscape
    ? { top: 54, right: 48, bottom: 42, left: 48 }
    : { top: 104, right: 36, bottom: 52, left: 36 };
}

function addOverviewMapLayers() {
  if (!overview) return;
  map.addSource("country-provinces", { type: "geojson", data: overview.country });
  map.addSource("outside-amphoes", { type: "geojson", data: overview.outsideAmphoes });
  map.addSource("overview-tambons", { type: "geojson", data: overview.tambons });
  map.addLayer({ id: "country-fill", type: "fill", source: "country-provinces", paint: { "fill-color": "#f1f3f4", "fill-opacity": 1 } });
  map.addLayer({ id: "country-outline", type: "line", source: "country-provinces", paint: { "line-color": "#ffffff", "line-width": 0.75, "line-opacity": 0.95 } });
  map.addLayer({ id: "outside-amphoe-fill", type: "fill", source: "outside-amphoes", paint: { "fill-color": "#e4eaed", "fill-opacity": 0.94 } });
  map.addLayer({ id: "outside-amphoe-3d", type: "fill-extrusion", source: "outside-amphoes", layout: { visibility: "none" }, paint: { "fill-extrusion-color": "#d2dce1", "fill-extrusion-height": 620, "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.92 } });
  map.addLayer({ id: "overview-tambon-outline", type: "line", source: "overview-tambons", minzoom: 6.4, paint: { "line-color": "#f6f9fa", "line-width": 0.6, "line-opacity": 0.86 } });
}

function provinceViewCenter({ focusCourt = true } = {}) {
  const provinceCenter = boundsForGeometry(overview.province.features[0].geometry).getCenter();
  if (!focusCourt || !overview?.courtAmphoes?.features?.length) return [provinceCenter.lng, provinceCenter.lat];
  const courtCenter = boundsForCollection(overview.courtAmphoes).getCenter();
  const weight = 0.70;
  return [
    provinceCenter.lng + (courtCenter.lng - provinceCenter.lng) * weight,
    provinceCenter.lat + (courtCenter.lat - provinceCenter.lat) * weight,
  ];
}

function fitProvinceOverview({ duration = 0, zoomBoost = 1, focusCourt = true } = {}) {
  if (!map) return;
  if (!overview?.province?.features?.[0]) return fitMapToData();
  mapViewport = "province";
  const bounds = boundsForGeometry(overview.province.features[0].geometry);
  const camera = map.cameraForBounds?.(bounds, { padding: mapPadding("province"), maxZoom: 10 });
  const center = provinceViewCenter({ focusCourt });
  if (camera) {
    provinceOverviewZoom = Math.min(camera.zoom + zoomBoost, 11);
    map.easeTo({ ...camera, center, zoom: provinceOverviewZoom, pitch: mapIs3d ? 50 : 0, bearing: mapIs3d ? -15 : 0, duration });
  } else {
    provinceOverviewZoom = Math.min(10 + zoomBoost, 11);
    map.fitBounds(bounds, { padding: mapPadding("province"), maxZoom: 11, duration });
    map.easeTo({ center, pitch: mapIs3d ? 50 : 0, bearing: mapIs3d ? -15 : 0, duration: 0 });
  }
  scheduleMapLabels();
}

function focusFeaturesOnMap(items, { duration = 450 } = {}) {
  if (!map || !items.length) return false;
  mapViewport = "staff";
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of items) extendBounds(bounds, feature.geometry.coordinates);
  map.fitBounds(bounds, { padding: mapPadding("detail"), maxZoom: 12.2, duration });
  scheduleMapLabels();
  return true;
}

function showTambonView() {
  const person = selectedStaff();
  if (person && focusFeaturesOnMap(assignedAreasFor(person.id))) return;
  if (!map) return;
  mapViewport = "detail";
  map.easeTo({ center: map.getCenter(), zoom: Math.max(map.getZoom(), 10.2), duration: 450 });
  scheduleMapLabels();
  if (!state.showLabels) showToast("เปิดปุ่ม “แสดงชื่อตำบล” เพื่อดูชื่อตำบลบนแผนที่");
}

function setMap3d(enabled, { duration = 450 } = {}) {
  mapIs3d = Boolean(enabled);
  if (map?.isStyleLoaded()) {
    for (const layer of ["tambon-3d", "outside-amphoe-3d"]) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", mapIs3d ? "visible" : "none");
    }
    map.easeTo({ pitch: mapIs3d ? 50 : 0, bearing: mapIs3d ? -15 : 0, duration });
  }
  renderMapControls();
}

function playIntroFlight() {
  if (!map || !overview) return fitMapToData();
  setMap3d(true, { duration: 0 });
  map.fitBounds(boundsForCollection(overview.country), { padding: mapPadding("province"), duration: 0, maxZoom: 6.2 });
  setTimeout(() => fitProvinceOverview({ duration: 1900 }), 280);
}

function createMap() {
  if (!window.maplibregl) throw new Error("ไม่พบ MapLibre GL");
  if (!supportsWebGL() && !window.__MAPLIBRE_TEST__) throw new Error("อุปกรณ์นี้ไม่รองรับ WebGL กรุณาอัปเดต Chrome หรือ Android System WebView");
  map = new maplibregl.Map({
    container: "main-map",
    style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#f6f7f8" } }] },
    center: [101.0, 13.7], zoom: 5.1, minZoom: 5, maxZoom: 12.5, pitch: 0, bearing: 0, antialias: true, preserveDrawingBuffer: true,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(createResetControl(() => fitProvinceOverview({ duration: 450 })), "top-right");
  map.addControl(createTrueNorthControl(), "top-left");
  decorateMapControls();
  configureMapInteraction();
  map.on("load", () => {
    decorateMapControls();
    addOverviewMapLayers();
    map.addSource("tambons", { type: "geojson", data: mapData(), promoteId: "id" });
    map.addLayer({ id: "tambon-ground", type: "fill", source: "tambons", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.84 } });
    map.addLayer({ id: "tambon-3d", type: "fill-extrusion", source: "tambons", layout: { visibility: "none" }, paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.9 } });
    map.addLayer({ id: "tambon-outline", type: "line", source: "tambons", paint: { "line-color": "#fff", "line-width": 1.1, "line-opacity": 0.96 } });
    const onTambonClick = (event) => { const id = String(event.features?.[0]?.properties?.id || ""); const feature = features.find((item) => Core.areaId(item) === id); if (feature) toggleFeatureFromMap(feature); };
    for (const layer of ["tambon-ground", "tambon-3d"]) {
      map.on("click", layer, onTambonClick);
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }
    Landmarks?.addToMap(map);
    map.on("moveend", renderMapLabels);
    playIntroFlight();
  });
}

function createResetControl(onReset) {
  return { onAdd() { const group = document.createElement("div"); group.className = "maplibregl-ctrl maplibregl-ctrl-group"; group.append(button("⌖", "map-reset-button", onReset)); return group; }, onRemove() {} };
}

function createTrueNorthControl() {
  let mapInstance = null;
  let needle = null;
  let updateNeedle = null;
  return {
    onAdd(instance) {
      mapInstance = instance;
      const control = document.createElement("div");
      control.className = "maplibregl-ctrl true-north-control";
      const controlButton = document.createElement("button");
      controlButton.type = "button";
      controlButton.className = "true-north-button";
      controlButton.title = "หันแผนที่สู่ทิศเหนือจริง";
      controlButton.setAttribute("aria-label", "หันแผนที่สู่ทิศเหนือจริง");
      const rose = document.createElement("span");
      rose.className = "true-north-rose";
      needle = document.createElement("span");
      needle.className = "true-north-needle";
      const letter = document.createElement("span");
      letter.className = "true-north-letter";
      letter.textContent = "N";
      rose.append(needle, letter);
      controlButton.append(rose);
      control.append(controlButton);
      updateNeedle = () => { if (needle && mapInstance) needle.style.transform = `rotate(${-mapInstance.getBearing()}deg)`; };
      controlButton.addEventListener("click", () => mapInstance?.easeTo({ bearing: 0, duration: 350 }));
      mapInstance.on("rotate", updateNeedle);
      updateNeedle();
      return control;
    },
    onRemove() {
      if (mapInstance && updateNeedle) mapInstance.off("rotate", updateNeedle);
      mapInstance = null;
      needle = null;
      updateNeedle = null;
    },
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
    const control = map.getContainer().querySelector(selector);
    if (!control) continue;
    control.dataset.tooltip = label;
    control.title = label;
    control.setAttribute("aria-label", label);
  }
}

function configureMapInteraction() {
  if (!map) return;
  map.dragPan.enable();
  map.touchZoomRotate.enable();
  map.touchZoomRotate.disableRotation();
  map.getCanvas().style.touchAction = "none";
}

function extendBounds(bounds, coordinates) {
  if (typeof coordinates?.[0] === "number") bounds.extend(coordinates);
  else for (const coordinate of coordinates || []) extendBounds(bounds, coordinate);
}

function featureCenter(feature) {
  const bounds = new maplibregl.LngLatBounds(); extendBounds(bounds, feature.geometry.coordinates); const center = bounds.getCenter(); return [center.lng, center.lat];
}

function fitMapToData() {
  if (!map || !availableFeatures().length) return;
  const assigned = availableFeatures().filter((feature) => getStaff(state.assignments[Core.areaId(feature)]));
  const bounds = new maplibregl.LngLatBounds(); for (const feature of (assigned.length ? assigned : availableFeatures())) extendBounds(bounds, feature.geometry.coordinates);
  map.fitBounds(bounds, { padding: 28, duration: 0, maxZoom: 10.8 }); scheduleMapLabels();
}

function clearMarkers(type) { for (const marker of labelMarkers[type]) marker.remove(); labelMarkers[type] = []; }
function overlap(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }

function renderDistrictLabels(entries) {
  if (!map) return;
  entries.forEach((entry) => {
    const element = document.createElement("span");
    element.className = `map-district-label${entry.outside ? " outside" : ""}`;
    element.textContent = entry.name;
    const target = entry.outside ? labelMarkers.context : labelMarkers.district;
    target.push(new maplibregl.Marker({ element, anchor: "center" }).setLngLat(entry.center).addTo(map));
  });
}

function renderMapLabels() {
  clearMarkers("area");
  clearMarkers("district");
  clearMarkers("context");
  if (!map?.isStyleLoaded()) return;
  const bounds = map.getBounds();
  const visible = availableFeatures().filter((feature) => bounds.contains(featureCenter(feature)));
  const occupied = [];
  const showNames = state.showLabels && (mapCaptureMode || map.getZoom() >= (provinceOverviewZoom ?? 10) + 0.75);
  const showPrices = state.showPriceLabels && (mapCaptureMode || map.getZoom() >= 10.2);

  if (showNames || showPrices) {
    const ordered = visible.slice().sort((a, b) => {
      const aScore = (featurePrice(a) !== null ? 2 : 0) + (state.assignments[Core.areaId(a)] ? 1 : 0);
      const bScore = (featurePrice(b) !== null ? 2 : 0) + (state.assignments[Core.areaId(b)] ? 1 : 0);
      return bScore - aScore;
    });
    for (const feature of ordered) {
      const price = featurePrice(feature);
      const nameText = showNames ? Core.tambonName(feature) : "";
      const priceText = showPrices && price !== null ? Core.formatAmount(price, { suffix: false }) : "";
      if (!nameText && !priceText) continue;
      const center = featureCenter(feature);
      const point = map.project(center);
      const width = Math.max(46, nameText.length * 7.8 + 16, priceText.length * 7.2 + 16);
      const height = nameText && priceText ? 37 : 23;
      const box = { left: point.x - width / 2, right: point.x + width / 2, top: point.y - height / 2, bottom: point.y + height / 2 };
      if (occupied.some((item) => overlap(box, item))) continue;
      occupied.push(box);

      const element = document.createElement("span");
      element.className = `map-area-label${nameText && priceText ? " with-price" : ""}`;
      if (nameText) {
        const name = document.createElement("span");
        name.className = "map-area-name";
        name.textContent = nameText;
        element.append(name);
      }
      if (priceText) {
        const amount = document.createElement("span");
        amount.className = "map-area-price";
        amount.textContent = priceText;
        element.append(amount);
      }
      labelMarkers.area.push(new maplibregl.Marker({ element, anchor: "center" }).setLngLat(center).addTo(map));
    }
  }

  if (state.showDistrictLabels) {
    const groups = new Map();
    for (const feature of availableFeatures()) {
      const district = Core.districtName(feature);
      if (!groups.has(district)) groups.set(district, []);
      groups.get(district).push(feature);
    }
    const entries = [];
    for (const [district, items] of groups) {
      const districtBounds = new maplibregl.LngLatBounds();
      for (const feature of items) extendBounds(districtBounds, feature.geometry.coordinates);
      const center = districtBounds.getCenter();
      if (bounds.contains(center)) entries.push({ name: district, center, outside: false });
    }
    for (const feature of overview?.outsideAmphoes?.features || []) {
      const center = featureCenter(feature);
      if (bounds.contains(center)) entries.push({ name: feature.properties.amphoe_th, center, outside: true });
    }
    renderDistrictLabels(entries);
  }
}

function scheduleMapLabels() { if (!map) return; const run = () => { if (!map.isStyleLoaded()) return; map.resize(); renderMapLabels(); }; map.once("idle", run); setTimeout(run, 220); }

function updateMap() { if (map?.isStyleLoaded() && map.getSource("tambons")) map.getSource("tambons").setData(mapData()); renderMapLabels(); }

function renderMapControls() {
  if (dom.three_d_button) {
    dom.three_d_button.setAttribute("aria-pressed", String(mapIs3d));
    dom.three_d_button.textContent = mapIs3d ? "◧ มุมมอง 3D" : "▱ มุมมองปกติ";
  }
  dom.labels_button.setAttribute("aria-pressed", String(state.showLabels)); dom.labels_button.textContent = state.showLabels ? "ซ่อนชื่อตำบล" : "แสดงชื่อตำบล";
  dom.district_labels_button.setAttribute("aria-pressed", String(state.showDistrictLabels)); dom.district_labels_button.textContent = state.showDistrictLabels ? "ซ่อนชื่ออำเภอ" : "แสดงชื่ออำเภอ";
  dom.price_labels_button.setAttribute("aria-pressed", String(state.showPriceLabels)); dom.price_labels_button.textContent = state.showPriceLabels ? "ซ่อนยอด" : "แสดงยอด";
  dom.legend_rail.hidden = !state.showLegend; dom.maps_layout.classList.toggle("legend-hidden", !state.showLegend); dom.toggle_legend_button.textContent = state.showLegend ? "ซ่อนคำอธิบายสี" : "แสดงคำอธิบายสี";
  dom.publish_prices.checked = state.publishPrices;
}

function renderLightweight() {
  renderSharedStatus();
  renderPriceProgress();
  renderSummary();
  renderValidation();
  renderReportSummary();
  renderLegend();
  renderUnassignedSummary();
  updateMap();
}

function renderAll() {
  renderSharedStatus();
  if (!features.length) return;
  renderStaffSelect();
  renderStaffManagement();
  renderDistrictList();
  renderTambonList();
  renderUnassignedSummary();
  renderPriceList();
  renderLegend();
  renderSummary();
  renderValidation();
  renderReportStaffSelect();
  renderReportSummary();
  renderMapControls();
  updateMap();
}

function reportRows(person) {
  return assignedAreasFor(person.id).sort((a, b) => `${Core.districtName(a)} ${Core.tambonName(a)}`.localeCompare(`${Core.districtName(b)} ${Core.tambonName(b)}`, "th")).map((feature, index) => ({
    "ลำดับ": index + 1, "ผู้รับผิดชอบ": person.name, "สถานะ": person.active ? "ปฏิบัติงาน" : "ปิดใช้งาน", "อำเภอ": Core.districtName(feature), "ตำบล": Core.tambonName(feature), "ยอด (บาท)": featurePrice(feature) ?? "",
  }));
}

function workbookSheet(workbook, name, rows, usedNames) {
  let sheetName = name.replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 28) || "รายงาน"; let suffix = 2;
  while (usedNames.has(sheetName)) { sheetName = `${name.slice(0, 24)} ${suffix}`.slice(0, 31); suffix += 1; }
  usedNames.add(sheetName); const content = rows.length ? rows : [{ "หมายเหตุ": "ไม่มีข้อมูล" }]; const sheet = XLSX.utils.json_to_sheet(content); sheet["!cols"] = Object.keys(content[0]).map((key) => ({ wch: Math.min(45, Math.max(12, key.length + 8)) })); XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
}

function exportExcel() {
  if (!window.XLSX) return showToast("โหลดเครื่องมือ Excel ไม่สำเร็จ");
  const selected = getStaff(dom.report_staff_select.value);
  const people = selected ? [selected] : state.staff;
  const workbook = XLSX.utils.book_new();
  const used = new Set();
  workbookSheet(workbook, "สรุปภาระงาน", people.map((person, index) => {
    const item = workloadFor(person);
    return {
      "ลำดับ": index + 1,
      "ผู้รับผิดชอบ": person.name,
      "สถานะ": person.active ? "ปฏิบัติงาน" : "ปิดใช้งาน",
      "จำนวนตำบล": item.areas.length,
      "จำนวนอำเภอ": item.districts.length,
      "อำเภอ": item.districts.join(", "),
    };
  }), used);
  if (selected) workbookSheet(workbook, `พื้นที่ ${selected.name}`, reportRows(selected), used);
  else {
    workbookSheet(workbook, "รายการพื้นที่ทั้งหมด", state.staff.flatMap(reportRows), used);
    for (const person of state.staff) workbookSheet(workbook, person.name, reportRows(person), used);
  }
  workbookSheet(workbook, "ยังไม่มอบหมาย", unassignedAreas().map((feature, index) => ({
    "ลำดับ": index + 1,
    "อำเภอ": Core.districtName(feature),
    "ตำบล": Core.tambonName(feature),
    "ยอด (บาท)": featurePrice(feature) ?? "",
    "สถานะ": "ยังไม่มอบหมาย",
  })), used);
  XLSX.writeFile(workbook, `${selected ? `รายงานเขต-${selected.name}` : "รายงานเขตงานส่งหมาย"}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast("ดาวน์โหลดรายงาน Excel แล้ว");
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }

function printPersonReport() {
  const person = getStaff(dom.report_staff_select.value);
  if (!person) return showToast("เลือกเจ้าหน้าที่ก่อนพิมพ์ PDF รายคน");
  const workload = workloadFor(person);
  const byDistrict = new Map();
  for (const feature of workload.areas) {
    const district = Core.districtName(feature);
    if (!byDistrict.has(district)) byDistrict.set(district, []);
    byDistrict.get(district).push(feature);
  }
  const groups = [...byDistrict.entries()].map(([district, items]) => `<section><h3>อำเภอ${escapeHtml(district)} (${items.length} ตำบล)</h3><table><thead><tr><th>ตำบล</th><th>ยอดรายตำบล</th></tr></thead><tbody>${items.sort((a,b)=>Core.tambonName(a).localeCompare(Core.tambonName(b),"th")).map((feature)=>`<tr><td>${escapeHtml(Core.tambonName(feature))}</td><td>${escapeHtml(Core.formatAmount(featurePrice(feature)))}</td></tr>`).join("")}</tbody></table></section>`).join("") || "<p>ยังไม่มีพื้นที่รับผิดชอบ</p>";
  const reportWindow = open("", "_blank");
  if (!reportWindow) return showToast("กรุณาอนุญาตป๊อปอัป");
  reportWindow.opener = null;
  reportWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>รายงาน ${escapeHtml(person.name)}</title><style>@page{size:A4;margin:16mm}body{font-family:"Noto Sans Thai",Tahoma,sans-serif;color:#172b3a}h1{font-size:22px;margin:0}h2{font-size:16px;color:#315269}h3{font-size:14px;margin-top:18px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #dbe5ea;padding:6px;text-align:left}th:last-child,td:last-child{text-align:right}.summary{display:flex;gap:8px;margin:12px 0}.tag{background:#edf4f7;padding:5px 9px;border-radius:999px}</style></head><body><h1>รายงานเขตรับผิดชอบงานส่งหมาย</h1><h2>ศาลจังหวัดลพบุรี</h2><p><strong>ผู้รับผิดชอบ:</strong> ${escapeHtml(person.name)}</p><div class="summary"><span class="tag">${workload.areas.length} ตำบล</span><span class="tag">${workload.districts.length} อำเภอ</span></div>${groups}</body></html>`);
  reportWindow.document.close();
  reportWindow.onload = () => reportWindow.print();
}

function downloadBlob(blob, filename) { const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(anchor.href), 1000); }

async function captureCurrentMapImage() {
  if (!window.html2canvas || !map) throw new Error("แผนที่ยังไม่พร้อมสร้างภาพ");
  map.resize();
  renderMapLabels();
  await new Promise((resolve) => {
    let completed = false;
    const finish = () => { if (!completed) { completed = true; resolve(); } };
    if (map.isStyleLoaded()) map.once("idle", finish);
    setTimeout(finish, 520);
  });
  const canvas = await window.html2canvas(document.getElementById("main-map"), {
    backgroundColor: "#f6f7f8",
    scale: 2,
    useCORS: true,
    logging: false,
  });
  const image = canvas.toDataURL("image/png");
  if (!image.startsWith("data:image")) throw new Error("ไม่สามารถสร้างภาพแผนที่ได้");
  return image;
}

function startPrintMapCaptureLayout() {
  const mapElement = document.getElementById("main-map");
  if (!mapElement) throw new Error("ไม่พบพื้นที่แผนที่สำหรับสร้างไฟล์");
  const originalStyle = mapElement.getAttribute("style");
  mapElement.classList.add("map-export-capture");
  Object.assign(mapElement.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: "1440px",
    height: "820px",
    minHeight: "0",
    zIndex: "-1",
  });
  map.resize();
  return () => {
    mapElement.classList.remove("map-export-capture");
    if (originalStyle === null) mapElement.removeAttribute("style");
    else mapElement.setAttribute("style", originalStyle);
    map.resize();
  };
}

async function captureFullProvinceMapImage() {
  if (!map) throw new Error("แผนที่ยังไม่พร้อม");
  const center = map.getCenter();
  const previous = {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    viewport: mapViewport,
    overviewZoom: provinceOverviewZoom,
  };
  const restoreCaptureLayout = startPrintMapCaptureLayout();
  try {
    mapCaptureMode = true;
    fitProvinceOverview({ duration: 0, zoomBoost: 0, focusCourt: false });
    return await captureCurrentMapImage();
  } finally {
    mapCaptureMode = false;
    mapViewport = previous.viewport;
    provinceOverviewZoom = previous.overviewZoom;
    restoreCaptureLayout();
    map.jumpTo({ center: previous.center, zoom: previous.zoom, bearing: previous.bearing, pitch: previous.pitch });
    scheduleMapLabels();
  }
}

async function exportProfessionalPng() {
  if (!window.html2canvas || !map) return showToast("โหลดเครื่องมือ PNG ไม่สำเร็จ");
  const original = dom.export_button.textContent;
  dom.export_button.disabled = true;
  dom.export_button.textContent = "กำลังสร้าง PNG…";
  try {
    const image = await captureFullProvinceMapImage();
    const blob = await (await fetch(image)).blob();
    if (!blob) throw new Error("ไม่สามารถสร้างไฟล์ PNG ได้");
    downloadBlob(blob, `lopburi-notice-areas-${new Date().toISOString().slice(0, 10)}.png`);
    showToast("ดาวน์โหลด PNG แผนที่แล้ว");
  } catch (error) {
    console.error(error);
    showToast("ส่งออก PNG ไม่สำเร็จ");
  } finally {
    dom.export_button.disabled = false;
    dom.export_button.textContent = original;
  }
}

async function printProfessionalMapA4() {
  if (!window.html2canvas || !map) return showToast("แผนที่ยังโหลดไม่เสร็จ");
  const printWindow = open("", "_blank");
  if (!printWindow) return showToast("กรุณาอนุญาตป๊อปอัป");
  printWindow.opener = null;
  const original = { showLabels: state.showLabels, showDistrictLabels: state.showDistrictLabels, showPriceLabels: state.showPriceLabels };
  try {
    state.showLabels = dom.print_tambon_labels.checked;
    state.showDistrictLabels = dom.print_district_labels.checked;
    state.showPriceLabels = dom.print_price_labels.checked;
    renderMapControls();
    const image = await captureFullProvinceMapImage();
    printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>แผนที่เขตพื้นที่ส่งหมาย</title><style>
      @page{size:A4;margin:0}*{box-sizing:border-box}html,body{width:auto;height:auto;min-height:0;overflow:visible}body{margin:0;padding:0;background:#fff}
      .print-map{display:block;width:100%;height:auto;object-fit:contain;background:#f6f7f8}
    </style></head><body><img class="print-map" src="${image}" alt="แผนที่เขตพื้นที่ส่งหมาย"></body></html>`);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  } catch (error) {
    console.error(error);
    printWindow.close();
    showToast("สร้างแผนพิมพ์ไม่สำเร็จ");
  } finally {
    Object.assign(state, original);
    renderMapControls();
    renderMapLabels();
  }
}

function backupState() { downloadBlob(new Blob([JSON.stringify({ ...serializableState(), exportedAt: new Date().toISOString(), note: "Lopburi Notice Area Manager v4 backup" }, null, 2)], { type: "application/json" }), `lopburi-notice-v4-${new Date().toISOString().slice(0, 10)}.json`); showToast("ดาวน์โหลดไฟล์สำรองแล้ว"); }

async function restoreState(file) {
  if (!file) return;
  try { const restored = Core.normalizeState(JSON.parse(await file.text())); if (!confirm("แทนที่ข้อมูลปัจจุบันด้วยไฟล์สำรองหรือไม่?")) return; state = { ...restored, updatedAt: new Date().toISOString(), pendingChanges: true }; filterStateToCourt(); saveLocalState(); renderAll(); showToast("กู้คืนข้อมูลสำเร็จ กรุณาบันทึกส่วนกลาง"); }
  catch (error) { console.error(error); showToast("ไฟล์สำรองไม่ถูกต้อง"); }
  finally { dom.restore_input.value = ""; }
}

async function loadBoundaries() {
  const params = new URLSearchParams({ where: "ADMIN_ID1 = '16'", outFields: "ADMIN_ID1,ADMIN_ID2,ADMIN_ID3,NAME1,NAME2,NAME3", returnGeometry: "true", outSR: "4326", f: "geojson" });
  const response = await fetch(`${GIS_QUERY_URL}?${params}`); if (!response.ok) throw new Error(`GIS ${response.status}`); const collection = await response.json();
  if (!Array.isArray(collection.features)) throw new Error("ไม่พบข้อมูลขอบเขต");
  features = collection.features.filter((feature) => Core.areaId(feature) && Core.districtName(feature) && Core.tambonName(feature) && Core.isCourtFeature(feature)).map((feature) => ({ ...feature, id: Core.areaId(feature) }));
  if (!features.length) throw new Error("ไม่พบตำบลในเขตศาลจังหวัดลพบุรี");
  filterStateToCourt();
}

async function loadOverviewMapData() {
  if (!Overview?.load) return;
  try {
    overview = await Overview.load();
  } catch (error) {
    console.warn("Unable to load overview map data", error);
    overview = null;
    showToast("โหลดภาพรวมจังหวัดไม่สำเร็จ กำลังใช้แผนที่เขตส่งหมายแบบเดิม");
  }
}

function confirmSaveBeforeLeave(proceed) {
  if (!state.pendingChanges) return proceed();
  const overlay = document.createElement("div"); overlay.className = "leave-modal-overlay";
  const card = document.createElement("div"); card.className = "leave-modal"; card.innerHTML = '<h2 class="leave-modal-title">ยังไม่ได้บันทึกส่วนกลาง</h2><p class="leave-modal-body">การแก้ไขล่าสุดยังอยู่ในเครื่องนี้เท่านั้น</p>';
  const actions = document.createElement("div"); actions.className = "leave-modal-actions";
  const saveGo = button("บันทึกแล้วไปต่อ", "button button-primary", async () => { saveGo.disabled = true; if (await saveSharedState()) { overlay.remove(); proceed(); } else saveGo.disabled = false; });
  const go = button("ไปต่อโดยไม่บันทึก", "button button-danger", () => { bypassLeaveGuard = true; overlay.remove(); proceed(); });
  const cancel = button("ยกเลิก", "button button-muted", () => overlay.remove()); actions.append(saveGo, go, cancel); card.append(actions); overlay.append(card); document.body.append(overlay);
}

function bindEvents() {
  dom.add_staff_button.addEventListener("click", () => { addStaff(dom.new_staff_name.value); dom.new_staff_name.value = ""; });
  dom.new_staff_name.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); dom.add_staff_button.click(); } });
  dom.staff_select.addEventListener("change", () => { renderAll(); const person = selectedStaff(); if (person) focusFeaturesOnMap(assignedAreasFor(person.id)); else fitProvinceOverview({ duration: 350 }); });
  dom.toggle_staff_management.addEventListener("click", () => { staffManagementOpen = !staffManagementOpen; renderStaffManagement(); });
  dom.new_color_button.addEventListener("click", () => { const person = selectedStaff(); if (!person) return showToast("เลือกผู้รับผิดชอบก่อน"); person.color = nextDistinctColor(state.staff.filter((item) => item.id !== person.id).map((item) => item.color)); persist(`คละสีใหม่ให้ ${person.name} แล้ว`); });
  dom.staff_import_input.addEventListener("change", (event) => importStaffFile(event.target.files[0]));
  dom.tambon_search.addEventListener("input", renderTambonList);
  dom.price_search.addEventListener("input", renderPriceList);
  dom.price_import_button.addEventListener("click", () => importPrices(dom.price_paste.value));
  dom.price_csv_input.addEventListener("change", (event) => importPriceFile(event.target.files[0]));
  dom.publish_prices.addEventListener("change", () => { state.publishPrices = dom.publish_prices.checked; persist(state.publishPrices ? "เปิดแสดงยอดในหน้าดูผลแล้ว" : "ปิดแสดงยอดในหน้าดูผลแล้ว"); });
  dom.validate_button.addEventListener("click", () => { renderValidation(); showToast("ตรวจสอบข้อมูลล่าสุดแล้ว"); });
  dom.province_overview_button.addEventListener("click", () => fitProvinceOverview({ duration: 500 }));
  dom.tambon_view_button.addEventListener("click", showTambonView);
  dom.three_d_button.addEventListener("click", () => setMap3d(!mapIs3d));
  dom.labels_button.addEventListener("click", () => { state.showLabels = !state.showLabels; persist(); });
  dom.district_labels_button.addEventListener("click", () => { state.showDistrictLabels = !state.showDistrictLabels; persist(); });
  dom.price_labels_button.addEventListener("click", () => { state.showPriceLabels = !state.showPriceLabels; persist(); });
  dom.toggle_legend_button.addEventListener("click", () => { state.showLegend = !state.showLegend; persist(); });
  dom.export_button.addEventListener("click", exportProfessionalPng); dom.print_map_button.addEventListener("click", printProfessionalMapA4);
  dom.backup_button.addEventListener("click", backupState); dom.restore_input.addEventListener("change", (event) => restoreState(event.target.files[0]));
  dom.excel_report_button.addEventListener("click", exportExcel); dom.pdf_report_button.addEventListener("click", printPersonReport); dom.report_staff_select.addEventListener("change", renderReportSummary);
  dom.check_token_button.addEventListener("click", async () => { const result = await verifyGitHubToken(); showToast(result.valid ? "ตรวจสอบรหัสแล้ว" : result.reason); });
  dom.save_shared_button.addEventListener("click", saveSharedState); dom.reload_shared_button.addEventListener("click", reloadSharedState);
  dom.github_token.addEventListener("input", () => { tokenCheck.valid = false; setTokenStatus("วางรหัสแล้วกดตรวจสอบก่อนบันทึก"); });
  dom.remember_github_token.addEventListener("change", () => { if (!dom.remember_github_token.checked) forgetToken({ clearInput: false }); else renderRememberedTokenStatus(); });
  dom.forget_github_token_button.addEventListener("click", () => { forgetToken(); setTokenStatus("ลบรหัสที่จำไว้แล้ว"); });
  const viewLink = document.querySelector('a[href="view.html"]'); if (viewLink) viewLink.addEventListener("click", (event) => { if (!state.pendingChanges) return; event.preventDefault(); confirmSaveBeforeLeave(() => { bypassLeaveGuard = true; location.href = viewLink.href; }); });
  addEventListener("beforeunload", (event) => { if (state.pendingChanges && !bypassLeaveGuard) { event.preventDefault(); event.returnValue = ""; } });
  const refitMapForViewport = () => { configureMapInteraction(); setTimeout(() => { if (mapViewport === "province") fitProvinceOverview({ duration: 0 }); else scheduleMapLabels(); }, 180); };
  addEventListener("resize", refitMapForViewport); addEventListener("orientationchange", refitMapForViewport);
}

async function init() {
  bindEvents(); loadRememberedToken();
  try { await Promise.all([loadBoundaries(), loadOverviewMapData()]); await loadSharedState(); createMap(); renderAll(); }
  catch (error) { console.error(error); dom.tambon_list.innerHTML = `<p class="empty-result">${escapeHtml(error.message || "โหลดระบบไม่สำเร็จ")}</p>`; showToast(error.message || "โหลดระบบไม่สำเร็จ"); }
  finally { dom.loading.hidden = true; }
}

init();
