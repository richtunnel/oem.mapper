/**
 * Text normalization shared by the estimate adapter and the parts matcher.
 *
 * The spec's sketch (SPEC §3B) normalized punctuation/casing only. Two flaws are
 * fixed here, because both cause real false negatives on shop-written estimates:
 *
 *   1. Abbreviations are not expanded ("frt bumper fascia", "R&I", "assy"), so a
 *      description that a human reads instantly would fall through to UNMATCHED.
 *   2. `text.includes(alias)` matches inside other words ("glass" inside
 *      "glassware"), which invents matches. Matching must be token-boundary
 *      aware — see `phraseContains` below, used by the matcher.
 *
 * Normalization NEVER decides anything on its own: it only makes two strings
 * comparable. The decision layer consumes normalized ids, not text.
 */

/** Single-token expansions applied token-by-token. Illustrative, shop-vocabulary. */
export const TOKEN_EXPANSIONS = Object.freeze({
  "&": "and",
  "r&i": "remove install",
  "ri": "remove install",
  "rr": "remove replace",
  "assy": "assembly",
  "frt": "front",
  "frnt": "front",
  "fwd": "forward",
  "rrs": "rear",
  "wshld": "windshield",
  "ws": "windshield",
  "lh": "left",
  "rh": "right",
  "sen": "sensor",
  "snsr": "sensor",
  "cam": "camera",
  "brkt": "bracket",
  "mtg": "mounting",
  "cal": "calibration",
  "w": "with",
});

const MULTI_WORD_EXPANSIONS = Object.freeze([
  [/\br\s*(?:&|and|\/)\s*i\b/g, "remove install"],
  [/\bremove\s*(?:&|and|\/)\s*install\b/g, "remove install"],
  [/\brem\s+and\s+inst\b/g, "remove install"],
  [/\binc\s+and\s+refinish\b/g, "repair refinish"],
]);

/** Lowercase, expand common abbreviations, strip punctuation, collapse spaces. */
export function normalizeText(value = "") {
  let text = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase();

  for (const [pattern, replacement] of MULTI_WORD_EXPANSIONS) {
    text = text.replace(pattern, ` ${replacement} `);
  }

  // "&" survives the punctuation strip below, so reduce it to "and" first.
  text = text.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ");

  const tokens = text
    .split(" ")
    .filter(Boolean)
    .flatMap((token) => String(TOKEN_EXPANSIONS[token] ?? token).split(" "));

  return tokens.join(" ").trim();
}

/** Token array form of `normalizeText`, used for coverage scoring. */
export function tokenize(value = "") {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

/**
 * True only when `phrase` appears in `text` on token boundaries.
 * Punctuation/casing/abbreviation differences are normalized away first.
 */
export function phraseContains(text, phrase) {
  if (!text || !phrase) return false;
  return ` ${normalizeText(text)} `.includes(` ${normalizeText(phrase)} `);
}

/** Normalize an estimate operation value ("R&I", "Remove and Install") to a canonical enum. */
export function normalizeOperation(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const table = [
    [/^replace$|^repl$/, "REPLACE"],
    [/^remove install$|^remove and install$|^r i$/, "REMOVE_INSTALL"],
    [/^repair$/, "REPAIR"],
    [/^refinish$|^refin$/, "REFINISH"],
    [/^replace glass$|^glass replacement$/, "REPLACE_GLASS"],
    [/^alignment$|^wheel alignment$/, "ALIGNMENT"],
    [/^adjust$|^adjustment$/, "ADJUST"],
    [/^inspect$|^inspection$/, "INSPECT"],
    [/^unknown$|^unspecified$/, "UNKNOWN"],
  ];

  for (const [pattern, operation] of table) {
    if (pattern.test(normalized)) return operation;
  }
  return null; // caller turns this into a ValidationError naming the allowed values
}

/** Build a stable, documented vehicle key. Trim is intentionally excluded (see vehicles module). */
export function buildVehicleKey({ year, make, model }) {
  if (!year || !make || !model) return null;
  const slug = (part) => normalizeText(part).replace(/ /g, "_").toUpperCase();
  return `${slug(make)}-${year}-${slug(model)}`;
}
