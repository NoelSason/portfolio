// Pure genetics helpers for the "Translate the gene" feature.
// No DOM access here, so the logic runs (and is tested) under Node.

const BASES = "TCAG";
// NCBI translation table 1 (the standard code), indexed by first, second, then third base in TCAG order.
const STANDARD_CODE = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";

export const CODON_TABLE = Object.freeze(
  Object.fromEntries(
    [...STANDARD_CODE].map((aa, i) => {
      const codon = BASES[i >> 4] + BASES[(i >> 2) & 3] + BASES[i & 3];
      return [codon, aa];
    }),
  ),
);

export const STOP = "*";

// The hidden message: M E E T N O E L S A S O N, then a stop.
// Both O's are TAG, which only a pyrrolysine-reading organism translates.
export const GENE = "ATGGAGGAAACCAACTAGGAGCTGTCCGCCAGCTAGAATTAA";
export const GENE_MESSAGE = "MEETNOELSASON";

export const ORGANISMS = Object.freeze({
  ecoli: {
    id: "ecoli",
    name: "Escherichia coli",
    short: "E. coli",
    reassigned: {},
  },
  mbarkeri: {
    id: "mbarkeri",
    name: "Methanosarcina barkeri",
    short: "M. barkeri",
    // Methanosarcina species read the amber codon UAG as pyrrolysine (O).
    reassigned: { TAG: "O" },
  },
});

export const AMINO_ACIDS = Object.freeze({
  A: { three: "Ala", name: "alanine" },
  C: { three: "Cys", name: "cysteine" },
  D: { three: "Asp", name: "aspartate" },
  E: { three: "Glu", name: "glutamate" },
  F: { three: "Phe", name: "phenylalanine" },
  G: { three: "Gly", name: "glycine" },
  H: { three: "His", name: "histidine" },
  I: { three: "Ile", name: "isoleucine" },
  K: { three: "Lys", name: "lysine" },
  L: { three: "Leu", name: "leucine" },
  M: { three: "Met", name: "methionine" },
  N: { three: "Asn", name: "asparagine" },
  P: { three: "Pro", name: "proline" },
  Q: { three: "Gln", name: "glutamine" },
  R: { three: "Arg", name: "arginine" },
  S: { three: "Ser", name: "serine" },
  T: { three: "Thr", name: "threonine" },
  V: { three: "Val", name: "valine" },
  W: { three: "Trp", name: "tryptophan" },
  Y: { three: "Tyr", name: "tyrosine" },
  O: { three: "Pyl", name: "pyrrolysine" },
  U: { three: "Sec", name: "selenocysteine" },
});

export function codons(dna) {
  const list = [];
  for (let i = 0; i + 3 <= dna.length; i += 3) list.push(dna.slice(i, i + 3));
  return list;
}

export function transcribe(dna) {
  return dna.replaceAll("T", "U");
}

export function translateCodon(codon, organismId) {
  const organism = ORGANISMS[organismId];
  if (!organism) throw new Error(`Unknown organism: ${organismId}`);
  return organism.reassigned[codon] ?? CODON_TABLE[codon];
}

// Translates from the first codon until the first stop.
// end is "stop", "no-start" (first codon isn't ATG), or "no-stop" (ran off the end).
export function translate(dna, organismId) {
  const list = codons(dna);
  if (list[0] !== "ATG") return { end: "no-start", protein: "", steps: [], stopIndex: null };

  const steps = [];
  for (let i = 0; i < list.length; i++) {
    const aa = translateCodon(list[i], organismId);
    steps.push({ index: i, codon: list[i], aa });
    if (aa === STOP) {
      const protein = steps.slice(0, -1).map((s) => s.aa).join("");
      return { end: "stop", protein, steps, stopIndex: i };
    }
  }
  return { end: "no-stop", protein: steps.map((s) => s.aa).join(""), steps, stopIndex: null };
}

const NEXT_BASE = { A: "C", C: "G", G: "T", T: "A" };

export function nextBase(base) {
  return NEXT_BASE[base];
}

export function mutate(dna, position, base) {
  return dna.slice(0, position) + base + dna.slice(position + 1);
}

// Classifies a single-base substitution by its effect on that codon.
export function classifyMutation(before, after, position, organismId) {
  const index = Math.floor(position / 3);
  const fromCodon = before.slice(index * 3, index * 3 + 3);
  const toCodon = after.slice(index * 3, index * 3 + 3);
  const fromAa = translateCodon(fromCodon, organismId);
  const toAa = translateCodon(toCodon, organismId);

  let kind;
  if (index === 0 && fromCodon === "ATG" && toCodon !== "ATG") kind = "start-lost";
  else if (index === 0 && fromCodon !== "ATG" && toCodon === "ATG") kind = "start-restored";
  else if (fromAa === toAa) kind = "silent";
  else if (toAa === STOP) kind = "nonsense";
  else if (fromAa === STOP) kind = "stop-lost";
  else kind = "missense";

  return { kind, codonIndex: index, fromCodon, toCodon, fromAa, toAa };
}

// One codon per letter for writing a name in protein. Most are the codon human genes use most often.
const NAME_CODONS = {
  A: "GCC", C: "TGC", D: "GAC", E: "GAG", F: "TTC", G: "GGC", H: "CAC", I: "ATC",
  K: "AAG", L: "CTG", M: "ATG", N: "AAC", P: "CCC", Q: "CAG", R: "CGG", S: "AGC",
  T: "ACC", V: "GTG", W: "TGG", Y: "TAC",
  O: "TAG", // pyrrolysine, read from UAG
  U: "TGA", // selenocysteine, read from UGA with a SECIS signal in the RNA
};

// What each one-letter code that isn't one of the 20 standard amino acids means.
export const SPECIAL_LETTERS = Object.freeze({
  O: "pyrrolysine",
  U: "selenocysteine",
  B: "ambiguous",
  J: "ambiguous",
  X: "ambiguous",
  Z: "ambiguous",
});

// Encodes a name as a gene: start codon, one codon per letter, stop codon.
// verdict is "any-cell", "human-with-signal" (has U), "microbes-only" (has O), or "no-cell" (has B, J, X, or Z).
export function encodeName(name) {
  const letters = [...name.toUpperCase()].filter((ch) => ch >= "A" && ch <= "Z");
  const encoded = letters.map((ch) => ({
    letter: ch,
    codon: NAME_CODONS[ch] ?? null,
    kind: SPECIAL_LETTERS[ch] ?? "standard",
  }));

  const has = (kind) => encoded.some((e) => e.kind === kind);
  let verdict = "any-cell";
  if (has("ambiguous")) verdict = "no-cell";
  else if (has("pyrrolysine")) verdict = "microbes-only";
  else if (has("selenocysteine")) verdict = "human-with-signal";

  return {
    letters: encoded,
    verdict,
    codons: ["ATG", ...encoded.map((e) => e.codon ?? "???"), "TAA"],
  };
}
