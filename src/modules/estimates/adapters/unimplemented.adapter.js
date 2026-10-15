import { NotImplementedError } from "../../../shared/errors.js";
import { SourceAdapterBase } from "./source-adapter.js";

/**
 * Adapters that are DESIGNED but deliberately not built in this MVP.
 *
 * They exist as first-class, discoverable objects (listed by GET /api/adapters)
 * so the API can answer honestly — HTTP 501 with code NOT_IMPLEMENTED — instead
 * of pulling in OCR/PDF dependencies or, far worse, letting an LLM improvise a
 * repair estimate. Nothing downstream is allowed to treat their output as data.
 */
function createUnimplementedAdapter({ id, name, contentTypes, extensions, hint }) {
  const adapter = new SourceAdapterBase({ id, name, contentTypes, extensions, implemented: false });

  adapter.parse = function parse() {
    throw new NotImplementedError(name, hint);
  };

  return adapter;
}

export const PdfEstimateAdapter = createUnimplementedAdapter({
  id: "pdf",
  name: "PDF estimate (CCC/Mitchell export)",
  contentTypes: ["application/pdf"],
  extensions: [".pdf"],
  hint: "PDF text/layout extraction is a separate follow-up: it needs a real parser, a line-item normalization layer, and extraction confidence, none of which belong in this engine's decision path.",
});

export const ImageOcrAdapter = createUnimplementedAdapter({
  id: "image-ocr",
  name: "Photographed estimate (OCR)",
  contentTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/tiff"],
  extensions: [".jpg", ".jpeg", ".png", ".webp", ".heic", ".tif", ".tiff"],
  hint: "OCR of photographs is a separate follow-up. Per the project's hard constraints, extracted text must be reviewed by a human or an LLM-assisted step that never owns the final decision.",
});

export const CsvEstimateAdapter = createUnimplementedAdapter({
  id: "csv",
  name: "CSV estimate export",
  contentTypes: ["text/csv", "application/csv"],
  extensions: [".csv", ".tsv"],
  hint: "CSV is cheap to add later, but each estimating platform uses its own columns; the adapter needs a documented column mapping before it can be trusted.",
});

export const UNIMPLEMENTED_ADAPTERS = Object.freeze([
  PdfEstimateAdapter,
  ImageOcrAdapter,
  CsvEstimateAdapter,
]);
