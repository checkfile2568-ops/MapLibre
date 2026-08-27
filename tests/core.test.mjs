/**
 * ทดสอบกติกาข้อมูลใน core.js
 * รันด้วย: node --test tests/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../core.js");

test("ยอดแสดงเป็นตัวเลขล้วน ไม่มีหน่วยเงิน", () => {
  assert.equal(Core.formatAmount(1250), "1,250");
  assert.equal(Core.formatAmount(750.5), "750.5");
  assert.equal(Core.formatAmount(null), "—");
  assert.ok(!Core.formatAmount(500).includes("บาท"));
  assert.ok(!Core.formatAmount(500).includes("฿"));
});

test("อ่านเลขไทย คอมมา และคำว่าบาทจากไฟล์เก่าได้", () => {
  assert.equal(Core.parseAmount("๗๕๐"), 750);
  assert.equal(Core.parseAmount("1,250.50"), 1250.5);
  assert.equal(Core.parseAmount("500 บาท"), 500);
  assert.equal(Core.parseAmount("฿640"), 640);
});

test("ปฏิเสธยอดที่ผิดรูปแบบ", () => {
  assert.equal(Core.parseAmount("-10"), null);
  assert.equal(Core.parseAmount("12.345"), null);
  assert.equal(Core.parseAmount("ห้าร้อย"), null);
  assert.equal(Core.parseAmount(""), null);
});

test("ล้างอักขระแฝงและช่องว่างซ้ำในชื่อ", () => {
  assert.equal(Core.sanitizeName("​ชนินทร์  ทดสอบ "), "ชนินทร์ ทดสอบ");
});

test("รหัสอำเภอในเขตศาลมี 6 แห่งและตรวจพื้นที่ได้", () => {
  assert.equal(Core.COURT_AMPHOE_CODES.size, 6);
  assert.ok(Core.isCourtFeature({ properties: { ADMIN_ID2: "1601" } }));
  assert.ok(!Core.isCourtFeature({ properties: { ADMIN_ID2: "1604" } }));
});

test("อ่านค่าจากขอบเขตได้ทั้งรูปแบบ ArcGIS และไฟล์ในเครื่อง", () => {
  const arcgis = { properties: { ADMIN_ID3: "160102", ADMIN_ID2: "1601", NAME2: "เมืองลพบุรี", NAME3: "ท่าหิน" } };
  const local = { properties: { tambon_code: "TH160102", amphoe_code: "TH1601", amphoe_th: "เมืองลพบุรี", tambon_th: "ท่าหิน" } };
  for (const feature of [arcgis, local]) {
    assert.equal(Core.areaId(feature), "160102");
    assert.equal(Core.amphoeCode(feature), "1601");
    assert.equal(Core.districtName(feature), "เมืองลพบุรี");
    assert.equal(Core.tambonName(feature), "ท่าหิน");
  }
});

test("normalizeState เติมค่าเริ่มต้นครบและคง version 4", () => {
  const state = Core.normalizeState({ staff: [{ id: "a", name: "ก", color: "#111" }], assignments: { "160102": "a" } });
  assert.equal(state.version, 4);
  assert.equal(state.staff.length, 1);
  assert.equal(state.publishPrices, true);
  assert.deepEqual(state.prices, {});
});

test("filterStateToFeatures ตัดพื้นที่และคนที่ไม่มีอยู่จริงออก", () => {
  const features = [{ properties: { ADMIN_ID3: "160102", ADMIN_ID2: "1601", NAME2: "เมืองลพบุรี", NAME3: "ท่าหิน" } }];
  const filtered = Core.filterStateToFeatures({
    staff: [{ id: "a", name: "ก", color: "#111" }],
    assignments: { "160102": "a", "999999": "a", "160103": "ghost" },
    prices: { "160102": 500, "999999": 900 },
  }, features);
  assert.deepEqual(Object.keys(filtered.assignments), ["160102"]);
  assert.deepEqual(Object.keys(filtered.prices), ["160102"]);
});

test("นำเข้ายอดจากข้อความ แยกตำบลชื่อซ้ำด้วยชื่ออำเภอ", () => {
  const features = [
    { properties: { ADMIN_ID3: "160502", ADMIN_ID2: "1605", NAME2: "ท่าวุ้ง", NAME3: "บางคู้" } },
    { properties: { ADMIN_ID3: "160101", ADMIN_ID2: "1601", NAME2: "เมืองลพบุรี", NAME3: "ทะเลชุบศร" } },
  ];
  const parsed = Core.parsePriceLines("เมืองลพบุรี/ทะเลชุบศร 500\nท่าวุ้ง/บางคู้ ๗๕๐\nไม่มีตำบลนี้ 100", features);
  assert.equal(parsed.applied.length, 2);
  assert.equal(parsed.applied[0].amount, 500);
  assert.equal(parsed.applied[1].amount, 750);
  assert.equal(parsed.notFound.length, 1);
});

test("describeChanges สรุปการเปลี่ยนแปลงเป็นข้อความ commit", () => {
  const before = Core.normalizeState({ staff: [{ id: "a", name: "ก", color: "#111" }], assignments: { "160102": "a" }, prices: { "160102": 100 } });
  const after = Core.normalizeState({
    staff: [{ id: "a", name: "ก", color: "#111" }, { id: "b", name: "ข", color: "#222" }],
    assignments: { "160102": "b", "160103": "a" },
    prices: { "160102": 200 },
  });
  const message = Core.describeChanges(before, after);
  assert.match(message, /เพิ่มเจ้าหน้าที่ 1 คน/);
  assert.match(message, /มอบหมายเพิ่ม 1 ตำบล/);
  assert.match(message, /ย้ายผู้รับผิดชอบ 1 ตำบล/);
  assert.match(message, /แก้ยอด 1 ตำบล/);
});

test("describeChanges บอกได้เมื่อไม่มีอะไรเปลี่ยน", () => {
  const state = Core.normalizeState({ staff: [], assignments: {}, prices: {} });
  assert.match(Core.describeChanges(state, state), /ไม่มีการเปลี่ยนแปลง/);
});

test("sumPrices รวมยอดเฉพาะพื้นที่ที่มีค่า", () => {
  const features = [
    { properties: { ADMIN_ID3: "160101" } },
    { properties: { ADMIN_ID3: "160102" } },
  ];
  assert.equal(Core.sumPrices(features, { "160101": 500, "160102": 250.5 }), 750.5);
  assert.equal(Core.sumPrices(features, { "160101": 500 }), 500);
});

test("วันที่แสดงเป็นพุทธศักราช", () => {
  assert.match(Core.formatThaiDate("2026-08-03T06:35:20Z"), /2569/);
  assert.equal(Core.formatThaiDate(null), "—");
});
