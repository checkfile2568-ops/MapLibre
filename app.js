/*
 * ระบบบริหารเขตงานส่งหมาย — ข้อมูลการมอบหมายถูกเก็บในเบราว์เซอร์ของเครื่องผู้ใช้
 * ขอบเขตตำบลถูกเรียกจาก ArcGIS Feature Service แบบอ่านอย่างเดียว
 */

const GIS_QUERY_URL = "https://services1.arcgis.com/jSaRWj2TDlcN1zOC/arcgis/rest/services/Thailand_Subdistrict_Boundaries_%28%E0%B8%82%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B8%B9%E0%B8%A5%E0%B8%82%E0%B8%AD%E0%B8%9A%E0%B9%80%E0%B8%82%E0%B8%95%E0%B8%95%E0%B8%B3%E0%B8%9A%E0%B8%A5%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%97%E0%B8%A8%E0%B9%84%E0%B8%97%E0%B8%A2%29/FeatureServer/1/query";
const STORAGE_KEY = "lopburi-notice-area-manager-v1";
const SHARED_BRANCH = "main";
const SHARED_DATA_API = "https://api.github.com/repos/checkfile2568-ops/MapLibre/contents/data/assignments.json";
const MAIN_COURT_DISTRICTS = new Set(["เมืองลพบุรี", "พัฒนานิคม", "โคกสำโรง", "ท่าวุ้ง", "บ้านหมี่", "หนองม่วง"]);
const PALETTE = [
  "#1377b5", "#ca5d35", "#2c9a6d", "#7757b5", "#c04662", "#27858f",
  "#ae791a", "#4772af", "#a04d9a", "#537c3c", "#9c623f", "#27725a",
];

const dom = {
  loading: document.querySelector("#loading"),
  staffSelect: document.querySelector("#staff-select"),
  newStaffName: document.querySelector("#new-staff-name"),
  addStaffButton: document.querySelector("#add-staff-button"),
  staffImportInput: document.querySelector("#staff-import-input"),
  colorSwatch: document.querySelector("#color-swatch"),
  staffHelp: document.querySelector("#staff-help"),
  newColorButton: document.querySelector("#new-color-button"),
  staffManagementList: document.querySelector("#staff-management-list"),
  districtList: document.querySelector("#district-list"),
  tambonSearch: document.querySelector("#tambon-search"),
  tambonList: document.querySelector("#tambon-list"),
  validationList: document.querySelector("#validation-list"),
  validateButton: document.querySelector("#validate-button"),
  summary: document.querySelector("#assignment-summary"),
  legend: document.querySelector("#legend"),
  labelsButton: document.querySelector("#labels-button"),
  exportButton: document.querySelector("#export-button"),
  backupButton: document.querySelector("#backup-button"),
  restoreInput: document.querySelector("#restore-input"),
  reportStaffSelect: document.querySelector("#report-staff-select"),
  excelReportButton: document.querySelector("#excel-report-button"),
  pdfReportButton: document.querySelector("#pdf-report-button"),
  reportSummary: document.querySelector("#report-summary"),
  saveSharedButton: document.querySelector("#save-shared-button"),
  reloadSharedButton: document.querySelector("#reload-shared-button"),
  checkTokenButton: document.querySelector("#check-token-button"),
  githubToken: document.querySelector("#github-token"),
  sharedStatus: document.querySelector("#shared-status"),
  tokenStatus: document.querySelector("#token-status"),
  updatedAt: document.querySelector("#updated-at"),
  toast: document.querySelector("#toast"),
  printable: document.querySelector("#printable"),
};

let features = [];
let maps = { main: null };
let labelMarkers = { main: [] };
let toastTimer;
let state = loadState();
let shared = { available: false, loading: false, sha: null, error: null };
let tokenCheck = { checking: false, status: "idle", message: "", expiresAt: null, login: null };

function initialState() {
  return { version: 3, staff: [], assignments: {}, showLabels: false, updatedAt: null, pendingChanges: false };
}

function normalizeState(raw) {
  if (!raw || !Array.isArray(raw.staff) || typeof raw.assignments !== "object") return initialState();
  return {
    version: 3,
    staff: raw.staff
      .filter((person) => person && person.id && person.name && person.color)
      .map((person) => ({ id: String(person.id), name: String(person.name), color: String(person.color), active: person.active !== false })),
    assignments: Object.fromEntries(Object.entries(raw.assignments).map(([area, person]) => [String(area), String(person)])),
    showLabels: Boolean(raw.showLabels),
    updatedAt: raw.updatedAt || null,
    pendingChanges: Boolean(raw.pendingChanges),
  };
}

function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return initialState();
  }
}

function serializableState() {
  return {
    version: 3,
    staff: state.staff,
    assignments: state.assignments,
    showLabels: state.showLabels,
    updatedAt: state.updatedAt,
  };
}

function hasAssignmentsOrStaff(candidate) {
  return candidate.staff.length > 0 || Object.keys(candidate.assignments).length > 0;
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function persist(message) {
  state.updatedAt = new Date().toISOString();
  state.pendingChanges = true;
  saveLocalState();
  renderAll();
  if (message) showToast(message);
}

function selectedStaffId() {
  return dom.staffSelect.value || "";
}

function selectedStaff() {
  return state.staff.find((person) => person.id === selectedStaffId() && person.active) || null;
}

function getStaff(staffId) {
  return state.staff.find((person) => person.id === staffId) || null;
}

function activeStaff() {
  return state.staff.filter((person) => person.active);
}

function areaId(feature) {
  return String(feature.properties.ADMIN_ID3 || feature.properties.OBJECTID || feature.id);
}

function featureDistrict(feature) {
  return feature.properties.NAME2;
}

function featureTambon(feature) {
  return feature.properties.NAME3;
}

function isMainDistrict(feature) {
  return MAIN_COURT_DISTRICTS.has(featureDistrict(feature));
}

function availableFeatures() {
  return features.filter(isMainDistrict);
}

function removeAreasOutsideLopburiCourt() {
  if (!features.length) return 0;
  const allowedIds = new Set(availableFeatures().map(areaId));
  const entries = Object.entries(state.assignments);
  const keptEntries = entries.filter(([id]) => allowedIds.has(id));
  state.assignments = Object.fromEntries(keptEntries);
  return entries.length - keptEntries.length;
}

function currentAssignments() {
  const validStaff = new Set(state.staff.map((person) => person.id));
  return Object.fromEntries(Object.entries(state.assignments).filter(([, staffId]) => validStaff.has(staffId)));
}

function assignedAreasFor(staffId) {
  return availableFeatures().filter((feature) => state.assignments[areaId(feature)] === staffId);
}

function ensureSelectedStaff() {
  if (selectedStaff()) return true;
  showToast("กรุณาเลือกผู้รับผิดชอบก่อนกำหนดพื้นที่");
  return false;
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 3100);
}

