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

  function surfaceOffset(map, landmark, getSurfaceElevation) {
    const elevation = Number(getSurfaceElevation?.(landmark) || 0);
    const transform = map?.transform;
    const MercatorCoordinate = window.maplibregl?.MercatorCoordinate;
    const elevationMatrix = transform?._pixelMatrix3D;
    if (!Number.isFinite(elevation) || elevation <= 0 || !transform?.coordinatePoint || !elevationMatrix || !MercatorCoordinate?.fromLngLat) return [0, 0];
    try {
      // Markers use map.project() at ground level, whereas fill-extrusion draws
      // the coloured tambon on its raised top surface.  MapLibre maintains a
      // separate 3D pixel matrix for an elevated point.  The ordinary matrix
      // (the previous implementation) projects only the ground plane, which
      // leaves DOM markers visibly detached when the camera is tilted.
      // Project the same location with that 3D matrix and use the screen-space
      // delta as the marker offset.  It follows the surface through pan, zoom
      // and every frame of the 3D camera transition.
      const ground = map.project(landmark.coordinates);
      const raised = transform.coordinatePoint(MercatorCoordinate.fromLngLat(landmark.coordinates), elevation, elevationMatrix);
      const x = raised.x - ground.x;
      const y = raised.y - ground.y;
      return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : [0, 0];
    } catch {
      // If a future MapLibre release changes this optional projection helper,
      // retain the safe ground-level marker instead of breaking the map.
      return [0, 0];
    }
  }

  function addToMap(map, { getSurfaceElevation = () => 0 } = {}) {
    if (!map || !window.maplibregl) return { remove() {} };
    const entries = LANDMARKS.map((landmark) => {
      const element = markerElement(landmark);
      // A custom marker is positioned from its box edge.  Keep that edge at
      // the coordinates with no extra downward offset, and avoid the default
      // pixel rounding that is especially visible on small mobile maps.
      const marker = new maplibregl.Marker({
        element,
        anchor: "bottom",
        offset: [0, 0],
        rotationAlignment: "viewport",
        pitchAlignment: "viewport",
        subpixelPositioning: true,
      }).setLngLat(landmark.coordinates).addTo(map);
      element.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        new maplibregl.Popup({ offset: 16, closeButton: true, focusAfterOpen: false }).setLngLat(landmark.coordinates).setDOMContent(popupContent(landmark)).addTo(map);
      });
      return { element, landmark, marker, surfaceOffset: [0, 0] };
    });
    const syncSurfaceAnchors = () => {
      for (const entry of entries) {
        const next = surfaceOffset(map, entry.landmark, getSurfaceElevation);
        if (Math.abs(next[0] - entry.surfaceOffset[0]) < 0.1 && Math.abs(next[1] - entry.surfaceOffset[1]) < 0.1) continue;
        entry.surfaceOffset = next;
        entry.marker.setOffset(next);
      }
    };
    const overlaps = (first, second) => first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
    const positionLabels = () => {
      const mapBounds = map.getContainer().getBoundingClientRect();
      const occupied = Array.from(document.querySelectorAll(".map-area-label,.map-district-label,.display-tambon-label,.display-district-label"))
        .filter((element) => element.offsetParent !== null)
        .map((element) => element.getBoundingClientRect());
      const options = [[0, 0], [54, -42], [-54, -42], [58, 8], [-58, 8], [0, -80]];
      for (const { element } of entries) {
        const name = element.querySelector(".landmark-name");
        if (!name || element.hidden || element.classList.contains("is-compact")) continue;
        name.hidden = false;
        let placed = false;
        for (const [x, y] of options) {
          element.style.setProperty("--landmark-label-x", `${x}px`);
          element.style.setProperty("--landmark-label-y", `${y}px`);
          const box = name.getBoundingClientRect();
          const insideMap = box.left >= mapBounds.left + 4 && box.right <= mapBounds.right - 4 && box.top >= mapBounds.top + 4 && box.bottom <= mapBounds.bottom - 4;
          if (insideMap && !occupied.some((other) => overlaps(box, other))) { occupied.push(box); placed = true; break; }
        }
        if (!placed) name.hidden = true;
      }
    };
    const scheduleLabelPositioning = () => window.setTimeout(positionLabels, 0);
    const updateVisibility = () => {
      syncSurfaceAnchors();
      const zoom = map.getZoom();
      for (const { element } of entries) { element.hidden = zoom < 8.2; element.classList.toggle("is-compact", zoom < 10.2); }
      scheduleLabelPositioning();
    };
    map.on("move", syncSurfaceAnchors); map.on("zoomend", updateVisibility); map.on("moveend", scheduleLabelPositioning); updateVisibility();
    return { remove() { map.off("move", syncSurfaceAnchors); map.off("zoomend", updateVisibility); map.off("moveend", scheduleLabelPositioning); for (const { marker } of entries) marker.remove(); }, update: updateVisibility };
  }

  window.MapLibreLandmarks = Object.freeze({ landmarks: LANDMARKS, addToMap });
}());
