/**
 * map-engine.js — แผนที่ชุดเดียวที่หน้าจัดการและหน้าแสดงผลใช้ร่วมกัน
 *
 * เดิมโค้ดแผนที่ถูกเขียนซ้ำสองชุดใน app.js และ view.js ทำให้สองหน้าจอ
 * ค่อย ๆ เพี้ยนออกจากกัน (สีต่างกัน ป้ายต่างกัน มุมกล้องต่างกัน)
 * ไฟล์นี้รวมทุกอย่างไว้ที่เดียว ทั้งสองหน้าจึงได้แผนที่หน้าตาเดียวกันเสมอ
 *
 * ความสามารถ
 *   • ชั้นข้อมูล ประเทศ → จังหวัด → อำเภอนอกเขต → ตำบลในเขตศาล
 *   • มุมมอง 2 มิติ / 3 มิติ พร้อมกล้องเคลื่อนแบบนุ่ม (ค่อย ๆ เข้า ไม่กระตุก)
 *   • ป้ายชื่อตำบล ชื่ออำเภอ ยอด และชื่อจังหวัดข้างเคียง พร้อมกันชนไม่ให้ทับกัน
 *   • สีทั้งหมดอ่านจาก CSS token จึงเปลี่ยนตามธีมสว่าง/มืดโดยอัตโนมัติ
 *   • เคารพการตั้งค่า "ลดการเคลื่อนไหว" ของระบบปฏิบัติการ
 *
 * [ต่อยอด] เพิ่มชั้นข้อมูลใหม่ ให้เพิ่มใน addLayers() และเพิ่มสีใน readPalette()
 */
