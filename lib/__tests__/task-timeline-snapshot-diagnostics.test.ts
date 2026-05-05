import { describe, expect, it } from "vitest";

import { describeSnapshotDiagnostics } from "@/components/task-timeline/use-snapshots";

describe("task timeline snapshot diagnostics", () => {
  it("explains a job/server mismatch when canonical snapshots 404 and compat is empty", () => {
    const message = describeSnapshotDiagnostics("job-123", {
      source: "compat",
      canonicalStatus: 404,
      compatStatus: 200,
      usedFallback: true,
    });

    expect(message).toContain("cannot find job job-123");
    expect(message).toContain("different local port, worktree, or database environment");
  });

  it("explains an attached job with no saved screenshots", () => {
    const message = describeSnapshotDiagnostics("job-123", {
      source: "canonical",
      canonicalStatus: 200,
      usedFallback: false,
    });

    expect(message).toContain("job is attached");
    expect(message).toContain("no browser screenshots");
  });

  it("does not show diagnostics when no job is selected", () => {
    const message = describeSnapshotDiagnostics(null, {
      source: "compat",
      canonicalStatus: 404,
      compatStatus: 200,
      usedFallback: true,
    });

    expect(message).toBeUndefined();
  });
});
