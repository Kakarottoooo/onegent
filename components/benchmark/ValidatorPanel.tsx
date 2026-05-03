"use client";

/**
 * Validator UI for the benchmark dashboard.
 *
 * Two input modes:
 *   - "loaded": validates the report currently loaded in the dashboard
 *     (passed via the `report` prop). Useful for: codex pushes a new
 *     run, dashboard renders it but feels off → click validate to see
 *     what's drifting.
 *   - "paste": user pastes raw JSON. Useful for: codex shares a JSON
 *     file before pushing, or you want to validate a hand-crafted run.
 *
 * Renders the validation result as:
 *   - Green pill with "0 errors / N warnings / M infos" on top
 *   - Issue list grouped by severity (errors first, then warnings, then info)
 *   - Each issue shows: severity icon + path + message + optional detail
 *
 * Uses the same color tones as the rest of /dev/benchmark-runs.
 */

import { useState } from "react";
import { validateBenchmarkReport, type ValidationIssue, type ValidationResult } from "./validator";
import type { Phase0BenchmarkReport } from "./types";

interface Props {
  /** The currently-loaded report in the dashboard (null = none loaded). */
  loadedReport: Phase0BenchmarkReport | null;
  /** Friendly label for the loaded report (run id or file name). */
  loadedLabel?: string;
}

type Mode = "loaded" | "paste";

export default function Validator({ loadedReport, loadedLabel }: Props) {
  const [mode, setMode] = useState<Mode>("loaded");
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [validatedSource, setValidatedSource] = useState<string | null>(null);

  function runValidation() {
    setPasteError(null);
    setResult(null);
    if (mode === "loaded") {
      if (!loadedReport) {
        setPasteError("No report loaded — pick a run from the dropdown above.");
        return;
      }
      const r = validateBenchmarkReport(loadedReport as unknown);
      setResult(r);
      setValidatedSource(`loaded: ${loadedLabel ?? "current report"}`);
      return;
    }
    // mode === "paste"
    let parsed: unknown;
    try {
      parsed = JSON.parse(pasteText);
    } catch (err) {
      setPasteError(
        err instanceof Error ? `JSON parse failed: ${err.message}` : "JSON parse failed",
      );
      return;
    }
    const r = validateBenchmarkReport(parsed);
    setResult(r);
    setValidatedSource(`pasted JSON (${pasteText.length} chars)`);
  }

  function clearResult() {
    setResult(null);
    setPasteError(null);
    setValidatedSource(null);
  }

  return (
    <section className="benchmark-validator" aria-label="Benchmark report validator">
      <header className="benchmark-validator__head">
        <h3 className="benchmark-validator__title">Validate report shape</h3>
        <span className="benchmark-validator__sub">
          Per <code>.coordination/claude.md</code> Q2 — checks for{" "}
          <code>taxonomyCode</code> empty-string drift, <code>currentJobId</code>{" "}
          null/undefined consistency, <code>createdAt</code> ISO format, plus
          full schema integrity (counts vs metrics, severity-pair invariant).
        </span>
      </header>

      {/* Mode toggle */}
      <div className="benchmark-validator__modes" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "loaded"}
          onClick={() => {
            setMode("loaded");
            clearResult();
          }}
          className={[
            "benchmark-validator__mode",
            mode === "loaded" ? "benchmark-validator__mode--active" : "",
          ].join(" ")}
        >
          Validate loaded report
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "paste"}
          onClick={() => {
            setMode("paste");
            clearResult();
          }}
          className={[
            "benchmark-validator__mode",
            mode === "paste" ? "benchmark-validator__mode--active" : "",
          ].join(" ")}
        >
          Paste JSON
        </button>
      </div>

      {/* Input area */}
      {mode === "loaded" && (
        <p className="benchmark-validator__loaded-hint">
          {loadedReport
            ? <>Will validate the currently loaded report ({loadedLabel ?? "untitled"}).</>
            : <>No report loaded yet — pick one from the run dropdown above first.</>}
        </p>
      )}
      {mode === "paste" && (
        <textarea
          className="benchmark-validator__textarea"
          placeholder='Paste raw JSON, e.g. the contents of benchmark/runs/phase0-resy-2026-05-03.json'
          value={pasteText}
          onChange={(e) => setPasteText(e.currentTarget.value)}
          rows={8}
          spellCheck={false}
        />
      )}

      <div className="benchmark-validator__actions">
        <button
          type="button"
          className="benchmark-validator__run"
          onClick={runValidation}
          disabled={mode === "paste" && pasteText.trim().length === 0}
        >
          Run validation
        </button>
        {(result || pasteError) && (
          <button
            type="button"
            className="benchmark-validator__clear"
            onClick={clearResult}
          >
            Clear
          </button>
        )}
      </div>

      {pasteError && (
        <p className="benchmark-validator__paste-error" role="alert">
          {pasteError}
        </p>
      )}

      {result && <ValidationResultView result={result} source={validatedSource} />}
    </section>
  );
}

/* ─── Result view ─────────────────────────────────────────────────── */

function ValidationResultView({
  result,
  source,
}: {
  result: ValidationResult;
  source: string | null;
}) {
  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const infos = result.issues.filter((i) => i.severity === "info");

  return (
    <div className="benchmark-validator__result" role="region" aria-label="Validation result">
      {/* Verdict pill */}
      <div className="benchmark-validator__verdict-row">
        <span
          className={[
            "benchmark-validator__verdict",
            result.ok
              ? "benchmark-validator__verdict--pass"
              : "benchmark-validator__verdict--fail",
          ].join(" ")}
        >
          {result.ok ? "✓ schema valid" : "✗ schema errors found"}
        </span>
        <span className="benchmark-validator__counts">
          {result.counts.error} error{result.counts.error === 1 ? "" : "s"} ·{" "}
          {result.counts.warning} warning{result.counts.warning === 1 ? "" : "s"} ·{" "}
          {result.counts.info} info
        </span>
        {source && (
          <span className="benchmark-validator__source">{source}</span>
        )}
      </div>

      {/* Empty state */}
      {result.issues.length === 0 && (
        <p className="benchmark-validator__empty">
          No issues. Report shape matches the contract exactly.
        </p>
      )}

      {/* Issue groups */}
      {errors.length > 0 && (
        <IssueGroup heading="Errors — dashboard would render incorrectly" issues={errors} />
      )}
      {warnings.length > 0 && (
        <IssueGroup heading="Warnings — contract drift, dashboard renders something" issues={warnings} />
      )}
      {infos.length > 0 && <IssueGroup heading="Info" issues={infos} />}
    </div>
  );
}

function IssueGroup({
  heading,
  issues,
}: {
  heading: string;
  issues: ValidationIssue[];
}) {
  return (
    <div className="benchmark-validator__group">
      <h4 className="benchmark-validator__group-title">{heading}</h4>
      <ul className="benchmark-validator__list">
        {issues.map((issue, i) => (
          <li
            key={i}
            className={[
              "benchmark-validator__issue",
              `benchmark-validator__issue--${issue.severity}`,
            ].join(" ")}
          >
            <span className="benchmark-validator__icon" aria-hidden>
              {issue.severity === "error" ? "✗" : issue.severity === "warning" ? "⚠" : "ℹ"}
            </span>
            <code className="benchmark-validator__path">{issue.path}</code>
            <p className="benchmark-validator__message">{issue.message}</p>
            {issue.detail && (
              <p className="benchmark-validator__detail">{issue.detail}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
