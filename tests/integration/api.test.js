import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createApp } from "../../src/api/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "fixtures", "est-10042.json");
const estimate = JSON.parse(readFileSync(fixturePath, "utf8"));

/**
 * The app is mounted on an ephemeral port inside the test process (never 3000 or
 * 3100) and closed at the end, so no server is left running.
 */
const server = createApp().listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;
// `fetch` keeps its sockets alive, and a server with open keep-alive connections
// never finishes `close()` — the suite would stop printing results and hang with the
// process alive. Drop the connections first, then close, so the test file exits.
test.after(
  () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
);

test("POST /api/estimates/analyze returns the full auditable report", async () => {
  const response = await fetch(`${baseUrl}/api/estimates/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(estimate),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.estimateId, "EST-10042");
  assert.equal(body.adapter.implemented, true);
  assert.equal(body.report.summary.totalLines, 6);
  assert.equal(body.report.summary.byCategory.UNRESOLVED, 1);
  assert.equal(body.report.dataProvenance.verifiedRuleCount, 0);
  assert.ok(body.impactMatrix.every((row) => row.candidateOnly === true));
  assert.equal(body.decisions.length, 6);
});

test("POST with ?format=text returns the technician-facing rendering", async () => {
  const response = await fetch(`${baseUrl}/api/estimates/analyze?format=text`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(estimate),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/plain/);
  const text = await response.text();
  assert.match(text, /Estimate EST-10042/);
  assert.match(text, /Unresolved \/ needs human review/);
});

test("JSON body wrapped in an `estimate` key is accepted too", async () => {
  const response = await fetch(`${baseUrl}/api/estimates/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ estimate: JSON.stringify(estimate) }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).estimateId, "EST-10042");
});

test("multipart upload of a JSON estimate file works (SPEC §6 route shape)", async () => {
  const form = new FormData();
  form.set("estimate", new Blob([readFileSync(fixturePath)], { type: "application/json" }), "est-10042.json");
  const response = await fetch(`${baseUrl}/api/estimates/analyze`, { method: "POST", body: form });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.estimateId, "EST-10042");
});

test("a PDF upload answers 501 NOT_IMPLEMENTED instead of guessing", async () => {
  const form = new FormData();
  form.set("estimate", new Blob([Buffer.from("%PDF-1.7 not a real estimate")], { type: "application/pdf" }), "estimate.pdf");
  const response = await fetch(`${baseUrl}/api/estimates/analyze`, { method: "POST", body: form });
  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.error.code, "NOT_IMPLEMENTED");
  assert.match(body.error.details.hint, /separate follow-up/);
});

test("an invalid estimate is rejected with 400 and every validation problem", async () => {
  const response = await fetch(`${baseUrl}/api/estimates/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ estimateId: "EST-BAD", vehicle: {}, lines: [{ lineId: "L1", operation: "WELD" }] }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.ok(body.error.details.errors.some((issue) => issue.path === "lines[0].description"));
});

test("malformed JSON body is a 400, not a crash", async () => {
  const response = await fetch(`${baseUrl}/api/estimates/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ nope",
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("GET /api/datasets reports the data as unverified", async () => {
  const response = await fetch(`${baseUrl}/api/datasets`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.verifiedRuleCount, 0);
  assert.equal(body.procedures.label, "ILLUSTRATIVE / UNVERIFIED");
  assert.match(body.note, /Nothing in this dataset is verified/);
});

test("GET /api/adapters advertises one implemented adapter and the three stubs", async () => {
  const response = await fetch(`${baseUrl}/api/adapters`);
  const body = await response.json();
  assert.deepEqual(body.adapters.filter((a) => a.implemented).map((a) => a.id), ["structured-json"]);
  assert.equal(body.adapters.filter((a) => !a.implemented).length, 3);
});

test("GET /api/health responds, and unknown routes 404 with a typed error", async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  const missing = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "NOT_FOUND");
});