(function (global) {
  "use strict";

  const Core = global.MapLibreCore;

  const INTRO_DELAY = 420;
  const INTRO_DURATION = 3200;
  const RISE_DURATION = 1500;

  /** จังหวัดข้างเคียง วางป้ายไว้ฝั่งนอกเส้นแบ่งเขต เพื่อบอกทิศทางบนแผนที่ */
  const ADJACENT_PROVINCES = [
    { code: "TH60", name: "นครสวรรค์", coordinate: [100.323215, 15.320724], offset: [-10, -6] },
    { code: "TH67", name: "เพชรบูรณ์", coordinate: [101.081525, 15.654422], offset: [5, -8] },
    { code: "TH36", name: "ชัยภูมิ", coordinate: [101.616323, 15.461403], offset: [9, -3] },
    { code: "TH17", name: "สิงห์บุรี", coordinate: [100.203695, 14.947096], offset: [-10, 0] },
    { code: "TH30", name: "นครราชสีมา", coordinate: [101.636895, 15.117761], offset: [10, 0] },
    { code: "TH15", name: "อ่างทอง", coordinate: [100.249306, 14.576901], offset: [-10, 7] },
    { code: "TH14", name: "พระนครศรีอยุธยา", coordinate: [100.518817, 14.404722], offset: [-2, 10] },
    { code: "TH19", name: "สระบุรี", coordinate: [100.832285, 14.532746], offset: [5, 10] },
  ];

  const TOKENS = {
    void: "--map-void",
    country: "--map-country",
    countryLine: "--map-country-line",
    outside: "--map-outside",
    outsideLine: "--map-outside-line",
    outsideTop: "--map-outside-top",
    unassigned: "--map-unassigned",
    areaLine: "--map-area-line",
    halo: "--map-halo",
    hover: "--map-hover",
    selected: "--map-selected",
  };

  function prefersReducedMotion() {
    return Boolean(global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  function supportsWebGL() {
    if (!global.WebGLRenderingContext) return false;
    try {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      return false;
    }
  }

  function easeInOutCubic(progress) {
    return progress < 0.5 ? 4 * progress ** 3 : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }

  function extendBounds(bounds, coordinates) {
    if (typeof coordinates?.[0] === "number") bounds.extend(coordinates);
    else for (const coordinate of coordinates || []) extendBounds(bounds, coordinate);
  }

  function boundsOfGeometry(geometry) {
    const bounds = new maplibregl.LngLatBounds();
    extendBounds(bounds, geometry.coordinates);
    return bounds;
  }

  function boundsOfFeatures(items) {
    const bounds = new maplibregl.LngLatBounds();
    for (const feature of items || []) extendBounds(bounds, feature.geometry.coordinates);
    return bounds;
  }

  function centerOfFeature(feature) {
    if (!feature.__center) {
      const center = boundsOfGeometry(feature.geometry).getCenter();
      Object.defineProperty(feature, "__center", { value: [center.lng, center.lat], enumerable: false, writable: true });
    }
    return feature.__center;
  }

  function boxesOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  /** ผสมสีสองสีเข้าหากัน ใช้หรี่พื้นที่ของคนที่ไม่ได้เลือกให้กลมกลืนกับพื้นหลัง */
  function mixHex(from, to, amount) {
    const parse = (value) => {
      const hex = String(value).trim().replace("#", "");
      const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
      const number = Number.parseInt(full.slice(0, 6), 16);
      return Number.isFinite(number) ? [(number >> 16) & 255, (number >> 8) & 255, number & 255] : [128, 128, 128];
    };
    const [r1, g1, b1] = parse(from);
    const [r2, g2, b2] = parse(to);
    const t = Math.min(1, Math.max(0, amount));
    const channel = (a, b) => Math.round(a + (b - a) * t).toString(16).padStart(2, "0");
    return `#${channel(r1, r2)}${channel(g1, g2)}${channel(b1, b2)}`;
  }

  function create(options = {}) {
    const {
      container,
      interactive = true,
      preserveDrawingBuffer = false,
      startThreeD = true,
      onAreaClick,
      onAreaHover,
      onReady,
      onMoveEnd,
    } = options;

    if (!global.maplibregl) throw new Error("ไม่พบไลบรารีแผนที่ MapLibre");
    if (!supportsWebGL() && !global.__MAPLIBRE_TEST__) {
      throw new Error("อุปกรณ์นี้ไม่รองรับ WebGL กรุณาอัปเดตเบราว์เซอร์หรือ Android System WebView");
    }

    let palette = readPalette();
    let features = [];
    let context = null;
    let presentation = {
      staffById: new Map(),
      assignments: {},
      prices: {},
      showTambonLabels: true,
      showDistrictLabels: true,
      showAmountLabels: false,
      filterStaffId: "",
      selectedAreaId: "",
      searchText: "",
      dimStrength: 0.78,
    };
    let markers = { area: [], district: [], context: [], province: [] };
    let threeD = Boolean(startThreeD);
    let captureMode = false;
    let viewport = "province";
    let overviewZoom = null;
    let riseHandle = null;
    let hoveredId = null;
    let ready = false;
    let labelTimer = null;
    let measurer = null;

    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": palette.void } }],
      },
      center: [101.0, 13.7],
      zoom: 5.1,
      minZoom: 4.6,
      maxZoom: 13,
      maxPitch: 68,
      pitch: threeD ? 46 : 0,
      bearing: threeD ? -19 : 0,
      antialias: true,
      attributionControl: false,
      preserveDrawingBuffer,
      interactive,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(resetControl(() => flyToOverview({ duration: 900 })), "top-right");
    map.addControl(northControl(), "top-left");
    configureInteraction();

    map.on("load", () => {
      addLayers();
      ready = true;
      decorateControls();
      map.on("moveend", () => {
        scheduleLabels();
        onMoveEnd?.(viewport);
      });
      onReady?.(api);
    });

    /* ---------------------------------------------------------------- สี */

    function readPalette() {
      const styles = getComputedStyle(document.documentElement);
      const read = (name, fallback) => (styles.getPropertyValue(name) || "").trim() || fallback;
      return {
        void: read(TOKENS.void, "#0a121b"),
        country: read(TOKENS.country, "#121d29"),
        countryLine: read(TOKENS.countryLine, "#1d2b3a"),
        outside: read(TOKENS.outside, "#16222f"),
        outsideLine: read(TOKENS.outsideLine, "#243444"),
        outsideTop: read(TOKENS.outsideTop, "#1b2836"),
        unassigned: read(TOKENS.unassigned, "#33475c"),
        areaLine: read(TOKENS.areaLine, "#0b131c"),
        halo: read(TOKENS.halo, "#e7be72"),
        hover: read(TOKENS.hover, "#ffffff"),
        selected: read(TOKENS.selected, "#ffe6ad"),
      };
    }

    function applyPalette() {
      palette = readPalette();
      if (!ready) return;
      const set = (layer, property, value) => {
        if (map.getLayer(layer)) map.setPaintProperty(layer, property, value);
      };
      set("background", "background-color", palette.void);
      set("country-fill", "fill-color", palette.country);
      set("country-outline", "line-color", palette.countryLine);
      set("outside-fill", "fill-color", palette.outside);
      set("outside-outline", "line-color", palette.outsideLine);
      set("court-halo", "line-color", palette.halo);
      set("tambon-outline", "line-color", palette.areaLine);
      set("tambon-hover", "line-color", palette.hover);
      set("tambon-focus", "line-color", palette.hover);
      set("tambon-selected", "line-color", palette.selected);
      refresh();
    }

    /* ------------------------------------------------------------ ข้อมูล */

    function collection() {
      const { staffById, assignments, prices, filterStaffId, selectedAreaId, searchText, dimStrength } = presentation;
      const needle = Core.sanitizeName(searchText).toLocaleLowerCase("th");
      return {
        type: "FeatureCollection",
        features: features.map((feature) => {
          const id = Core.areaId(feature);
          const owner = staffById.get(assignments[id]) || null;
          const amount = Number.isFinite(prices[id]) ? prices[id] : null;
          const focused = Boolean(filterStaffId) && owner?.id === filterStaffId;
          const dimmed = Boolean(filterStaffId) && !focused;
          const matched = needle
            ? `${Core.tambonName(feature)} ${Core.districtName(feature)} ${owner?.name || ""}`.toLocaleLowerCase("th").includes(needle)
            : false;
          const baseColor = owner ? owner.color : palette.unassigned;
          return {
            type: "Feature",
            id,
            geometry: feature.geometry,
            properties: {
              id,
              color: dimmed ? mixHex(baseColor, palette.void, dimStrength) : baseColor,
              height: dimmed ? 460 : owner ? (focused ? 2100 : 1180) : 620,
              amount,
              hasAmount: amount !== null,
              assigned: Boolean(owner),
              dimmed,
              focused,
              matched,
              selected: id === selectedAreaId,
            },
          };
        }),
      };
    }

    function addLayers() {
      if (context) addContextLayers();

      map.addSource("tambons", { type: "geojson", data: collection(), promoteId: "id" });

      map.addLayer({
        id: "tambon-ground",
        type: "fill",
        source: "tambons",
        layout: { visibility: threeD ? "none" : "visible" },
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["get", "assigned"], 0.9, 0.62],
          "fill-opacity-transition": { duration: 420 },
        },
      });

      map.addLayer({
        id: "tambon-3d",
        type: "fill-extrusion",
        source: "tambons",
        layout: { visibility: threeD ? "visible" : "none" },
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-height": ["*", ["get", "height"], 0],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.94,
          "fill-extrusion-height-transition": { duration: 900 },
          "fill-extrusion-vertical-gradient": true,
          "fill-extrusion-opacity-transition": { duration: 520 },
        },
      });

      map.addLayer({
        id: "tambon-outline",
        type: "line",
        source: "tambons",
        paint: {
          "line-color": palette.areaLine,
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 11, 1.4],
          "line-opacity": 0.55,
        },
      });

      map.addLayer({
        id: "tambon-match",
        type: "line",
        source: "tambons",
        filter: ["==", ["get", "matched"], true],
        paint: { "line-color": palette.halo, "line-width": 2.4, "line-opacity": 0.95, "line-blur": 0.6 },
      });

      map.addLayer({
        id: "tambon-hover",
        type: "line",
        source: "tambons",
        paint: {
          "line-color": palette.hover,
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.6, 0],
          "line-opacity": 0.9,
        },
      });

      map.addLayer({
        id: "tambon-focus",
        type: "line",
        source: "tambons",
        filter: ["==", ["get", "focused"], true],
        paint: { "line-color": palette.hover, "line-width": 2, "line-opacity": 0.85 },
      });

      map.addLayer({
        id: "tambon-selected",
        type: "line",
        source: "tambons",
        filter: ["==", ["get", "selected"], true],
        paint: { "line-color": palette.selected, "line-width": 3, "line-opacity": 1 },
      });

      bindAreaEvents();
    }

    function addContextLayers() {
      map.addSource("country", { type: "geojson", data: context.country });
      map.addSource("outside", { type: "geojson", data: context.outsideAmphoes });
      map.addSource("court-amphoes", { type: "geojson", data: context.courtAmphoes });

      map.addLayer({ id: "country-fill", type: "fill", source: "country", paint: { "fill-color": palette.country, "fill-opacity": 1 } });
      map.addLayer({ id: "country-outline", type: "line", source: "country", paint: { "line-color": palette.countryLine, "line-width": 0.8, "line-opacity": 0.9 } });
      map.addLayer({ id: "outside-fill", type: "fill", source: "outside", paint: { "fill-color": palette.outside, "fill-opacity": 0.96 } });
      map.addLayer({ id: "outside-outline", type: "line", source: "outside", paint: { "line-color": palette.outsideLine, "line-width": 0.8, "line-opacity": 0.7 } });
      map.addLayer({
        id: "court-halo",
        type: "line",
        source: "court-amphoes",
        paint: { "line-color": palette.halo, "line-width": 2.2, "line-blur": 3.4, "line-opacity": 0.55 },
      });
    }

    function bindAreaEvents() {
      const layers = ["tambon-ground", "tambon-3d"];
      const findFeature = (event) => {
        const id = String(event.features?.[0]?.properties?.id || "");
        return features.find((item) => Core.areaId(item) === id) || null;
      };
      for (const layer of layers) {
        map.on("click", layer, (event) => {
          const feature = findFeature(event);
          if (feature) onAreaClick?.(feature, event);
        });
        map.on("mousemove", layer, (event) => {
          const id = String(event.features?.[0]?.properties?.id || "");
          if (hoveredId === id) return;
          if (hoveredId) map.setFeatureState({ source: "tambons", id: hoveredId }, { hover: false });
          hoveredId = id;
          if (id) map.setFeatureState({ source: "tambons", id }, { hover: true });
          map.getCanvas().style.cursor = "pointer";
          onAreaHover?.(findFeature(event));
        });
        map.on("mouseleave", layer, () => {
          if (hoveredId) map.setFeatureState({ source: "tambons", id: hoveredId }, { hover: false });
          hoveredId = null;
          map.getCanvas().style.cursor = "";
          onAreaHover?.(null);
        });
      }
    }

    function refresh() {
      if (!ready) return;
      if (map.getSource("tambons")) map.getSource("tambons").setData(collection());
      scheduleLabels();
    }

    /* ------------------------------------------------------------ กล้อง */

    function perspective() {
      return threeD ? { pitch: 46, bearing: -19 } : { pitch: 0, bearing: 0 };
    }

    function padding(view = "province") {
      if (captureMode && view === "province") return { top: 48, right: 60, bottom: 70, left: 60 };
      const landscape = global.matchMedia?.("(orientation: landscape)")?.matches;
      if (view === "province") {
        // เผื่อระยะมากกว่าปกติ เพื่อให้เห็นอำเภอข้างเคียงเป็นฉากหลัง และกันมุมกล้อง 3 มิติบีบภาพ
        return landscape ? { top: 74, right: 66, bottom: 70, left: 66 } : { top: 84, right: 28, bottom: 126, left: 28 };
      }
      return landscape ? { top: 58, right: 52, bottom: 46, left: 52 } : { top: 104, right: 36, bottom: 56, left: 36 };
    }

    /**
     * ภาพรวม = กรอบ 6 อำเภอในเขตศาล ไม่ใช่ทั้งจังหวัด
     * เพราะเขตศาลอยู่ครึ่งตะวันตก ถ้าเล็งทั้งจังหวัดพื้นที่จริงจะเล็กและเบี้ยวไปข้างเดียว
     * อำเภอนอกเขตยังเห็นเป็นฉากหลังจากระยะ padding ที่เผื่อไว้
     */
    function flyToOverview({ duration = 900, zoomBoost = 0 } = {}) {
      if (!ready) return;
      viewport = "province";
      const time = prefersReducedMotion() ? 0 : duration;
      const subject = context?.courtAmphoes?.features?.length
        ? boundsOfFeatures(context.courtAmphoes.features)
        : features.length ? boundsOfFeatures(features) : null;
      if (!subject) return fitAll({ duration: time });
      const camera = map.cameraForBounds?.(subject, { padding: padding("province"), maxZoom: 10.4 });
      if (camera) {
        overviewZoom = Math.min(camera.zoom + zoomBoost, 11);
        map.easeTo({ ...camera, zoom: overviewZoom, ...perspective(), duration: time, easing: easeInOutCubic });
      } else {
        overviewZoom = Math.min(9.4 + zoomBoost, 11);
        map.fitBounds(subject, { padding: padding("province"), maxZoom: 10.4, duration: time });
        map.easeTo({ ...perspective(), duration: 0 });
      }
      scheduleLabels();
    }

    function fitAll({ duration = 0 } = {}) {
      if (!ready || !features.length) return;
      const assigned = features.filter((feature) => presentation.assignments[Core.areaId(feature)]);
      const bounds = boundsOfFeatures(assigned.length ? assigned : features);
      map.fitBounds(bounds, { padding: padding("province"), maxZoom: 10.8, duration: prefersReducedMotion() ? 0 : duration });
      scheduleLabels();
    }

    function easeToBounds(bounds, { view = "detail", maxZoom = 12.2, duration = 1600 } = {}) {
      const time = prefersReducedMotion() ? 0 : duration;
      const camera = map.cameraForBounds?.(bounds, { padding: padding(view), maxZoom });
      if (camera) map.easeTo({ ...camera, ...perspective(), duration: time, easing: easeInOutCubic });
      else {
        map.fitBounds(bounds, { padding: padding(view), maxZoom, duration: 0 });
        map.easeTo({ ...perspective(), duration: time });
      }
      scheduleLabels();
    }

    function flyToAreas(items, options = {}) {
      const list = (items || []).filter(Boolean);
      if (!ready || !list.length) return false;
      viewport = "staff";
      easeToBounds(boundsOfFeatures(list), { view: "detail", maxZoom: 11.6, ...options });
      return true;
    }

    function flyToArea(feature, options = {}) {
      if (!ready || !feature) return false;
      viewport = "detail";
      easeToBounds(boundsOfGeometry(feature.geometry), { view: "detail", maxZoom: 12.4, ...options });
      return true;
    }

    function zoomToTambonLevel() {
      if (!ready) return;
      viewport = "detail";
      map.easeTo({
        center: map.getCenter(),
        zoom: Math.max(map.getZoom(), 10.4),
        ...perspective(),
        duration: prefersReducedMotion() ? 0 : 1400,
        easing: easeInOutCubic,
      });
      scheduleLabels();
    }

    function setThreeD(enabled, { duration = 700 } = {}) {
      threeD = Boolean(enabled);
      if (!ready) return;
      for (const [layer, visible] of [["tambon-3d", threeD], ["tambon-ground", !threeD]]) {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
      }
      if (threeD) animateRise({ duration: prefersReducedMotion() ? 0 : RISE_DURATION });
      map.easeTo({ ...perspective(), duration: prefersReducedMotion() ? 0 : duration, easing: easeInOutCubic });
      scheduleLabels();
    }

    /** พื้นที่ค่อย ๆ ยกตัวขึ้นจากพื้นแทนที่จะโผล่มาทันที */
    function animateRise({ duration = RISE_DURATION, delay = 0 } = {}) {
      if (!ready || !map.getLayer("tambon-3d")) return;
      cancelAnimationFrame(riseHandle);
      const setHeight = (factor) => {
        map.setPaintProperty("tambon-3d", "fill-extrusion-height", ["*", ["get", "height"], factor]);
      };
      if (!duration) return setHeight(1);
      const start = performance.now() + delay;
      setHeight(0);
      const step = (now) => {
        const progress = Math.min(1, Math.max(0, (now - start) / duration));
        setHeight(easeInOutCubic(progress));
        if (progress < 1) riseHandle = requestAnimationFrame(step);
      };
      riseHandle = requestAnimationFrame(step);
    }

    /** ลำดับเปิดตัว: ทั้งประเทศ → ค่อย ๆ ไล่เข้าจังหวัด → พื้นที่ยกตัวขึ้น → ป้ายค่อยปรากฏ */
    function playIntro() {
      if (!ready) return;
      if (prefersReducedMotion()) {
        setThreeD(threeD, { duration: 0 });
        flyToOverview({ duration: 0 });
        animateRise({ duration: 0 });
        return;
      }
      map.getContainer().classList.add("map-intro");
      if (context?.country?.features?.length) {
        map.fitBounds(boundsOfFeatures(context.country.features), { padding: padding("province"), duration: 0, maxZoom: 6.2 });
      }
      map.jumpTo(perspective());
      animateRise({ duration: RISE_DURATION, delay: INTRO_DELAY + INTRO_DURATION * 0.35 });
      setTimeout(() => {
        flyToOverview({ duration: INTRO_DURATION });
        setTimeout(() => map.getContainer().classList.remove("map-intro"), INTRO_DURATION + 200);
      }, INTRO_DELAY);
    }

    function configureInteraction() {
      if (!interactive) return;
      map.dragPan.enable();
      map.touchZoomRotate.enable();
      map.touchZoomRotate.disableRotation();
      map.getCanvas().style.touchAction = "none";
    }

    /* ------------------------------------------------------------- ป้าย */

    function clearMarkers(kind) {
      for (const marker of markers[kind]) marker.remove();
      markers[kind] = [];
    }

    function addMarker(kind, element, coordinate, markerOptions = {}) {
      element.classList.add("map-label");
      markers[kind].push(new maplibregl.Marker({ element, anchor: "center", ...markerOptions }).setLngLat(coordinate).addTo(map));
    }

    /** มุมจอที่ปุ่มควบคุมแผนที่ครองอยู่ — ป้ายต้องหลบ */
    function controlZones() {
      const canvas = map.getCanvas();
      const width = canvas.clientWidth;
      return [
        { left: 0, right: 122, top: 0, bottom: 122 },
        { left: width - 120, right: width, top: 0, bottom: 206 },
      ];
    }

    /**
     * วัดขนาดจริงของป้ายก่อนวาง
     * ภาษาไทยมีสระบนล่างและความกว้างตัวอักษรไม่คงที่ การเดาจากจำนวนตัวอักษร
     * ทำให้ป้ายทับกันบ่อย จึงวัดจากการ render จริงในกล่องซ่อนแทน
     */
    function measure(element) {
      if (!measurer) {
        measurer = document.createElement("div");
        measurer.setAttribute("aria-hidden", "true");
        Object.assign(measurer.style, {
          position: "absolute", left: "-99999px", top: "0", visibility: "hidden", pointerEvents: "none",
        });
        map.getContainer().append(measurer);
      }
      measurer.append(element);
      const size = { width: element.offsetWidth, height: element.offsetHeight };
      element.remove();
      return size;
    }

    function renderLabels() {
      for (const kind of Object.keys(markers)) clearMarkers(kind);
      if (!ready || !map.isStyleLoaded()) return;

      const bounds = map.getBounds();
      const zoom = map.getZoom();
      const base = overviewZoom ?? 10;
      const { showTambonLabels, showDistrictLabels, showAmountLabels, prices, filterStaffId, staffById, assignments } = presentation;
      const showNames = showTambonLabels && (captureMode || zoom >= base + 0.7);
      const showAmounts = showAmountLabels && (captureMode || zoom >= base + 0.35);
      const occupied = controlZones();

      /** วางป้ายถ้ายังมีที่ว่าง คืนค่า false เมื่อชนของเดิม */
      function place(kind, element, coordinate, markerOptions) {
        const size = measure(element);
        const point = map.project(coordinate);
        const box = {
          left: point.x - size.width / 2 - 3,
          right: point.x + size.width / 2 + 3,
          top: point.y - size.height / 2 - 3,
          bottom: point.y + size.height / 2 + 3,
        };
        const canvas = map.getCanvas();
        if (box.left < 2 || box.top < 2 || box.right > canvas.clientWidth - 2 || box.bottom > canvas.clientHeight - 2) return false;
        if (occupied.some((item) => boxesOverlap(box, item))) return false;
        occupied.push(box);
        addMarker(kind, element, coordinate, markerOptions);
        return true;
      }

      /* ป้ายตำบลและยอด — เรียงตามความสำคัญ ตำบลที่มีทั้งยอดและผู้รับผิดชอบได้ที่ก่อน */
      if (showNames || showAmounts) {
        const score = (feature) => {
          const id = Core.areaId(feature);
          return (Number.isFinite(prices[id]) ? 2 : 0) + (assignments[id] ? 1 : 0);
        };
        const visible = features
          .filter((feature) => bounds.contains(centerOfFeature(feature)))
          .sort((left, right) => score(right) - score(left));
        for (const feature of visible) {
          const id = Core.areaId(feature);
          if (filterStaffId && staffById.get(assignments[id])?.id !== filterStaffId) continue;
          const amount = Number.isFinite(prices[id]) ? prices[id] : null;
          const nameText = showNames ? Core.tambonName(feature) : "";
          const amountText = showAmounts && amount !== null ? Core.formatAmount(amount) : "";
          if (!nameText && !amountText) continue;
          const element = document.createElement("span");
          element.className = `map-area-label${nameText && amountText ? " with-amount" : ""}`;
          if (nameText) {
            const name = document.createElement("span");
            name.className = "map-area-name";
            name.textContent = nameText;
            element.append(name);
          }
          if (amountText) {
            const value = document.createElement("span");
            value.className = "map-area-amount";
            value.textContent = amountText;
            element.append(value);
          }
          place("area", element, centerOfFeature(feature));
        }
      }

      /* ป้ายอำเภอ — ในเขตศาลก่อน แล้วจึงอำเภอข้างเคียง */
      if (showDistrictLabels) {
        const groups = new Map();
        for (const feature of features) {
          const district = Core.districtName(feature);
          if (!groups.has(district)) groups.set(district, []);
          groups.get(district).push(feature);
        }
        for (const [district, items] of groups) {
          const center = boundsOfFeatures(items).getCenter();
          if (!bounds.contains(center)) continue;
          const element = document.createElement("span");
          element.className = "map-district-label";
          element.textContent = `อำเภอ${district}`;
          place("district", element, [center.lng, center.lat]);
        }
        for (const feature of context?.outsideAmphoes?.features || []) {
          const center = centerOfFeature(feature);
          if (!bounds.contains(center)) continue;
          const element = document.createElement("span");
          element.className = "map-district-label outside";
          const title = document.createElement("span");
          title.textContent = `อำเภอ${feature.properties.amphoe_th || ""}`;
          const note = document.createElement("small");
          note.textContent = "นอกเขตส่งหมาย";
          element.append(title, note);
          place("context", element, center);
        }
      }

      /* ชื่อจังหวัดข้างเคียง — บอกทิศทางเมื่อมองภาพรวมเท่านั้น */
      if (viewport === "province" && zoom <= base + 0.4 && context?.country?.features?.length) {
        const available = new Set(context.country.features.map((feature) => feature.properties?.prov_code));
        for (const entry of ADJACENT_PROVINCES) {
          if (!available.has(entry.code)) continue;
          const element = document.createElement("span");
          element.className = "map-province-label";
          element.textContent = entry.name;
          place("province", element, entry.coordinate, { offset: entry.offset });
        }
      }
    }

    function scheduleLabels() {
      if (!ready) return;
      clearTimeout(labelTimer);
      const run = () => {
        if (!map.isStyleLoaded()) return;
        renderLabels();
      };
      map.once("idle", run);
      labelTimer = setTimeout(run, 240);
    }

    /* --------------------------------------------------------- ตัวควบคุม */

    function resetControl(onReset) {
      return {
        onAdd() {
          const group = document.createElement("div");
          group.className = "maplibregl-ctrl maplibregl-ctrl-group";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "map-reset-button";
          button.textContent = "⌖";
          button.addEventListener("click", onReset);
          group.append(button);
          return group;
        },
        onRemove() {},
      };
    }

    function northControl() {
      let instance = null;
      let needle = null;
      let update = null;
      return {
        onAdd(mapInstance) {
          instance = mapInstance;
          const control = document.createElement("div");
          control.className = "maplibregl-ctrl true-north-control";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "true-north-button";
          button.title = "หันแผนที่สู่ทิศเหนือ";
          button.setAttribute("aria-label", "หันแผนที่สู่ทิศเหนือ");
          const rose = document.createElement("span");
          rose.className = "true-north-rose";
          needle = document.createElement("span");
          needle.className = "true-north-needle";
          const letter = document.createElement("span");
          letter.className = "true-north-letter";
          letter.textContent = "N";
          rose.append(needle, letter);
          button.append(rose);
          control.append(button);
          update = () => { if (needle && instance) needle.style.transform = `rotate(${-instance.getBearing()}deg)`; };
          button.addEventListener("click", () => instance?.easeTo({ bearing: 0, duration: 400 }));
          instance.on("rotate", update);
          update();
          return control;
        },
        onRemove() {
          if (instance && update) instance.off("rotate", update);
          instance = null;
          needle = null;
          update = null;
        },
      };
    }

    function decorateControls() {
      const labels = [
        [".maplibregl-ctrl-zoom-in", "ขยายภาพ"],
        [".maplibregl-ctrl-zoom-out", "ลดขนาดภาพ"],
        [".maplibregl-ctrl-compass", "ปรับมุมมอง 3 มิติ"],
        [".map-reset-button", "กลับสู่ภาพรวมจังหวัด"],
      ];
      for (const [selector, label] of labels) {
        const element = map.getContainer().querySelector(selector);
        if (!element) continue;
        element.dataset.tooltip = label;
        element.title = label;
        element.setAttribute("aria-label", label);
      }
    }

    /* ------------------------------------------------------------- API */

    const api = {
      map,
      isReady: () => ready,
      isThreeD: () => threeD,
      viewport: () => viewport,
      setContext(value) {
        context = value;
        if (ready && !map.getSource("country") && context) {
          addContextLayers();
          for (const layer of ["tambon-ground", "tambon-3d", "tambon-outline", "tambon-match", "tambon-hover", "tambon-focus", "tambon-selected"]) {
            if (map.getLayer(layer)) map.moveLayer(layer);
          }
        }
      },
      setFeatures(value) {
        features = value || [];
        refresh();
      },
      getFeatures: () => features,
      setPresentation(value) {
        presentation = { ...presentation, ...value };
        refresh();
      },
      refreshPalette: applyPalette,
      playIntro,
      flyToOverview,
      flyToAreas,
      flyToArea,
      zoomToTambonLevel,
      fitAll,
      setThreeD,
      animateRise,
      renderLabels,
      scheduleLabels,
      openPopup(coordinate, content, options = {}) {
        return new maplibregl.Popup({ offset: 14, closeButton: false, className: "map-popup", ...options })
          .setLngLat(coordinate)
          .setDOMContent(content)
          .addTo(map);
      },
      centerOfFeature,
      boundsOfFeatures,
      setCaptureMode(value) {
        captureMode = Boolean(value);
        renderLabels();
      },
      resize() {
        if (!ready) return;
        map.resize();
        configureInteraction();
        scheduleLabels();
      },
      destroy() {
        cancelAnimationFrame(riseHandle);
        clearTimeout(labelTimer);
        for (const kind of Object.keys(markers)) clearMarkers(kind);
        measurer?.remove();
        map.remove();
      },
    };

    return api;
  }

  global.MapEngine = { create, supportsWebGL, prefersReducedMotion, ADJACENT_PROVINCES };
})(window);
