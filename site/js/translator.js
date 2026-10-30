import {
  AMINO_ACIDS,
  GENE,
  GENE_MESSAGE,
  STOP,
  codons,
  encodeName,
  mutate,
  mutationEffect,
  nameLetters,
  nextBase,
  transcribe,
  translate,
} from "./genetics.js";
import { recordTranslation } from "./counter.js";

const STEP_MS = 260;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Word lengths in MEET NOEL SASON, used to group the reveal tiles.
const MESSAGE_WORDS = [4, 4, 5];

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
  const length = result.protein.length;
  return `The ribosome stopped at codon ${result.stopIndex + 1} (${stopCodon}). The protein is ${length} amino acid${length === 1 ? "" : "s"} long.`;
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
    case "unread":
      return `${lead} That codon comes after the stop, so the ribosome never reads it and the protein doesn't change.`;
    case "no-start":
      return lead;
    default:
      return lead;
  }
}

// "J" / "J and X" / "B, J, and X"
function listLetters(letters) {
  if (letters.length < 3) return letters.join(" and ");
  return `${letters.slice(0, -1).join(", ")}, and ${letters.at(-1)}`;
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
      return `No cell can make this. ${listLetters(ambiguous)} ${ambiguous.length === 1 ? "isn't an amino acid" : "aren't amino acids"}. Scientists use B, J, X, and Z when they can't tell which amino acid is there.`;
    default:
      return "";
  }
}

// Splits a protein into the reveal's word groups: "MEETNSEL" -> ["MEET", "NSEL", ""].
// The last group keeps any extra letters, as when a stop codon is lost.
function groupLikeMessage(protein) {
  const groups = [];
  let start = 0;
  MESSAGE_WORDS.forEach((length, i) => {
    const last = i === MESSAGE_WORDS.length - 1;
    groups.push(last ? protein.slice(start) : protein.slice(start, start + length));
    start += length;
  });
  return groups;
}

// "Letter 5 changed from N to T." / "The last 8 letters are missing." / "1 extra letter, K, was added."
function describeChanges(protein) {
  const notes = [];
  for (let i = 0; i < Math.min(protein.length, GENE_MESSAGE.length); i++) {
    if (protein[i] !== GENE_MESSAGE[i]) notes.push(`Letter ${i + 1} changed from ${GENE_MESSAGE[i]} to ${protein[i]}.`);
  }
  const missing = GENE_MESSAGE.length - protein.length;
  if (missing > 0) notes.push(`The last ${missing} letter${missing === 1 ? " is" : "s are"} missing.`);
  if (missing < 0) notes.push(`${-missing} extra letter${missing === -1 ? "" : "s"}, ${protein.slice(GENE_MESSAGE.length)}, ${missing === -1 ? "was" : "were"} added.`);
  return notes.slice(0, 4).join(" ");
}

