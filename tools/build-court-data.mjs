#!/usr/bin/env node
/**
 * สร้าง data/court-tambon.geojson — ขอบเขต 85 ตำบลในเขตศาลจังหวัดลพบุรี
 *
 * ทำไมต้องมีไฟล์นี้
 *   เดิมหน้าเว็บดึงขอบเขต "ทั้งจังหวัด" 124 ตำบลจาก ArcGIS ทุกครั้งที่เปิด
 *   แล้วค่อยกรองเหลือ 85 ตำบลในเบราว์เซอร์ ทำให้ช้าและล่มตาม ArcGIS
 *   สคริปต์นี้ทำงานนั้นล่วงหน้าครั้งเดียว หน้าเว็บจึงโหลดไฟล์เดียวจบ
 *
 * วิธีใช้
 *   node tools/build-court-data.mjs              สร้างจากไฟล์ในเครื่อง (ไม่ต้องต่อเน็ต)
 *   node tools/build-court-data.mjs --enrich     ดึงประชากร/ครัวเรือนจาก ArcGIS มาฝังในไฟล์ด้วย
 *
 * ควรรันใหม่เมื่อ: ขอบเขตการปกครองเปลี่ยน หรืออยากอัปเดตตัวเลขประชากร
 */
import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const COURT_AMPHOE_CODES = ["1601", "1602", "1603", "1605", "1606", "1611"];
const EXPECTED_TAMBONS = 85;
const GIS_QUERY_URL =
  "https://services1.arcgis.com/jSaRWj2TDlcN1zOC/arcgis/rest/services/" +
  "Thailand_Subdistrict_Boundaries_%28%E0%B8%82%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B8%B9%E0%B8%A5%E0%B8%82" +
  "%E0%B8%AD%E0%B8%9A%E0%B9%80%E0%B8%82%E0%B8%95%E0%B8%95%E0%B8%B3%E0%B8%9A%E0%B8%A5%E0%B8%9B%E0%B8%A3" +
  "%E0%B8%B0%E0%B9%80%E0%B8%97%E0%B8%A8%E0%B9%84%E0%B8%97%E0%B8%A2%29/FeatureServer/1/query";

const enrich = process.argv.includes("--enrich");
const codeOf = (value) => String(value ?? "").replace(/^TH/i, "");
const round6 = (value) => Math.round(value * 1e6) / 1e6;

function roundGeometry(geometry) {
  const walk = (node) =>
    Array.isArray(node[0]) ? node.map(walk) : [round6(node[0]), round6(node[1])];
  return { ...geometry, coordinates: walk(geometry.coordinates) };
}

async function readJson(relative) {
  return JSON.parse(await fs.readFile(new URL(relative, root), "utf8"));
}

async function fetchPopulation() {
  const params = new URLSearchParams({
    where: "ADMIN_ID1 = '16'",
    outFields: "ADMIN_ID3,POPULATION,HOUSE",
    returnGeometry: "false",
    f: "json",
  });
  const response = await fetch(`${GIS_QUERY_URL}?${params}`);
  if (!response.ok) throw new Error(`ArcGIS ตอบกลับ ${response.status}`);
  const payload = await response.json();
  const table = new Map();
  for (const item of payload.features ?? []) {
    const attributes = item.attributes ?? {};
    table.set(codeOf(attributes.ADMIN_ID3), {
      POPULATION: Number(attributes.POPULATION) || null,
      HOUSE: Number(attributes.HOUSE) || null,
    });
  }
  return table;
}

const source = await readJson("data/map-overview/lopburi_tambon.geojson");
const villages = await readJson("data/tambon-village-counts.json");
const previous = await readJson("data/court-tambon.geojson").catch(() => null);

let population = new Map();
if (enrich) {
  try {
    population = await fetchPopulation();
    console.log(`ดึงข้อมูลประชากรจาก ArcGIS สำเร็จ ${population.size} ตำบล`);
  } catch (error) {
    console.warn(`ดึงข้อมูลประชากรไม่สำเร็จ (${error.message}) — ใช้ค่าเดิมในไฟล์แทน`);
  }
}
if (!population.size && previous) {
  for (const feature of previous.features ?? []) {
    const properties = feature.properties ?? {};
    if (properties.POPULATION || properties.HOUSE) {
      population.set(String(properties.ADMIN_ID3), {
        POPULATION: properties.POPULATION ?? null,
        HOUSE: properties.HOUSE ?? null,
      });
    }
  }
}

const features = source.features
  .filter((feature) => COURT_AMPHOE_CODES.includes(codeOf(feature.properties.amphoe_code)))
  .map((feature) => {
    const properties = feature.properties;
    const id = codeOf(properties.tambon_code);
    const extra = population.get(id) ?? {};
    return {
      type: "Feature",
      id,
      properties: {
        ADMIN_ID1: codeOf(properties.prov_code),
        ADMIN_ID2: codeOf(properties.amphoe_code),
        ADMIN_ID3: id,
        NAME1: properties.prov_th,
        NAME2: properties.amphoe_th,
        NAME3: properties.tambon_th,
        NAME1_EN: properties.prov_en ?? null,
        NAME2_EN: properties.amphoe_en ?? null,
        NAME3_EN: properties.tambon_en ?? null,
        POPULATION: extra.POPULATION ?? null,
        HOUSE: extra.HOUSE ?? null,
        VILLAGES: villages?.counts?.[id] ?? null,
      },
      geometry: roundGeometry(feature.geometry),
    };
  })
  .sort((left, right) => left.properties.ADMIN_ID3.localeCompare(right.properties.ADMIN_ID3));

if (features.length !== EXPECTED_TAMBONS) {
  throw new Error(`คาดว่าจะได้ ${EXPECTED_TAMBONS} ตำบล แต่ได้ ${features.length} ตำบล`);
}

const collection = {
  type: "FeatureCollection",
  name: "lopburi_court_tambon",
  description: "ขอบเขตตำบลในเขตอำนาจศาลจังหวัดลพบุรี 85 ตำบล",
  source: "Thailand Subdistrict Boundaries (Globetech / MERKATOR) + DOPA village counts",
  amphoeCodes: COURT_AMPHOE_CODES,
  generatedFrom: "tools/build-court-data.mjs",
  features,
};

await fs.writeFile(new URL("data/court-tambon.geojson", root), `${JSON.stringify(collection)}\n`, "utf8");
const withPopulation = features.filter((feature) => feature.properties.POPULATION).length;
console.log(`สร้าง data/court-tambon.geojson แล้ว ${features.length} ตำบล (มีข้อมูลประชากร ${withPopulation} ตำบล)`);
