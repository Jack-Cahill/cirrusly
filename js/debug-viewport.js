// TEMPORARY: a live readout of the viewport numbers, to learn what a real phone (iOS 26 Safari) reports while its
// keyboard is up. Shown only with the query `?debug` (cirrusly.fun/?debug#play); without it this file does nothing.
// The panel sits just above the focused answer box (the one place a browser keeps on screen with the keys up),
// or at the top left, and never takes a touch. Rects are getBoundingClientRect top / bottom.
// To remove it, delete this file and its <script> tag in index.html; nothing else refers to it.

(() => {
  if (!new URLSearchParams(window.location.search).has("debug")) return;

  const panel = document.createElement("pre");
  panel.className = "debug-viewport";
  Object.assign(panel.style, {
    position: "fixed",
    left: "4px",
    top: "4px",
    zIndex: "3000",
    margin: "0",
    padding: "4px 6px",
    font: "10px/1.3 ui-monospace, Menlo, monospace",
    color: "#fff",
    background: "rgb(0 0 0 / 72%)",
    borderRadius: "4px",
    pointerEvents: "none",
  });
  document.body.append(panel);

  const counts = { vvResize: 0, vvScroll: 0, winResize: 0, focus: 0 };
  const root = document.documentElement;
  const n = (value) => (typeof value === "number" ? String(Math.round(value * 100) / 100) : "-");
  const rect = (selector) => {
    const element = document.querySelector(selector);
    if (!element || element.getClientRects().length === 0) return "-";
    const box = element.getBoundingClientRect();
    return `${n(box.top)} / ${n(box.bottom)}`;
  };

  function update() {
    const view = window.visualViewport;
    const field = document.activeElement?.classList.contains("qfield") ? document.activeElement : null;
    const style = getComputedStyle(root);
    panel.textContent = [
      `inner ${innerWidth}x${innerHeight}  outer ${outerWidth}x${outerHeight}`,
      `screen ${screen.width}x${screen.height}  dpr ${n(window.devicePixelRatio)}`,
      view
        ? `vv ${n(view.width)}x${n(view.height)} top ${n(view.offsetTop)} pageTop ${n(view.pageTop)} ` +
          `scale ${n(view.scale)}`
        : "vv none",
      `scrollY ${n(window.scrollY)}  docTop ${n(root.scrollTop)}  bodyTop ${n(document.body.scrollTop)}`,
      `keyboard ${root.classList.contains("keyboard") ? "ON" : "off"}` +
        `  --vv-top ${style.getPropertyValue("--vv-top")}  --vv-h ${style.getPropertyValue("--vv-h")}`,
      `stage  ${rect(".stage")}`,
      `qgroup ${rect(".qgroup")}`,
      `field  ${field ? rect(":focus") : "(none focused)"}`,
      `events vv resize ${counts.vvResize} scroll ${counts.vvScroll}  win resize ${counts.winResize}` +
        `  focus ${counts.focus}`,
    ].join("\n");
    if (field) {
      panel.style.top = `${Math.max(0, field.getBoundingClientRect().top - panel.offsetHeight - 6)}px`;
    } else {
      panel.style.top = "4px";
    }
  }

  window.visualViewport?.addEventListener("resize", () => counts.vvResize++);
  window.visualViewport?.addEventListener("scroll", () => counts.vvScroll++);
  window.addEventListener("resize", () => counts.winResize++);
  document.addEventListener("focusin", () => counts.focus++);
  setInterval(update, 200);
  update();
})();
