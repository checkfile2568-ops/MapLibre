/**
 * ทดสอบความถูกต้องของไฟล์ข้อมูลในระบบ
 * ป้องกันไม่ให้ commit ไฟล์ที่ขอบเขตหาย ตำบลไม่ครบ หรือคีย์ไม่ตรงกัน
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../core.js");
const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await fs.readFile(new URL(path, root), "utf8"));

const boundaries = await readJson("data/court-tambon.geojson");
const assignments = await readJson("data/assignments.json");

test("ขอบเขตมีครบ 85 ตำบลในเขตศาล", () => {
  assert.equal(boundaries.features.length, Core.EXPECTED_COURT_TAMBONS);
  for (const feature of boundaries.features) {
    assert.ok(Core.isCourtFeature(feature), `${Core.areaId(feature)} อยู่นอกเขตศาล`);
    assert.ok(Core.tambonName(feature), "ตำบลต้องมีชื่อ");
    assert.ok(feature.geometry?.coordinates?.length, "ตำบลต้องมีรูปทรง");
  }
});

test("รหัสตำบลไม่ซ้ำและครบ 6 อำเภอ", () => {
  const ids = boundaries.features.map(Core.areaId);
  assert.equal(new Set(ids).size, ids.length);
  const amphoes = new Set(boundaries.features.map(Core.amphoeCode));
  assert.deepEqual([...amphoes].sort(), [...Core.COURT_AMPHOE_CODES].sort());
});

test("ทุกการมอบหมายและทุกยอดชี้ไปยังตำบลที่มีอยู่จริง", () => {
  const ids = new Set(boundaries.features.map(Core.areaId));
  for (const key of Object.keys(assignments.assignments)) assert.ok(ids.has(key), `ไม่พบตำบลรหัส ${key}`);
  for (const key of Object.keys(assignments.prices || {})) assert.ok(ids.has(key), `ไม่พบตำบลรหัส ${key}`);
});

test("ทุกการมอบหมายชี้ไปยังเจ้าหน้าที่ที่มีอยู่จริง", () => {
  const staffIds = new Set(assignments.staff.map((person) => person.id));
  for (const value of Object.values(assignments.assignments)) assert.ok(staffIds.has(value), `ไม่พบเจ้าหน้าที่ ${value}`);
});

test("สีเจ้าหน้าที่ไม่ซ้ำกัน", () => {
  const colors = assignments.staff.map((person) => person.color.toLowerCase());
  assert.equal(new Set(colors).size, colors.length);
});
