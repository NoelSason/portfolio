import { GENE } from "./genetics.js";
import { initTranslator } from "./translator.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Seeded random numbers, so the trace looks the same on every visit.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

// Draws a Sanger-style chromatogram: one Gaussian peak per base call,
// plus small background peaks in the other three channels.
function drawTrace(svg, sequence) {
  const width = 640;
  const spacing = 14;
  const left = (width - spacing * (sequence.length - 1)) / 2;
  const baseline = 146;
  const peakHeight = 108;
  const sigma = 3.1;
  const random = mulberry32(2028);

  const peaks = { A: [], C: [], G: [], T: [] };
  [...sequence].forEach((call, i) => {
    const x = left + i * spacing;
    for (const base of "ACGT") {
      if (base === call) peaks[base].push({ x: x + (random() - 0.5) * 1.2, h: 0.55 + random() * 0.45 });
      else if (random() < 0.45) peaks[base].push({ x: x + (random() - 0.5) * 6, h: random() * 0.11 });
    }
  });

  for (const base of "ACGT") {
    let d = "";
    for (let x = 0; x <= width; x += 1) {
      let y = 0;
      for (const p of peaks[base]) y += p.h * Math.exp(-((x - p.x) ** 2) / (2 * sigma * sigma));
      d += `${x === 0 ? "M" : "L"}${x} ${(baseline - y * peakHeight).toFixed(1)}`;
    }
    svg.append(svgEl("path", { d, class: `peaks peaks-${base}` }));
  }

  svg.append(svgEl("line", { x1: 0, x2: width, y1: baseline + 0.5, y2: baseline + 0.5, class: "axis" }));

  [...sequence].forEach((call, i) => {
    const text = svgEl("text", { x: left + i * spacing, y: 16, class: `call fill-${call.toLowerCase()}` });
    text.textContent = call;
    svg.append(text);
  });

  for (let n = 10; n <= sequence.length; n += 10) {
    const x = left + (n - 1) * spacing;
    svg.append(svgEl("line", { x1: x, x2: x, y1: baseline + 2, y2: baseline + 7, class: "axis" }));
    const label = svgEl("text", { x, y: baseline + 20, class: "tick-label" });
    label.textContent = n;
    svg.append(label);
  }

  if (!reducedMotion) animateTrace(svg);
}

// The page's one ambient motion: the four channels draw in once on load.
function animateTrace(svg) {
  const paths = svg.querySelectorAll(".peaks");
  for (const path of paths) {
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const path of paths) {
        path.style.transition = "stroke-dashoffset 1.8s cubic-bezier(0.22, 1, 0.36, 1)";
        path.style.strokeDashoffset = "0";
      }
    });
  });
}

function setUpDialog() {
  const dialog = document.getElementById("gene-dialog");
  let translator = null;
  let opener = null;

  const open = (event) => {
    opener = event?.currentTarget ?? null;
    translator ??= initTranslator(dialog);
    if (!dialog.open) dialog.showModal();
    if (location.hash !== "#gene") history.replaceState(null, "", "#gene");
  };

  const close = () => dialog.close();

  for (const button of document.querySelectorAll("[data-open-gene]")) button.addEventListener("click", open);
  dialog.querySelector("[data-close-gene]").addEventListener("click", close);

  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  dialog.addEventListener("close", () => {
    if (location.hash === "#gene") history.replaceState(null, "", location.pathname + location.search);
    opener?.focus();
  });

  if (location.hash === "#gene") open();
  window.addEventListener("hashchange", () => {
    if (location.hash === "#gene") open();
  });
}

function setUpThemeToggle() {
  const button = document.getElementById("theme-toggle");
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const current = () => root.dataset.theme ?? (systemDark.matches ? "dark" : "light");

  const label = () => {
    const next = current() === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", `Switch to ${next} theme`);
    button.title = `Switch to ${next} theme`;
  };

  button.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
    label();
  });

  systemDark.addEventListener("change", label);
  label();
}

drawTrace(document.getElementById("trace"), GENE);
setUpDialog();
setUpThemeToggle();
