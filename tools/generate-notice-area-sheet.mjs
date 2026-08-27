#!/usr/bin/env node
/**
 * สร้าง data/notice-area-sheet.csv สำหรับนำเข้า Google Sheets
 * อ่านจาก data/court-tambon.geojson และ data/assignments.json
 * (หน้าตั้งค่าระบบสร้างไฟล์นี้ให้อัตโนมัติทุกครั้งที่กดบันทึกส่วนกลางอยู่แล้ว
 *  สคริปต์นี้ใช้เมื่อต้องการสร้างซ้ำจากบรรทัดคำสั่ง)
 */
import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await fs.readFile(new URL(path, root), "utf8"));

const data = await readJson("data/assignments.json");
const geojson = await readJson("data/court-tambon.geojson");
const people = new Map(data.staff.map((person) => [person.id, person.name]));
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;

const rows = geojson.features
  .slice()
  .sort((left, right) =>
    `${left.properties.NAME2} ${left.properties.NAME3}`.localeCompare(`${right.properties.NAME2} ${right.properties.NAME3}`, "th"))
  .map((feature) => [
    `อำเภอ${feature.properties.NAME2} / ตำบล${feature.properties.NAME3}`,
    people.get(data.assignments[feature.properties.ADMIN_ID3]) || "ยังไม่มอบหมาย",
  ]);

if (rows.length !== 85) throw new Error(`คาดว่าจะได้ 85 ตำบล แต่ได้ ${rows.length} ตำบล`);

await fs.writeFile(
  new URL("data/notice-area-sheet.csv", root),
  `﻿${rows.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`,
  "utf8"
);
console.log(`สร้าง data/notice-area-sheet.csv แล้ว ${rows.length} แถว`);
