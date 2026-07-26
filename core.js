(function (global) {
  "use strict";

  const VERSION = 4;
  const STORAGE_KEY = "lopburi-notice-area-manager-v1";
  const COURT_DISTRICT_NAMES = new Set(["เมืองลพบุรี", "พัฒนานิคม", "โคกสำโรง", "ท่าวุ้ง", "บ้านหมี่", "หนองม่วง"]);
  const COURT_AMPHOE_CODES = new Set(["1601", "1602", "1603", "1605", "1606", "1611"]);
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
      pendingChanges: false,
    };
  }

  function sanitizeName(value) {
    return String(value ?? "").replace(INVISIBLE_CHARS, " ").trim().replace(/\s+/g, " ");
  }

  function toArabicDigits(value) {
    return String(value ?? "").replace(/[๐-๙]/g, (digit) => THAI_DIGITS[digit]);
  }

  function parseAmount(raw) {
    const cleaned = toArabicDigits(raw).replace(INVISIBLE_CHARS, "").replace(/[฿บาท,\s]/gi, "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
    const value = Number(cleaned);
    return Number.isFinite(value) && value >= 0 ? value : null;
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
    };
  }

  function areaId(feature) {
    return String(feature?.properties?.ADMIN_ID3 || feature?.properties?.OBJECTID || feature?.id || "");
  }

  function districtName(feature) {
    return sanitizeName(feature?.properties?.NAME2);
  }

  function tambonName(feature) {
    return sanitizeName(feature?.properties?.NAME3);
  }

  function amphoeCode(feature) {
    return String(feature?.properties?.ADMIN_ID2 || areaId(feature).slice(0, 4));
  }

  function isCourtFeature(feature) {
    return COURT_AMPHOE_CODES.has(amphoeCode(feature)) || COURT_DISTRICT_NAMES.has(districtName(feature));
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
        if (/ตำบล|อำเภอ|ชื่อ|name|ยอด|ราคา|จำนวน/i.test(line)) continue;
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

  function formatAmount(value, { suffix = true } = {}) {
    const amount = typeof value === "number" ? value : parseAmount(value);
    if (amount === null || !Number.isFinite(amount)) return "—";
    const text = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
    return suffix ? `${text} บาท` : text;
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

  const api = {
    VERSION,
    STORAGE_KEY,
    COURT_DISTRICT_NAMES,
    COURT_AMPHOE_CODES,
    initialState,
    sanitizeName,
    toArabicDigits,
    parseAmount,
    normalizePrices,
    normalizeState,
    serializableState,
    areaId,
    districtName,
    tambonName,
    amphoeCode,
    isCourtFeature,
    normalizeAreaName,
    buildAreaIndex,
    parsePriceLines,
    formatAmount,
    sumPrices,
    hasSharedData,
    filterStateToFeatures,
  };

  global.MapLibreCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
