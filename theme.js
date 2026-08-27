/**
 * theme.js — สลับธีมสว่าง/มืด และจำค่าไว้ในเครื่อง
 *
 * มีสามสถานะ: ตามระบบ (auto) · สว่าง (light) · มืด (dark)
 * ค่าที่เลือกถูกเขียนเป็น data-theme บน <html> ให้ CSS token ทำงานต่อ
 * และแจ้ง subscriber ทุกตัว (เช่น map-engine) ให้อ่านสีชุดใหม่
 *
 * [ต่อยอด] ถ้าจะเพิ่มธีมที่สาม ให้เพิ่มใน ORDER และเพิ่มชุด token ใน tokens.css
 */
(function (global) {
  "use strict";

  const Core = global.MapLibreCore;
  const KEY = Core?.THEME_KEY || "lopburi-notice-area-manager-v1:theme";
  const ORDER = ["auto", "light", "dark"];
  const LABELS = {
    auto: { icon: "◐", text: "ตามระบบ", title: "ธีมตามการตั้งค่าเครื่อง — กดเพื่อเลือกโหมดสว่าง" },
    light: { icon: "☀", text: "สว่าง", title: "โหมดสว่าง — กดเพื่อเลือกโหมดมืด" },
    dark: { icon: "☾", text: "มืด", title: "โหมดมืด — กดเพื่อกลับไปใช้ค่าตามระบบ" },
  };

  const listeners = new Set();
  let mode = read();

  function read() {
    try {
      const stored = localStorage.getItem(KEY);
      return ORDER.includes(stored) ? stored : "auto";
    } catch {
      return "auto";
    }
  }

  function systemPrefersDark() {
    return Boolean(global.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
  }

  /** ธีมที่ใช้จริงอยู่ตอนนี้ ("light" หรือ "dark") */
  function resolved() {
    return mode === "auto" ? (systemPrefersDark() ? "dark" : "light") : mode;
  }

  function apply() {
    const root = document.documentElement;
    if (mode === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    root.style.colorScheme = resolved();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const color = getComputedStyle(root).getPropertyValue("--surface-solid").trim();
      if (color) meta.setAttribute("content", color);
    }
    for (const listener of listeners) {
      try { listener(resolved(), mode); } catch (error) { console.warn(error); }
    }
  }

  function set(next) {
    mode = ORDER.includes(next) ? next : "auto";
    try { localStorage.setItem(KEY, mode); } catch { /* โหมดส่วนตัวอาจเขียนไม่ได้ */ }
    apply();
  }

  function cycle() {
    set(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]);
  }

  function decorate(button) {
    if (!button) return;
    const label = LABELS[mode];
    button.innerHTML = "";
    const icon = document.createElement("span");
    icon.className = "theme-toggle-icon";
    icon.textContent = label.icon;
    const text = document.createElement("span");
    text.className = "theme-toggle-text";
    text.textContent = label.text;
    button.append(icon, text);
    button.title = label.title;
    button.setAttribute("aria-label", label.title);
    button.dataset.themeMode = mode;
  }

  function mount(button) {
    if (!button) return;
    decorate(button);
    button.addEventListener("click", () => {
      cycle();
      decorate(button);
    });
    subscribe(() => decorate(button));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  global.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    if (mode === "auto") apply();
  });

  apply();

  global.ThemeController = { get mode() { return mode; }, resolved, set, cycle, mount, subscribe, apply };
})(window);