function decodeBase64Utf8(value) {
  const bytes = Uint8Array.from(atob(value.replace(/\n/g, "")), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function sharedDataUrl() {
  const url = new URL(SHARED_DATA_API);
  url.searchParams.set("ref", SHARED_BRANCH);
  url.searchParams.set("_", String(Date.now()));
  return url;
}

function githubApiHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function setTokenStatus(message, status = "") {
  tokenCheck = { ...tokenCheck, status, message };
  if (!dom.tokenStatus) return;
  dom.tokenStatus.textContent = message;
  dom.tokenStatus.className = `token-status ${status}`.trim();
}

function clearTokenCheck() {
  tokenCheck = { checking: false, status: "idle", message: "", expiresAt: null, login: null };
  setTokenStatus(dom.githubToken.value.trim() ? "ยังไม่ได้ตรวจสอบรหัส กด “ตรวจสอบรหัส” ก่อนบันทึก" : "วางรหัสแล้วกด “ตรวจสอบรหัส” ก่อนบันทึก");
}

function formatExpiration(expiresAt) {
  if (!expiresAt) return "GitHub ไม่ได้ส่งวันหมดอายุให้หน้าเว็บนี้อ่านได้ ให้ตรวจที่หน้าจัดการรหัสของ GitHub";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return `วันหมดอายุตาม GitHub: ${expiresAt}`;
  const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
  const dateText = new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeStyle: "short" }).format(date);
  if (days < 0) return `หมดอายุแล้วเมื่อ ${dateText}`;
  if (days === 0) return `หมดอายุภายในวันนี้ (${dateText})`;
  return `หมดอายุ ${dateText} (เหลือประมาณ ${days} วัน)`;
}

async function readGitHubError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // GitHub may return an empty response body for some security failures.
  }
  return {
    status: response.status,
    message: typeof payload?.message === "string" ? payload.message : "",
    documentationUrl: typeof payload?.documentation_url === "string" ? payload.documentation_url : "",
  };
}

function explainGitHubError({ status, message }) {
  const detail = message.toLowerCase();
  if (status === 401) return "รหัสใช้ไม่ได้ ถูกยกเลิก หรือหมดอายุแล้ว ให้สร้างรหัสใหม่แล้ววางอีกครั้ง";
  if (status === 403 && /rate limit|secondary rate limit/.test(detail)) return "GitHub จำกัดจำนวนการใช้งานชั่วคราว โปรดลองใหม่อีกสักครู่";
  if (status === 403 && /saml|single sign-on|sso/.test(detail)) return "รหัสยังไม่ได้รับอนุญาตให้ใช้กับองค์กรนี้ ให้เปิดสิทธิ์ SSO ของ GitHub ก่อน";
  if (status === 403 && /resource not accessible|personal access token|insufficient|not accessible/.test(detail)) {
    return "รหัสใช้ได้ แต่ไม่มีสิทธิ์แก้ไข MapLibre: ตอนสร้างรหัสให้เลือก Only select repositories → MapLibre และตั้ง Repository permissions → Contents เป็น Read and write";
  }
  if (status === 403) return `GitHub ปฏิเสธสิทธิ์ (403)${message ? `: ${message}` : ""}`;
  if (status === 404) return "ไม่พบไฟล์หรือที่เก็บข้อมูลกลาง กรุณาตรวจสอบชื่อโครงการ MapLibre";
  return `GitHub ตอบกลับ ${status}${message ? `: ${message}` : ""}`;
}

async function verifyGitHubToken() {
  const token = dom.githubToken.value.trim();
  if (!token) {
    setTokenStatus("ยังไม่มีรหัสสำหรับตรวจสอบ", "warning");
    return { valid: false, reason: "กรุณาวางรหัส GitHub ก่อน" };
  }

  tokenCheck = { ...tokenCheck, checking: true };
  setTokenStatus("กำลังตรวจสอบรหัสกับ GitHub…");
  renderSharedStatus();
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: githubApiHeaders(token),
      cache: "no-store",
    });
    const expiresAt = response.headers.get("github-authentication-token-expiration");
    if (!response.ok) {
      const error = await readGitHubError(response);
      const reason = explainGitHubError(error);
      tokenCheck = { checking: false, status: "error", message: reason, expiresAt: null, login: null };
      setTokenStatus(reason, "error");
      return { valid: false, reason };
    }
    const account = await response.json();
    const expirationText = formatExpiration(expiresAt);
    const message = `ตรวจสอบแล้ว: รหัสเป็นของบัญชี ${account.login} และยังใช้ได้ — ${expirationText} กด “บันทึกส่วนกลาง” เพื่อยืนยันสิทธิ์แก้ไข MapLibre`;
    tokenCheck = { checking: false, status: "ok", message, expiresAt, login: account.login };
    setTokenStatus(message, "ok");
    return { valid: true, expiresAt, login: account.login };
  } catch (error) {
    console.error(error);
    const reason = "ตรวจสอบรหัสไม่ได้ เพราะเชื่อมต่อ GitHub ไม่สำเร็จ โปรดตรวจอินเทอร์เน็ตแล้วลองใหม่";
    tokenCheck = { checking: false, status: "error", message: reason, expiresAt: null, login: null };
    setTokenStatus(reason, "error");
    return { valid: false, reason };
  } finally {
    tokenCheck = { ...tokenCheck, checking: false };
    renderSharedStatus();
  }
}

function renderSharedStatus() {
  if (!dom.sharedStatus) return;
  let message = "กำลังเชื่อมต่อข้อมูลส่วนกลาง…";
  let statusClass = "";
  if (shared.loading) {
    message = "กำลังโหลดข้อมูลส่วนกลาง…";
  } else if (state.pendingChanges) {
    message = "ข้อมูลบนหน้านี้ยังอยู่ในเครื่องเท่านั้น — หน้าจอแสดงผลและเครื่องอื่นจะเห็นข้อมูลหลังจากกด “บันทึกส่วนกลาง”";
    statusClass = "pending";
  } else if (shared.available) {
    message = "เชื่อมต่อข้อมูลส่วนกลางแล้ว — ทุกเครื่องจะเห็นค่าชุดเดียวกัน";
    statusClass = "synced";
  } else {
    message = "ยังเชื่อมต่อข้อมูลส่วนกลางไม่ได้ กำลังใช้สำเนาในเครื่อง";
    statusClass = "offline";
  }
  dom.sharedStatus.textContent = message;
  dom.sharedStatus.className = `shared-status ${statusClass}`.trim();
  dom.saveSharedButton.disabled = shared.loading;
  dom.reloadSharedButton.disabled = shared.loading;
  dom.checkTokenButton.disabled = shared.loading || tokenCheck.checking;
  dom.checkTokenButton.textContent = tokenCheck.checking ? "กำลังตรวจสอบรหัส…" : "ตรวจสอบรหัส";
}

