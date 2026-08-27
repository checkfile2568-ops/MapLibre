/**
 * boundaries.js — โหลดขอบเขตพื้นที่ให้ทั้งสองหน้าจอ
 *
 * หลักการ (แก้ผลตรวจ ตร-01 และ ตร-02)
 *   1. โหลดไฟล์ในเครื่อง data/court-tambon.geojson ก่อนเสมอ — 85 ตำบล ~46 KB
 *      แผนที่จึงขึ้นทันทีและใช้งานได้แม้เน็ตนอกองค์กรล่ม
 *   2. จากนั้นค่อยขอขอบเขตความละเอียดสูงจาก ArcGIS แบบเบื้องหลัง
 *      ถามเฉพาะ 6 อำเภอในเขตศาล ไม่ใช่ทั้งจังหวัดเหมือนรุ่นก่อน
 *   3. ผลลัพธ์จาก ArcGIS ถูกเก็บใน Cache Storage เปิดครั้งต่อไปจึงไม่ต้องต่อเน็ตอีก
 *   4. ทุกขั้นตอนล้มเหลวได้โดยไม่กระทบการใช้งาน — ไม่มีการ throw ออกไปข้างนอก
 *
 * [ต่อยอด] ถ้าต้องการตัด ArcGIS ออกถาวร ให้รัน
 *     node tools/build-court-data.mjs --enrich
 *   แล้ว commit ไฟล์ที่ได้ ระบบจะมีขอบเขตละเอียดพร้อมประชากรอยู่ในเครื่องเลย
 */
