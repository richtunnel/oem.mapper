# OEM data: status, provenance, and what would make it real

## The plain statement

**There is no real OEM procedure data in this repository. Not one rule is verified.**

- Every rule in `src/data/oem-procedures.json` is marked `ruleStatus: "ILLUSTRATIVE"` and
  `verified: false`.
- Every source document id begins with `ILLUSTRATIVE-DOC-` and is **fictional**. There is
  no document `ILLUSTRATIVE-DOC-001` anywhere in the world; it exists so the citation
  plumbing can be exercised end to end.
- The component aliases, sensor relationships and vehicle key `EXAMPLE-2024-SUV` are
  invented. `EXAMPLE` is not a real make and no real-world make, model or trim is named or
  implied anywhere in this repository.
- `GET /api/datasets` reports `verifiedRuleCount: 0`; every report states
  `dataProvenance.verifiedRuleCount: 0` and carries the disclaimer.
- `oem.repository.js` **refuses to load a dataset whose `_provenance.verified` is `true`**.
  Flipping a flag in JSON cannot turn this data into verified data; the loader fails and
  the check must be removed deliberately, together with a real source.

Consequences that are enforced in code, not just documented:

- A triggered rule produces `PROCEDURE_INDICATED`, never "calibration required", and its
  headline says the source must be verified before the procedure is performed.
- `UNVERIFIED_SOURCE` is a `humanReviewRequired` trigger in `review-policy-v1`, so while
  the library is illustrative, any procedure indication keeps the review flag on.
- The report's `disclaimer` says the output may not be used to decide work on a real
  vehicle.

## Why this is the honest position

Per the project's hard constraints: the engine must never present illustrative data as
real. A plausible-looking calibration list is the one failure mode that would make this
product actively dangerous — a shop acting on an invented radar requirement, or worse
missing a real camera calibration because our gap looked like a "no". So the engine is
built to say **"I do not know"** loudly (`UNRESOLVED`, `INSUFFICIENT_DATA`,
`coverageGaps`, `NOT_INDICATED_UNDER_RULES`) and to attribute every statement to an
explicit rule and source.

## What would promote a rule to VERIFIED

A rule may be marked `ruleStatus: "VERIFIED"`, `verified: true` only when **all** of the
following hold:

1. **A legitimate, vehicle-specific source exists.** An OEM service-information
   subscription, licensed service-information data, or an expert-reviewed repair case set.
   A generic part catalog, a public VIN decoder, a forum post, a competitor's marketing
   page, or an LLM's summary do not qualify.
2. **The source is identified precisely**: document id, revision, section, and page or
   procedure identifier — enough for a technician to open it and land on the same text.
   A licensed source must additionally be recorded with its licence reference in this
   repository (`_provenance`), and the actual text must not be copied in.
3. **Applicability is pinned to the exact configuration**: year, make, model, trim or
   sensor package, and the vehicle key the rule declares. "Most SUVs" is not applicable.
4. **The trigger conditions are transcribed, not paraphrased**: every condition a rule
   carries (disconnection, bracket disturbance, alignment, DTC presence, glass replaced,
   method/equipment requirements) must come from the source, with the procedure type
   (static calibration / dynamic calibration / initialization / aiming / inspection)
   stated the way the OEM states it.
5. **A second person has checked it against the source**, and the check is recorded — who
   checked it, when, and against which revision.
6. **The vehicle key in the data has a real configuration behind it**, i.e. a
   configuration/VIN resolver can produce it, instead of it being typed by hand.
7. **The fixture set is updated**: a documented repair case covering the rule goes into
   the validation fixtures so the rule is exercised end to end, and the review-policy
   behaviour of a verified rule (`CONDITIONS_EVALUATED_FULLY` → no human review) is
   covered by a test rather than assumed.

Until then, the *only* correct outputs of this system are indications labelled unverified,
explicit gaps, and requests for human review.

## How verified data is expected to coexist with illustrative data

The intended migration is additive:

- Keep the illustrative dataset for tests and demos, clearly named
  (`ILLUSTRATIVE-OEM-PROCEDURES-001`) and never presented as real.
- Add real rules keyed to real vehicle keys, with `ruleStatus: "VERIFIED"` and real source
  records. Because rule applicability is keyed on `vehicleKey`, the two sets do not mix:
  a real 2023 make/model never sees an `EXAMPLE-2024-SUV` rule.
- `verifiedRuleCount` becomes non-zero, `UNVERIFIED_SOURCE` stops firing for lines whose
  only rules are real, and the human-review flag becomes a meaningful filter again.
- The datasets' `_provenance` block and the loader guard change together, in one reviewed
  commit, with the licence reference recorded.

## Rule record shape (for whoever adds real data)

```json
{
  "id": "REAL-0001",
  "ruleStatus": "VERIFIED",
  "verified": true,
  "procedure": "OEM_PROCEDURE_NAME_AS_WRITTEN",
  "procedureType": "STATIC_CALIBRATION",
  "applicability": {
    "vehicleKey": "REAL-2023-MODEL",
    "triggerComponent": "front_camera",
    "operations": ["REPLACE"],
    "procedureType": null
  },
  "logic": "ALL",
  "conditions": [
    { "field": "componentReplaced", "operator": "equals", "value": true,
      "label": "as stated by the source" }
  ],
  "reason": "One sentence, in the source's terms, not ours.",
  "evidenceRequired": ["what a technician must confirm"],
  "source": {
    "documentId": "REAL-DOC-ID",
    "revision": "R#",
    "section": "procedure identifier / page",
    "fictional": false,
    "checkedBy": "name, date, revision"
  }
}
```

Fields the engine reads and will not invent: `applicability.*`, `logic`, `conditions[]`,
`reason`, `evidenceRequired`, `source.*`, `ruleStatus`. A fact a rule asks for that the
estimate does not supply stays `UNKNOWN` and is reported by name — it is never defaulted.
