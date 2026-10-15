import { analyzeEstimate, createCatalogs } from "../../modules/estimates/estimate.service.js";
import { NotImplementedError } from "../../shared/errors.js";
import { renderTextReport } from "../../modules/reports/report.service.js";
import { listAdapters, selectAdapter } from "../../modules/estimates/adapters/index.js";

const catalogs = createCatalogs();

/**
 * POST /api/estimates/analyze
 *
 * Two request shapes:
 *   - application/json body: the structured estimate itself, or { estimate: {...} }
 *   - multipart/form-data with an `estimate` file (JSON accepted; PDF/CSV/images
 *     answer 501 NOT_IMPLEMENTED with the adapter's explanation)
 *
 * `?format=text` returns the technician-facing plain-text rendering of the same report.
 */
export async function analyzeEstimateHandler(req, res) {
  let stream = "request body";
  try {
    const wantsText = String(req.query?.format ?? "").toLowerCase() === "text";

    const { input, contentType, filename } = resolveInput(req);
    const adapter = selectAdapter({ input, contentType, filename });

    if (!adapter.implemented) throw new NotImplementedError(adapter.name);

    const result = analyzeEstimate(input, { catalogs, adapter });

    if (wantsText) {
      res.type("text/plain").send(renderTextReport(result.report));
      return;
    }

    res.json({
      status: result.report.status,
      estimateId: result.report.estimateId,
      adapter: result.adapter,
      report: result.report,
      // The impact matrix and decisions are also returned at the top level so an
      // integrator can consume them without walking the report; both carry the
      // "candidate generation only" labelling.
      impactMatrix: result.impactMatrix,
      decisions: result.decisions,
    });
    return;
  } catch (error) {
    stream = error?.code === "NOT_IMPLEMENTED" ? "adapter" : stream;
    throw Object.assign(error, { handlingStage: stream });
  }
}

function resolveInput(req) {
  if (req.file) {
    return {
      input: req.file.buffer,
      contentType: req.file.mimetype ?? null,
      filename: req.file.originalname ?? null,
    };
  }

  const body = req.body ?? {};
  const input = body.estimate !== undefined && (body.estimateId === undefined || typeof body.estimate === "string") ? body.estimate : body;
  return { input, contentType: req.headers?.["content-type"] ?? null, filename: req.headers?.["x-estimate-filename"] ?? null };
}

export function listAdaptersHandler(_req, res) {
  res.json({ adapters: listAdapters() });
}

export function datasetProvenanceHandler(_req, res) {
  res.json({
    ...catalogs.provenance,
    componentCount: catalogs.components.length,
    ruleCount: catalogs.resolver.catalogSize(),
    verifiedRuleCount: catalogs.resolver.verifiedRuleCount,
    note: "Nothing in this dataset is verified. See docs/OEM-DATA.md for what promotes a rule to VERIFIED.",
  });
}

export function healthHandler(_req, res) {
  res.json({ status: "ok", reportVersion: "0.1.0", verifiedRuleCount: catalogs.resolver.verifiedRuleCount });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.originalUrl}.` } });
}
