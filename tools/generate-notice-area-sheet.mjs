import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const data = JSON.parse(await fs.readFile(new URL("data/assignments.json", root), "utf8"));
const geojson = JSON.parse(await fs.readFile(new URL("data/map-overview/lopburi_tambon.geojson", root), "utf8"));
const courtAmphoes = new Set(["1601", "1602", "1603", "1605", "1606", "1611"]);
const people = new Map(data.staff.map((person) => [person.id, person.name]));
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const rows = geojson.features
  .filter((feature) => courtAmphoes.has(String(feature.properties.amphoe_code || "").replace(/^TH/i, "")))
  .sort((left, right) => `${left.properties.amphoe_th} ${left.properties.tambon_th}`.localeCompare(`${right.properties.amphoe_th} ${right.properties.tambon_th}`, "th"))
  .map((feature) => {
    const id = String(feature.properties.tambon_code || "").replace(/^TH/i, "");
    const area = `อำเภอ${feature.properties.amphoe_th} / ตำบล${feature.properties.tambon_th}`;
    return [area, people.get(data.assignments[id]) || "ยังไม่มอบหมาย"];
  });

if (rows.length !== 85) throw new Error(`Expected 85 court tambons, received ${rows.length}`);
await fs.writeFile(new URL("data/notice-area-sheet.csv", root), `\uFEFF${rows.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`, "utf8");
console.log(`Generated ${rows.length} notice area rows.`);
