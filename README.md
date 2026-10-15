# Recalibra — Vehicle Repair Impact & Recalibration Decision Engine (MVP)

Takes **one structured JSON repair estimate** and returns an **impact matrix** plus an
**auditable decision report** over HTTP: which ADAS/OEM procedures each repair line
indicates, why, and on whose authority — with everything the engine *could not* decide
kept visible instead of being rounded down to "no calibration needed".

> ## Read this first
> **No real OEM procedure data exists in this repository.** Every component, rule,
> condition and source in `src/data/` is **ILLUSTRATIVE and UNVERIFIED**, invented to
> exercise the data model. `verifiedRuleCount` is **0** and the loader refuses to start
> if a dataset claims otherwise. Nothing this engine outputs may be used to decide work
> on a real vehicle. See [docs/OEM-DATA.md](docs/OEM-DATA.md).

## Quickstart

```bash
npm install
npm test          # node:test — no services, no database, no network
npm start         # API on http://localhost:3100
```

Node.js 20+ (developed on 22). Plain JavaScript, ESM.

## Copy-pasteable demo

```bash
# 1. Start the API (port 3100 — port 3000 belongs to the team website)
npm start &

# 2. Analyze the spec's EST-10042 estimate
curl -s -X POST http://localhost:3100/api/estimates/analyze \
  -H 'content-type: application/json' \
  --data @tests/fixtures/est-10042.json | head -c 2000

# 3. Same report, technician-facing plain text
curl -s -X POST 'http://localhost:3100/api/estimates/analyze?format=text' \
  -H 'content-type: application/json' \
  --data @tests/fixtures/est-10042.json

# 4. Upload the estimate as a multipart file
curl -s -X POST http://localhost:3100/api/estimates/analyze \
  -F 'estimate=@tests/fixtures/est-10042.json;type=application/json' | head -c 500

# 5. What adapters exist, and where the data came from
curl -s http://localhost:3100/api/adapters
curl -s http://localhost:3100/api/datasets

# 6. A PDF is refused honestly (501), it is not guessed at
curl -s -X POST http://localhost:3100/api/estimates/analyze \
  -F 'estimate=@some-invoice.pdf;type=application/pdf'
```

### The pipeline in five lines

```
POST estimate ─▶ source adapter (JSON only) ─▶ validate + normalize
             ─▶ resolve vehicle key (never "verified")
             ─▶ match components (MATCHED | AMBIGUOUS | UNMATCHED)
             ─▶ impact matrix  (CANDIDATE GENERATION ONLY)
             ─▶ decision table (three-valued conditions) ─▶ report + evidence
```

## What the report says

Per line: operation, matched component and confidence, decision category, the rules that
produced it, the facts each rule read, the missing facts, and the source document for
every rule. Categories are deliberately distinct:

| Category | Meaning |
| --- | --- |
| `PROCEDURE_INDICATED` | An applicable rule's conditions are satisfied (or it has none). Source is unverified, so this is an *indication*, not a mandate. |
| `INSPECTION_REQUIRED` | Only inspection-type rules triggered. |
| `CONDITIONAL` | A rule applies but named facts are missing — the procedure applies *pending those facts*. |
| `NOT_INDICATED_UNDER_RULES` | Rules applied and none triggered, or no rule covers this component/operation. **Never** "no procedure needed". |
| `UNRESOLVED` | The line could not be matched to one component (unmatched or ambiguous). |

Plus three separate sections — `unresolved`, `coverageGaps`, `humanReview` — because
"we don't know", "we have no rule" and "a human must look at this" are different things.
The human-review flag follows an explicit, versioned policy
(`review-policy-v1`, `src/modules/decision-engine/review-policy.js`), not the spec
sketch's inverted `some(d => d.status !== "REVIEW_REQUIRED")`.

## What this MVP does NOT do

- **No real OEM data.** No rule is `VERIFIED`; all sources are `ILLUSTRATIVE-DOC-00N`
  and fictional. Promotion criteria are in [docs/OEM-DATA.md](docs/OEM-DATA.md).
