/**
 * ทดสอบว่าไฟล์หน้าเว็บกับโค้ดยังตรงกัน
 * จับข้อผิดพลาดที่พบบ่อย: ลืมใส่ id ในหน้า HTML หรือใส่เลขรุ่นไม่ตรงกัน
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../core.js");
const root = new URL("../", import.meta.url);
const read = async (path) => fs.readFile(new URL(path, root), "utf8");

const pages = { "index.html": await read("index.html"), "view.html": await read("view.html") };
const scripts = { "app.js": await read("app.js"), "view.js": await read("view.js") };

function idsRequestedBy(source) {
  const block = source.match(/const dom = Object\.fromEntries\(\[([\s\S]*?)\]\.map/);
  if (!block) return [];
  return [...block[1].matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
}

function idsInPage(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
}

test("ทุก id ที่ app.js เรียกใช้ มีอยู่ใน index.html", () => {
  const available = idsInPage(pages["index.html"]);
  for (const id of idsRequestedBy(scripts["app.js"])) assert.ok(available.has(id), `index.html ไม่มี id="${id}"`);
});

test("ทุก id ที่ view.js เรียกใช้ มีอยู่ใน view.html", () => {
  const available = idsInPage(pages["view.html"]);
  for (const id of idsRequestedBy(scripts["view.js"])) assert.ok(available.has(id), `view.html ไม่มี id="${id}"`);
});

test("ไม่มี id ซ้ำในหน้าเดียวกัน", () => {
  for (const [name, html] of Object.entries(pages)) {
    const all = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(all).size, all.length, `${name} มี id ซ้ำ`);
  }
});

test("เลขรุ่นท้าย URL ตรงกับ APP_VERSION ทุกไฟล์ทั้งสองหน้า", () => {
  for (const [name, html] of Object.entries(pages)) {
    const versions = new Set([...html.matchAll(/\?v=([0-9.]+)/g)].map((match) => match[1]));
    assert.deepEqual([...versions], [Core.APP_VERSION], `${name} ใช้เลขรุ่นไม่ตรงกับ core.js`);
  }
});

test("โหลด core.js ก่อนไฟล์อื่นเสมอ", () => {
  for (const [name, html] of Object.entries(pages)) {
    const order = [...html.matchAll(/<script src="([^"?]+)/g)].map((match) => match[1]);
    assert.ok(order.indexOf("core.js") < order.indexOf("map-engine.js"), `${name} โหลด core.js ช้าเกินไป`);
    assert.ok(order.includes("vendor/maplibre-gl.js"), `${name} ต้องใช้ MapLibre จากไฟล์ในระบบ ไม่ใช่ CDN`);
  }
});

test("ไม่มีการเรียกสคริปต์จาก CDN ภายนอกอีก", () => {
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(!/<script[^>]+src="https?:/.test(html), `${name} ยังมีสคริปต์จากภายนอก`);
  }
});

test("ไม่มีคำว่าบาทหรือสัญลักษณ์เงินหลงเหลือในส่วนติดต่อผู้ใช้", () => {
  for (const [name, source] of Object.entries({ ...pages, ...scripts })) {
    assert.ok(!source.includes("฿"), `${name} ยังมีสัญลักษณ์เงิน`);
    assert.ok(!/ยอด \(บาท\)/.test(source), `${name} ยังมีหัวคอลัมน์ยอด (บาท)`);
  }
});

test("รหัสบันทึกถูกเก็บใน sessionStorage เท่านั้น", () => {
  const setters = [...scripts["app.js"].matchAll(/(local|session)Storage\.setItem\((\w+)/g)];
  for (const [, kind, variable] of setters) {
    if (/TOKEN/.test(variable)) assert.equal(kind, "session", "รหัส GitHub ต้องไม่ถูกเก็บถาวรใน localStorage");
  }
});
