import {
  AMINO_ACIDS,
  GENE,
  GENE_MESSAGE,
  STOP,
  classifyMutation,
  codons,
  encodeName,
  mutate,
  nextBase,
  transcribe,
  translate,
} from "./genetics.js";
import { recordTranslation } from "./counter.js";

const STEP_MS = 260;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function aminoName(aa) {
  if (aa === STOP) return "stop";
  return `${AMINO_ACIDS[aa].name} (${aa})`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function summarize(result) {
  if (result.end === "no-start") {
    return "There's no start codon now. Translation begins at AUG, so nothing gets made.";
  }
  if (result.end === "no-stop") {
    return `The ribosome ran off the end without finding a stop codon. A cell would likely destroy this protein: ${result.protein}.`;
  }
  const stopCodon = transcribe(result.steps[result.stopIndex].codon);
  return `The ribosome stopped at codon ${result.stopIndex + 1} (${stopCodon}). The protein is ${result.protein.length} amino acids long.`;
}

function describeMutation(m, position, from, to) {
  const before = transcribe(m.fromCodon);
  const after = transcribe(m.toCodon);
  const lead = `Base ${position + 1} changed from ${from} to ${to}, so ${before} became ${after}.`;
  switch (m.kind) {
    case "silent":
      return `${lead} Both code for ${aminoName(m.toAa)}, so the protein doesn't change. That's a silent mutation.`;
    case "missense":
      return `${lead} ${capitalize(aminoName(m.fromAa))} became ${aminoName(m.toAa)}. That's a missense mutation.`;
    case "nonsense":
      return `${lead} ${after} is a stop codon, so the protein ends early. That's a nonsense mutation.`;
    case "stop-lost":
      return `${lead} The stop codon now codes for ${aminoName(m.toAa)}, so the ribosome reads past it.`;
    case "start-lost":
      return `${lead} That was the start codon.`;
    case "start-restored":
      return `${lead} The start codon is back.`;
    default:
      return lead;
  }
}

function nameVerdict(result) {
  const ambiguous = [...new Set(result.letters.filter((l) => l.kind === "ambiguous").map((l) => l.letter))];
  switch (result.verdict) {
    case "any-cell":
      return "Any cell could make this protein. Every letter is one of the 20 standard amino acids.";
    case "human-with-signal":
      return "Your own cells could make this, with help. U is selenocysteine, and the RNA needs an extra signal to read UGA as U instead of stop. Human cells use it in 25 proteins.";
    case "microbes-only":
      return "A human cell can't make this. O is pyrrolysine, and only some microbes can read UAG as O. Same problem as my name.";
    case "no-cell":
      return `No cell can make this. ${ambiguous.join(", ")} ${ambiguous.length === 1 ? "isn't an amino acid" : "aren't amino acids"}. Scientists use B, J, X, and Z when they can't tell which amino acid is there.`;
    default:
      return "";
  }
}

export function initTranslator(root) {
  const strip = root.querySelector("#gene-strip");
  const output = root.querySelector("#protein-output");
  const status = root.querySelector("#gene-status");
  const reveal = root.querySelector("#gene-reveal");
  const revealCount = root.querySelector("#reveal-count");
  const translateButton = root.querySelector("#translate-button");
  const resetButton = root.querySelector("#reset-button");
  const nameInput = root.querySelector("#name-input");
  const nameOutput = root.querySelector("#name-output");

  let dna = GENE;
  let organism = root.querySelector('input[name="organism"]:checked').value;
  let result = null;
  let run = 0;
  let focusPosition = 0;
  let solved = false;

  // Build one column per codon: DNA bases (buttons), RNA, amino acid.
  const columns = codons(GENE).map((_, index) => {
    const column = document.createElement("div");
    column.className = "codon";
    const dnaRow = document.createElement("span");
    dnaRow.className = "codon-dna";
    for (let k = 0; k < 3; k++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "base";
      button.dataset.position = String(index * 3 + k);
      button.tabIndex = index * 3 + k === focusPosition ? 0 : -1;
      dnaRow.append(button);
    }
    const rna = document.createElement("span");
    rna.className = "codon-rna";
    rna.setAttribute("aria-hidden", "true");
    const aa = document.createElement("span");
    aa.className = "codon-aa";
    column.append(dnaRow, rna, aa);
    strip.append(column);
    return { column, bases: [...dnaRow.children], rna, aa };
  });

  function paintSequence() {
    columns.forEach(({ bases, rna }, index) => {
      bases.forEach((button, k) => {
        const position = index * 3 + k;
        const base = dna[position];
        button.textContent = base;
        button.className = `base base-${base}${base !== GENE[position] ? " changed" : ""}`;
        button.setAttribute("aria-label", `Base ${position + 1}, ${base}. Change to ${nextBase(base)}.`);
      });
      rna.textContent = transcribe(dna.slice(index * 3, index * 3 + 3));
    });
  }

  function clearProtein() {
    for (const { column, aa } of columns) {
      column.classList.remove("reading");
      aa.className = "codon-aa";
      aa.textContent = "";
      aa.removeAttribute("title");
    }
    output.textContent = "";
  }

  function paintStep(step) {
    const cell = columns[step.index].aa;
    if (step.aa === STOP) {
      cell.className = "codon-aa stop";
      cell.textContent = "stop";
      return;
    }
    const special = step.aa === "O" || step.aa === "U";
    cell.className = `codon-aa filled${special ? " special" : ""}`;
    cell.textContent = step.aa;
    cell.title = `${AMINO_ACIDS[step.aa].three}, ${AMINO_ACIDS[step.aa].name}`;
  }

  function paintResult() {
    clearProtein();
    if (!result) return;
    result.steps.forEach(paintStep);
    output.textContent = result.protein;
  }

  function finish() {
    if (result.end === "stop" && result.protein === GENE_MESSAGE) {
      status.textContent = "The ribosome read all 13 amino acids and stopped at UAA. Both UAG codons became O, pyrrolysine.";
      showReveal();
      return;
    }
    if (organism === "ecoli" && dna === GENE) {
      status.textContent = "The ribosome stopped at codon 6. In E. coli, UAG means stop, so the protein ends at MEETN. Some microbes read UAG as an amino acid instead. Switch the organism and translate again.";
      return;
    }
    status.textContent = summarize(result);
  }

  function showReveal() {
    if (solved) return;
    solved = true;
    reveal.hidden = false;
    recordTranslation().then((count) => {
      if (!count) return;
      revealCount.textContent = count === 1
        ? "You're the first person to read it."
        : `You're one of ${count.toLocaleString()} people who have read it.`;
      revealCount.hidden = false;
    });
  }

  async function animateTranslation() {
    const token = ++run;
    result = translate(dna, organism);
    clearProtein();

    if (result.end === "no-start") {
      status.textContent = summarize(result);
      return;
    }

    status.textContent = "Translating…";
    let protein = "";
    for (const step of result.steps) {
      columns[step.index].column.classList.add("reading");
      if (!reducedMotion) await wait(STEP_MS);
      if (token !== run) return;
      columns[step.index].column.classList.remove("reading");
      paintStep(step);
      if (step.aa !== STOP) protein += step.aa;
      output.textContent = protein;
    }
    finish();
  }

  function changeBase(position) {
    ++run;
    const before = dna;
    const from = dna[position];
    const to = nextBase(from);
    dna = mutate(dna, position, to);
    const mutation = classifyMutation(before, dna, position, organism);
    result = translate(dna, organism);
    paintSequence();
    paintResult();

    let message = describeMutation(mutation, position, from, to);
    if (result.stopIndex !== null && mutation.codonIndex > result.stopIndex) {
      message += " It's after the stop codon, so the ribosome never reads it.";
    }
    status.textContent = `${message} ${summarize(result)}`;
    if (result.end === "stop" && result.protein === GENE_MESSAGE) showReveal();
  }

  function moveFocus(position) {
    const buttons = strip.querySelectorAll(".base");
    const clamped = Math.max(0, Math.min(buttons.length - 1, position));
    buttons[focusPosition].tabIndex = -1;
    buttons[clamped].tabIndex = 0;
    buttons[clamped].focus();
    focusPosition = clamped;
  }

  strip.addEventListener("click", (event) => {
    const button = event.target.closest(".base");
    if (!button) return;
    const position = Number(button.dataset.position);
    changeBase(position);
    moveFocus(position);
  });

  // One tab stop for the whole sequence; arrow keys move between bases.
  strip.addEventListener("keydown", (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (event.key in keys) moveFocus(focusPosition + keys[event.key]);
    else if (event.key === "Home") moveFocus(0);
    else if (event.key === "End") moveFocus(dna.length - 1);
    else return;
    event.preventDefault();
  });

  for (const radio of root.querySelectorAll('input[name="organism"]')) {
    radio.addEventListener("change", () => {
      organism = radio.value;
      ++run;
      result = null;
      clearProtein();
      status.textContent = organism === "mbarkeri"
        ? "Methanosarcina barkeri reads UAG differently. Translate again to see how."
        : "E. coli uses the standard genetic code. Translate to see where it stops.";
    });
  }

  translateButton.addEventListener("click", animateTranslation);

  resetButton.addEventListener("click", () => {
    ++run;
    dna = GENE;
    result = null;
    paintSequence();
    clearProtein();
    status.textContent = "The gene is back to the original. Translate it again.";
  });

  nameInput.addEventListener("input", () => {
    const encoded = encodeName(nameInput.value);
    nameOutput.replaceChildren();
    if (encoded.letters.length === 0) return;

    const list = document.createElement("ol");
    list.className = "name-codons";
    list.setAttribute("aria-label", "Codons for your name");
    const items = [
      { codon: "ATG", letter: "M", kind: "frame", label: "start" },
      ...encoded.letters,
      { codon: "TAA", letter: "stop", kind: "frame" },
    ];
    for (const item of items) {
      const li = document.createElement("li");
      li.className = `name-codon is-${item.kind}`;
      const codon = document.createElement("span");
      codon.className = "nc-codon";
      codon.textContent = item.codon ? transcribe(item.codon) : "none";
      const letter = document.createElement("span");
      letter.className = "nc-letter";
      letter.textContent = item.letter;
      li.append(codon, letter);
      list.append(li);
    }

    const verdict = document.createElement("p");
    verdict.className = "name-verdict";
    verdict.textContent = `${nameVerdict(encoded)} Every protein starts with M, so your name gets one in front.`;
    nameOutput.append(list, verdict);
  });

  paintSequence();
  return { reset: () => resetButton.click() };
}