- **No PDF, OCR, image or CSV ingestion.** The adapters exist and are discoverable via
  `GET /api/adapters`, but they throw a typed `NOT_IMPLEMENTED` (HTTP 501). No PDF/OCR
  dependency is installed on purpose.
- **No VIN decode or configuration resolver.** `vehicleKey` is derived from
  year/make/model (or taken from the input) and is reported as
  `configurationVerified: false` on every report. Trim is ignored when deriving the key.
- **No database, no queue, no persistence, no auth, no job history.** Every request is
  analysed in-process from read-only seed files.
- **No AI in the decision path** (`aiInDecisionPath: false` in every report). No LLM
  call exists in this repo. An LLM may later help with messy descriptions or extraction;
  it will never own a decision.
- **No false-negative validation.** The engine has not been checked against documented
  OEM repair cases, so nothing is known about its miss rate.
- **No multi-vehicle support.** The seeded rule library covers one fictional vehicle
  key, `EXAMPLE-2024-SUV`.
- **No part-number-driven fitment.** `partNumber` is carried through the report but does
  not currently select or filter rules.

`src/workers/` and `src/infrastructure/` from the spec's project layout are **deliberately
absent**: there is no background processing and no database in this MVP. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Dependencies (and why only these)

`express` (HTTP), `multer` (the spec's multipart route shape). Nothing else — validation,
matching, the condition evaluator and the report renderer are hand-written, in-repo, and
directly tested. Tests use `node:test`, `node:assert` and global `fetch`/`FormData`, so
there is no test framework and no HTTP client dependency either.

## Layout

```
src/api/                    app.js · server.js (port 3100) · routes/ · controllers/ · middleware/
src/modules/estimates/      estimate.schema.js · estimate.service.js · adapters/
src/modules/vehicles/       vehicle.service.js
src/modules/parts-mapping/  matcher.js · impact-matrix.js
src/modules/oem-procedures/ oem.repository.js · procedure-resolver.js
src/modules/decision-engine/ condition-evaluator.js · rule-engine.js · decision.service.js · review-policy.js
src/modules/reports/        report.service.js
src/shared/                 errors.js · constants.js · text.js · validate.js
src/data/                   components.json · oem-procedures.json   (ILLUSTRATIVE)
tests/unit/                 matcher · impact matrix · condition evaluator · decision engine · schema/adapters
tests/integration/          pipeline.e2e.test.js · api.test.js
tests/fixtures/             est-10042.json · aliased-components.test-catalog.json
docs/                       ARCHITECTURE.md · OEM-DATA.md
```

## Deviations from the spec (and why)

1. **A vehicle that is not "verified" no longer blocks analysis (SPEC §6).** The sketch
   returns 422 when `vehicle.verified` is false. With no VIN provider and no verified data,
   that gates every request and hides everything behind one error. Instead the report
   carries `configurationVerified: false`, the reason, and the list of checks that did not
   happen — on every decision.
2. **`lines[].operation` is required (SPEC §2 omits it on L1).** Rule applicability keys
   on the operation; guessing it is exactly the silent guess this product must not make.
   Missing `position` warns and defaults to `UNSPECIFIED` rather than failing.
3. **Matching is token-boundary, not `text.includes(alias)`** (SPEC §3B), and ambiguity
   requires a genuine score tie — see the header of `matcher.js`.
4. **Human-review flag replaced with `review-policy-v1`** (SPEC §6 correction), with
   rule-library gaps separated from analysis defects.
5. **`logic: ANY` short-circuits on a known TRUE** (SPEC §5 production refinement) and
   reports the unevaluated conditions rather than burying them.
6. **`EST-10042` fixture extended with L5 and L6** so the end-to-end test reaches the
   UNRESOLVED and INSPECTION_REQUIRED paths. L1–L4 are the spec's own lines; the
   additions are documented in the fixture's `_fixtureNote`.
7. **Tests run via `node --test "tests/**/*.test.js"`** — `node --test <dir>` is not
   accepted as a directory argument on this Node build.
