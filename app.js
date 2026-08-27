/**
 * app.js — หน้าตั้งค่าระบบ (index.html)
 *
 * โครงสร้าง
 *   1. สถานะและตัวช่วย
 *   2. รหัสบันทึก GitHub (เก็บชั่วคราวในแท็บ ไม่ค้างในเครื่อง)
 *   3. บันทึกส่วนกลางเป็น commit เดียวผ่าน Git Trees API
 *   4. การมอบหมายพื้นที่ ยอด และรายชื่อ
 *   5. การวาดหน้าจอ
 *   6. รายงาน ส่งออก และการเชื่อมกับ map-engine
 *
 * [ต่อยอด] จุดเชื่อมสำคัญ
 *   • engine.*      — ทุกอย่างที่เกี่ยวกับแผนที่อยู่ใน map-engine.js
 *   • loadVendor()  — โหลดไลบรารีหนักเมื่อกดใช้งานเท่านั้น
 *   • saveShared()  — จุดเดียวที่เขียนข้อมูลขึ้น GitHub
 */
"use strict";

const Core = window.MapLibreCore;
const Boundaries = window.MapLibreBoundaries;

const REPO_OWNER = "checkfile2568-ops";
const REPO_NAME = "MapLibre";
const SHARED_BRANCH = "main";
const SHARED_DATA_PATH = "data/assignments.json";
const NOTICE_SHEET_PATH = "data/notice-area-sheet.csv";
const API_ROOT = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
const TOKEN_KEY = `${Core.STORAGE_KEY}:github-token`;
const TOKEN_META_KEY = `${Core.STORAGE_KEY}:github-token-metadata`;
const LEGACY_TOKEN_KEYS = [TOKEN_KEY, TOKEN_META_KEY];

const PALETTE = ["#1377b5", "#ca5d35", "#2c9a6d", "#7757b5", "#c04662", "#27858f", "#ae791a", "#4772af", "#a04d9a", "#537c3c", "#9c623f", "#27725a"];

const dom = Object.fromEntries([
  "loading", "theme-toggle", "staff-select", "new-staff-name", "add-staff-button", "staff-import-input", "color-swatch", "staff-help", "new-color-button",
  "toggle-staff-management", "staff-management-content", "staff-management-list", "district-list", "tambon-search", "tambon-list",
  "area-selection-count", "unassigned-summary", "price-search", "price-list", "price-paste", "price-import-button", "price-csv-input",
  "price-import-status", "price-progress", "price-labels-button", "publish-prices", "validation-list", "validate-button",
  "assignment-summary", "maps-layout", "legend-rail", "legend", "province-overview-button", "tambon-view-button", "three-d-button",
  "toggle-legend-button", "labels-button", "district-labels-button", "export-button", "print-map-button", "print-tambon-labels",
  "print-district-labels", "print-price-labels", "backup-button", "restore-input", "report-staff-select", "excel-report-button",
  "pdf-report-button", "report-summary", "save-shared-button", "reload-shared-button", "check-token-button", "github-token",
  "remember-github-token", "remembered-token-status", "forget-github-token-button", "shared-status", "token-status", "updated-at",
  "boundary-source", "toast", "printable", "main-map",
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

let features = [];
let villageCounts = {};
let state = loadLocalState();
let baseline = Core.serializableState(state);
let engine = null;
let shared = { available: false, loading: false, error: null };
let tokenCheck = { checking: false, valid: false, login: null, expiresAt: null };
let toastTimer = null;
let staffManagementOpen = false;
let bypassLeaveGuard = false;
const vendorCache = new Map();

/* ============================================================ 1. ตัวช่วย */

function showToast(message) {
  if (!dom.toast || !message) return;
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 3400);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function button(text, className, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
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
    console.warn("บันทึกข้อมูลในเครื่องไม่สำเร็จ", error);
    showToast("เบราว์เซอร์นี้บันทึกข้อมูลในเครื่องไม่ได้ กรุณากดบันทึกส่วนกลางบ่อยขึ้น");
    return false;
  }
}

function serializableState() {
  return Core.serializableState(state);
}

/** โหลดไลบรารีขนาดใหญ่เมื่อผู้ใช้กดใช้งานจริงเท่านั้น (ผลตรวจ ตร-09) */
function loadVendor(name, src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (vendorCache.has(name)) return vendorCache.get(name);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${src}?v=${Core.APP_VERSION}`;
    script.async = true;
    script.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error(`โหลด ${name} ไม่สำเร็จ`)));
    script.onerror = () => reject(new Error(`โหลด ${name} ไม่สำเร็จ`));
    document.head.append(script);
  });
  vendorCache.set(name, promise);
  return promise;
}

const loadSheetJs = () => loadVendor("SheetJS", "vendor/xlsx.full.min.js", "XLSX");
const loadHtml2Canvas = () => loadVendor("html2canvas", "vendor/html2canvas.min.js", "html2canvas");

function selectedStaffId() { return dom.staff_select?.value || ""; }
function getStaff(id) { return state.staff.find((person) => person.id === id) || null; }
function selectedStaff() { const person = getStaff(selectedStaffId()); return person?.active ? person : null; }
function activeStaff() { return state.staff.filter((person) => person.active); }
function availableFeatures() { return features; }
function featureAmount(feature) { const value = state.prices[Core.areaId(feature)]; return Number.isFinite(value) ? value : null; }
function assignedAreasFor(staffId) { return features.filter((feature) => state.assignments[Core.areaId(feature)] === staffId); }
function unassignedAreas() { return features.filter((feature) => !getStaff(state.assignments[Core.areaId(feature)])); }
function assignmentCount() { return features.filter((feature) => getStaff(state.assignments[Core.areaId(feature)])).length; }
function pricedCount() { return features.filter((feature) => featureAmount(feature) !== null).length; }

function ensureSelectedStaff() {
  if (selectedStaff()) return true;
  showToast("กรุณาเลือกผู้รับผิดชอบก่อนกำหนดพื้นที่");
  return false;
}

function filterStateToCourt() {
  const filtered = Core.filterStateToFeatures(state, features);
  const removed =
    Object.keys(state.assignments).length - Object.keys(filtered.assignments).length +
    Object.keys(state.prices).length - Object.keys(filtered.prices).length;
  state = { ...filtered, pendingChanges: state.pendingChanges || removed > 0 };
  return removed;
}

function persist(message, { fullRender = true } = {}) {
  state.updatedAt = new Date().toISOString();
  state.pendingChanges = true;
  saveLocalState();
  if (fullRender) renderAll();
  else renderLightweight();
  showToast(message);
}

function persistAmountChange(message = "") {
  state.updatedAt = new Date().toISOString();
  state.pendingChanges = true;
  saveLocalState();
  renderSharedStatus();
  renderPriceProgress();
  renderSummary();
  renderValidation();
  syncMap();
  showToast(message);
}

function csvField(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function noticeAreaSheetCsv() {
  const rows = features
    .slice()
    .sort((left, right) => `${Core.districtName(left)} ${Core.tambonName(left)}`.localeCompare(`${Core.districtName(right)} ${Core.tambonName(right)}`, "th"))
    .map((feature) => {
      const person = getStaff(state.assignments[Core.areaId(feature)]);
      return [`อำเภอ${Core.districtName(feature)} / ตำบล${Core.tambonName(feature)}`, person?.name || "ยังไม่มอบหมาย"];
    });
  return `﻿${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

/* ================================================ 2. รหัสบันทึก GitHub */

function githubHeaders(token) {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
}

async function readGitHubError(response) {
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, message: typeof payload.message === "string" ? payload.message : "" };
}

function explainGitHubError({ status, message }) {
  const detail = String(message).toLowerCase();
  if (status === 401) return "รหัสใช้ไม่ได้ ถูกยกเลิก หรือหมดอายุแล้ว";
  if (status === 403 && /rate limit/.test(detail)) return "GitHub จำกัดจำนวนการใช้งานชั่วคราว กรุณารอสักครู่แล้วลองใหม่";
  if (status === 403) return "รหัสไม่มีสิทธิ์แก้ไข MapLibre ให้ตั้ง Contents เป็น Read and write";
  if (status === 404) return "ไม่พบไฟล์หรือ Repository ตรวจว่ารหัสมีสิทธิ์เข้าถึง MapLibre";
  if (status === 409 || status === 422) return "ข้อมูลกลางถูกแก้ไขจากเครื่องอื่น กรุณากดโหลดค่ากลางใหม่ก่อนบันทึก";
  return message || `บันทึกไม่สำเร็จ (${status})`;
}

function setTokenStatus(message, status = "") {
  if (!dom.token_status) return;
  dom.token_status.textContent = message;
  dom.token_status.className = `token-status ${status}`.trim();
}

/**
 * รหัสถูกเก็บใน sessionStorage — อยู่เฉพาะแท็บนี้และหายเมื่อปิดเบราว์เซอร์
 * (ผลตรวจ ตร-03 เดิมเก็บใน localStorage แบบถาวร)
 */
function rememberedToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function tokenMetadata() {
  try { return JSON.parse(sessionStorage.getItem(TOKEN_META_KEY)) || null; } catch { return null; }
}

function rememberToken(token, metadata) {
  if (!dom.remember_github_token?.checked || !token) return;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(TOKEN_META_KEY, JSON.stringify({ ...metadata, checkedAt: new Date().toISOString() }));
    renderRememberedTokenStatus({ ...metadata });
  } catch {
    dom.remembered_token_status.textContent = "เบราว์เซอร์นี้ไม่อนุญาตให้จำรหัส";
    dom.remembered_token_status.className = "remembered-token-status warning";
  }
}

function forgetToken({ clearInput = true } = {}) {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_META_KEY);
  } catch { /* no-op */ }
  if (clearInput && dom.github_token) dom.github_token.value = "";
  if (dom.remember_github_token) dom.remember_github_token.checked = false;
  renderRememberedTokenStatus(null);
}