async function loadSharedState({ forceRemote = false } = {}) {
  shared.loading = true;
  shared.error = null;
  renderSharedStatus();
  try {
    const response = await fetch(sharedDataUrl(), {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
    const payload = await response.json();
    const remoteState = normalizeState(JSON.parse(decodeBase64Utf8(payload.content)));
    const shouldUseRemote = forceRemote || hasAssignmentsOrStaff(remoteState) || !hasAssignmentsOrStaff(state);
    if (shouldUseRemote) {
      state = { ...remoteState, pendingChanges: false };
    } else {
      state.pendingChanges = true;
    }
    if (removeAreasOutsideLopburiCourt() > 0) state.pendingChanges = true;
    shared = { available: true, loading: false, sha: payload.sha, error: null };
    saveLocalState();
    renderAll();
    return true;
  } catch (error) {
    console.error(error);
    shared = { ...shared, available: false, loading: false, error: error.message };
    renderAll();
    return false;
  }
}

async function reloadSharedState() {
  if (state.pendingChanges && !window.confirm("มีการแก้ไขในเครื่องที่ยังไม่ได้บันทึกส่วนกลาง ต้องการละทิ้งแล้วโหลดข้อมูลกลางใหม่หรือไม่?")) return;
  const loaded = await loadSharedState({ forceRemote: true });
  showToast(loaded ? "โหลดข้อมูลส่วนกลางล่าสุดแล้ว" : "ไม่สามารถโหลดข้อมูลส่วนกลางได้");
}

async function saveSharedState() {
  const token = dom.githubToken.value.trim();
  if (!token) {
    setTokenStatus("กรุณาวาง Fine-grained GitHub token ที่มีสิทธิ์ Contents: Read and write ก่อนบันทึก", "warning");
    showToast("กรุณาวางรหัส GitHub ก่อนบันทึก");
    return;
  }
  const checked = await verifyGitHubToken();
  if (!checked.valid) {
    showToast(checked.reason);
    return;
  }
  if (!shared.sha && !(await loadSharedState())) {
    showToast("ไม่พบข้อมูลส่วนกลาง จึงยังบันทึกไม่ได้");
    return;
  }
  shared.loading = true;
  renderSharedStatus();
  try {
    const response = await fetch(SHARED_DATA_API, {
      method: "PUT",
      headers: {
        ...githubApiHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Update Lopburi notice area assignments",
        content: encodeBase64Utf8(JSON.stringify(serializableState(), null, 2)),
        branch: SHARED_BRANCH,
        sha: shared.sha,
      }),
    });
    if (!response.ok) {
      const githubError = await readGitHubError(response);
      if (response.status === 409 || response.status === 422) {
        throw new Error("ข้อมูลส่วนกลางถูกแก้ไขจากเครื่องอื่นแล้ว กรุณาโหลดค่ากลางใหม่ก่อนบันทึกอีกครั้ง");
      }
      const reason = explainGitHubError(githubError);
      setTokenStatus(`ตรวจสอบรหัสผ่าน แต่บันทึกไม่ได้: ${reason}`, "error");
      throw new Error(reason);
    }
    const result = await response.json();
    shared = { available: true, loading: false, sha: result.content?.sha || shared.sha, error: null };
    state.pendingChanges = false;
    state.updatedAt = new Date().toISOString();
    saveLocalState();
    renderAll();
    dom.githubToken.value = "";
    clearTokenCheck();
    showToast("บันทึกข้อมูลส่วนกลางแล้ว ทุกเครื่องจะเห็นค่าใหม่นี้");
  } catch (error) {
    console.error(error);
    shared = { ...shared, loading: false, error: error.message };
    renderAll();
    showToast(error.message || "บันทึกข้อมูลส่วนกลางไม่สำเร็จ");
  }
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
}

function colorDistance(first, second) {
  const [r1, g1, b1] = hexToRgb(first);
  const [r2, g2, b2] = hexToRgb(second);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function hslToHex(hue, saturation, lightness) {
  saturation /= 100;
  lightness /= 100;
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    const color = lightness - saturation * Math.min(lightness, 1 - lightness) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function nextDistinctColor(excluded = []) {
  const unused = PALETTE.filter((candidate) => !excluded.includes(candidate));
  if (unused.length) return unused[0];

  for (let index = 0; index < 360; index += 17) {
    const candidate = hslToHex((state.staff.length * 137.508 + index) % 360, 62, 43);
    if (excluded.every((color) => colorDistance(candidate, color) > 95)) return candidate;
  }
  return hslToHex((state.staff.length * 71) % 360, 65, 45);
}

function addStaff(name) {
  const cleanName = name.trim().replace(/\s+/g, " ");
  if (!cleanName) return;
  if (state.staff.some((person) => person.name.localeCompare(cleanName, "th") === 0)) {
    showToast("มีชื่อนี้อยู่ในรายการแล้ว");
    return;
  }
  const person = {
    id: `staff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    color: nextDistinctColor(state.staff.map((existing) => existing.color)),
    active: true,
  };
  state.staff.push(person);
  renderStaffSelect();
  dom.staffSelect.value = person.id;
  persist(`เพิ่ม ${cleanName} และกำหนดสีให้อัตโนมัติแล้ว`);
}

function reassignSelectedColor() {
  const person = selectedStaff();
  if (!person) return showToast("เลือกผู้รับผิดชอบที่ต้องการคละสีก่อน");
  const otherColors = state.staff.filter((candidate) => candidate.id !== person.id).map((candidate) => candidate.color);
  const next = nextDistinctColor(otherColors);
  person.color = next;
  persist(`เปลี่ยนสีของ ${person.name} แล้ว`);
}

function cleanStaffName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function renameStaff(person) {
  const nextName = window.prompt("แก้ไขชื่อเจ้าหน้าที่", person.name);
  if (nextName === null) return;
  const cleanName = cleanStaffName(nextName);
  if (!cleanName) return showToast("ชื่อเจ้าหน้าที่ต้องไม่ว่าง");
  if (state.staff.some((candidate) => candidate.id !== person.id && candidate.name.localeCompare(cleanName, "th") === 0)) {
    return showToast("มีชื่อนี้อยู่ในรายการแล้ว");
  }
  if (cleanName === person.name) return;
  person.name = cleanName;
  persist(`แก้ไขชื่อเจ้าหน้าที่เป็น ${cleanName} แล้ว`);
}

function toggleStaffActive(person) {
  const assignmentCount = assignedAreasFor(person.id).length;
  if (person.active) {
    const note = assignmentCount ? `\nพื้นที่ ${assignmentCount} ตำบลจะยังคงอยู่กับชื่อนี้จนกว่าจะโอนพื้นที่` : "";
    if (!window.confirm(`ปิดใช้งาน ${person.name} หรือไม่? จะไม่สามารถรับมอบหมายพื้นที่ใหม่ได้${note}`)) return;
    person.active = false;
    if (dom.staffSelect.value === person.id) dom.staffSelect.value = "";
    persist(`ปิดใช้งาน ${person.name} แล้ว`);
    return;
  }
  person.active = true;
  persist(`เปิดใช้งาน ${person.name} แล้ว`);
}

function transferStaffAreas(person, targetId) {
  const areas = assignedAreasFor(person.id);
  if (!areas.length) return showToast(`${person.name} ยังไม่มีพื้นที่ต้องโอน`);
  if (!targetId) return showToast("เลือกผู้รับโอนพื้นที่ก่อน");

  if (targetId === "__unassign__") {
    if (!window.confirm(`ยกเลิกการมอบหมาย ${areas.length} ตำบลของ ${person.name} หรือไม่?`)) return;
    for (const feature of areas) delete state.assignments[areaId(feature)];
    persist(`ยกเลิกพื้นที่ ${areas.length} ตำบลของ ${person.name} แล้ว`);
    return;
  }

  const target = getStaff(targetId);
  if (!target || !target.active) return showToast("เลือกผู้รับโอนที่ยังปฏิบัติงานอยู่");
  if (!window.confirm(`โอน ${areas.length} ตำบลจาก ${person.name} ไปให้ ${target.name} หรือไม่?`)) return;
  for (const feature of areas) state.assignments[areaId(feature)] = target.id;
  persist(`โอน ${areas.length} ตำบลไปให้ ${target.name} แล้ว`);
}

function transferSelectedStaffAreas(person, areas, targetId) {
  if (!areas.length) return showToast("เลือกตำบลที่ต้องการโอนก่อน");
  if (!targetId) return showToast("เลือกผู้รับโอนตำบลก่อน");
  const target = getStaff(targetId);
  if (!target || !target.active) return showToast("เลือกผู้รับโอนที่ยังปฏิบัติงานอยู่");
  if (!window.confirm(`โอน ${areas.length} ตำบลจาก ${person.name} ไปให้ ${target.name} หรือไม่?`)) return;
  for (const feature of areas) state.assignments[areaId(feature)] = target.id;
  persist(`โอน ${areas.length} ตำบลไปให้ ${target.name} แล้ว`);
}

function unassignSelectedStaffAreas(person, areas) {
  if (!areas.length) return showToast("เลือกตำบลที่ต้องการนำออกก่อน");
  if (!window.confirm(`นำ ${areas.length} ตำบลออกจาก ${person.name} หรือไม่? ตำบลเหล่านี้จะกลับไปอยู่ในรายการยังไม่มอบหมาย`)) return;
  for (const feature of areas) delete state.assignments[areaId(feature)];
  persist(`นำ ${areas.length} ตำบลออกจาก ${person.name} แล้ว — อยู่ในรายการยังไม่มอบหมาย`);
}

function deleteStaff(person) {
  const areas = assignedAreasFor(person.id);
  if (areas.length) {
    showToast(`ลบ ${person.name} ไม่ได้ — กรุณาโอนหรือยกเลิก ${areas.length} ตำบลก่อน`);
    return;
  }
  if (!window.confirm(`ลบ ${person.name} ออกจากรายชื่อหรือไม่?`)) return;
  state.staff = state.staff.filter((candidate) => candidate.id !== person.id);
  if (dom.staffSelect.value === person.id) dom.staffSelect.value = "";
  persist(`ลบ ${person.name} ออกจากรายชื่อแล้ว`);
}

function renderStaffManagement() {
  if (!state.staff.length) {
    dom.staffManagementList.innerHTML = '<p class="empty-result">ยังไม่มีรายชื่อเจ้าหน้าที่</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const person of state.staff) {
    const areas = assignedAreasFor(person.id);
    const districts = new Set(areas.map(featureDistrict));
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
    meta.textContent = `${areas.length} ตำบล · ${districts.size} อำเภอ${person.active ? "" : " · รับพื้นที่ใหม่ไม่ได้"}`;

    const actions = document.createElement("div");
    actions.className = "staff-card-actions";
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "button button-muted";
    rename.textContent = "แก้ชื่อ";
    rename.addEventListener("click", () => renameStaff(person));
    const activity = document.createElement("button");
    activity.type = "button";
    activity.className = "button button-muted";
    activity.textContent = person.active ? "ปิดใช้งาน" : "เปิดใช้งาน";
    activity.addEventListener("click", () => toggleStaffActive(person));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger";
    remove.textContent = "ลบ";
    remove.addEventListener("click", () => deleteStaff(person));
    actions.append(rename, activity, remove);

    const editor = document.createElement("details");
    editor.className = "staff-area-editor";
    const editorSummary = document.createElement("summary");
    editorSummary.textContent = `แก้ไขตำบลรายรายการ (${areas.length} ตำบล)`;
    editor.append(editorSummary);

    if (!areas.length) {
      const empty = document.createElement("p");
      empty.className = "staff-area-empty";
      empty.textContent = "ยังไม่มีตำบลที่รับผิดชอบ";
      editor.append(empty);
    } else {
      const hint = document.createElement("p");
      hint.className = "staff-area-hint";
      hint.textContent = "เลือกตำบลเพื่อโอนไปให้เจ้าหน้าที่คนอื่น หรือนำออกเพื่อให้กลับไปอยู่ในรายการยังไม่มอบหมาย";

      const selectAllRow = document.createElement("label");
      selectAllRow.className = "staff-area-select-all";
      const selectAll = document.createElement("input");
      selectAll.type = "checkbox";
      const selectAllText = document.createElement("span");
      selectAllText.textContent = "เลือกทั้งหมด";
      selectAllRow.append(selectAll, selectAllText);

      const areaList = document.createElement("div");
      areaList.className = "staff-area-list";
      const checkboxes = new Map();
      const sortedAreas = areas.slice().sort((left, right) => {
        const district = featureDistrict(left).localeCompare(featureDistrict(right), "th");
        return district || featureTambon(left).localeCompare(featureTambon(right), "th");
      });

      for (const feature of sortedAreas) {
        const option = document.createElement("label");
        option.className = "staff-area-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.areaId = areaId(feature);
        const text = document.createElement("span");
        text.textContent = featureTambon(feature);
        const district = document.createElement("small");
        district.textContent = featureDistrict(feature);
        option.append(checkbox, text, district);
        areaList.append(option);
        checkboxes.set(areaId(feature), checkbox);
      }

      const selectedFeatures = () => sortedAreas.filter((feature) => checkboxes.get(areaId(feature)).checked);
      const selectionStatus = document.createElement("p");
      selectionStatus.className = "staff-area-selection-status";

      const bulkActions = document.createElement("div");
      bulkActions.className = "staff-area-bulk-actions";
      const partialSelect = document.createElement("select");
      const partialPlaceholder = document.createElement("option");
      partialPlaceholder.value = "";
      partialPlaceholder.textContent = "— โอนตำบลที่เลือกไปให้ —";
      partialSelect.append(partialPlaceholder);
      for (const candidate of activeStaff().filter((candidate) => candidate.id !== person.id)) {
        const option = document.createElement("option");
        option.value = candidate.id;
        option.textContent = candidate.name;
        partialSelect.append(option);
      }

      const partialTransfer = document.createElement("button");
      partialTransfer.type = "button";
      partialTransfer.className = "button button-secondary";
      partialTransfer.textContent = "โอนที่เลือก";
      const partialUnassign = document.createElement("button");
      partialUnassign.type = "button";
      partialUnassign.className = "button button-danger";
      partialUnassign.textContent = "นำที่เลือกออก";

      const refreshSelection = () => {
        const count = selectedFeatures().length;
        selectAll.checked = count === sortedAreas.length;
        selectAll.indeterminate = count > 0 && count < sortedAreas.length;
        selectionStatus.textContent = `เลือกแล้ว ${count} ตำบล`;
        partialTransfer.disabled = !count || !partialSelect.value;
        partialUnassign.disabled = !count;
      };
      selectAll.addEventListener("change", () => {
        for (const checkbox of checkboxes.values()) checkbox.checked = selectAll.checked;
        refreshSelection();
      });
      for (const checkbox of checkboxes.values()) checkbox.addEventListener("change", refreshSelection);
      partialSelect.addEventListener("change", refreshSelection);
      partialTransfer.addEventListener("click", () => transferSelectedStaffAreas(person, selectedFeatures(), partialSelect.value));
      partialUnassign.addEventListener("click", () => unassignSelectedStaffAreas(person, selectedFeatures()));
      refreshSelection();

      bulkActions.append(partialSelect, partialTransfer, partialUnassign);
      editor.append(hint, selectAllRow, areaList, selectionStatus, bulkActions);
    }

    const transfer = document.createElement("div");
    transfer.className = "transfer-row";
    const select = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— โอนทั้งหมดไปให้ —";
    select.append(placeholder);
    for (const candidate of activeStaff().filter((candidate) => candidate.id !== person.id)) {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.name;
      select.append(option);
    }
    const unassign = document.createElement("option");
    unassign.value = "__unassign__";
    unassign.textContent = "ยกเลิกพื้นที่ทั้งหมด";
    select.append(unassign);
    const transferButton = document.createElement("button");
    transferButton.type = "button";
    transferButton.className = "button button-secondary";
    transferButton.textContent = "โอนทั้งหมด";
    transferButton.disabled = !areas.length;
    transferButton.addEventListener("click", () => transferStaffAreas(person, select.value));
    transfer.append(select, transferButton);

    card.append(heading, meta, actions, editor, transfer);
    fragment.append(card);
  }
  dom.staffManagementList.replaceChildren(fragment);
}

function assignmentCount() {
  return Object.keys(currentAssignments()).filter((id) => availableFeatures().some((feature) => areaId(feature) === id)).length;
}

function districtEntries() {
  return Array.from(new Set(availableFeatures().map(featureDistrict))).sort((a, b) => a.localeCompare(b, "th"));
}

function setFeatureAssignment(feature, staffId, { silent = false } = {}) {
  const id = areaId(feature);
  if (!staffId) {
    delete state.assignments[id];
  } else {
    state.assignments[id] = staffId;
  }
  if (!silent) persist();
}

function assignFeatures(featuresToAssign, shouldAssign) {
  if (!ensureSelectedStaff()) {
    renderAll();
    return;
  }
  const staff = selectedStaff();
  const foreign = featuresToAssign.filter((feature) => {
    const owner = state.assignments[areaId(feature)];
    return shouldAssign && owner && owner !== staff.id;
  });
  if (foreign.length && !window.confirm(`${foreign.length} ตำบลมีผู้รับผิดชอบอยู่แล้ว ต้องการย้ายมาให้ ${staff.name} หรือไม่?`)) {
    renderAll();
    return;
  }
  for (const feature of featuresToAssign) {
    if (shouldAssign) state.assignments[areaId(feature)] = staff.id;
    else if (state.assignments[areaId(feature)] === staff.id) delete state.assignments[areaId(feature)];
  }
  persist(shouldAssign ? `กำหนด ${featuresToAssign.length} ตำบลให้ ${staff.name} แล้ว` : `ยกเลิกพื้นที่ของ ${staff.name} แล้ว`);
}

function toggleFeatureFromMap(feature) {
  if (!ensureSelectedStaff()) return;
  const staff = selectedStaff();
  const owner = state.assignments[areaId(feature)];
  if (owner === staff.id) {
    setFeatureAssignment(feature, null);
    showToast(`ยกเลิก ${featureTambon(feature)} แล้ว`);
    return;
  }
  if (owner && owner !== staff.id) {
    const other = getStaff(owner);
    if (!window.confirm(`${featureTambon(feature)} อยู่กับ ${other ? other.name : "ผู้รับผิดชอบเดิม"} ต้องการย้ายพื้นที่หรือไม่?`)) return;
  }
  setFeatureAssignment(feature, staff.id);
  showToast(`กำหนด ${featureTambon(feature)} ให้ ${staff.name} แล้ว`);
}

function renderStaffSelect() {
  const selected = selectedStaffId();
  dom.staffSelect.innerHTML = '<option value="">— เลือกผู้รับผิดชอบ —</option>';
  for (const person of activeStaff()) {
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = person.name;
    dom.staffSelect.append(option);
  }
  dom.staffSelect.value = activeStaff().some((person) => person.id === selected) ? selected : "";
  const person = selectedStaff();
  dom.colorSwatch.style.background = person ? person.color : "repeating-conic-gradient(#d3dde3 0 25%, #fff 0 50%) 50% / 10px 10px";
  dom.staffHelp.textContent = person
    ? `สีของ ${person.name} จะไม่ซ้ำกับผู้รับผิดชอบรายอื่น`
    : activeStaff().length ? "เลือกผู้รับผิดชอบที่ปฏิบัติงานอยู่เพื่อกำหนดพื้นที่" : "เพิ่มรายชื่อก่อน แล้วระบบจะคละสีที่ต่างกันชัดเจนให้";
}

function renderDistrictList() {
  const staff = selectedStaff();
  const fragment = document.createDocumentFragment();
  const indeterminateInputs = [];
  for (const district of districtEntries()) {
    const districtFeatures = availableFeatures().filter((feature) => featureDistrict(feature) === district);
    const assigned = staff ? districtFeatures.filter((feature) => state.assignments[areaId(feature)] === staff.id).length : 0;
    const label = document.createElement("label");
    label.className = "district-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(staff && assigned === districtFeatures.length);
    input.disabled = !staff;
    input.dataset.district = district;
    if (staff && assigned > 0 && assigned < districtFeatures.length) indeterminateInputs.push(input);
    input.addEventListener("change", () => assignFeatures(districtFeatures, input.checked));
    const text = document.createElement("span");
    text.className = "district-label";
    text.textContent = district;
    const count = document.createElement("span");
    count.className = "count-tag";
    count.textContent = `${districtFeatures.length} ตำบล`;
    label.append(input, text, count);
    fragment.append(label);
  }
  dom.districtList.replaceChildren(fragment);
  for (const input of indeterminateInputs) input.indeterminate = true;
}

function renderTambonList() {
  const query = dom.tambonSearch.value.trim().toLocaleLowerCase("th");
  const staff = selectedStaff();
  const matches = availableFeatures()
    .filter((feature) => `${featureTambon(feature)} ${featureDistrict(feature)}`.toLocaleLowerCase("th").includes(query))
    .sort((a, b) => `${featureDistrict(a)} ${featureTambon(a)}`.localeCompare(`${featureDistrict(b)} ${featureTambon(b)}`, "th"))
    .slice(0, query ? 80 : 25);
  if (!matches.length) {
    dom.tambonList.innerHTML = '<p class="empty-result">ไม่พบตำบลที่ค้นหา</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const feature of matches) {
    const label = document.createElement("label");
    label.className = "tambon-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(staff && state.assignments[areaId(feature)] === staff.id);
    input.disabled = !staff;
    input.addEventListener("change", () => assignFeatures([feature], input.checked));
    const text = document.createElement("span");
    text.textContent = featureTambon(feature);
    const district = document.createElement("small");
    district.textContent = featureDistrict(feature);
    label.append(input, text, district);
    fragment.append(label);
  }
  dom.tambonList.replaceChildren(fragment);
}

function renderLegend() {
  if (!state.staff.length) {
    dom.legend.innerHTML = '<p class="empty-result">ยังไม่มีผู้รับผิดชอบ</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const person of state.staff) {
    const count = assignedAreasFor(person.id).length;
    const item = document.createElement("div");
    item.className = "legend-item";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = person.color;
    const name = document.createElement("strong");
    name.textContent = `${person.name}${person.active ? "" : " (ปิดใช้งาน)"}`;
    const countText = document.createElement("span");
    countText.className = "legend-count";
    countText.textContent = `${count} ตำบล`;
    item.append(dot, name, countText);
    fragment.append(item);
  }
  dom.legend.replaceChildren(fragment);
}

function renderSummary() {
  const total = availableFeatures().length;
  const assigned = assignmentCount();
  const pills = [
    `${state.staff.length} ผู้รับผิดชอบ`,
    `มอบหมายแล้ว ${assigned}/${total} ตำบล`,
    `เขตศาลจังหวัดลพบุรี`,
  ];
  dom.summary.replaceChildren(...pills.map((text) => {
    const pill = document.createElement("span");
    pill.className = "summary-pill";
    pill.textContent = text;
    return pill;
  }));
  dom.updatedAt.textContent = state.updatedAt
    ? `ปรับปรุง: ${new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.updatedAt))}`
    : "ยังไม่มีการบันทึก";
}

function renderValidation() {
  const validStaffIds = new Set(state.staff.map((person) => person.id));
  const unknownAssignments = Object.entries(state.assignments).filter(([, staffId]) => !validStaffIds.has(staffId));
  const colors = state.staff.map((person) => person.color.toLowerCase());
  const duplicateColors = colors.length - new Set(colors).size;
  const closePairs = [];
  for (let index = 0; index < state.staff.length; index += 1) {
    for (let next = index + 1; next < state.staff.length; next += 1) {
      if (colorDistance(state.staff[index].color, state.staff[next].color) < 66) {
        closePairs.push(`${state.staff[index].name} / ${state.staff[next].name}`);
      }
    }
  }
  const missing = availableFeatures().length - assignmentCount();
  const items = [
    { className: duplicateColors ? "error" : "ok", text: duplicateColors ? `พบสีซ้ำ ${duplicateColors} รายการ` : "สีไม่ซ้ำกัน" },
    { className: closePairs.length ? "warn" : "ok", text: closePairs.length ? `สีใกล้กัน: ${closePairs.join(", ")}` : "สีต่างกันชัดเจน" },
    { className: unknownAssignments.length ? "error" : "ok", text: unknownAssignments.length ? `พบการมอบหมายที่ไม่พบชื่อ ${unknownAssignments.length} รายการ` : "ไม่พบพื้นที่ซ้ำ — ตำบลหนึ่งมีผู้รับผิดชอบได้หนึ่งคน" },
    { className: missing ? "warn" : "ok", text: missing ? `ยังไม่มอบหมาย ${missing} ตำบล` : "มอบหมายครบทุกตำบลในขอบเขต" },
  ];
  dom.validationList.replaceChildren(...items.map((item) => {
    const row = document.createElement("li");
    row.className = item.className;
    row.textContent = item.text;
    return row;
  }));
}

function mapData() {
  const sourceFeatures = features
    .filter(isMainDistrict)
    .map((feature) => {
      const id = areaId(feature);
      const owner = getStaff(state.assignments[id]);
      return {
        ...feature,
        id,
        properties: {
          ...feature.properties,
          id,
          color: owner ? owner.color : "#dce6ea",
          height: owner ? 1250 : 340,
          assigned: Boolean(owner),
        },
      };
    });
  return { type: "FeatureCollection", features: sourceFeatures };
}

function createMap(container) {
  const config = { center: [100.68, 14.83], zoom: 8.9, pitch: 47, bearing: -13 };
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: "background", type: "background", paint: { "background-color": "#edf4f5" } }],
    },
    ...config,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.on("load", () => {
    map.addSource("tambons", { type: "geojson", data: mapData(), promoteId: "id" });
    map.addLayer({
      id: "tambon-ground",
      type: "fill",
      source: "tambons",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.74 },
    });
    map.addLayer({
      id: "tambon-3d",
      type: "fill-extrusion",
      source: "tambons",
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.82,
      },
    });
    map.addLayer({
      id: "tambon-outline",
      type: "line",
      source: "tambons",
      paint: { "line-color": "#ffffff", "line-width": 1.1, "line-opacity": 0.96 },
    });
    map.on("mouseenter", "tambon-3d", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "tambon-3d", () => { map.getCanvas().style.cursor = ""; });
    map.on("click", "tambon-3d", (event) => {
      const clicked = event.features && event.features[0];
      if (!clicked) return;
      const original = features.find((feature) => areaId(feature) === String(clicked.properties.id));
      if (!original) return;
      toggleFeatureFromMap(original);
    });
    map.on("moveend", () => renderMapLabels(map));
  });
  return map;
}

function updateMapSource(map) {
  if (!map || !map.isStyleLoaded() || !map.getSource("tambons")) return;
  map.getSource("tambons").setData(mapData());
  renderMapLabels(map);
}

function labelPosition(feature) {
  const bounds = new maplibregl.LngLatBounds();
  extendBounds(bounds, feature.geometry.coordinates);
  const center = bounds.getCenter();
  return [center.lng, center.lat];
}

function clearMapLabels(mapKey = "main") {
  for (const marker of labelMarkers[mapKey] || []) marker.remove();
  labelMarkers[mapKey] = [];
}

function labelsOverlap(first, second) {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
}

function renderMapLabels(map) {
  clearMapLabels();
  if (!map || !map.isStyleLoaded() || !state.showLabels || map.getZoom() < 9.4) return;

  const occupied = [];
  const visible = availableFeatures()
    .map((feature) => {
      const coordinate = labelPosition(feature);
      return { feature, coordinate, point: map.project(coordinate) };
    })
    .filter(({ coordinate }) => map.getBounds().contains(coordinate))
    .sort((first, second) => {
      const firstAssigned = Boolean(getStaff(state.assignments[areaId(first.feature)]));
      const secondAssigned = Boolean(getStaff(state.assignments[areaId(second.feature)]));
      return Number(secondAssigned) - Number(firstAssigned);
    });

  for (const { feature, coordinate, point } of visible) {
    const name = featureTambon(feature);
    const width = Math.max(34, name.length * 7.8);
    const box = { left: point.x - width / 2, right: point.x + width / 2, top: point.y - 10, bottom: point.y + 10 };
    if (occupied.some((other) => labelsOverlap(box, other))) continue;
    occupied.push(box);
    const element = document.createElement("span");
    element.className = "map-tambon-label";
    element.textContent = name;
    const marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat(coordinate).addTo(map);
    labelMarkers.main.push(marker);
  }
}

function fitMapsToData() {
  if (!maps.main || !availableFeatures().length) return;
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of availableFeatures()) extendBounds(bounds, feature.geometry.coordinates);
  maps.main.fitBounds(bounds, { padding: 46, duration: 0, maxZoom: 10.2 });
}

function extendBounds(bounds, coordinates) {
  if (typeof coordinates[0] === "number") {
    bounds.extend(coordinates);
    return;
  }
  for (const coordinate of coordinates) extendBounds(bounds, coordinate);
}

function renderMaps() {
  updateMapSource(maps.main);
  dom.labelsButton.setAttribute("aria-pressed", String(state.showLabels));
  dom.labelsButton.textContent = state.showLabels ? "ซ่อนชื่อตำบล" : "แสดงชื่อตำบล";
}

function renderAll() {
  renderSharedStatus();
  if (!features.length) return;
  renderStaffSelect();
  renderStaffManagement();
  renderReportStaffSelect();
  renderReportSummary();
  renderDistrictList();
  renderTambonList();
  renderLegend();
  renderSummary();
  renderValidation();
  renderMaps();
}

async function loadBoundaries() {
  const params = new URLSearchParams({
    where: "ADMIN_ID1 = '16'",
    outFields: "ADMIN_ID1,ADMIN_ID2,ADMIN_ID3,NAME1,NAME2,NAME3",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });
  const response = await fetch(`${GIS_QUERY_URL}?${params.toString()}`);
  if (!response.ok) throw new Error(`GIS service returned ${response.status}`);
  const collection = await response.json();
  if (!Array.isArray(collection.features) || !collection.features.length) throw new Error("ไม่พบขอบเขตตำบลของจังหวัดลพบุรี");
  features = collection.features
    .filter((feature) => feature.properties?.ADMIN_ID3 && feature.properties?.NAME2 && feature.properties?.NAME3)
    .map((feature) => ({ ...feature, id: areaId(feature) }));
  removeAreasOutsideLopburiCourt();
}

function downloadBlob(blob, filename) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

function reportDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function workloadFor(person) {
  const areas = assignedAreasFor(person.id);
  return {
    person,
    areas,
    districts: Array.from(new Set(areas.map(featureDistrict))).sort((first, second) => first.localeCompare(second, "th")),
  };
}

function unassignedAreas() {
  return availableFeatures().filter((feature) => !getStaff(state.assignments[areaId(feature)]));
}

function reportRowsFor(person) {
  return assignedAreasFor(person.id)
    .sort((first, second) => `${featureDistrict(first)} ${featureTambon(first)}`.localeCompare(`${featureDistrict(second)} ${featureTambon(second)}`, "th"))
    .map((feature, index) => ({
      "ลำดับ": index + 1,
      "ผู้รับผิดชอบ": person.name,
      "สถานะเจ้าหน้าที่": person.active ? "ปฏิบัติงาน" : "ปิดใช้งาน",
      "อำเภอ": featureDistrict(feature),
      "ตำบล": featureTambon(feature),
    }));
}

function unassignedReportRows() {
  return unassignedAreas()
    .sort((first, second) => `${featureDistrict(first)} ${featureTambon(first)}`.localeCompare(`${featureDistrict(second)} ${featureTambon(second)}`, "th"))
    .map((feature, index) => ({ "ลำดับ": index + 1, "อำเภอ": featureDistrict(feature), "ตำบล": featureTambon(feature), "สถานะ": "ยังไม่มอบหมาย" }));
}

function workbookSheet(workbook, name, rows, usedNames) {
  let sheetName = name.replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 28) || "รายงาน";
  let suffix = 2;
  while (usedNames.has(sheetName)) {
    sheetName = `${name.slice(0, 24)} ${suffix}`.slice(0, 31);
    suffix += 1;
  }
  usedNames.add(sheetName);
  const content = rows.length ? rows : [{ "หมายเหตุ": "ไม่มีข้อมูล" }];
  const sheet = window.XLSX.utils.json_to_sheet(content);
  sheet["!cols"] = Object.keys(content[0]).map((key) => ({ wch: Math.min(42, Math.max(12, key.length + 8)) }));
  window.XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
}

function exportExcelReport() {
  if (!window.XLSX) {
    showToast("ยังโหลดเครื่องมือ Excel ไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่");
    return;
  }
  const selectedId = dom.reportStaffSelect.value;
  const selected = selectedId ? getStaff(selectedId) : null;
  if (selectedId && !selected) return showToast("ไม่พบเจ้าหน้าที่ที่เลือกรายงาน");

  const workbook = window.XLSX.utils.book_new();
  const usedNames = new Set();
  const workloads = (selected ? [selected] : state.staff).map(workloadFor);
  const summary = workloads.map((item, index) => ({
    "ลำดับ": index + 1,
    "ผู้รับผิดชอบ": item.person.name,
    "สถานะ": item.person.active ? "ปฏิบัติงาน" : "ปิดใช้งาน",
    "จำนวนตำบล": item.areas.length,
    "จำนวนอำเภอ": item.districts.length,
    "อำเภอที่รับผิดชอบ": item.districts.join(", "),
  }));
  workbookSheet(workbook, "สรุปภาระงาน", summary, usedNames);

  if (selected) {
    workbookSheet(workbook, `พื้นที่ ${selected.name}`, reportRowsFor(selected), usedNames);
  } else {
    const details = state.staff.flatMap((person) => reportRowsFor(person));
    workbookSheet(workbook, "รายการพื้นที่ทั้งหมด", details, usedNames);
    for (const person of state.staff) workbookSheet(workbook, person.name, reportRowsFor(person), usedNames);
  }
  workbookSheet(workbook, "ยังไม่มอบหมาย", unassignedReportRows(), usedNames);
  const filename = selected
    ? `รายงานเขต-${selected.name}-${reportDateStamp()}.xlsx`
    : `รายงานเขตงานส่งหมาย-${reportDateStamp()}.xlsx`;
  window.XLSX.writeFile(workbook, filename);
  showToast("ดาวน์โหลดรายงาน Excel แล้ว");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function printStaffPdf() {
  const person = getStaff(dom.reportStaffSelect.value);
  if (!person) {
    showToast("เลือกเจ้าหน้าที่ก่อนพิมพ์หรือบันทึก PDF รายคน");
    return;
  }
  const workload = workloadFor(person);
  const byDistrict = new Map();
  for (const feature of workload.areas) {
    const district = featureDistrict(feature);
    if (!byDistrict.has(district)) byDistrict.set(district, []);
    byDistrict.get(district).push(featureTambon(feature));
  }
  const groups = [...byDistrict.entries()]
    .sort(([first], [second]) => first.localeCompare(second, "th"))
    .map(([district, tambons]) => `<section><h3>อำเภอ${escapeHtml(district)} (${tambons.length} ตำบล)</h3><p>${tambons.sort((first, second) => first.localeCompare(second, "th")).map(escapeHtml).join(" · ") || "—"}</p></section>`)
    .join("") || "<p>ยังไม่มีพื้นที่รับผิดชอบ</p>";
  const printedAt = new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeStyle: "short" }).format(new Date());
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    showToast("เบราว์เซอร์ปิดหน้าต่างรายงานไว้ กรุณาอนุญาตป๊อปอัปแล้วลองใหม่");
    return;
  }
  reportWindow.opener = null;
  reportWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>รายงานเขต ${escapeHtml(person.name)}</title><style>
    @page { size: A4; margin: 16mm; } body { font-family: "Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif; color:#172b3a; line-height:1.55; } h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:0 0 14px;color:#315269} h3{font-size:14px;margin:15px 0 5px;padding-top:10px;border-top:1px solid #dbe5ea} p{margin:0} .meta{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tag{padding:5px 9px;border-radius:999px;background:#edf4f7;color:#315269;font-size:12px}.foot{margin-top:22px;color:#647785;font-size:11px}
  </style></head><body><h1>รายงานเขตรับผิดชอบงานส่งหมาย</h1><h2>ศาลจังหวัดลพบุรี</h2><p><strong>ผู้รับผิดชอบ:</strong> ${escapeHtml(person.name)} (${person.active ? "ปฏิบัติงาน" : "ปิดใช้งาน"})</p><div class="meta"><span class="tag">${workload.areas.length} ตำบล</span><span class="tag">${workload.districts.length} อำเภอ</span></div>${groups}<p class="foot">จัดทำเมื่อ ${escapeHtml(printedAt)}</p></body></html>`);
  reportWindow.document.close();
  reportWindow.onload = () => reportWindow.print();
}

function renderReportStaffSelect() {
  const selected = dom.reportStaffSelect.value;
  dom.reportStaffSelect.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "— รายงานทั้งหมด —";
  dom.reportStaffSelect.append(all);
  for (const person of state.staff) {
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = `${person.name}${person.active ? "" : " (ปิดใช้งาน)"}`;
    dom.reportStaffSelect.append(option);
  }
  dom.reportStaffSelect.value = state.staff.some((person) => person.id === selected) ? selected : "";
}

function renderReportSummary() {
  const fragment = document.createDocumentFragment();
  const unassigned = unassignedAreas().length;
  const unassignedItem = document.createElement("div");
  unassignedItem.className = "report-item report-unassigned";
  const unassignedName = document.createElement("strong");
  unassignedName.textContent = "พื้นที่ยังไม่มอบหมาย";
  const unassignedCount = document.createElement("span");
  unassignedCount.textContent = `${unassigned} ตำบล`;
  unassignedItem.append(unassignedName, unassignedCount);
  fragment.append(unassignedItem);

  for (const person of state.staff) {
    const workload = workloadFor(person);
    const item = document.createElement("div");
    item.className = "report-item";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = person.color;
    const name = document.createElement("strong");
    name.textContent = `${person.name}${person.active ? "" : " (ปิดใช้งาน)"}`;
    const count = document.createElement("span");
    count.textContent = `${workload.areas.length} ตำบล · ${workload.districts.length} อำเภอ`;
    item.append(dot, name, count);
    fragment.append(item);
  }
  dom.reportSummary.replaceChildren(fragment);
}

async function exportPng() {
  if (!window.html2canvas) {
    showToast("ไม่พบเครื่องมือส่งออก PNG กรุณารีเฟรชหน้าเว็บ");
    return;
  }
  const original = dom.exportButton.textContent;
  dom.exportButton.disabled = true;
  dom.exportButton.textContent = "กำลังสร้าง PNG…";
  try {
    maps.main.resize();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const canvas = await window.html2canvas(dom.printable, {
      backgroundColor: "#ffffff",
      scale: 2.25,
      useCORS: true,
      logging: false,
      windowWidth: dom.printable.scrollWidth,
      windowHeight: dom.printable.scrollHeight,
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("สร้างไฟล์ PNG ไม่สำเร็จ");
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `lopburi-notice-areas-${date}.png`);
    showToast("ดาวน์โหลด PNG แล้ว");
  } catch (error) {
    console.error(error);
    showToast("ส่งออก PNG ไม่สำเร็จ โปรดลองใหม่อีกครั้ง");
  } finally {
    dom.exportButton.disabled = false;
    dom.exportButton.textContent = original;
  }
}

function backupState() {
  const backup = { ...serializableState(), exportedAt: new Date().toISOString(), note: "Lopburi Notice Area Manager backup" };
  downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), `lopburi-notice-areas-backup-${new Date().toISOString().slice(0, 10)}.json`);
  showToast("ดาวน์โหลดไฟล์สำรองแล้ว");
}

