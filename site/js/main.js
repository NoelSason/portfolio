import { GENE, GENE_MESSAGE } from "./genetics.js";
import { initTranslator } from "./translator.js";
import { initAssistant } from "./assistant.js";

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

const ROW_HEIGHT = 206;
const SPACING = 14;
const BASELINE = 146;

// Peak shapes depend only on the base index, so the trace looks the same in one row or two.
function tracePeaks(sequence) {
  const random = mulberry32(2028);
  return [...sequence].map((call) => {
    const peaks = [];
    for (const base of "ACGT") {
      if (base === call) peaks.push({ base, dx: (random() - 0.5) * 1.2, h: 0.55 + random() * 0.45 });
      else if (random() < 0.45) peaks.push({ base, dx: (random() - 0.5) * 6, h: random() * 0.11 });
    }
    return peaks;
  });
}

// Draws a Sanger-style chromatogram: one Gaussian peak per base call, small background
// peaks in the other three channels, and an empty slot under each codon for its amino acid.
function drawTrace(svg, sequence, perRow) {
  for (const node of [...svg.children]) if (node.tagName !== "title") node.remove();

  const rows = Math.ceil(sequence.length / perRow);
  const width = rows === 1 ? 640 : SPACING * (perRow - 1) + 44;
  const left = rows === 1 ? (width - SPACING * (sequence.length - 1)) / 2 : 22;
  const peakHeight = 108;
  const sigma = 3.1;
  const allPeaks = tracePeaks(sequence);
  svg.setAttribute("viewBox", `0 0 ${width} ${rows * ROW_HEIGHT}`);

  for (let row = 0; row < rows; row++) {
    const first = row * perRow;
    const last = Math.min(sequence.length, first + perRow) - 1;
    const top = row * ROW_HEIGHT;
    const xOf = (i) => left + (i - first) * SPACING;
    const baseline = top + BASELINE;

    for (const base of "ACGT") {
      let d = "";
      for (let x = 0; x <= width; x += 1) {
        let y = 0;
        for (let i = first; i <= last; i++) {
          for (const p of allPeaks[i]) {
            if (p.base === base) y += p.h * Math.exp(-((x - xOf(i) - p.dx) ** 2) / (2 * sigma * sigma));
          }
        }
        d += `${x === 0 ? "M" : "L"}${x} ${(baseline - y * peakHeight).toFixed(1)}`;
      }
      svg.append(svgEl("path", { d, class: `peaks peaks-${base}` }));
    }

    svg.append(svgEl("line", { x1: 0, x2: width, y1: baseline + 0.5, y2: baseline + 0.5, class: "axis" }));

    for (let i = first; i <= last; i++) {
      const text = svgEl("text", { x: xOf(i), y: top + 16, class: `call fill-${sequence[i].toLowerCase()}` });
      text.textContent = sequence[i];
      svg.append(text);
      if ((i + 1) % 10 === 0) {
        svg.append(svgEl("line", { x1: xOf(i), x2: xOf(i), y1: baseline + 2, y2: baseline + 7, class: "axis" }));
        const label = svgEl("text", { x: xOf(i), y: baseline + 19, class: "tick-label" });
        label.textContent = i + 1;
        svg.append(label);
      }
    }

    // One slot per codon, centered on its middle base.
    for (let c = Math.ceil(first / 3); c * 3 + 2 <= last; c++) {
      const x = xOf(c * 3 + 1);
      svg.append(svgEl("rect", { x: x - 17, y: baseline + 29, width: 34, height: 22, rx: 5, class: "lane-slot", "data-codon": c }));
      const letter = svgEl("text", { x, y: baseline + 45, class: "lane-aa", "data-codon": c });
      svg.append(letter);
    }
  }
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

// Fills the slots with the protein once a visitor has read the gene.
function fillLane(svg, protein) {
  for (const slot of svg.querySelectorAll(".lane-slot")) {
    const c = Number(slot.dataset.codon);
    const letter = svg.querySelector(`.lane-aa[data-codon="${c}"]`);
    const aa = protein[c];
    slot.classList.toggle("filled", Boolean(aa));
    slot.classList.toggle("special", aa === "O");
    letter.textContent = aa ?? (c === protein.length ? "stop" : "");
    letter.classList.toggle("is-stop", !aa && c === protein.length);
  }
  svg.querySelector("title").textContent =
    "A DNA sequencing trace of a 42-base gene. Under it, the protein it codes for reads MEET NOEL SASON.";
}

function setUpTrace() {
  const svg = document.getElementById("trace");
  const narrow = window.matchMedia("(max-width: 600px)");
  let read = false;
  try {
    read = localStorage.getItem("gene-solved") === "1";
  } catch {
    // Storage blocked: the slots start empty.
  }

  const render = (animate) => {
    drawTrace(svg, GENE, narrow.matches ? 21 : GENE.length);
    if (read) fillLane(svg, GENE_MESSAGE);
    if (animate && !reducedMotion) animateTrace(svg);
  };

  render(true);
  narrow.addEventListener("change", () => render(false));
  document.addEventListener("gene:read", () => {
    read = true;
    fillLane(svg, GENE_MESSAGE);
  });
}

const NAME_HASH = /^#name=([A-Za-z]{1,24})$/;
const isGeneHash = (hash) => hash === "#gene" || NAME_HASH.test(hash);

function setUpDialog() {
  const dialog = document.getElementById("gene-dialog");
  const fallbackOpener = document.querySelector(".trace-caption [data-open-gene]");
  let translator = null;
  let opener = null;
  // True while the dialog owns a history entry we pushed, so Back closes it.
  let pushed = false;
  // A section link clicked inside the dialog, followed once the dialog has closed.
  let pendingHash = null;

  const ensureTranslator = () => {
    if (translator) return translator;
    translator = initTranslator(dialog);
    initAssistant(dialog, translator.getState);
    return translator;
  };

  const show = () => {
    const t = ensureTranslator();
    if (!dialog.open) dialog.showModal();
    const name = location.hash.match(NAME_HASH)?.[1];
    if (name) t.setName(name.toUpperCase());
    t.autoplay();
  };

  const followPending = () => {
    if (!pendingHash) return;
    const hash = pendingHash;
    pendingHash = null;
    location.hash = hash;
  };

  // Buttons add a history entry, so Back closes the dialog instead of leaving the page.
  const openFromButton = (event) => {
    opener = event.currentTarget;
    if (!isGeneHash(location.hash)) {
      history.pushState({ gene: true }, "", "#gene");
      pushed = true;
    }
    show();
  };

  const close = () => dialog.close();

  for (const button of document.querySelectorAll("[data-open-gene]")) button.addEventListener("click", openFromButton);
  dialog.querySelector("[data-close-gene]").addEventListener("click", close);

  dialog.addEventListener("click", (event) => {
    // A click on the backdrop lands on the dialog element itself.
    if (event.target === dialog) close();
    const link = event.target.closest('a[href^="#"]');
    if (link) {
      event.preventDefault();
      pendingHash = link.hash;
      close();
    }
  });

  dialog.addEventListener("close", () => {
    if (pushed) {
      pushed = false;
      history.back(); // popstate follows any pending link
    } else {
      if (isGeneHash(location.hash)) history.replaceState(null, "", location.pathname + location.search);
      followPending();
    }
    (opener ?? fallbackOpener).focus({ preventScroll: true });
    opener = null;
  });

  // Back and Forward move between the page and the dialog's entry.
  window.addEventListener("popstate", () => {
    if (isGeneHash(location.hash)) {
      if (!dialog.open) show();
      return;
    }
    if (dialog.open) {
      pushed = false;
      dialog.close();
    }
    followPending();
  });

  // A typed or linked #gene or #name= opens it too.
  window.addEventListener("hashchange", () => {
    if (isGeneHash(location.hash) && !dialog.open) show();
  });

  if (isGeneHash(location.hash)) show();
}

// The browser bar color follows the chosen theme, not only the system one.
function syncThemeColor(theme) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.content = theme === "dark" ? "#0F1A2B" : "#F3F6F9";
  }
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
    syncThemeColor(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
    label();
  });

  systemDark.addEventListener("change", label);
  if (root.dataset.theme) syncThemeColor(root.dataset.theme);
  label();
}

setUpTrace();
setUpDialog();
setUpThemeToggle();
