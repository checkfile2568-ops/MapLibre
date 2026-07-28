"use strict";

// Decorative landmarks are deliberately separate from assignment data. They
// never change a tambon owner, price, search result, or the map's GeoJSON.
(function registerMapLibreLandmarks() {
  const LANDMARKS = Object.freeze([
    { id: "phra-prang-sam-yot", name: "พระปรางค์สามยอด", district: "ตำบลท่าหิน · อำเภอเมืองลพบุรี", description: "โบราณสถานสำคัญของลพบุรี", coordinates: [100.6141130, 14.8029199], type: "prang", image: "assets/landmarks/phra-prang-sam-yot.png" },
    { id: "wat-khao-wong-phrachan", name: "วัดเขาวงพระจันทร์", district: "ตำบลห้วยโป่ง · อำเภอโคกสำโรง", description: "จุดสักการะบนเขาวงพระจันทร์", coordinates: [100.6974408, 14.9669191], type: "mountain", image: "assets/landmarks/wat-khao-wong-phrachan.png" },
    { id: "pa-sak-jolasid-dam", name: "เขื่อนป่าสักชลสิทธิ์", district: "ตำบลแก่งเสือเต้น · อำเภอพัฒนานิคม", description: "เขื่อนและแหล่งเก็บกักน้ำสำคัญของลพบุรี", coordinates: [101.0620622, 14.8668986], type: "dam", image: "assets/landmarks/pa-sak-jolasid-dam.png" },
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
    const model = document.createElement("span"); model.className = "landmark-model has-image"; model.setAttribute("aria-hidden", "true");
    const image = document.createElement("img"); image.src = landmark.image; image.alt = ""; image.decoding = "async";
    image.addEventListener("error", () => { image.remove(); model.classList.remove("has-image"); });
    model.append(image);
    for (let index = 1; index <= 3; index += 1) { const piece = document.createElement("i"); piece.className = `landmark-piece landmark-piece-${index}`; model.append(piece); }
    const name = document.createElement("span"); name.className = "landmark-name"; name.textContent = landmark.name;
    button.append(model, name);
    return button;
  }

  function addToMap(map) {
    if (!map || !window.maplibregl) return { remove() {} };
    const entries = LANDMARKS.map((landmark) => {
      const element = markerElement(landmark);
      const marker = new maplibregl.Marker({ element, anchor: "bottom", offset: [0, 3] }).setLngLat(landmark.coordinates).addTo(map);
      element.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        new maplibregl.Popup({ offset: 16, closeButton: true, focusAfterOpen: false }).setLngLat(landmark.coordinates).setDOMContent(popupContent(landmark)).addTo(map);
      });
      return { element, marker };
    });
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
      const zoom = map.getZoom();
      for (const { element } of entries) { element.hidden = zoom < 8.2; element.classList.toggle("is-compact", zoom < 10.2); }
      scheduleLabelPositioning();
    };
    map.on("zoomend", updateVisibility); map.on("moveend", scheduleLabelPositioning); updateVisibility();
    return { remove() { map.off("zoomend", updateVisibility); map.off("moveend", scheduleLabelPositioning); for (const { marker } of entries) marker.remove(); }, update: updateVisibility };
  }

  window.MapLibreLandmarks = Object.freeze({ landmarks: LANDMARKS, addToMap });
}());
