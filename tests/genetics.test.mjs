import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODON_TABLE,
  GENE,
  GENE_MESSAGE,
  classifyMutation,
  codons,
  encodeName,
  mutate,
  mutationEffect,
  transcribe,
  translate,
  translateCodon,
} from "../site/js/genetics.js";

test("codon table matches the standard genetic code", () => {
  assert.equal(Object.keys(CODON_TABLE).length, 64);
  const known = { ATG: "M", TGG: "W", TAA: "*", TAG: "*", TGA: "*", GCC: "A", AGA: "R", AGC: "S", TTA: "L", ATA: "I" };
  for (const [codon, aa] of Object.entries(known)) assert.equal(CODON_TABLE[codon], aa, codon);
  // 61 sense codons, 3 stops, 20 amino acids.
  const values = Object.values(CODON_TABLE);
  assert.equal(values.filter((v) => v === "*").length, 3);
  assert.equal(new Set(values.filter((v) => v !== "*")).size, 20);
});

test("the gene is whole codons and starts with ATG", () => {
  assert.equal(GENE.length % 3, 0);
  assert.equal(codons(GENE)[0], "ATG");
  assert.equal(transcribe("ATGTAG"), "AUGUAG");
});

test("E. coli stops at the first UAG", () => {
  const result = translate(GENE, "ecoli");
  assert.equal(result.end, "stop");
  assert.equal(result.protein, "MEETN");
  assert.equal(result.stopIndex, 5);
});

test("M. barkeri reads UAG as pyrrolysine and spells the message", () => {
  const result = translate(GENE, "mbarkeri");
  assert.equal(result.end, "stop");
  assert.equal(result.protein, GENE_MESSAGE);
  assert.equal(result.stopIndex, codons(GENE).length - 1);
  assert.equal(translateCodon("TAA", "mbarkeri"), "*");
});

test("a broken start codon stops translation before it begins", () => {
  const result = translate(mutate(GENE, 0, "C"), "ecoli");
  assert.equal(result.end, "no-start");
  assert.equal(result.protein, "");
});

test("mutations are classified by their effect on the codon", () => {
  const cases = [
    // [position, new base, organism, expected kind]
    [11, "T", "ecoli", "silent"], // ACC -> ACT, still T
    [9, "G", "ecoli", "missense"], // ACC -> GCC, T -> A
    [5, "T", "ecoli", "missense"], // GAG -> GAT, E -> D
    [3, "T", "ecoli", "nonsense"], // GAG -> TAG
    [3, "T", "mbarkeri", "missense"], // GAG -> TAG reads as O there
    [41, "G", "ecoli", "silent"], // TAA -> TAG, both stops in E. coli
    [41, "G", "mbarkeri", "stop-lost"], // TAA -> TAG reads through as O
    [2, "A", "ecoli", "start-lost"],
  ];
  for (const [position, base, organism, kind] of cases) {
    const result = classifyMutation(GENE, mutate(GENE, position, base), position, organism);
    assert.equal(result.kind, kind, `position ${position} -> ${base} in ${organism}`);
  }
});

test("names encode to codons with a verdict", () => {
  const noel = encodeName("Noel");
  assert.deepEqual(noel.codons, ["ATG", "AAC", "TAG", "GAG", "CTG", "TAA"]);
  assert.equal(noel.verdict, "microbes-only");

  assert.equal(encodeName("Priya").verdict, "any-cell");
  assert.equal(encodeName("Luis").verdict, "human-with-signal");
  assert.equal(encodeName("Jo").verdict, "no-cell");
  assert.equal(encodeName("Ana-Maria 2").letters.length, 8);
  assert.equal(encodeName("").letters.length, 0);
});

test("every encoded standard letter translates back to itself", () => {
  const result = encodeName("ACDEFGHIKLMNPQRSTVWY");
  for (const { letter, codon } of result.letters) assert.equal(CODON_TABLE[codon], letter);
});

test("mutation effects account for where the ribosome starts and stops", () => {
  // Base 19 starts codon 7, after E. coli's stop at codon 6, so it's never read.
  assert.equal(mutationEffect(GENE, mutate(GENE, 18, "T"), 18, "ecoli").kind, "unread");
  // The same codon is read in M. barkeri, so the change matters there.
  assert.equal(mutationEffect(GENE, mutate(GENE, 18, "T"), 18, "mbarkeri").kind, "missense");
  // Once the start codon is gone, later changes make no protein either way.
  const noStart = mutate(GENE, 0, "C");
  assert.equal(mutationEffect(GENE, noStart, 0, "ecoli").kind, "start-lost");
  assert.equal(mutationEffect(noStart, mutate(noStart, 0, "G"), 0, "ecoli").kind, "no-start");
  assert.equal(mutationEffect(noStart, mutate(noStart, 0, "A"), 0, "ecoli").kind, "start-restored");
  assert.equal(mutationEffect(noStart, mutate(noStart, 9, "G"), 9, "ecoli").kind, "no-start");
});

test("accented names keep their letters", () => {
  assert.deepEqual(encodeName("José").letters.map((l) => l.letter), ["J", "O", "S", "E"]);
  assert.equal(encodeName("Zoë").letters.length, 3);
  assert.equal(encodeName("Ünal").verdict, "human-with-signal");
  assert.equal(encodeName("李华").letters.length, 0);
});
