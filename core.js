/**
 * core.js — กติกาข้อมูลกลางของระบบบริหารเขตพื้นที่งานส่งหมาย
 *
 * ไฟล์นี้คือ "แหล่งความจริงเดียว" ของ
 *   • เลขรุ่นระบบ (ใช้ทำ cache busting ทุกไฟล์พร้อมกัน)
 *   • รหัสอำเภอในเขตศาลจังหวัดลพบุรี
 *   • โครงสร้างข้อมูล การตรวจความถูกต้อง และการอ่านค่าจากขอบเขตตำบล
 *   • การแปลงตัวเลขยอด (เลขไทย ทศนิยม) — ยอดเป็น "จำนวน" ไม่มีหน่วยเงิน
 *
 * ทั้งหน้าจัดการและหน้าแสดงผลเรียกใช้ไฟล์นี้ร่วมกัน ห้ามเขียนกติกาซ้ำที่อื่น
 *
 * [ต่อยอด] จุดขยายในอนาคต
 *   • เพิ่มเขตศาลอื่น: แก้ COURT_AMPHOE_CODES และ COURT_DISTRICT_NAMES ที่นี่ที่เดียว
 *   • เพิ่มฟิลด์ใหม่ในข้อมูลกลาง: เพิ่มใน initialState + normalizeState + serializableState
 */
