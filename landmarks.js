"use strict";

// Decorative landmarks are deliberately separate from assignment data. They
// never change a tambon owner, price, search result, or the map's GeoJSON.
(function registerMapLibreLandmarks() {
  const LANDMARKS = Object.freeze([
    // baseline is the transparent lower margin inside each generated PNG.  It
    // is applied to the image only, so the visual base—not an invisible edge—
    // is exactly at the geographic coordinate.
    { id: "phra-prang-sam-yot", areaId: "160102", name: "พระปรางค์สามยอด", district: "ตำบลท่าหิน · อำเภอเมืองลพบุรี", description: "โบราณสถานสำคัญของลพบุรี", coordinates: [100.6141130, 14.8029199], type: "prang", image: "assets/landmarks/phra-prang-sam-yot.png", baseline: "9.90%" },
    { id: "wat-khao-wong-phrachan", areaId: "160305", name: "วัดเขาวงพระจันทร์", district: "ตำบลห้วยโป่ง · อำเภอโคกสำโรง", description: "จุดสักการะบนเขาวงพระจันทร์", coordinates: [100.6974408, 14.9669191], type: "mountain", image: "assets/landmarks/wat-khao-wong-phrachan.png", baseline: "6.25%" },
    { id: "pa-sak-jolasid-dam", areaId: "160207", name: "เขื่อนป่าสักชลสิทธิ์", district: "ตำบลหนองบัว · อำเภอพัฒนานิคม", description: "เขื่อนและแหล่งเก็บกักน้ำสำคัญของลพบุรี", coordinates: [101.0620622, 14.8668986], type: "dam", image: "assets/landmarks/pa-sak-jolasid-dam.png", baseline: "18.23%" },
  ]);

  function popupContent(landmark) {
    const content = document.createElement("div");
    const title = document.createElement("div"); title.className = "popup-title"; title.textContent = landmark.name;
    const district = document.createElement("div"); district.className = "popup-sub"; district.textContent = landmark.district;
    const detail = document.createElement("div"); detail.className = "popup-sub"; detail.textContent = landmark.description;
    content.append(title, district, detail);
    return content;
  }

  function markerElement(landmark) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `landmark-marker landmark-${landmark.type}`;
    button.dataset.landmark = landmark.id;
    button.title = landmark.name;
    button.setAttribute("aria-label", `ดูข้อมูล ${landmark.name}`);
    button.style.setProperty("--landmark-image-baseline", landmark.baseline || "0%");
    const model = document.createElement("span"); model.className = "landmark-model has-image"; model.setAttribute("aria-hidden", "true");
    const image = document.createElement("img"); image.src = landmark.image; image.alt = ""; image.decoding = "async";
    image.addEventListener("error", () => { image.remove(); model.classList.remove("has-image"); });
    model.append(image);
    for (let index = 1; index <= 3; index += 1) { const piece = document.createElement("i"); piece.className = `landmark-piece landmark-piece-${index}`; model.append(piece); }
    const name = document.createElement("span"); name.className = "landmark-name"; name.textContent = landmark.name;
    button.append(model, name);
    return button;
  }

  function boxesOverlap(first, second) {
    return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
  }

  function labelNames(landmark) {
    const [tambonPart = "", districtPart = ""] = String(landmark.district || "").split(" · ");
    return { tambon: tambonPart.replace(/^ตำบล/, "").trim(), district: districtPart.replace(/^อำเภอ/, "").trim() };
  }

  function normalLabelText(element) {
    return String(element?.textContent || "").replace(/\s+/g, " ").trim().replace(/^อำเภอ/, "");
  }

  function landmarkSize(map) {
    const minimum = window.innerWidth <= 680 ? 30 : 34;
    const maximum = window.innerWidth <= 680 ? 56 : 64;
    return Math.round(Math.min(maximum, Math.max(minimum, minimum + (map.getZoom() - 8.2) * 12)));
  }

  function labelForLandmark(landmark) {
    const names = labelNames(landmark);
    const tambon = Array.from(document.querySelectorAll(".map-area-label,.map-tambon-label,.display-tambon-label"))
      .find((element) => normalLabelText(element).startsWith(names.tambon));
    if (tambon) return tambon;
    return Array.from(document.querySelectorAll(".map-district-label,.display-district-label"))
      .find((element) => normalLabelText(element) === names.district) || null;
  }

  function addToMap(map) {
    if (!map || !window.maplibregl) return { remove() {} };
    const container = map.getContainer();
    const entries = LANDMARKS.map((landmark) => {
      const element = markerElement(landmark);
      element.classList.add("landmark-label-anchor");
      element.hidden = true;
      container.append(element);
      element.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        const mapBounds = container.getBoundingClientRect(); const iconBounds = element.getBoundingClientRect();
        const point = [iconBounds.left - mapBounds.left + iconBounds.width / 2, iconBounds.top - mapBounds.top + iconBounds.height / 2];
        new maplibregl.Popup({ offset: 12, closeButton: true, focusAfterOpen: false }).setLngLat(map.unproject(point)).setDOMContent(popupContent(landmark)).addTo(map);
      });
      return { element, landmark };
    });
    const positionMarkers = () => {
      const mapBounds = container.getBoundingClientRect();
      const labels = Array.from(document.querySelectorAll(".map-area-label,.map-tambon-label,.map-district-label,.display-tambon-label,.display-district-label"))
        .filter((element) => element.offsetParent !== null);
      const occupied = labels.map((element) => element.getBoundingClientRect());
      for (const control of container.querySelectorAll(".maplibregl-ctrl")) occupied.push(control.getBoundingClientRect());
      for (const entry of entries) {
        const anchor = labelForLandmark(entry.landmark);
        if (!anchor) { entry.element.hidden = true; continue; }
        const size = landmarkSize(map); const label = anchor.getBoundingClientRect();
        const candidates = [[label.right + 4, label.top + (label.height - size) / 2], [label.left - size - 4, label.top + (label.height - size) / 2], [label.left + (label.width - size) / 2, label.top - size - 4], [label.left + (label.width - size) / 2, label.bottom + 4]];
        let placement = null;
        for (const [left, top] of candidates) {
          const box = { left, top, right: left + size, bottom: top + size };
          const insideMap = box.left >= mapBounds.left + 4 && box.right <= mapBounds.right - 4 && box.top >= mapBounds.top + 4 && box.bottom <= mapBounds.bottom - 4;
          if (insideMap && !occupied.some((other) => boxesOverlap(box, other))) { placement = { left, top, box }; break; }
          if (!placement && insideMap) placement = { left, top, box };
        }
        if (!placement) { entry.element.hidden = true; continue; }
        entry.element.style.setProperty("--landmark-size", `${size}px`);
        entry.element.style.left = `${placement.left - mapBounds.left}px`;
        entry.element.style.top = `${placement.top - mapBounds.top}px`;
        entry.element.hidden = false;
        occupied.push(placement.box);
      }
    };
    let frame = 0; let settleTimer = 0;
    const scheduleLayout = (settle = false) => {
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; positionMarkers(); });
      if (settle) { window.clearTimeout(settleTimer); settleTimer = window.setTimeout(positionMarkers, 260); }
    };
    const onMove = () => scheduleLayout(false); const onSettle = () => scheduleLayout(true);
    map.on("move", onMove); map.on("moveend", onSettle); map.on("zoomend", onSettle); map.on("idle", onSettle); scheduleLayout(true);
    return { remove() { map.off("move", onMove); map.off("moveend", onSettle); map.off("zoomend", onSettle); map.off("idle", onSettle); window.cancelAnimationFrame(frame); window.clearTimeout(settleTimer); for (const { element } of entries) element.remove(); }, update: () => scheduleLayout(true) };
  }

  window.MapLibreLandmarks = Object.freeze({ landmarks: LANDMARKS, addToMap });
}());