export function initTranslator(root) {
  const strip = root.querySelector("#gene-strip");
  const output = root.querySelector("#protein-output");
  const status = root.querySelector("#gene-status");
  const reveal = root.querySelector("#gene-reveal");
  const revealTiles = root.querySelector("#reveal-tiles");
  const revealText = root.querySelector("#reveal-text");
  const revealNote = root.querySelector("#reveal-note");
  const revealCount = root.querySelector("#reveal-count");
  const translateButton = root.querySelector("#translate-button");
  const payoffButton = root.querySelector("#payoff-button");
  const resetButton = root.querySelector("#reset-button");
  const nameInput = root.querySelector("#name-input");
  const nameOutput = root.querySelector("#name-output");
  const nameShare = root.querySelector("#name-share");
  const nameShareStatus = root.querySelector("#name-share-status");
  const nameAnnounce = root.querySelector("#name-announce");

  let dna = GENE;
  let organism = root.querySelector('input[name="organism"]:checked').value;
  let result = null;
  let run = 0;
  let focusPosition = 0;
  let solved = false;
  let played = false;

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

  // One ribosome slides along the RNA row: large subunit above, small subunit below.
  const ribosome = document.createElement("div");
  ribosome.className = "ribosome";
  ribosome.setAttribute("aria-hidden", "true");
  strip.append(ribosome);

  function placeRibosome(index) {
    const { column, rna } = columns[index];
    ribosome.style.width = `${column.offsetWidth}px`;
    ribosome.style.height = `${rna.offsetHeight}px`;
    ribosome.style.transform = `translate(${column.offsetLeft}px, ${column.offsetTop + rna.offsetTop}px)`;
    ribosome.classList.remove("released");
    ribosome.classList.add("active");
  }

  function releaseRibosome() {
    ribosome.classList.add("released");
    ribosome.classList.remove("active");
  }

  function hideRibosome() {
    ribosome.classList.remove("active", "released");
  }

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
    payoffButton.hidden = true;
    hideRibosome();
    for (const { column, aa } of columns) {
      column.classList.remove("unread");
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

  // Codons after the stop never get read, so they fade.
  function markUnread() {
    const last = result?.stopIndex ?? (result?.end === "no-start" ? -1 : columns.length - 1);
    columns.forEach(({ column }, index) => column.classList.toggle("unread", index > last));
  }

  function paintResult() {
    clearProtein();
    if (!result) return;
    result.steps.forEach(paintStep);
    output.textContent = result.protein;
    markUnread();
  }

  // The reveal is built from amino-acid tiles and follows later edits to the gene.
  function paintReveal() {
    if (!solved) return;
    const protein = result ? result.protein : GENE_MESSAGE;
    revealTiles.replaceChildren();
    let offset = 0;
    groupLikeMessage(protein.padEnd(GENE_MESSAGE.length, " ")).forEach((group, g) => {
      const word = document.createElement("span");
      word.className = "reveal-word";
      [...group].forEach((letter, i) => {
        const index = offset + i;
        const tile = document.createElement("span");
        tile.className = "reveal-tile";
        tile.style.setProperty("--i", String(index));
        if (letter === " ") {
          tile.classList.add("missing");
        } else {
          if (letter === "O" || letter === "U") tile.classList.add("special");
          if (letter !== GENE_MESSAGE[index]) tile.classList.add("changed");
          const one = document.createElement("span");
          one.className = "tile-letter";
          one.textContent = letter;
          const three = document.createElement("span");
          three.className = "tile-code";
          three.textContent = AMINO_ACIDS[letter]?.three ?? "";
          tile.append(one, three);
        }
        word.append(tile);
      });
      offset += MESSAGE_WORDS[g];
      revealTiles.append(word);
    });

    const spaced = groupLikeMessage(protein).filter(Boolean).join(" ");
    revealText.textContent = protein === GENE_MESSAGE
      ? "Meet Noel Sason."
      : `The protein now reads ${spaced || "nothing"}. ${describeChanges(protein)}`;

    const changedBases = [...dna].filter((base, i) => base !== GENE[i]).length;
    if (protein === GENE_MESSAGE) {
      revealNote.hidden = true;
    } else if (organism === "ecoli" && result?.end !== "no-start") {
      // E. coli stops at the first UAG whatever else changed, so don't blame the edits.
      revealNote.textContent = `In E. coli the protein stops at ${protein}. Switch back to M. barkeri to read the rest.`;
      revealNote.hidden = false;
    } else if (!protein) {
      revealNote.textContent = "Without a start codon, my name doesn't get made at all.";
      revealNote.hidden = false;
    } else {
      revealNote.textContent = `${changedBases === 1 ? "One base change" : `${changedBases} base changes`} and my name reads ${spaced}.`;
      revealNote.hidden = false;
    }
  }

  function finish() {
    markUnread();
    if (result.end === "stop" && result.protein === GENE_MESSAGE) {
      const stopCodon = transcribe(result.steps[result.stopIndex].codon);
      status.textContent = `The ribosome read all 13 amino acids and stopped at ${stopCodon}. Both UAG codons became O, pyrrolysine.`;
      showReveal();
      return;
    }
    if (organism === "ecoli" && dna === GENE) {
      status.textContent = "The ribosome stopped at codon 6. In E. coli, UAG means stop, so the protein ends at MEETN. Some microbes read UAG as an amino acid instead.";
      payoffButton.hidden = false;
      paintReveal();
      return;
    }
    status.textContent = summarize(result);
    paintReveal();
  }

  function showReveal() {
    const firstTime = !solved;
    solved = true;
    reveal.hidden = false;
    paintReveal();
    if (!firstTime) return;

    reveal.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    try {
      localStorage.setItem("gene-solved", "1");
    } catch {
      // Storage blocked: the home page won't remember the reading.
    }
    document.dispatchEvent(new CustomEvent("gene:read"));
    recordTranslation().then((count) => {
      if (!count) return;
      revealCount.textContent = count === 1
        ? "You're the first person to read it."
        : `You're one of ${count.toLocaleString()} people who have read it.`;
      revealCount.hidden = false;
    });
  }

  function setOrganism(id) {
    organism = id;
    root.querySelector(`input[name="organism"][value="${id}"]`).checked = true;
  }

  async function animateTranslation() {
    played = true;
    const token = ++run;
    result = translate(dna, organism);
    clearProtein();

    if (result.end === "no-start") {
      markUnread();
      status.textContent = summarize(result);
      paintReveal();
      return;
    }

    status.textContent = `Translating with ${organism === "ecoli" ? "E. coli" : "M. barkeri"}…`;
    let protein = "";
    for (const step of result.steps) {
      placeRibosome(step.index);
      if (!reducedMotion) await wait(STEP_MS);
      if (token !== run) return;
      paintStep(step);
      if (step.aa !== STOP) protein += step.aa;
      output.textContent = protein;
    }
    releaseRibosome();
    finish();
  }

  function changeBase(position) {
    ++run;
    const before = dna;
    const from = dna[position];
    const to = nextBase(from);
    dna = mutate(dna, position, to);
    const mutation = mutationEffect(before, dna, position, organism);
    result = translate(dna, organism);
    paintSequence();
    paintResult();

    // An edit after the stop changes nothing, so it gets one sentence, not a summary too.
    const message = describeMutation(mutation, position, from, to);
    status.textContent = mutation.kind === "unread" ? message : `${message} ${summarize(result)}`;
    // Edits update an earlier reveal, but only Translate reveals the message the first time.
    paintReveal();
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
        ? "Methanosarcina barkeri reads UAG differently. Press Translate to see how."
        : "E. coli uses the standard genetic code. Press Translate to see where it stops.";
    });
  }

  translateButton.addEventListener("click", animateTranslation);

  // After E. coli stops at MEETN, one click switches to M. barkeri and reads the whole gene.
  payoffButton.addEventListener("click", () => {
    setOrganism("mbarkeri");
    translateButton.focus();
    animateTranslation();
  });

  resetButton.addEventListener("click", () => {
    ++run;
    dna = GENE;
    result = null;
    paintSequence();
    clearProtein();
    paintReveal();
    status.textContent = "The gene is back to the original. Press Translate to read it again.";
  });

  function renderName() {
    const encoded = encodeName(nameInput.value);
    nameOutput.replaceChildren();
    nameShare.hidden = encoded.letters.length === 0;
    nameShareStatus.textContent = "";
    if (encoded.letters.length === 0) {
      if (nameInput.value.trim()) {
        const hint = document.createElement("p");
        hint.className = "name-verdict";
        hint.textContent = "Amino acids only have codes for the letters A to Z. Accented letters work too.";
        nameOutput.append(hint);
      }
      announceName("");
      return;
    }

    const list = document.createElement("ol");
    list.className = "name-codons";
    list.setAttribute("aria-label", "Codons for your name");
    const items = [
      { codon: "ATG", letter: "M", kind: "frame" },
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
    verdict.textContent = `${nameVerdict(encoded)} Translation starts at AUG, which codes for M, so your name gets one in front.`;
    nameOutput.append(list, verdict);
    announceName(nameVerdict(encoded));
  }

  // Screen readers hear the verdict once typing pauses, not the whole codon list per keystroke.
  let announceTimer;
  function announceName(text) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      nameAnnounce.textContent = text;
    }, 600);
  }

  nameInput.addEventListener("input", renderName);

  // Shares a link that opens this dialog with the name already written in protein.
  nameShare.addEventListener("click", async () => {
    const letters = nameLetters(nameInput.value).join("");
    const url = `${location.origin}${location.pathname}#name=${letters}`;
    const text = `${letters} written in protein, on Noel Sason's portfolio`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "Write your name in protein", text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      nameShareStatus.textContent = "Link copied.";
    } catch (error) {
      if (error?.name !== "AbortError") nameShareStatus.textContent = `Copy this link: ${url}`;
    }
  });

  paintSequence();

  return {
    // Reads the gene with E. coli the first time the dialog opens, so the stop shows right away.
    autoplay() {
      if (played) return;
      played = true;
      setTimeout(animateTranslation, reducedMotion ? 0 : 450);
    },
    // What the assistant needs to answer about the visitor's current view.
    getState() {
      return { dna, organism, protein: result?.protein ?? "", status: status.textContent };
    },
    setName(name) {
      nameInput.value = name;
      renderName();
      nameInput.scrollIntoView({ block: "center" });
    },
  };
}