(function (global) {
  "use strict";

  /** เลขรุ่นของชุดไฟล์ ใช้ต่อท้าย URL ทุกไฟล์ (?v=) ให้ตรงกันทั้งระบบ */
  const APP_VERSION = "5.0.1";

  /** เลขรุ่นของ "โครงสร้างข้อมูล" ใน assignments.json — คนละตัวกับ APP_VERSION */
  const VERSION = 4;

  const STORAGE_KEY = "lopburi-notice-area-manager-v1";
  const THEME_KEY = `${STORAGE_KEY}:theme`;

  /** อำเภอในเขตอำนาจศาลจังหวัดลพบุรี 6 อำเภอ (ไม่รวมเขตศาลจังหวัดชัยบาดาล) */
  const COURT_AMPHOE_CODES = new Set(["1601", "1602", "1603", "1605", "1606", "1611"]);
  const COURT_DISTRICT_NAMES = new Set(["เมืองลพบุรี", "พัฒนานิคม", "โคกสำโรง", "ท่าวุ้ง", "บ้านหมี่", "หนองม่วง"]);
  const EXPECTED_COURT_TAMBONS = 85;

  const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u00A0]/g;
  const THAI_DIGITS = { "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4", "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9" };

  function initialState() {
    return {
      version: VERSION,
      staff: [],
      assignments: {},
      prices: {},
      showLabels: true,
      showDistrictLabels: true,
      showLegend: true,
      showPriceLabels: true,
      publishPrices: true,
      updatedAt: null,
      updatedBy: null,
      pendingChanges: false,
    };
  }

  function sanitizeName(value) {
    return String(value ?? "").replace(INVISIBLE_CHARS, " ").trim().replace(/\s+/g, " ");
  }

  function toArabicDigits(value) {
    return String(value ?? "").replace(/[๐-๙]/g, (digit) => THAI_DIGITS[digit]);
  }

  /**
   * แปลงข้อความเป็นยอด (จำนวน) — รองรับเลขไทย คอมมา ทศนิยมไม่เกิน 2 ตำแหน่ง
   * ยังยอมรับคำว่า "บาท" หรือ "฿" ที่ติดมากับไฟล์เก่าเพื่อไม่ให้การนำเข้าพัง
   * แต่ระบบไม่แสดงหน่วยเงินที่ใดอีก
   */
  function parseAmount(raw) {
    const cleaned = toArabicDigits(raw).replace(INVISIBLE_CHARS, "").replace(/[฿,\s]/g, "").replace(/บาท/gi, "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
    const value = Number(cleaned);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  /** แสดงยอดเป็นตัวเลขล้วน ไม่มีหน่วย (เช่น 1,250 หรือ 750.5) */
  function formatAmount(value) {
    const amount = typeof value === "number" ? value : parseAmount(value);
    if (amount === null || !Number.isFinite(amount)) return "—";
    return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
  }

  function formatCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return new Intl.NumberFormat("th-TH").format(number);
  }

  function normalizePrices(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const result = {};
    for (const [id, rawValue] of Object.entries(raw)) {
      const amount = typeof rawValue === "number" ? rawValue : parseAmount(rawValue);
      if (Number.isFinite(amount) && amount >= 0) result[String(id)] = Math.round(amount * 100) / 100;
    }
    return result;
  }

  function normalizeStaff(raw) {
    if (!Array.isArray(raw)) return [];
    const seenIds = new Set();
    const seenNames = new Set();
    const staff = [];
    for (const person of raw) {
      if (!person || !person.id || !person.name || !person.color) continue;
      const id = String(person.id);
      const name = sanitizeName(person.name);
      const key = name.toLocaleLowerCase("th");
      if (!name || seenIds.has(id) || seenNames.has(key)) continue;
      seenIds.add(id);
      seenNames.add(key);
      staff.push({ id, name, color: String(person.color), active: person.active !== false });
    }
    return staff;
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== "object") return initialState();
    const staff = normalizeStaff(raw.staff);
    const assignments = raw.assignments && typeof raw.assignments === "object" && !Array.isArray(raw.assignments)
      ? Object.fromEntries(Object.entries(raw.assignments).map(([area, person]) => [String(area), String(person)]))
      : {};
    return {
      version: VERSION,
      staff,
      assignments,
      prices: normalizePrices(raw.prices),
      showLabels: raw.showLabels !== false,
      showDistrictLabels: raw.showDistrictLabels !== false,
      showLegend: raw.showLegend !== false,
      showPriceLabels: raw.showPriceLabels !== false,
      publishPrices: raw.publishPrices !== false,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
      updatedBy: typeof raw.updatedBy === "string" ? sanitizeName(raw.updatedBy) || null : null,
      pendingChanges: Boolean(raw.pendingChanges),
    };
  }

  function serializableState(state) {
    const normalized = normalizeState(state);
    return {
      version: VERSION,
      staff: normalized.staff,
      assignments: normalized.assignments,
      prices: normalized.prices,
      showLabels: normalized.showLabels,
      showDistrictLabels: normalized.showDistrictLabels,
      showLegend: normalized.showLegend,
      showPriceLabels: normalized.showPriceLabels,
      publishPrices: normalized.publishPrices,
      updatedAt: normalized.updatedAt,
      updatedBy: normalized.updatedBy,
    };
  }

  /* ---------- การอ่านค่าจากขอบเขตตำบล ----------
     รองรับสองรูปแบบ: ไฟล์ในเครื่อง (ADMIN_ID3) และผลลัพธ์ ArcGIS (ADMIN_ID3 เช่นกัน)
     ฟังก์ชัน compactCode รองรับรหัสที่มีคำนำหน้า TH เผื่อไฟล์รุ่นเก่า           */

  function compactCode(value) {
    return String(value ?? "").replace(/^TH/i, "");
  }

  function areaId(feature) {
    const properties = feature?.properties || {};
    return compactCode(properties.ADMIN_ID3 || properties.tambon_code || feature?.id || properties.OBJECTID || "");
  }

  function districtName(feature) {
    const properties = feature?.properties || {};
    return sanitizeName(properties.NAME2 ?? properties.amphoe_th);
  }

  function tambonName(feature) {
    const properties = feature?.properties || {};
    return sanitizeName(properties.NAME3 ?? properties.tambon_th);
  }

  function amphoeCode(feature) {
    const properties = feature?.properties || {};
    return compactCode(properties.ADMIN_ID2 || properties.amphoe_code || areaId(feature).slice(0, 4));
  }

  function isCourtFeature(feature) {
    return COURT_AMPHOE_CODES.has(amphoeCode(feature)) || COURT_DISTRICT_NAMES.has(districtName(feature));
  }

  function featureNumber(feature, key) {
    const value = feature?.properties?.[key];
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeAreaName(value) {
    return sanitizeName(value)
      .replace(/(ตำบล|ต\.|อำเภอ|อ\.|แขวง|เขต)/gi, "")
      .replace(/[\/,_-]/g, "")
      .replace(/\s+/g, "")
      .toLocaleLowerCase("th");
  }

  function buildAreaIndex(features) {
    const tambonOnly = new Map();
    const districtTambon = new Map();
    for (const feature of features || []) {
      const tambon = normalizeAreaName(tambonName(feature));
      const district = normalizeAreaName(districtName(feature));
      if (!tambon) continue;
      if (!tambonOnly.has(tambon)) tambonOnly.set(tambon, []);
      tambonOnly.get(tambon).push(feature);
      districtTambon.set(`${district}|${tambon}`, feature);
    }
    return { tambonOnly, districtTambon };
  }

  function parsePriceLines(text, features) {
    const index = buildAreaIndex(features);
    const result = { applied: [], notFound: [], ambiguous: [], invalid: [] };
    const lines = String(text ?? "").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = sanitizeName(rawLine);
      if (!line) continue;
      if (!/\d|[๐-๙]/.test(line)) {
        if (/ตำบล|อำเภอ|ชื่อ|name|ยอด|จำนวน/i.test(line)) continue;
        result.invalid.push(line);
        continue;
      }
      const converted = toArabicDigits(line);
      const amountMatch = converted.match(/(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|฿)?\s*$/i);
      if (!amountMatch) {
        result.invalid.push(line);
        continue;
      }
      const amount = parseAmount(amountMatch[1]);
      if (amount === null) {
        result.invalid.push(line);
        continue;
      }
      const namePart = sanitizeName(converted.slice(0, amountMatch.index).replace(/[;,]/g, " "));
      const pieces = namePart.split(/[\/|>]/).map(sanitizeName).filter(Boolean);
      let feature = null;
      if (pieces.length >= 2) {
        const district = normalizeAreaName(pieces[0]);
        const tambon = normalizeAreaName(pieces.slice(1).join(" "));
        feature = index.districtTambon.get(`${district}|${tambon}`) || null;
      }
      if (!feature) {
        const normalizedWhole = normalizeAreaName(namePart);
        const direct = index.tambonOnly.get(normalizedWhole);
        if (direct?.length === 1) feature = direct[0];
        else if (direct?.length > 1) {
          result.ambiguous.push(line);
          continue;
        }
      }
      if (!feature) {
        const tokens = namePart.split(/\s+/).filter(Boolean);
        for (const token of tokens.reverse()) {
          const matches = index.tambonOnly.get(normalizeAreaName(token));
          if (matches?.length === 1) {
            feature = matches[0];
            break;
          }
          if (matches?.length > 1) {
            const districtKey = normalizeAreaName(namePart);
            feature = matches.find((candidate) => districtKey.includes(normalizeAreaName(districtName(candidate)))) || null;
            if (!feature) {
              result.ambiguous.push(line);
              break;
            }
          }
        }
      }
      if (!feature) {
        if (!result.ambiguous.includes(line)) result.notFound.push(line);
        continue;
      }
      result.applied.push({ id: areaId(feature), amount, feature, line });
    }
    return result;
  }

  function sumPrices(features, prices) {
    return (features || []).reduce((total, feature) => {
      const value = prices?.[areaId(feature)];
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);
  }

  function hasSharedData(state) {
    return Boolean(
      state?.staff?.length ||
      Object.keys(state?.assignments || {}).length ||
      Object.keys(state?.prices || {}).length
    );
  }

  function filterStateToFeatures(state, features) {
    const normalized = normalizeState(state);
    const validAreaIds = new Set((features || []).map(areaId));
    const validStaffIds = new Set(normalized.staff.map((person) => person.id));
    const assignments = Object.fromEntries(
      Object.entries(normalized.assignments).filter(([id, staffId]) => validAreaIds.has(id) && validStaffIds.has(staffId))
    );
    const prices = Object.fromEntries(
      Object.entries(normalized.prices).filter(([id]) => validAreaIds.has(id))
    );
    return { ...normalized, assignments, prices };
  }

  /**
   * เปรียบเทียบข้อมูลกลางสองรุ่น แล้วสรุปเป็นข้อความสั้น ๆ
   * ใช้เป็นข้อความ commit เพื่อให้ย้อนดูประวัติได้ว่าใครแก้อะไร (ผลตรวจ ตร-10)
   */
  function describeChanges(before, after) {
    const previous = normalizeState(before);
    const next = normalizeState(after);
    const parts = [];

    const staffBefore = new Map(previous.staff.map((person) => [person.id, person]));
    const staffAfter = new Map(next.staff.map((person) => [person.id, person]));
    const addedStaff = [...staffAfter.keys()].filter((id) => !staffBefore.has(id)).length;
    const removedStaff = [...staffBefore.keys()].filter((id) => !staffAfter.has(id)).length;
    const renamedStaff = [...staffAfter.values()].filter((person) => {
      const old = staffBefore.get(person.id);
      return old && (old.name !== person.name || old.active !== person.active);
    }).length;
    if (addedStaff) parts.push(`เพิ่มเจ้าหน้าที่ ${addedStaff} คน`);
    if (removedStaff) parts.push(`ลบเจ้าหน้าที่ ${removedStaff} คน`);
    if (renamedStaff) parts.push(`แก้ข้อมูลเจ้าหน้าที่ ${renamedStaff} คน`);

    const areaKeys = new Set([...Object.keys(previous.assignments), ...Object.keys(next.assignments)]);
    let assigned = 0;
    let cleared = 0;
    let moved = 0;
    for (const key of areaKeys) {
      const from = previous.assignments[key];
      const to = next.assignments[key];
      if (from === to) continue;
      if (!from) assigned += 1;
      else if (!to) cleared += 1;
      else moved += 1;
    }
    if (assigned) parts.push(`มอบหมายเพิ่ม ${assigned} ตำบล`);
    if (moved) parts.push(`ย้ายผู้รับผิดชอบ ${moved} ตำบล`);
    if (cleared) parts.push(`ยกเลิกมอบหมาย ${cleared} ตำบล`);

    const priceKeys = new Set([...Object.keys(previous.prices), ...Object.keys(next.prices)]);
    const priceChanges = [...priceKeys].filter((key) => previous.prices[key] !== next.prices[key]).length;
    if (priceChanges) parts.push(`แก้ยอด ${priceChanges} ตำบล`);

    const toggles = ["showLabels", "showDistrictLabels", "showLegend", "showPriceLabels", "publishPrices"]
      .filter((key) => previous[key] !== next[key]).length;
    if (toggles) parts.push(`ปรับการแสดงผล ${toggles} รายการ`);

    return parts.length ? parts.join(" · ") : "บันทึกข้อมูลกลางโดยไม่มีการเปลี่ยนแปลง";
  }

  /** วันที่แบบไทย พ.ศ. — ใช้ทั้งหน้าจัดการและหน้าแสดงผล */
  function formatThaiDate(value, { withTime = false } = {}) {
    const date = value instanceof Date ? value : new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "—";
    const options = { day: "numeric", month: "short", year: "numeric" };
    if (withTime) Object.assign(options, { hour: "2-digit", minute: "2-digit" });
    return new Intl.DateTimeFormat("th-TH", { ...options, calendar: "buddhist" }).format(date);
  }

  const api = {
    APP_VERSION,
    VERSION,
    STORAGE_KEY,
    THEME_KEY,
    COURT_DISTRICT_NAMES,
    COURT_AMPHOE_CODES,
    EXPECTED_COURT_TAMBONS,
    initialState,
    sanitizeName,
    toArabicDigits,
    parseAmount,
    formatAmount,
    formatCount,
    formatThaiDate,
    normalizePrices,
    normalizeState,
    serializableState,
    compactCode,
    areaId,
    districtName,
    tambonName,
    amphoeCode,
    isCourtFeature,
    featureNumber,
    normalizeAreaName,
    buildAreaIndex,
    parsePriceLines,
    sumPrices,
    hasSharedData,
    filterStateToFeatures,
    describeChanges,
  };

  global.MapLibreCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
