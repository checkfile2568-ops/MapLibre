"use strict";

// Decorative landmarks are deliberately separate from assignment data. They
// never change a tambon owner, price, search result, or the map's GeoJSON.
(function registerMapLibreLandmarks() {
  const LANDMARKS = Object.freeze([
    { id: "phra-prang-sam-yot", name: "พระปรางค์สามยอด", district: "ตำบลท่าหิน · อำเภอเมืองลพบุรี", description: "โบราณสถานสำคัญของลพบุรี", coordinates: [100.6141130, 14.8029199], type: "prang" },
    { id: "wat-khao-wong-phrachan", name: "วัดเขาวงพระจันทร์", district: "ตำบลห้วยโป่ง · อำเภอโคกสำโรง", description: "จุดสักการะบนเขาวงพระจันทร์", coordinates: [100.6974408, 14.9669191], type: "mountain" },
    { id: "pa-sak-jolasid-dam", name: "เขื่อนป่าสักชลสิทธิ์", district: "ตำบลแก่งเสือเต้น · อำเภอพัฒนานิคม", description: "เขื่อนและแหล่งเก็บกักน้ำสำคัญของลพบุรี", coordinates: [101.0620622, 14.8668986], type: "dam" },
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
    const model = document.createElement("span"); model.className = "landmark-model"; model.setAttribute("aria-hidden", "true");
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
    const updateVisibility = () => {
      const zoom = map.getZoom();
      for (const { element } of entries) { element.hidden = zoom < 8.2; element.classList.toggle("is-compact", zoom < 10.2); }
    };
    map.on("zoomend", updateVisibility); updateVisibility();
    return { remove() { map.off("zoomend", updateVisibility); for (const { marker } of entries) marker.remove(); }, update: updateVisibility };
  }

  window.MapLibreLandmarks = Object.freeze({ landmarks: LANDMARKS, addToMap });
}());
