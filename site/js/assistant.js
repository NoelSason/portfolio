// "Ask about this gene": common questions answer instantly from this file; anything else goes
// to a Lambda function that asks Claude, with the visitor's current gene as context.
const ASK_URL = "https://qahsaj7knvv5hzoqcr3oew3e5e0dlszg.lambda-url.us-east-1.on.aws/";

// Prepared answers, so the feature works even after the day's questions run out.
const COMMON = {
  stop: "In the standard genetic code, which E. coli uses, UAG is one of three stop codons. No transfer RNA brings an amino acid for it. A release factor protein binds there instead and frees the finished chain, so the protein ends after codon 5 as MEETN.",
  pyl: "Pyrrolysine is the 22nd amino acid, written O. Some methane-making archaea, like Methanosarcina barkeri, and a few bacteria make it. They carry a dedicated transfer RNA and enzyme that put pyrrolysine at UAG codons, which most organisms read as stop.",
  human: "Not this one. Human cells use the standard code, so their ribosomes would stop at the first UAG, codon 6, just like E. coli. Humans don't make pyrrolysine. They do make the 21st amino acid, selenocysteine, at UGA codons that carry a special signal in the RNA.",
};

export function initAssistant(root, getState) {
  const form = root.querySelector("#assistant-form");
  const input = root.querySelector("#assistant-input");
  const submit = form.querySelector("button[type=submit]");
  const answer = root.querySelector("#assistant-answer");
  const remaining = root.querySelector("#assistant-remaining");
  let busy = false;

  function show(text, source) {
    answer.replaceChildren();
    const body = document.createElement("p");
    body.className = "assistant-text";
    body.textContent = text;
    const label = document.createElement("p");
    label.className = "assistant-source";
    label.textContent = source;
    answer.append(body, label);
  }

  function showThinking() {
    answer.replaceChildren();
    const dots = document.createElement("p");
    dots.className = "assistant-thinking";
    dots.textContent = "Reading your gene";
    answer.append(dots);
  }

  for (const chip of root.querySelectorAll("[data-common]")) {
    chip.addEventListener("click", () => show(COMMON[chip.dataset.common], "Prepared answer"));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (busy) return;
    if (question.length < 3) {
      show("Type a question first, for example: why did my change stop the protein?", "");
      return;
    }

    busy = true;
    submit.disabled = true;
    showThinking();
    try {
      const response = await fetch(ASK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, dna: getState().dna, organism: getState().organism }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        show(data.message ?? "The assistant couldn't answer just now. Try again in a minute.", "");
        return;
      }
      show(data.answer, "Answered by Claude. It can make mistakes.");
      if (Number.isInteger(data.remaining)) {
        remaining.textContent = `${data.remaining} of today's questions left.`;
      }
      input.value = "";
    } catch {
      show("The assistant couldn't be reached. Check your connection and try again.", "");
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
}