/** ล้างรหัสที่ระบบรุ่นก่อนเคยฝากไว้ถาวรใน localStorage */
function clearLegacyStoredToken() {
  let found = false;
  for (const key of LEGACY_TOKEN_KEYS) {
    try {
      if (localStorage.getItem(key) !== null) { localStorage.removeItem(key); found = true; }
    } catch { /* no-op */ }
  }
  if (found) setTokenStatus("ลบรหัสที่ระบบรุ่นก่อนเก็บค้างไว้ในเครื่องแล้ว เพื่อความปลอดภัย", "warning");
}

function renderRememberedTokenStatus(meta = tokenMetadata()) {
  if (!dom.remembered_token_status) return;
  const token = rememberedToken();
  dom.forget_github_token_button.hidden = !token;
  if (!token) {
    dom.remembered_token_status.textContent = "ยังไม่ได้จำรหัสไว้";
    dom.remembered_token_status.className = "remembered-token-status";
    return;
  }
  if (!meta?.expiresAt) {
    dom.remembered_token_status.textContent = "จำรหัสไว้ในแท็บนี้แล้ว GitHub ไม่ได้แจ้งวันหมดอายุ";
    dom.remembered_token_status.className = "remembered-token-status warning";
    return;
  }
  const days = Math.round((new Date(meta.expiresAt).getTime() - Date.now()) / 86400000);
  const dateText = Core.formatThaiDate(meta.expiresAt);
  dom.remembered_token_status.textContent = days < 0
    ? `รหัสหมดอายุแล้วเมื่อ ${dateText}`
    : `รหัส ${meta.login || ""} หมดอายุ ${dateText} (อีกประมาณ ${days} วัน)`;
  dom.remembered_token_status.className = `remembered-token-status ${days < 0 ? "error" : days <= 7 ? "warning" : "ok"}`;
}

function loadRememberedToken() {
  clearLegacyStoredToken();
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
    tokenCheck = { checking: false, valid: false, login: meta?.login || null, expiresAt: meta?.expiresAt || null };
  }
  renderRememberedTokenStatus(meta);
}

async function verifyGitHubToken() {
  const token = dom.github_token.value.trim();
  if (!token) {
    setTokenStatus("กรุณาวาง Fine-grained GitHub token ก่อน", "warning");
    return { valid: false, reason: "ยังไม่ได้ใส่รหัส" };
  }
  tokenCheck.checking = true;
  renderSharedStatus();
  setTokenStatus("กำลังตรวจสอบรหัส…");
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
    const dateText = expiresAt ? ` หมดอายุ ${Core.formatThaiDate(expiresAt)}` : "";
    setTokenStatus(`รหัสใช้งานได้ (${account.login})${dateText}`, "ok");
    rememberToken(token, { login: account.login, expiresAt });
    renderRememberedTokenStatus({ login: account.login, expiresAt });
    return { valid: true, token, login: account.login };
  } catch (error) {
    console.error(error);
    tokenCheck = { checking: false, valid: false, login: null, expiresAt: null };
    setTokenStatus("เชื่อมต่อ GitHub ไม่ได้ ตรวจสอบอินเทอร์เน็ต", "error");
    return { valid: false, reason: "เชื่อมต่อ GitHub ไม่ได้" };
  } finally {
    tokenCheck.checking = false;
    renderSharedStatus();
  }
}

