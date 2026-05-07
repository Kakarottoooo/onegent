#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";
import {
  buildStage0PerformanceReport,
  renderStage0PerformanceMarkdown,
} from "@/lib/internal-benchmark/stage0-performance";

type Probe = {
  label: string;
  path: string;
};

type ProbeResult = {
  label: string;
  status: number | "error";
  ms: number;
  bytes: number;
  ok: boolean;
  error?: string;
};

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function measure(baseUrl: string, probe: Probe): Promise<ProbeResult> {
  const started = performance.now();
  try {
    const res = await fetch(`${baseUrl}${probe.path}`, {
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    return {
      label: probe.label,
      status: res.status,
      ms: Math.round(performance.now() - started),
      bytes: Buffer.byteLength(text),
      ok: res.ok,
    };
  } catch (err) {
    return {
      label: probe.label,
      status: "error",
      ms: Math.round(performance.now() - started),
      bytes: 0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  if (flag("stage0")) {
    const report = buildStage0PerformanceReport();
    const output = flag("json")
      ? JSON.stringify(report, null, 2)
      : renderStage0PerformanceMarkdown(report);
    const outputPath = arg("output");
    if (outputPath) writeFileSync(outputPath, output, "utf8");
    console.log(output);
    return;
  }

  const baseUrl = normalizeBaseUrl(arg("base-url") ?? "http://127.0.0.1:3000");
  const sessionId = arg("session-id") ?? "local-measurement-session";
  const jobId = arg("job-id");
  const now = new Date();
  const year = Number(arg("year") ?? String(now.getFullYear()));
  const month = Number(arg("month") ?? String(now.getMonth()));
  const encodedSession = encodeURIComponent(sessionId);

  const probes: Probe[] = [
    { label: "app bootstrap", path: `/api/app/bootstrap?session_id=${encodedSession}` },
    { label: "task summary", path: `/api/booking-jobs/summary?session_id=${encodedSession}` },
    { label: "compact task list", path: `/api/booking-jobs/compact-list?session_id=${encodedSession}&include_share=1` },
    { label: "compact room list", path: "/api/rooms/compact-list?include_invited=1" },
    { label: "contacts bootstrap", path: "/api/contacts/bootstrap" },
    { label: "calendar jobs", path: `/api/calendar/jobs?session_id=${encodedSession}` },
    { label: "calendar google status", path: "/api/calendar/google/status" },
    { label: "calendar google month", path: `/api/calendar/google/month?year=${year}&month=${month}` },
  ];

  if (jobId) {
    const encodedJob = encodeURIComponent(jobId);
    probes.push(
      { label: "task detail", path: `/api/booking-jobs/${encodedJob}` },
      { label: "timeline slim", path: `/api/booking-jobs/${encodedJob}/timeline-events?format=json&slim=1` },
      { label: "snapshot metadata", path: `/api/booking-jobs/${encodedJob}/snapshots` },
    );
  }

  const results = await Promise.all(probes.map((probe) => measure(baseUrl, probe)));
  console.log(`# App Performance Probe`);
  console.log(`base_url: ${baseUrl}`);
  console.log(`session_id: ${sessionId}`);
  if (jobId) console.log(`job_id: ${jobId}`);
  console.log("");
  console.log("| endpoint | status | ms | bytes |");
  console.log("|---|---:|---:|---:|");
  for (const result of results) {
    console.log(`| ${result.label} | ${result.status} | ${result.ms} | ${result.bytes} |`);
    if (result.error) console.log(`<!-- ${result.label}: ${result.error} -->`);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