async function restoreState(file) {
  if (!file) return;
  try {
    const restored = JSON.parse(await file.text());
    if (!Array.isArray(restored.staff) || typeof restored.assignments !== "object") throw new Error("รูปแบบไฟล์ไม่ถูกต้อง");
    if (!window.confirm("ต้องการแทนที่ข้อมูลการมอบหมายปัจจุบันด้วยไฟล์สำรองหรือไม่?")) return;
    state = normalizeState(restored);
    state.updatedAt = new Date().toISOString();
    state.pendingChanges = true;
    saveLocalState();
    renderAll();
    showToast("กู้คืนข้อมูลสำเร็จ กรุณาบันทึกส่วนกลางเพื่อใช้ทุกเครื่อง");
  } catch (error) {
    console.error(error);
    showToast("ไม่สามารถอ่านไฟล์สำรองนี้ได้");
  } finally {
    dom.restoreInput.value = "";
  }
}

async function importStaff(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const names = text
      .split(/\r?\n/)
      .map((line) => line.split(/[,\t;]/)[0].trim().replace(/^"|"$/g, ""))
      .filter((name) => name && !/^ชื่อ|^name$/i.test(name));
    const existing = new Set(state.staff.map((person) => person.name));
    let added = 0;
    for (const name of names) {
      if (existing.has(name)) continue;
      state.staff.push({
        id: `staff-${Date.now()}-${added}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        color: nextDistinctColor(state.staff.map((person) => person.color)),
        active: true,
      });
      existing.add(name);
      added += 1;
    }
    persist(added ? `นำเข้ารายชื่อ ${added} รายการแล้ว` : "ไม่พบรายชื่อใหม่ที่ต้องนำเข้า");
  } catch (error) {
    console.error(error);
    showToast("นำเข้ารายชื่อไม่สำเร็จ");
  } finally {
    dom.staffImportInput.value = "";
  }
}

function bindEvents() {
  dom.addStaffButton.addEventListener("click", () => {
    addStaff(dom.newStaffName.value);
    dom.newStaffName.value = "";
  });
  dom.newStaffName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      dom.addStaffButton.click();
    }
  });
  dom.staffSelect.addEventListener("change", renderAll);
  dom.newColorButton.addEventListener("click", reassignSelectedColor);
  dom.tambonSearch.addEventListener("input", renderTambonList);
  dom.validateButton.addEventListener("click", () => {
    renderValidation();
    showToast("ตรวจสอบข้อมูลล่าสุดแล้ว");
  });
  dom.labelsButton.addEventListener("click", () => {
    state.showLabels = !state.showLabels;
    persist();
    if (state.showLabels && maps.main?.getZoom() < 9.4) showToast("ซูมแผนที่เข้าเล็กน้อยเพื่อดูชื่อตำบลเป็นคำชัดเจน");
  });
  dom.exportButton.addEventListener("click", exportPng);
  dom.backupButton.addEventListener("click", backupState);
  dom.excelReportButton.addEventListener("click", exportExcelReport);
  dom.pdfReportButton.addEventListener("click", printStaffPdf);
  dom.reportStaffSelect.addEventListener("change", renderReportSummary);
  dom.checkTokenButton.addEventListener("click", async () => {
    const checked = await verifyGitHubToken();
    showToast(checked.valid ? "ตรวจสอบรหัสแล้ว" : checked.reason);
  });
  dom.saveSharedButton.addEventListener("click", saveSharedState);
  dom.reloadSharedButton.addEventListener("click", reloadSharedState);
  dom.githubToken.addEventListener("input", clearTokenCheck);
  dom.restoreInput.addEventListener("change", (event) => restoreState(event.target.files[0]));
  dom.staffImportInput.addEventListener("change", (event) => importStaff(event.target.files[0]));
}

async function init() {
  bindEvents();
  try {
    await loadBoundaries();
    await loadSharedState();
    maps.main = createMap("main-map");
    maps.main.once("load", () => {
      fitMapsToData();
      renderMaps();
    });
    renderAll();
  } catch (error) {
    console.error(error);
    dom.districtList.innerHTML = '<p class="empty-result">ไม่สามารถโหลดขอบเขตแผนที่ได้</p>';
    dom.tambonList.innerHTML = '<p class="empty-result">ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วรีเฟรชหน้าเว็บ</p>';
    showToast("โหลดขอบเขตตำบลไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต");
  } finally {
    dom.loading.hidden = true;
  }
}

init();