/* ============================================ 3. บันทึกส่วนกลาง (Git API) */

function sharedDataUrl() {
  const url = new URL(SHARED_DATA_PATH, window.location.href);
  url.searchParams.set("_", Date.now().toString());
  return url;
}

function renderSharedStatus() {
  if (!dom.shared_status) return;
  let text = "ยังไม่ได้เชื่อมต่อข้อมูลส่วนกลาง";
  let className = "";
  if (shared.loading) text = "กำลังโหลดหรือบันทึกข้อมูลส่วนกลาง…";
  else if (shared.error) { text = shared.error; className = "error"; }
  else if (state.pendingChanges) { text = "มีการแก้ไขที่ยังไม่ได้บันทึกขึ้นส่วนกลาง"; className = "pending"; }
  else if (shared.available) { text = "เชื่อมต่อข้อมูลส่วนกลางแล้ว ทุกเครื่องใช้ข้อมูลชุดเดียวกัน"; className = "synced"; }
  dom.shared_status.textContent = text;
  dom.shared_status.className = `shared-status ${className}`.trim();
  dom.save_shared_button.disabled = shared.loading;
  dom.reload_shared_button.disabled = shared.loading;
  dom.check_token_button.disabled = shared.loading || tokenCheck.checking;
}

async function loadSharedState() {
  shared.loading = true;
  renderSharedStatus();
  try {
    const response = await fetch(sharedDataUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error(`โหลดข้อมูลกลางไม่สำเร็จ (${response.status})`);
    const raw = await response.json();
    const incoming = Core.normalizeState(raw);
    if (Core.hasSharedData(incoming)) {
      state = { ...incoming, pendingChanges: false };
      baseline = Core.serializableState(state);
      saveLocalState();
    }
    shared = { available: true, loading: false, error: null };
  } catch (error) {
    console.warn(error);
    shared = { available: false, loading: false, error: "ยังไม่มีข้อมูลส่วนกลาง หรือโหลดไม่สำเร็จ" };
  }
  renderSharedStatus();
}

async function reloadSharedState() {
  if (state.pendingChanges && !confirm("โหลดค่ากลางจะทับการแก้ไขที่ยังไม่ได้บันทึก ต้องการดำเนินการต่อหรือไม่?")) return;
  await loadSharedState();
  filterStateToCourt();
  renderAll();
  showToast(shared.available ? "โหลดข้อมูลส่วนกลางแล้ว" : "โหลดข้อมูลส่วนกลางไม่สำเร็จ");
}

async function githubJson(token, path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: { ...githubHeaders(token), ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(explainGitHubError(await readGitHubError(response)));
  return response.status === 204 ? null : response.json();
}

/**
 * เขียนไฟล์ทั้งหมดเป็น commit เดียว (ผลตรวจ ตร-07)
 * ถ้าขั้นตอนใดล้มเหลว จะไม่มีไฟล์ใดถูกเปลี่ยนเลย ไม่เกิดสภาพข้อมูลครึ่ง ๆ
 */
async function commitFiles(token, files, message) {
  const ref = await githubJson(token, `/git/ref/heads/${SHARED_BRANCH}`);
  const headSha = ref.object.sha;
  const headCommit = await githubJson(token, `/git/commits/${headSha}`);
  const tree = await githubJson(token, "/git/trees", {
    method: "POST",
    body: JSON.stringify({
      base_tree: headCommit.tree.sha,
      tree: files.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.content })),
    }),
  });
  const commit = await githubJson(token, "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
  });
  await githubJson(token, `/git/refs/heads/${SHARED_BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  return commit.sha;
}

function commitMessage(actor) {
  const summary = Core.describeChanges(baseline, state);
  const stamp = Core.formatThaiDate(new Date(), { withTime: true });
  const who = Core.sanitizeName(actor) || "ไม่ระบุผู้บันทึก";
  return `${summary}\n\nผู้บันทึก: ${who}\nเวลา: ${stamp}\nระบบ: เขตพื้นที่งานส่งหมาย v${Core.APP_VERSION}`;
}

async function saveShared() {
  const checked = await verifyGitHubToken();
  if (!checked.valid) { showToast(checked.reason); return false; }
  const token = dom.github_token.value.trim();
  shared.loading = true;
  renderSharedStatus();
  try {
    state.updatedAt = new Date().toISOString();
    state.updatedBy = checked.login || null;
    const message = commitMessage(checked.login);
    await commitFiles(token, [
      { path: SHARED_DATA_PATH, content: `${JSON.stringify(serializableState(), null, 2)}\n` },
      { path: NOTICE_SHEET_PATH, content: noticeAreaSheetCsv() },
    ], message);

    state.pendingChanges = false;
    baseline = Core.serializableState(state);
    saveLocalState();
    shared = { available: true, loading: false, error: null };
    renderAll();
    if (!dom.remember_github_token.checked) {
      dom.github_token.value = "";
      tokenCheck = { checking: false, valid: false, login: null, expiresAt: null };
      setTokenStatus("บันทึกสำเร็จและล้างรหัสออกจากช่องแล้ว", "ok");
    }
    showToast("บันทึกข้อมูลส่วนกลางเป็น commit เดียวเรียบร้อย");
    return true;
  } catch (error) {
    console.error(error);
    shared = { ...shared, loading: false, error: error.message };
    renderSharedStatus();
    showToast(error.message || "บันทึกข้อมูลส่วนกลางไม่สำเร็จ");
    return false;
  }
}

/* ================================================= 4. การจัดการข้อมูล */

function hexToRgb(hex) {
  const normalized = String(hex).replace("#", "");
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
  const unused = PALETTE.find((candidate) => !excluded.includes(candidate));
  if (unused) return unused;
  for (let index = 0; index < 360; index += 17) {
    const candidate = hslToHex((state.staff.length * 137.508 + index) % 360, 62, 46);
    if (excluded.every((color) => colorDistance(candidate, color) > 95)) return candidate;
  }
  return hslToHex((state.staff.length * 71) % 360, 65, 48);
}

function addStaff(rawName) {
  const name = Core.sanitizeName(rawName);
  if (!name) return showToast("กรุณากรอกชื่อผู้รับผิดชอบ");
  if (state.staff.some((person) => person.name.localeCompare(name, "th", { sensitivity: "base" }) === 0)) return showToast("มีชื่อนี้อยู่แล้ว");
  const person = {
    id: `staff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    color: nextDistinctColor(state.staff.map((item) => item.color)),
    active: true,
  };
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

