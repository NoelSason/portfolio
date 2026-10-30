// Counts visitors who read the hidden message. The endpoint is an AWS Lambda
// function URL that increments a DynamoDB item (see README). Each browser adds
// itself once; after that it only reads the count. Any failure hides the line.
const COUNTER_URL = "https://q4prjx7x5sccbamh7impevwmk40owgcp.lambda-url.us-east-1.on.aws/";
const STORAGE_KEY = "gene-read";

function alreadyCounted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markCounted() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Private mode or blocked storage: this visitor may be counted again.
  }
}

export async function recordTranslation() {
  if (!COUNTER_URL) return null;
  try {
    const response = await fetch(COUNTER_URL, { method: alreadyCounted() ? "GET" : "POST" });
    if (!response.ok) return null;
    const { count } = await response.json();
    markCounted();
    return Number.isInteger(count) ? count : null;
  } catch {
    return null;
  }
}
