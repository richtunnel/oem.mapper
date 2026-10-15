/**
 * Parts matcher — turns an estimate description into a canonical component id,
 * and says so honestly when it cannot.
 *
 * Fixes to the spec's sketch (SPEC §3B), which is the reason this file is longer:
 *   1. The sketch used `text.includes(alias)` — substring matching invents matches
 *      across word boundaries. Matching here is token-boundary phrase matching.
 *   2. The sketch returned AMBIGUOUS for any multi-match, including when one
 *      component scored far better than another. Here ambiguity requires a genuine
 *      TIE at the top score, so "windshield camera" resolves to the camera rather
 *      than failing against the windshield part.
 *   3. The sketch threw away the original description and had no confidence. Both
 *      are preserved on the result and carried into the report (SPEC §9 step 2).
 *
 * Two invariants the rest of the system depends on:
 *   - Never guess. Only MATCHED results have a componentId; AMBIGUOUS lists every
 *     tied candidate and UNMATCHED lists near misses, both for human review.
 *   - Matching is a CANDIDATE GENERATION step. A matched part does not imply that
 *     any procedure is required — that is decided by the rules engine alone.
 */
import { MATCH_STATUS } from "../../shared/constants.js";
import { phraseContains, tokenize } from "../../shared/text.js";

export const MATCH_CONFIDENCE = Object.freeze({
  EXACT: "EXACT",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
});

/** Below this score a description is reported as UNMATCHED rather than matched weakly. */
export const MATCH_MIN_SCORE = 0.6;
/** Two candidates whose scores differ by less than this are a genuine tie. */
const TIE_EPSILON = 0.001;
/** Single-token aliases shorter than this are ignored ("arm", "cap" cause noise). */
const MIN_SINGLE_TOKEN_ALIAS_LENGTH = 4;

/**
 * Score one alias against a description.
 * @returns {{score: number, matchedAlias: string, kind: string}|null}
 */
export function scoreAlias(description, alias) {
  const textTokens = tokenize(description);
  const aliasTokens = tokenize(alias);
  if (!textTokens.length || !aliasTokens.length) return null;
  if (aliasTokens.length === 1 && aliasTokens[0].length < MIN_SINGLE_TOKEN_ALIAS_LENGTH) return null;

  const text = textTokens.join(" ");
  const normalizedAlias = aliasTokens.join(" ");

  if (text === normalizedAlias) return { score: 1, matchedAlias: alias, kind: "EXACT" };
  if (!phraseContains(text, normalizedAlias)) return null;

  // Longer aliases relative to the description are more specific.
  const coverage = aliasTokens.length / textTokens.length;
  const score = roundScore(0.5 + 0.5 * Math.min(coverage, 1));
  return { score, matchedAlias: alias, kind: "PHRASE" };
}

export function confidenceFromScore(score) {
  if (score >= 0.999) return MATCH_CONFIDENCE.EXACT;
  if (score >= 0.8) return MATCH_CONFIDENCE.HIGH;
  if (score >= MATCH_MIN_SCORE) return MATCH_CONFIDENCE.MEDIUM;
  return MATCH_CONFIDENCE.LOW;
}

/**
 * Match one description against the component catalog.
 * @param {string} description
 * @param {object[]} components
 */
export function findComponent(description, components = []) {
  const originalDescription = typeof description === "string" ? description : String(description ?? "");
  const normalizedDescription = tokenize(originalDescription).join(" ");

  const scored = [];
  for (const component of components) {
    let best = null;
    for (const alias of component.aliases ?? []) {
      const candidate = scoreAlias(originalDescription, alias);
      if (!candidate) continue;
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (best) {
      scored.push({
        componentId: component.id,
        displayName: component.displayName ?? component.id,
        score: best.score,
        confidence: confidenceFromScore(best.score),
        matchedAlias: best.matchedAlias,
        kind: best.kind,
        component,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.componentId.localeCompare(b.componentId));
  const candidates = scored.filter((c) => c.score >= MATCH_MIN_SCORE);
  const nearMisses = scored.filter((c) => c.score < MATCH_MIN_SCORE);

  const base = {
    originalDescription,
    normalizedDescription,
    componentId: null,
    component: null,
    matchConfidence: null,
    candidates: [...candidates, ...nearMisses].slice(0, 5).map(toCandidateSummary),
  };

  if (candidates.length === 0) {
    return {
      ...base,
      status: MATCH_STATUS.UNMATCHED,
      reason:
        "This description is not in the component catalog. No catalog alias matched it, so the affected " +
        "components and sensors are unknown. This line must not be assumed to need no procedure.",
    };
  }

  const best = candidates[0];
  const tied = candidates.filter((c) => Math.abs(c.score - best.score) < TIE_EPSILON);

  if (tied.length > 1) {
    return {
      ...base,
      status: MATCH_STATUS.AMBIGUOUS,
      reason: `Several catalog components match this description equally well (${tied
        .map((c) => c.componentId)
        .join(", ")}); the engine will not choose between them.`,
      candidates: tied.map(toCandidateSummary),
    };
  }

  return {
    ...base,
    status: MATCH_STATUS.MATCHED,
    componentId: best.componentId,
    component: best.component,
    matchConfidence: {
      level: best.confidence,
      score: best.score,
      matchedAlias: best.matchedAlias,
      matchKind: best.kind,
    },
    reason: `Matched catalog component "${best.componentId}" on alias "${best.matchedAlias}" (${best.confidence} confidence).`,
    candidates: candidates.slice(0, 3).map(toCandidateSummary),
  };
}

function toCandidateSummary(candidate) {
  return {
    componentId: candidate.componentId,
    displayName: candidate.displayName,
    score: candidate.score,
    confidence: candidate.confidence,
    matchedAlias: candidate.matchedAlias,
  };
}

function roundScore(value) {
  return Math.round(value * 10000) / 10000;
}