function setAreaAmount(feature, rawValue, { quiet = false } = {}) {
  const id = Core.areaId(feature);
  if (!id) return false;
  const text = String(rawValue ?? "").trim();
  if (!text) delete state.prices[id];
  else {
    const amount = Core.parseAmount(text);
    if (amount === null) return false;
    state.prices[id] = amount;
  }
  if (!quiet) persistAmountChange(`ปรับยอดตำบล${Core.tambonName(feature)}แล้ว`);
  return true;
}

function importAmounts(text) {
  const parsed = Core.parsePriceLines(text, features);
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
    dom.price_import_status.className = `helper-text ${parsed.notFound.length || parsed.ambiguous.length || parsed.invalid.length ? "warning-note" : ""}`;
  }
  if (parsed.applied.length) persist(`นำเข้ายอด ${parsed.applied.length} ตำบลแล้ว`);
  else renderAll();
}

async function importAmountFile(file) {
  if (!file) return;
  try { importAmounts(await file.text()); }
  catch (error) { console.error(error); showToast("อ่านไฟล์ยอดไม่สำเร็จ"); }
  finally { dom.price_csv_input.value = ""; }
}

async function importStaffFile(file) {
  if (!file) return;
  try {
    const names = (await file.text())
      .split(/\r?\n/)
      .map((line) => Core.sanitizeName(line.split(/[,;\t]/)[0].replace(/^"|"$/g, "")))
      .filter((name) => name && !/^ชื่อ|^name$/i.test(name));
    const existing = new Set(state.staff.map((person) => person.name.toLocaleLowerCase("th")));
    let added = 0;
    for (const name of names) {
      const key = name.toLocaleLowerCase("th");
      if (existing.has(key)) continue;
      state.staff.push({
        id: `staff-${Date.now()}-${added}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        color: nextDistinctColor(state.staff.map((person) => person.color)),
        active: true,
      });
      existing.add(key);
      added += 1;
    }
    persist(added ? `นำเข้ารายชื่อ ${added} รายการแล้ว` : "ไม่พบรายชื่อใหม่");
  } catch (error) {
    console.error(error);
    showToast("นำเข้ารายชื่อไม่สำเร็จ");
  } finally {
    dom.staff_import_input.value = "";
  }
}

/* =================================================== 5. การวาดหน้าจอ */

function renderStaffSelect() {
  const current = selectedStaffId();
  dom.staff_select.innerHTML = '<option value="">— เลือกผู้รับผิดชอบ —</option>';
  for (const person of activeStaff()) dom.staff_select.add(new Option(person.name, person.id));
  dom.staff_select.value = activeStaff().some((person) => person.id === current) ? current : "";
  const person = selectedStaff();
  dom.color_swatch.style.background = person
    ? person.color
    : "repeating-conic-gradient(var(--line) 0 25%, transparent 0 50%) 50% / 10px 10px";
  dom.staff_help.textContent = person
    ? `กำลังกำหนดพื้นที่ให้ ${person.name}`
    : activeStaff().length ? "เลือกผู้รับผิดชอบเพื่อกำหนดพื้นที่" : "เพิ่มรายชื่อก่อน แล้วระบบจะคละสีให้อัตโนมัติ";
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
    const areas = assignedAreasFor(person.id)
      .sort((a, b) => `${Core.districtName(a)} ${Core.tambonName(a)}`.localeCompare(`${Core.districtName(b)} ${Core.tambonName(b)}`, "th"));
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
      button("แก้ชื่อ", "text-button", () => renameStaff(person)),
      button(person.active ? "ปิดใช้งาน" : "เปิดใช้งาน", "text-button", () => toggleStaffActive(person)),
      button("ลบ", "text-button forget-token-button", () => deleteStaff(person))
    );

    const clearRow = document.createElement("div");
    clearRow.className = "staff-card-actions";
    const clearButton = button("ยกเลิกพื้นที่ทั้งหมด", "text-button forget-token-button", () => transferAreas(person, areas, "__unassign__"));
    clearButton.disabled = !areas.length;
    clearRow.append(clearButton);

    card.append(heading, meta, actions, clearRow);
    fragment.append(card);
  }
  dom.staff_management_list.replaceChildren(fragment);
}

function districtEntries() {
  return [...new Set(features.map(Core.districtName))].sort((a, b) => a.localeCompare(b, "th"));
}

function renderDistrictList() {
  const staff = selectedStaff();
  const fragment = document.createDocumentFragment();
  const partials = [];
  for (const district of districtEntries()) {
    const districtFeatures = features.filter((feature) => Core.districtName(feature) === district);
    const assigned = staff ? districtFeatures.filter((feature) => state.assignments[Core.areaId(feature)] === staff.id).length : 0;
    const row = document.createElement("label");
    row.className = "district-option";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.disabled = !staff;
    check.checked = Boolean(staff && assigned === districtFeatures.length);
    if (assigned > 0 && assigned < districtFeatures.length) partials.push(check);
    check.addEventListener("change", () => assignFeatures(districtFeatures, check.checked));
    const name = document.createElement("span");
    name.className = "district-label";
    name.style.flex = "1";
    name.textContent = district;
    const count = document.createElement("span");
    count.className = "count-tag";
    count.textContent = `${districtFeatures.length} ตำบล`;
    row.append(check, name, count);
    fragment.append(row);
  }
  dom.district_list.replaceChildren(fragment);
  partials.forEach((input) => { input.indeterminate = true; });
}

function renderTambonList() {
  const total = features.length;
  const staff = selectedStaff();
  const query = Core.sanitizeName(dom.tambon_search.value).toLocaleLowerCase("th");
  if (dom.area_selection_count) dom.area_selection_count.textContent = `${total} ตำบล`;
  if (!staff) {
    dom.tambon_list.innerHTML = '<p class="empty-result">เลือกชื่อผู้รับผิดชอบก่อน แล้วระบบจะแสดงพื้นที่ทั้งหมดให้เลือก</p>';
    return;
  }
  const matches = features
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
    name.style.flex = "1";
    name.textContent = Core.tambonName(feature);
    const small = document.createElement("small");
    small.style.color = "var(--muted)";
    small.textContent = owner
      ? `อ.${Core.districtName(feature)} · ${owner.id === staff.id ? "รับผิดชอบอยู่" : `ผู้รับผิดชอบ: ${owner.name}`}`
      : `อ.${Core.districtName(feature)} · ยังไม่มอบหมาย`;
    row.append(check, name, small);
    fragment.append(row);
  }
  dom.tambon_list.replaceChildren(fragment);
}

function renderUnassignedSummary() {
  if (!dom.unassigned_summary) return;
  const total = features.length;
  const items = unassignedAreas()
    .sort((a, b) => `${Core.districtName(a)} ${Core.tambonName(a)}`.localeCompare(`${Core.districtName(b)} ${Core.tambonName(b)}`, "th"));
  dom.unassigned_summary.replaceChildren();
  dom.unassigned_summary.className = `unassigned-summary ${items.length ? "pending" : "complete"}`;
  const heading = document.createElement("strong");
  if (!items.length) {
    heading.textContent = `มอบหมายผู้รับผิดชอบครบ ${total} ตำบลแล้ว`;
    dom.unassigned_summary.append(heading);
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

function renderAmountList() {
  const query = Core.sanitizeName(dom.price_search.value).toLocaleLowerCase("th");
  const items = features
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
    input.value = featureAmount(feature) === null ? "" : Core.formatAmount(featureAmount(feature));

    const commit = ({ notify = false } = {}) => {
      const previous = featureAmount(feature);
      if (!setAreaAmount(feature, input.value, { quiet: true })) {
        if (notify) showToast("กรอกยอดเป็นตัวเลข 0 ขึ้นไป ทศนิยมไม่เกิน 2 ตำแหน่ง");
        input.value = previous === null ? "" : Core.formatAmount(previous);
        return false;
      }
      const current = featureAmount(feature);
      input.value = current === null ? "" : Core.formatAmount(current);
      persistAmountChange(notify ? `บันทึกยอดตำบล${Core.tambonName(feature)}แล้ว` : "");
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
      if (event.key !== "Enter") return;
      event.preventDefault();
      clearTimeout(timer);
      commit({ notify: true });
      input.blur?.();
    });

    row.append(info, input);
    fragment.append(row);
  }
  dom.price_list.replaceChildren(fragment);
  renderPriceProgress();
}

function renderPriceProgress() {
  if (dom.price_progress) dom.price_progress.textContent = `${pricedCount()}/${features.length} ตำบล`;
}

function renderLegend() {
  if (!state.staff.length) {
    dom.legend.innerHTML = '<p class="empty-result">ยังไม่มีผู้รับผิดชอบ</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const person of state.staff) {
    const areas = assignedAreasFor(person.id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `legend-item${person.active ? "" : " inactive"}`;
    row.addEventListener("click", () => {
      dom.staff_select.value = person.active ? person.id : "";
      renderAll();
      engine?.flyToAreas(areas);
    });
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = person.color;
    const name = document.createElement("span");
    name.className = "legend-person";
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
  const total = features.length;
  const assigned = assignmentCount();
  const pills = [
    ["ผู้รับผิดชอบ", state.staff.length, ""],
    ["มอบหมายแล้ว", `${assigned}/${total}`, assigned === total ? "complete" : ""],
    ["ยังไม่มอบหมาย", total - assigned, total - assigned ? "pending" : "complete"],
    ["กำหนดยอดแล้ว", `${pricedCount()}/${total}`, ""],
  ];
  dom.assignment_summary.replaceChildren(...pills.map(([label, value, tone]) => {
    const item = document.createElement("span");
    item.className = `summary-pill ${tone}`.trim();
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    const caption = document.createElement("span");
    caption.textContent = label;
    item.append(strong, caption);
    return item;
  }));
  dom.updated_at.textContent = state.updatedAt
    ? `ปรับปรุง: ${Core.formatThaiDate(state.updatedAt, { withTime: true })}${state.updatedBy ? ` · ${state.updatedBy}` : ""}`
    : "ยังไม่มีการบันทึก";
}

function renderValidation() {
  const validStaff = new Set(state.staff.map((person) => person.id));
  const unknown = Object.values(state.assignments).filter((id) => !validStaff.has(id)).length;
  const colors = state.staff.map((person) => person.color.toLowerCase());
  const closePairs = [];
  for (let i = 0; i < state.staff.length; i += 1) {
    for (let j = i + 1; j < state.staff.length; j += 1) {
      if (colorDistance(state.staff[i].color, state.staff[j].color) < 66) closePairs.push(`${state.staff[i].name}/${state.staff[j].name}`);
    }
  }
  const missingAssignments = features.length - assignmentCount();
  const missingAmounts = features.length - pricedCount();
  const items = [
    [features.length === Core.EXPECTED_COURT_TAMBONS ? "ok" : "warn",
      features.length === Core.EXPECTED_COURT_TAMBONS ? `ขอบเขตครบ ${Core.EXPECTED_COURT_TAMBONS} ตำบล` : `ขอบเขตมี ${features.length} ตำบล ควรมี ${Core.EXPECTED_COURT_TAMBONS} ตำบล`],
    [new Set(colors).size === colors.length ? "ok" : "error", new Set(colors).size === colors.length ? "สีไม่ซ้ำกัน" : "พบสีซ้ำ"],
    [closePairs.length ? "warn" : "ok", closePairs.length ? `สีใกล้กัน: ${closePairs.join(", ")}` : "สีต่างกันชัดเจน"],
    [unknown ? "error" : "ok", unknown ? `พบพื้นที่อ้างอิงเจ้าหน้าที่ที่ไม่มีชื่อ ${unknown} รายการ` : "การมอบหมายอ้างอิงรายชื่อถูกต้อง"],
    [missingAssignments ? "warn" : "ok", missingAssignments ? `ยังไม่มอบหมาย ${missingAssignments} ตำบล` : "มอบหมายครบทุกตำบล"],
    [missingAmounts ? "warn" : "ok", missingAmounts ? `ยังไม่กำหนดยอด ${missingAmounts} ตำบล` : "กำหนดยอดครบทุกตำบล"],
    [state.publishPrices ? "warn" : "ok", state.publishPrices ? "เปิดแสดงยอดในหน้าจอแสดงผล (ไฟล์ข้อมูลใน Repository สาธารณะยังเปิดอ่านได้เสมอ)" : "ปิดการแสดงยอดในหน้าจอแสดงผล"],
  ];
  dom.validation_list.replaceChildren(...items.map(([className, text]) => {
    const li = document.createElement("li");
    li.className = className;
    li.textContent = text;
    return li;
  }));
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

function renderMapControls() {
  const toggle = (element, active, label) => {
    if (!element) return;
    element.setAttribute("aria-pressed", String(active));
    element.textContent = label;
  };
  toggle(dom.labels_button, state.showLabels, "ชื่อตำบล");
  toggle(dom.district_labels_button, state.showDistrictLabels, "ชื่ออำเภอ");
  toggle(dom.price_labels_button, state.showPriceLabels, "ยอด");
  toggle(dom.toggle_legend_button, state.showLegend, "คำอธิบายสี");
  if (dom.three_d_button) {
    const on = engine?.isThreeD?.() ?? true;
    dom.three_d_button.setAttribute("aria-pressed", String(on));
    dom.three_d_button.textContent = on ? "◧ มุมมอง 3 มิติ" : "▱ มุมมองปกติ";
  }
  dom.legend_rail.hidden = !state.showLegend;
  dom.maps_layout.classList.toggle("legend-hidden", !state.showLegend);
  dom.publish_prices.checked = state.publishPrices;
}

function syncMap() {
  engine?.setPresentation({
    staffById: new Map(state.staff.map((person) => [person.id, person])),
    assignments: state.assignments,
    prices: state.prices,
    showTambonLabels: state.showLabels,
    showDistrictLabels: state.showDistrictLabels,
    showAmountLabels: state.showPriceLabels,
    filterStaffId: "",
    selectedAreaId: "",
    searchText: "",
  });
}

function renderLightweight() {
  renderSharedStatus();
  renderPriceProgress();
  renderSummary();
  renderValidation();
  renderReportSummary();
  renderLegend();
  renderUnassignedSummary();
  renderMapControls();
  syncMap();
}

function renderAll() {
  renderSharedStatus();
  if (!features.length) return;
  renderStaffSelect();
  renderStaffManagement();
  renderDistrictList();
  renderTambonList();
  renderUnassignedSummary();
  renderAmountList();
  renderLegend();
  renderSummary();
  renderValidation();
  renderReportStaffSelect();
  renderReportSummary();
  renderMapControls();
  syncMap();
}

/* ============================================ 6. รายงานและการส่งออก */

function reportRows(person) {
  return assignedAreasFor(person.id)
    .sort((a, b) => `${Core.districtName(a)} ${Core.tambonName(a)}`.localeCompare(`${Core.districtName(b)} ${Core.tambonName(b)}`, "th"))
    .map((feature, index) => ({
      "ลำดับ": index + 1,
      "ผู้รับผิดชอบ": person.name,
      "สถานะ": person.active ? "ปฏิบัติงาน" : "ปิดใช้งาน",
      "อำเภอ": Core.districtName(feature),
      "ตำบล": Core.tambonName(feature),
      "ยอด": featureAmount(feature) ?? "",
    }));
}

function workbookSheet(XLSX, workbook, name, rows, usedNames) {
  let sheetName = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "รายงาน";
  let suffix = 2;
  while (usedNames.has(sheetName)) {
    sheetName = `${name.slice(0, 24)} ${suffix}`.slice(0, 31);
    suffix += 1;
  }
  usedNames.add(sheetName);
  const content = rows.length ? rows : [{ "หมายเหตุ": "ไม่มีข้อมูล" }];
  const sheet = XLSX.utils.json_to_sheet(content);
  sheet["!cols"] = Object.keys(content[0]).map((key) => ({ wch: Math.min(45, Math.max(12, key.length + 8)) }));
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
}

async function exportExcel() {
  const original = dom.excel_report_button.textContent;
  dom.excel_report_button.disabled = true;
  dom.excel_report_button.textContent = "กำลังเตรียมไฟล์…";
  try {
    const XLSX = await loadSheetJs();
    const selected = getStaff(dom.report_staff_select.value);
    const people = selected ? [selected] : state.staff;
    const workbook = XLSX.utils.book_new();
    const used = new Set();
    workbookSheet(XLSX, workbook, "สรุปภาระงาน", people.map((person, index) => {
      const item = workloadFor(person);
      return {
        "ลำดับ": index + 1,
        "ผู้รับผิดชอบ": person.name,
        "สถานะ": person.active ? "ปฏิบัติงาน" : "ปิดใช้งาน",
        "จำนวนตำบล": item.areas.length,
        "จำนวนอำเภอ": item.districts.length,
        "ยอดรวม": Core.sumPrices(item.areas, state.prices),
        "อำเภอ": item.districts.join(", "),
      };
    }), used);
    if (selected) workbookSheet(XLSX, workbook, `พื้นที่ ${selected.name}`, reportRows(selected), used);
    else {
      workbookSheet(XLSX, workbook, "รายการพื้นที่ทั้งหมด", state.staff.flatMap(reportRows), used);
      for (const person of state.staff) workbookSheet(XLSX, workbook, person.name, reportRows(person), used);
    }
    workbookSheet(XLSX, workbook, "ยังไม่มอบหมาย", unassignedAreas().map((feature, index) => ({
      "ลำดับ": index + 1,
      "อำเภอ": Core.districtName(feature),
      "ตำบล": Core.tambonName(feature),
      "ยอด": featureAmount(feature) ?? "",
      "สถานะ": "ยังไม่มอบหมาย",
    })), used);
    XLSX.writeFile(workbook, `${selected ? `รายงานเขต-${selected.name}` : "รายงานเขตงานส่งหมาย"}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast("ดาวน์โหลดรายงาน Excel แล้ว");
  } catch (error) {
    console.error(error);
    showToast(error.message || "สร้างรายงาน Excel ไม่สำเร็จ");
  } finally {
    dom.excel_report_button.disabled = false;
    dom.excel_report_button.textContent = original;
  }
}

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
  const groups = [...byDistrict.entries()].map(([district, items]) => {
    const rows = items
      .sort((a, b) => Core.tambonName(a).localeCompare(Core.tambonName(b), "th"))
      .map((feature) => `<tr><td>${escapeHtml(Core.tambonName(feature))}</td><td>${escapeHtml(Core.formatAmount(featureAmount(feature)))}</td></tr>`)
      .join("");
    return `<section><h3>อำเภอ${escapeHtml(district)} (${items.length} ตำบล)</h3><table><thead><tr><th>ตำบล</th><th>ยอด</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("") || "<p>ยังไม่มีพื้นที่รับผิดชอบ</p>";

  const reportWindow = open("", "_blank");
  if (!reportWindow) return showToast("กรุณาอนุญาตป๊อปอัปเพื่อพิมพ์รายงาน");
  reportWindow.opener = null;
  reportWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>รายงาน ${escapeHtml(person.name)}</title><style>
    @page{size:A4;margin:16mm}
    body{font-family:"TH Sarabun New","Sarabun",Tahoma,sans-serif;color:#172b3a;font-size:15px}
    h1{font-size:23px;margin:0}h2{font-size:16px;color:#315269;margin:2px 0 10px}h3{font-size:15px;margin:16px 0 6px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{border:1px solid #dbe5ea;padding:6px 8px;text-align:left}
    th:last-child,td:last-child{text-align:right}
    .summary{display:flex;gap:8px;margin:10px 0}
    .tag{background:#edf4f7;padding:5px 11px;border-radius:999px;font-size:13px}
  </style></head><body>
    <h1>รายงานเขตรับผิดชอบงานส่งหมาย</h1>
    <h2>ศาลจังหวัดลพบุรี · ${escapeHtml(Core.formatThaiDate(new Date()))}</h2>
    <p><strong>ผู้รับผิดชอบ:</strong> ${escapeHtml(person.name)}</p>
    <div class="summary"><span class="tag">${workload.areas.length} ตำบล</span><span class="tag">${workload.districts.length} อำเภอ</span><span class="tag">ยอดรวม ${escapeHtml(Core.formatAmount(Core.sumPrices(workload.areas, state.prices)))}</span></div>
    ${groups}
  </body></html>`);
  reportWindow.document.close();
  reportWindow.onload = () => reportWindow.print();
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

async function captureMapImage() {
  const html2canvas = await loadHtml2Canvas();
  engine.resize();
  engine.renderLabels();
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    engine.map.once("idle", finish);
    setTimeout(finish, 640);
  });
  const background = getComputedStyle(document.documentElement).getPropertyValue("--map-void").trim() || "#0a121b";
  const canvas = await html2canvas(dom.main_map, { backgroundColor: background, scale: 2, useCORS: true, logging: false });
  const image = canvas.toDataURL("image/png");
  if (!image.startsWith("data:image")) throw new Error("สร้างภาพแผนที่ไม่สำเร็จ");
  return image;
}

function startCaptureLayout() {
  const element = dom.main_map;
  const originalStyle = element.getAttribute("style");
  Object.assign(element.style, { position: "fixed", left: "-100000px", top: "0", width: "1440px", height: "820px", minHeight: "0", zIndex: "-1" });
  engine.resize();
  return () => {
    if (originalStyle === null) element.removeAttribute("style");
    else element.setAttribute("style", originalStyle);
    engine.resize();
  };
}

async function captureProvinceImage() {
  const map = engine.map;
  const center = map.getCenter();
  const previous = { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  const restore = startCaptureLayout();
  try {
    engine.setCaptureMode(true);
    engine.flyToOverview({ duration: 0, zoomBoost: 0 });
    return await captureMapImage();
  } finally {
    engine.setCaptureMode(false);
    restore();
    map.jumpTo(previous);
    engine.scheduleLabels();
  }
}

async function exportPng() {
  const original = dom.export_button.textContent;
  dom.export_button.disabled = true;
  dom.export_button.textContent = "กำลังสร้าง PNG…";
  try {
    const image = await captureProvinceImage();
    const blob = await (await fetch(image)).blob();
    downloadBlob(blob, `lopburi-notice-areas-${new Date().toISOString().slice(0, 10)}.png`);
    showToast("ดาวน์โหลดภาพแผนที่แล้ว");
  } catch (error) {
    console.error(error);
    showToast(error.message || "ส่งออก PNG ไม่สำเร็จ");
  } finally {
    dom.export_button.disabled = false;
    dom.export_button.textContent = original;
  }
}

async function printMapA4() {
  const printWindow = open("", "_blank");
  if (!printWindow) return showToast("กรุณาอนุญาตป๊อปอัปเพื่อพิมพ์แผนที่");
  printWindow.opener = null;
  const original = { showLabels: state.showLabels, showDistrictLabels: state.showDistrictLabels, showPriceLabels: state.showPriceLabels };
  try {
    state.showLabels = dom.print_tambon_labels.checked;
    state.showDistrictLabels = dom.print_district_labels.checked;
    state.showPriceLabels = dom.print_price_labels.checked;
    syncMap();
    const image = await captureProvinceImage();
    printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>แผนที่เขตพื้นที่ส่งหมาย</title><style>
      @page{size:A4 landscape;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}
      .print-map{display:block;width:100%;height:auto;object-fit:contain}
    </style></head><body><img class="print-map" src="${image}" alt="แผนที่เขตพื้นที่ส่งหมาย"></body></html>`);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  } catch (error) {
    console.error(error);
    printWindow.close();
    showToast(error.message || "สร้างแผนพิมพ์ไม่สำเร็จ");
  } finally {
    Object.assign(state, original);
    syncMap();
    renderMapControls();
  }
}

function backupState() {
  const payload = { ...serializableState(), exportedAt: new Date().toISOString(), note: `Lopburi Notice Area Manager v${Core.APP_VERSION} backup` };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `lopburi-notice-${new Date().toISOString().slice(0, 10)}.json`);
  showToast("ดาวน์โหลดไฟล์สำรองแล้ว");
}

async function restoreState(file) {
  if (!file) return;
  try {
    const restored = Core.normalizeState(JSON.parse(await file.text()));
    if (!confirm("แทนที่ข้อมูลปัจจุบันด้วยไฟล์สำรองหรือไม่?")) return;
    state = { ...restored, updatedAt: new Date().toISOString(), pendingChanges: true };
    filterStateToCourt();
    saveLocalState();
    renderAll();
    showToast("กู้คืนข้อมูลสำเร็จ กรุณากดบันทึกส่วนกลาง");
  } catch (error) {
    console.error(error);
    showToast("ไฟล์สำรองไม่ถูกต้อง");
  } finally {
    dom.restore_input.value = "";
  }
}

function confirmSaveBeforeLeave(proceed) {
  if (!state.pendingChanges) return proceed();
  const overlay = document.createElement("div");
  overlay.className = "leave-modal-overlay";
  const card = document.createElement("div");
  card.className = "leave-modal";
  card.innerHTML = '<h2 class="leave-modal-title">ยังไม่ได้บันทึกส่วนกลาง</h2><p class="leave-modal-body">การแก้ไขล่าสุดยังอยู่ในเครื่องนี้เท่านั้น</p>';
  const actions = document.createElement("div");
  actions.className = "leave-modal-actions";
  const saveGo = button("บันทึกแล้วไปต่อ", "button button-primary", async () => {
    saveGo.disabled = true;
    if (await saveShared()) { overlay.remove(); proceed(); }
    else saveGo.disabled = false;
  });
  const go = button("ไปต่อโดยไม่บันทึก", "button button-muted", () => { bypassLeaveGuard = true; overlay.remove(); proceed(); });
  const cancel = button("ยกเลิก", "button button-secondary", () => overlay.remove());
  actions.append(saveGo, go, cancel);
  card.append(actions);
  overlay.append(card);
  document.body.append(overlay);
}

/* ==================================================== 7. เริ่มต้นระบบ */

function createMapEngine() {
  engine = window.MapEngine.create({
    container: "main-map",
    preserveDrawingBuffer: true,
    startThreeD: true,
    onAreaClick: (feature) => toggleFeatureFromMap(feature),
    onReady: () => {
      syncMap();
      renderMapControls();
      engine.playIntro();
    },
  });
  window.ThemeController?.subscribe(() => engine?.refreshPalette());
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

function bindEvents() {
  window.ThemeController?.mount(dom.theme_toggle);

  dom.add_staff_button.addEventListener("click", () => { addStaff(dom.new_staff_name.value); dom.new_staff_name.value = ""; });
  dom.new_staff_name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); dom.add_staff_button.click(); }
  });
  dom.staff_select.addEventListener("change", () => {
    renderAll();
    const person = selectedStaff();
    if (person) engine?.flyToAreas(assignedAreasFor(person.id));
    else engine?.flyToOverview({ duration: 700 });
  });
  dom.toggle_staff_management.addEventListener("click", () => { staffManagementOpen = !staffManagementOpen; renderStaffManagement(); });
  dom.new_color_button.addEventListener("click", () => {
    const person = selectedStaff();
    if (!person) return showToast("เลือกผู้รับผิดชอบก่อน");
    person.color = nextDistinctColor(state.staff.filter((item) => item.id !== person.id).map((item) => item.color));
    persist(`คละสีใหม่ให้ ${person.name} แล้ว`);
  });
  dom.staff_import_input.addEventListener("change", (event) => importStaffFile(event.target.files[0]));
  dom.tambon_search.addEventListener("input", renderTambonList);
  dom.price_search.addEventListener("input", renderAmountList);
  dom.price_import_button.addEventListener("click", () => importAmounts(dom.price_paste.value));
  dom.price_csv_input.addEventListener("change", (event) => importAmountFile(event.target.files[0]));
  dom.publish_prices.addEventListener("change", () => {
    state.publishPrices = dom.publish_prices.checked;
    persist(state.publishPrices ? "เปิดแสดงยอดในหน้าจอแสดงผลแล้ว" : "ปิดแสดงยอดในหน้าจอแสดงผลแล้ว");
  });
  dom.validate_button.addEventListener("click", () => { renderValidation(); showToast("ตรวจสอบข้อมูลล่าสุดแล้ว"); });

  dom.province_overview_button.addEventListener("click", () => engine?.flyToOverview({ duration: 900 }));
  dom.tambon_view_button.addEventListener("click", () => {
    const person = selectedStaff();
    if (person && engine?.flyToAreas(assignedAreasFor(person.id))) return;
    engine?.zoomToTambonLevel();
    if (!state.showLabels) showToast("เปิดปุ่ม “ชื่อตำบล” เพื่อดูชื่อตำบลบนแผนที่");
  });
  dom.three_d_button.addEventListener("click", () => { engine?.setThreeD(!engine.isThreeD()); renderMapControls(); });
  dom.labels_button.addEventListener("click", () => { state.showLabels = !state.showLabels; persist("", { fullRender: false }); });
  dom.district_labels_button.addEventListener("click", () => { state.showDistrictLabels = !state.showDistrictLabels; persist("", { fullRender: false }); });
  dom.price_labels_button.addEventListener("click", () => { state.showPriceLabels = !state.showPriceLabels; persist("", { fullRender: false }); });
  dom.toggle_legend_button.addEventListener("click", () => { state.showLegend = !state.showLegend; persist("", { fullRender: false }); setTimeout(() => engine?.resize(), 240); });

  dom.export_button.addEventListener("click", exportPng);
  dom.print_map_button.addEventListener("click", printMapA4);
  dom.backup_button.addEventListener("click", backupState);
  dom.restore_input.addEventListener("change", (event) => restoreState(event.target.files[0]));
  dom.excel_report_button.addEventListener("click", exportExcel);
  dom.pdf_report_button.addEventListener("click", printPersonReport);
  dom.report_staff_select.addEventListener("change", renderReportSummary);

  dom.check_token_button.addEventListener("click", async () => {
    const result = await verifyGitHubToken();
    showToast(result.valid ? "ตรวจสอบรหัสแล้ว" : result.reason);
  });
  dom.save_shared_button.addEventListener("click", saveShared);
  dom.reload_shared_button.addEventListener("click", reloadSharedState);
  dom.github_token.addEventListener("input", () => { tokenCheck.valid = false; setTokenStatus("วางรหัสแล้วกดตรวจสอบก่อนบันทึก"); });
  dom.remember_github_token.addEventListener("change", () => {
    if (!dom.remember_github_token.checked) forgetToken({ clearInput: false });
    else renderRememberedTokenStatus();
  });
  dom.forget_github_token_button.addEventListener("click", () => { forgetToken(); setTokenStatus("ลบรหัสที่จำไว้แล้ว"); });

  const viewLink = document.querySelector('a[href="view.html"]');
  viewLink?.addEventListener("click", (event) => {
    if (!state.pendingChanges) return;
    event.preventDefault();
    confirmSaveBeforeLeave(() => { bypassLeaveGuard = true; location.href = viewLink.href; });
  });
  addEventListener("beforeunload", (event) => {
    if (state.pendingChanges && !bypassLeaveGuard) { event.preventDefault(); event.returnValue = ""; }
  });

  let resizeTimer = null;
  const refit = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => engine?.resize(), 180);
  };
  addEventListener("resize", refit);
  addEventListener("orientationchange", refit);
}

async function init() {
  bindEvents();
  loadRememberedToken();
  try {
    const boundaries = await Boundaries.load();
    features = boundaries.features;
    villageCounts = boundaries.villageCounts;
    filterStateToCourt();
    await loadSharedState();
    filterStateToCourt();
    createMapEngine();
    engine.setContext(boundaries.context);
    engine.setFeatures(features);
    renderAll();
    setBoundarySource("local");

    Boundaries.upgrade({
      villageCounts,
      onReady: (detailed, origin) => {
        features = detailed;
        filterStateToCourt();
        engine.setFeatures(features);
        renderAll();
        setBoundarySource(origin);
      },
    });
  } catch (error) {
    console.error(error);
    dom.tambon_list.innerHTML = `<p class="empty-result">${escapeHtml(error.message || "โหลดระบบไม่สำเร็จ")}</p>`;
    showToast(error.message || "โหลดระบบไม่สำเร็จ");
  } finally {
    dom.loading.hidden = true;
  }
}

init();
