(function (global) {
  "use strict";

  const COURT_AMPHOE_CODES = new Set(["1601", "1602", "1603", "1605", "1606", "1611"]);
  const DATA_PATH = "data/map-overview/";
  const FILES = {
    country: "thailand_provinces.geojson",
    tambons: "lopburi_tambon.geojson",
    amphoes: "lopburi_amphoe.geojson",
    province: "lopburi_province.geojson",
  };

  function compactCode(value) {
    return String(value || "").replace(/^TH/i, "");
  }

  function amphoeCode(feature) {
    return compactCode(feature?.properties?.amphoe_code);
  }

  function isCourtAmphoe(feature) {
    return COURT_AMPHOE_CODES.has(amphoeCode(feature));
  }

  function featureCollection(value, label) {
    if (!value || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
      throw new Error(`ข้อมูลแผนที่ ${label} ไม่ถูกต้อง`);
    }
    return value;
  }

  async function load() {
    const entries = Object.entries(FILES);
    const responses = await Promise.all(entries.map(async ([key, filename]) => {
      const response = await fetch(`${DATA_PATH}${filename}`, { cache: "force-cache" });
      if (!response.ok) throw new Error(`โหลด ${filename} ไม่สำเร็จ (${response.status})`);
      return [key, featureCollection(await response.json(), filename)];
    }));
    const result = Object.fromEntries(responses);
    if (result.country.features.length !== 77 || result.province.features.length !== 1) {
      throw new Error("จำนวนพื้นที่ภาพรวมไม่ครบ");
    }
    return {
      ...result,
      courtAmphoes: {
        type: "FeatureCollection",
        features: result.amphoes.features.filter(isCourtAmphoe),
      },
      outsideAmphoes: {
        type: "FeatureCollection",
        features: result.amphoes.features.filter((feature) => !isCourtAmphoe(feature)),
      },
    };
  }

  global.MapLibreOverview = {
    COURT_AMPHOE_CODES,
    amphoeCode,
    isCourtAmphoe,
    load,
  };
}(window));