(function (global) {
  "use strict";

  const Core = global.MapLibreCore;
  const LOCAL_URL = `data/court-tambon.geojson?v=${Core.APP_VERSION}`;
  const OVERVIEW_PATH = "data/map-overview/";
  const OVERVIEW_FILES = {
    country: "thailand_provinces.geojson",
    tambons: "lopburi_tambon.geojson",
    amphoes: "lopburi_amphoe.geojson",
    province: "lopburi_province.geojson",
  };

  const GIS_QUERY_URL =
    "https://services1.arcgis.com/jSaRWj2TDlcN1zOC/arcgis/rest/services/" +
    "Thailand_Subdistrict_Boundaries_%28%E0%B8%82%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B8%B9%E0%B8%A5%E0%B8%82" +
    "%E0%B8%AD%E0%B8%9A%E0%B9%80%E0%B8%82%E0%B8%95%E0%B8%95%E0%B8%B3%E0%B8%9A%E0%B8%A5%E0%B8%9B%E0%B8%A3" +
    "%E0%B8%B0%E0%B9%80%E0%B8%97%E0%B8%A8%E0%B9%84%E0%B8%97%E0%B8%A2%29/FeatureServer/1/query";

  const CACHE_NAME = `lopburi-boundaries-${Core.APP_VERSION}`;
  const DETAIL_TIMEOUT_MS = 9000;

  function courtQueryUrl() {
    const codes = [...Core.COURT_AMPHOE_CODES].map((code) => `'${code}'`).join(",");
    const params = new URLSearchParams({
      where: `ADMIN_ID2 IN (${codes})`,
      outFields: "ADMIN_ID1,ADMIN_ID2,ADMIN_ID3,NAME1,NAME2,NAME3,POPULATION,HOUSE",
      returnGeometry: "true",
      outSR: "4326",
      f: "geojson",
    });
    return `${GIS_QUERY_URL}?${params}`;
  }

  function prepare(collection, villageCounts) {
    const features = (collection?.features || [])
      .filter((feature) => Core.areaId(feature) && Core.isCourtFeature(feature))
      .map((feature) => {
        const id = Core.areaId(feature);
        return {
          ...feature,
          id,
          properties: {
            ...feature.properties,
            ADMIN_ID3: id,
            VILLAGES: feature.properties?.VILLAGES ?? villageCounts?.[id] ?? null,
          },
        };
      });
    features.sort((left, right) => Core.areaId(left).localeCompare(Core.areaId(right)));
    return features;
  }

  async function readJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`โหลด ${url} ไม่สำเร็จ (${response.status})`);
    return response.json();
  }

  async function loadVillageCounts() {
    try {
      const payload = await readJson(`data/tambon-village-counts.json?v=${Core.APP_VERSION}`);
      return payload?.counts && typeof payload.counts === "object" ? payload.counts : {};
    } catch {
      return {};
    }
  }

  /** ขอบเขตประเทศ/จังหวัด/อำเภอ สำหรับฉากหลังของแผนที่ */
  async function loadContext() {
    try {
      const entries = await Promise.all(
        Object.entries(OVERVIEW_FILES).map(async ([key, filename]) => [
          key,
          await readJson(`${OVERVIEW_PATH}${filename}?v=${Core.APP_VERSION}`, { cache: "force-cache" }),
        ])
      );
      const result = Object.fromEntries(entries);
      const inCourt = (feature) => Core.COURT_AMPHOE_CODES.has(Core.compactCode(feature?.properties?.amphoe_code));
      return {
        ...result,
        courtAmphoes: { type: "FeatureCollection", features: result.amphoes.features.filter(inCourt) },
        outsideAmphoes: { type: "FeatureCollection", features: result.amphoes.features.filter((f) => !inCourt(f)) },
      };
    } catch (error) {
      console.warn("โหลดฉากหลังแผนที่ไม่สำเร็จ", error);
      return null;
    }
  }

  async function cachedDetail() {
    if (!("caches" in global)) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(courtQueryUrl());
      return hit ? hit.json() : null;
    } catch {
      return null;
    }
  }

  async function storeDetail(payload) {
    if (!("caches" in global)) return;
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(courtQueryUrl(), new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/geo+json" },
      }));
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("lopburi-boundaries-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    } catch {
      /* เก็บ cache ไม่ได้ก็ไม่เป็นไร */
    }
  }

  async function fetchDetail() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
    try {
      const payload = await readJson(courtQueryUrl(), { signal: controller.signal });
      if (!Array.isArray(payload?.features) || !payload.features.length) throw new Error("ArcGIS ไม่ส่งข้อมูลขอบเขต");
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * โหลดขอบเขตพื้นฐาน — ต้องสำเร็จเสมอ ไม่งั้นถือว่าไฟล์ในระบบหาย
   * คืนค่า { features, context, villageCounts, detailed }
   */
  async function load() {
    const [localCollection, villageCounts, context] = await Promise.all([
      readJson(LOCAL_URL),
      loadVillageCounts(),
      loadContext(),
    ]);
    const features = prepare(localCollection, villageCounts);
    if (features.length !== Core.EXPECTED_COURT_TAMBONS) {
      console.warn(`ขอบเขตในเครื่องมี ${features.length} ตำบล คาดว่าควรมี ${Core.EXPECTED_COURT_TAMBONS} ตำบล`);
    }
    const hasPopulation = features.some((feature) => Core.featureNumber(feature, "POPULATION"));
    return { features, context, villageCounts, detailed: hasPopulation };
  }

  /**
   * ขอขอบเขตความละเอียดสูงแบบเบื้องหลัง
   * onReady(features, origin) จะถูกเรียกเมื่อได้ข้อมูลที่ดีกว่าเท่านั้น
   * ไม่มีการ throw — ล้มเหลวเงียบ ๆ แล้วใช้ข้อมูลในเครื่องต่อไป
   */
  async function upgrade({ villageCounts, onReady, onStatus } = {}) {
    const report = (status, detail) => { try { onStatus?.(status, detail); } catch { /* no-op */ } };
    try {
      const cached = await cachedDetail();
      if (cached) {
        const features = prepare(cached, villageCounts);
        if (features.length) {
          onReady?.(features, "cache");
          report("cache");
          return true;
        }
      }
    } catch { /* ข้ามไปดึงใหม่ */ }

    if (global.navigator && global.navigator.onLine === false) {
      report("offline");
      return false;
    }

    try {
      const payload = await fetchDetail();
      const features = prepare(payload, villageCounts);
      if (!features.length) throw new Error("ไม่พบตำบลในเขตศาล");
      await storeDetail(payload);
      onReady?.(features, "network");
      report("network");
      return true;
    } catch (error) {
      console.warn("ขอขอบเขตความละเอียดสูงไม่สำเร็จ ใช้ข้อมูลในเครื่องต่อไป", error);
      report("fallback", error);
      return false;
    }
  }

  global.MapLibreBoundaries = { load, upgrade, courtQueryUrl, CACHE_NAME };
})(window);
