# Architecture

## The six stages

| # | Stage | Code | What it may decide |
| --- | --- | --- | --- |
| 1 | Ingest one format | `src/modules/estimates/adapters/` | Nothing. Produces a raw estimate or a typed error. |
| 2 | Validate + normalize | `estimate.schema.js`, `src/shared/text.js` | Nothing. Shape, operation vocabulary, punctuation/casing/abbreviations. |
| 3 | Resolve vehicle | `src/modules/vehicles/vehicle.service.js` | Produces a `vehicleKey`. **Never** claims verification. |
| 4 | Map parts + build impact matrix | `src/modules/parts-mapping/` | MATCHED / AMBIGUOUS / UNMATCHED, and a **candidate** sensor/system set only. |
| 5 | Evaluate OEM rules | `src/modules/decision-engine/` | Everything. This is the only stage that states a procedure may apply. |
| 6 | Report | `src/modules/reports/` | Formatting, grouping, evidence assembly — no new claims. |

`estimate.service.js` composes 1→6 and is the only place the stages meet.

## Why extraction, mapping and decisioning are separated

The brief's core insight: the valuable IP is the *normalized relationship* between repair
operations, vehicle configuration, affected systems, OEM procedures and the evidence
behind each decision. That only holds if those concerns cannot leak into each other:

- **Extraction** (what the shop wrote) must be replaceable. Adding a CCC/Mitchell export,
  a PDF parser or an OCR worker changes stage 1 and nothing else — the estimate is handed
  on in one normalized shape.
- **Mapping** (what the line *is*) must be honest about ignorance and must never imply a
  requirement. `MATCHED` carries a component id; `AMBIGUOUS`/`UNMATCHED` carry candidates
  and reasons. The impact matrix is explicitly a *candidate generator*; its cells mean
  "evaluate this", never "calibrate this".
- **Decisioning** (what must be done, with authority) is deterministic, data-driven and
  independently testable. Rules are decision-table records, not code paths, so a new
  vehicle make or a new estimating platform does not mean rewriting decision logic.
- **AI** may assist stages 1–2 (messy text, candidate matching) and is barred from stage 5.
  Every report states `aiInDecisionPath: false`; no LLM call exists in this codebase.

Each stage is testable on its own: the matcher, the condition evaluator and the rule
engine all run against in-memory inputs, and the reviews below can be replaced without a
database.

## Three-valued logic is not a detail

`TRUE` / `FALSE` / `UNKNOWN` per condition, with per-logic resolution:

- `ANY`: a known `TRUE` triggers the rule; unknowns are reported alongside it and cannot
  un-trigger it. Only when nothing is `TRUE` and something is `UNKNOWN` is the answer
  `INSUFFICIENT_DATA`, and then the exact field names travel with it.
- `ALL`: one known `FALSE` settles the rule; unknowns are recorded but do not block.

`null` and absent are both `UNKNOWN` but are distinguished in the evidence trail; `false`
is a real fact. Coercion is refused (`"false"` never equals `false`).

## Category precedence

For a line with several applicable rules the category is chosen in this order, and the
losers are still attached to the line:

1. `PROCEDURE_INDICATED` — a triggered rule that is not an inspection.
2. `INSPECTION_REQUIRED` — only inspection rules triggered.
3. `CONDITIONAL` — nothing triggered, at least one rule awaiting facts.
4. `NOT_INDICATED_UNDER_RULES` — rules applied, none triggered, nothing pending.

`pendingFacts` is attached to every line, so a category of (1) or (2) never hides an
unevaluated condition.

## Review policy (`review-policy-v1`)

Three lists, kept apart on purpose:

- `unresolved` — mapping failures, missing facts, coverage gaps as report items.
- `coverageGaps` — our rule library has nothing for this component/operation. A gap in
  our data, not a defect in the estimate.
- `humanReview` — `humanReviewRequired` is true only for: `MAPPING_UNRESOLVED`,
  `MISSING_TRIGGER_FACTS`, `UNVERIFIED_SOURCE`. `RULE_LIBRARY_GAP` and
  `CONDITIONS_EVALUATED_FULLY` never raise it, and the policy rules are published in the
  response so a reader can audit the flag itself.

With today's data every triggered rule is `ILLUSTRATIVE`, so `UNVERIFIED_SOURCE` keeps
`humanReviewRequired` true — which is the honest answer while no OEM source exists.

## What is deliberately missing

`src/workers/` (background processing, retries) and `src/infrastructure/` (PostgreSQL,
Redis, external clients, logging) are **not created** in this MVP. There is no queue, no
database and no external service; every request is served in-process from two read-only
JSON files. Creating empty directories would suggest behaviour that does not exist.

Also absent by design: VIN decode, PDF/OCR extraction, persistence/migrations, auth,
malware scanning, job tracking, and any measurement of false negatives.

## Request flow (HTTP)

```
POST /api/estimates/analyze
  ├── express.json (object or { estimate: ... })      ─┐
  ├── multer memoryStorage (multipart `estimate` file) ─┤──▶ adapter registry
  └── ?format=text                                     ─┘        │
                                                                 ▼
                          validate ─▶ vehicle ─▶ matrix ─▶ rules ─▶ report
                                                                 ▼
                       { status, estimateId, adapter, impactMatrix, decisions, report }
errors: 400 VALIDATION_ERROR · 501 NOT_IMPLEMENTED · 404 NOT_FOUND · 413 FILE_TOO_LARGE
```

Other routes: `GET /api/adapters`, `GET /api/datasets`, `GET /api/health`.

## Where the next work goes

| Follow-up | Where it plugs in |
| --- | --- |
| PDF/OCR/CSV extraction | new adapter implementing `SourceAdapterBase`; drop the stub |
| VIN decode + trim/fitment | `vehicle.service.js` → set `configurationVerified` and the sensor package |
| Real OEM procedure library | `src/data/oem-procedures.json` + `docs/OEM-DATA.md` promotion path |
| Persistence + history | new `src/infrastructure/`, called from `estimate.service.js` |
| Background jobs/queue | new `src/workers/`, behind a different route contract |
| False-negative validation | new fixtures of documented repair cases asserting expected categories |
