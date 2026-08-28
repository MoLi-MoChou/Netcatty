import test from "node:test";
import assert from "node:assert/strict";
import { applyFeedCheckResult } from "./useUpdateCheck.ts";

test("does not surface electron-updater errors when GitHub already found a release", () => {
  const action = applyFeedCheckResult(
    "available",
    { error: "No published versions on GitHub", supported: true },
    null,
  );
  assert.deepEqual(action, { type: "none" });
});

test("surfaces feed errors only when GitHub API itself failed", () => {
  const action = applyFeedCheckResult(
    "error",
    { error: "No published versions on GitHub", supported: true },
    null,
  );
  assert.deepEqual(action, {
    type: "surface-error",
    error: "No published versions on GitHub",
  });
});

test("does not treat unsupported-platform errors as download failures", () => {
  const action = applyFeedCheckResult(
    "error",
    { error: "Auto-update is not supported on this platform/package format.", supported: false },
    null,
  );
  assert.deepEqual(action, { type: "none" });
});

test("promotes GitHub API failure to available when the feed finds an update", () => {
  const action = applyFeedCheckResult(
    "error",
    { available: true, supported: true, version: "1.1.84" },
    null,
  );
  assert.deepEqual(action, { type: "available" });
});

test("does not re-surface a dismissed feed version after GitHub API failure", () => {
  const action = applyFeedCheckResult(
    "error",
    { available: true, supported: true, version: "1.1.84" },
    "1.1.84",
  );
  assert.deepEqual(action, { type: "none" });
});

test("clears GitHub API error when the feed reports no update", () => {
  const action = applyFeedCheckResult(
    "error",
    { available: false, supported: true },
    null,
  );
  assert.deepEqual(action, { type: "up-to-date" });
});

test("ignores in-flight feed checks without changing status", () => {
  const action = applyFeedCheckResult(
    "error",
    { checking: true, supported: true },
    null,
  );
  assert.deepEqual(action, { type: "none" });
});
