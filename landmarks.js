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

  function elevatedPoint(map, coordinates, elevation) {
    const transform = map?.transform;
    const MercatorCoordinate = window.maplibregl?.MercatorCoordinate;
    const elevationMatrix = transform?._pixelMatrix3D;
    if (!Number.isFinite(elevation) || elevation <= 0 || !transform?.coordinatePoint || !elevationMatrix || !MercatorCoordinate?.fromLngLat) return map.project(coordinates);
    try {
      // Markers use map.project() at ground level, whereas fill-extrusion draws
      // the coloured tambon on its raised top surface.  MapLibre maintains a
      // separate 3D pixel matrix for an elevated point.  The ordinary matrix
      // (the previous implementation) projects only the ground plane, which
      // leaves DOM markers visibly detached when the camera is tilted.
      // Project the same location with that 3D matrix and use the screen-space
      // delta as the marker offset.  It follows the surface through pan, zoom
      // and every frame of the 3D camera transition.
      const raised = transform.coordinatePoint(MercatorCoordinate.fromLngLat(coordinates), elevation, elevationMatrix);
      return Number.isFinite(raised?.x) && Number.isFinite(raised?.y) ? raised : map.project(coordinates);
    } catch {
      // If a future MapLibre release changes this optional projection helper,
      // retain the safe ground-level marker instead of breaking the map.
      return map.project(coordinates);
    }
  }

  function surfaceOffset(map, coordinates, elevation) {
    const ground = map.project(coordinates);
    const raised = elevatedPoint(map, coordinates, elevation);
    const x = raised.x - ground.x;
    const y = raised.y - ground.y;
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : [0, 0];
  }

  function geometryBounds(geometry) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const visit = (coordinates) => {
      if (typeof coordinates?.[0] === "number") {
        bounds[0] = Math.min(bounds[0], coordinates[0]); bounds[1] = Math.min(bounds[1], coordinates[1]);
        bounds[2] = Math.max(bounds[2], coordinates[0]); bounds[3] = Math.max(bounds[3], coordinates[1]);
        return;
      }
      for (const coordinate of coordinates || []) visit(coordinate);
    };
    visit(geometry?.coordinates);
    return Number.isFinite(bounds[0]) ? bounds : null;
  }

  function pointInRing(point, ring) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const currentPoint = ring[index]; const previousPoint = ring[previous];
      const crosses = ((currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]))
        && (point[0] < (previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]) / (previousPoint[1] - currentPoint[1]) + currentPoint[0]);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function pointInGeometry(point, geometry) {
    const containsPolygon = (polygon) => pointInRing(point, polygon[0] || []) && !polygon.slice(1).some((ring) => pointInRing(point, ring));
    if (geometry?.type === "Polygon") return containsPolygon(geometry.coordinates);
    if (geometry?.type === "MultiPolygon") return geometry.coordinates.some(containsPolygon);
    return false;
  }

  function candidateCoordinates(landmark, getPlacementFeature) {
    const feature = getPlacementFeature?.(landmark);
    const geometry = feature?.geometry;
    const bounds = geometryBounds(geometry);
    if (!bounds) return [landmark.coordinates];
    const candidates = [];
    const add = (coordinate) => {
      if (!pointInGeometry(coordinate, geometry) || candidates.some((candidate) => Math.abs(candidate[0] - coordinate[0]) < 0.000001 && Math.abs(candidate[1] - coordinate[1]) < 0.000001)) return;
      candidates.push(coordinate);
    };
    add(landmark.coordinates);
    // A small interior grid gives each landmark several safe alternatives while
    // keeping it in its own tambon and close to the real-world coordinate.
    const [west, south, east, north] = bounds;
    for (const x of [0.18, 0.32, 0.46, 0.60, 0.74, 0.86]) {
      for (const y of [0.18, 0.32, 0.46, 0.60, 0.74, 0.86]) add([west + (east - west) * x, south + (north - south) * y]);
    }
    return candidates.sort((first, second) => {
      const firstDistance = Math.hypot((first[0] - landmark.coordinates[0]) * Math.cos(landmark.coordinates[1] * Math.PI / 180), first[1] - landmark.coordinates[1]);
      const secondDistance = Math.hypot((second[0] - landmark.coordinates[0]) * Math.cos(landmark.coordinates[1] * Math.PI / 180), second[1] - landmark.coordinates[1]);
      return firstDistance - secondDistance;
    });
  }

  function boxesOverlap(first, second) {
    return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
  }

  function addToMap(map, { getSurfaceElevation = () => 0, getPlacementFeature = () => null } = {}) {
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
      return { element, landmark, marker, coordinates: landmark.coordinates, surfaceOffset: [0, 0] };
    });
    const syncSurfaceAnchors = () => {
      for (const entry of entries) {
        const elevation = Number(getSurfaceElevation(entry.landmark) || 0);
        const next = surfaceOffset(map, entry.coordinates, elevation);
        if (Math.abs(next[0] - entry.surfaceOffset[0]) < 0.1 && Math.abs(next[1] - entry.surfaceOffset[1]) < 0.1) continue;
        entry.surfaceOffset = next;
        entry.marker.setOffset(next);
      }
    };
    const mapLabelBoxes = (mapBounds) => Array.from(document.querySelectorAll(".map-area-label,.map-district-label,.display-tambon-label,.display-district-label"))
      .filter((element) => element.offsetParent !== null)
      .map((element) => element.getBoundingClientRect());
    const positionMarkers = () => {
      const mapBounds = map.getContainer().getBoundingClientRect();
      const occupied = mapLabelBoxes(mapBounds);
      for (const entry of entries) {
        if (entry.element.hidden) continue;
        const model = entry.element.querySelector(".landmark-model");
        const modelBounds = model?.getBoundingClientRect();
        const width = Math.max(40, modelBounds?.width || (window.innerWidth <= 680 ? 48 : 64));
        const height = Math.max(40, modelBounds?.height || (window.innerWidth <= 680 ? 48 : 64));
        const elevation = Number(getSurfaceElevation(entry.landmark) || 0);
        let selection = null;
        for (const coordinates of candidateCoordinates(entry.landmark, getPlacementFeature)) {
          const point = elevatedPoint(map, coordinates, elevation);
          const box = { left: mapBounds.left + point.x - width / 2, right: mapBounds.left + point.x + width / 2, top: mapBounds.top + point.y - height, bottom: mapBounds.top + point.y };
          const insideMap = box.left >= mapBounds.left + 4 && box.right <= mapBounds.right - 4 && box.top >= mapBounds.top + 4 && box.bottom <= mapBounds.bottom - 4;
          if (insideMap && !occupied.some((other) => boxesOverlap(box, other))) { selection = { coordinates, box }; break; }
          if (!selection) selection = { coordinates, box };
        }
        if (!selection) continue;
        const changed = Math.abs(entry.coordinates[0] - selection.coordinates[0]) > 0.000001 || Math.abs(entry.coordinates[1] - selection.coordinates[1]) > 0.000001;
        entry.coordinates = selection.coordinates;
        if (changed) entry.marker.setLngLat(entry.coordinates);
        entry.surfaceOffset = surfaceOffset(map, entry.coordinates, elevation);
        entry.marker.setOffset(entry.surfaceOffset);
        occupied.push(selection.box);
      }
    };
    const positionLabels = () => {
      const mapBounds = map.getContainer().getBoundingClientRect();
      const occupied = mapLabelBoxes(mapBounds);
      for (const { element } of entries) {
        const model = element.querySelector(".landmark-model");
        if (model && !element.hidden) occupied.push(model.getBoundingClientRect());
      }
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
          if (insideMap && !occupied.some((other) => boxesOverlap(box, other))) { occupied.push(box); placed = true; break; }
        }
        if (!placed) name.hidden = true;
      }
    };
    const scheduleLayout = () => window.setTimeout(() => { positionMarkers(); positionLabels(); }, 70);
    const updateVisibility = () => {
      syncSurfaceAnchors();
      const zoom = map.getZoom();
      for (const { element } of entries) { element.hidden = zoom < 8.2; element.classList.toggle("is-compact", zoom < 10.2); }
      scheduleLayout();
    };
    map.on("move", syncSurfaceAnchors); map.on("zoomend", updateVisibility); map.on("moveend", scheduleLayout); updateVisibility();
    return { remove() { map.off("move", syncSurfaceAnchors); map.off("zoomend", updateVisibility); map.off("moveend", scheduleLayout); for (const { marker } of entries) marker.remove(); }, update: updateVisibility };
  }

  window.MapLibreLandmarks = Object.freeze({ landmarks: LANDMARKS, addToMap });
}());
