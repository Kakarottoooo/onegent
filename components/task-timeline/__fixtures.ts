/**
 * Mock fixtures — used ONLY when <TaskTimelinePanel demo="..." />.
 *
 * Lives inside the component package so it can never accidentally leak into
 * production data. Production code paths read from useTimelineData(jobId)
 * which polls the real API.
 */

import type { ExecutionSnapshot, TimelineEvent } from "./types";

/* Stub 1×1 transparent PNG so SnapshotCard has *something* to render
 * without bundling a real image. Replace with a CDN URL once Track A
 * publishes a snapshot endpoint. */
const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 800'>
  <defs>
    <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='#1f1f23'/>
      <stop offset='1' stop-color='#2c2c33'/>
    </linearGradient>
  </defs>
  <rect width='1280' height='800' fill='url(#g)'/>
  <g fill='rgba(255,255,255,0.35)' font-family='ui-sans-serif' text-anchor='middle'>
    <text x='640' y='390' font-size='28' font-weight='600'>Snapshot placeholder</text>
    <text x='640' y='430' font-size='16'>Track A will provide real screenshots</text>
  </g>
</svg>`);

const T0 = new Date("2026-05-02T13:42:11Z").getTime();
const tickAt = (offsetSec: number) => new Date(T0 + offsetSec * 1000).toISOString();

/* ─── Snapshots ────────────────────────────────────────────────────────── */

export const FIXTURE_SNAPSHOTS: ExecutionSnapshot[] = [
  { id: "s1", ts: tickAt(0), src: PLACEHOLDER_IMG, label: "Opened opentable.com" },
  { id: "s2", ts: tickAt(2), src: PLACEHOLDER_IMG, label: "Search results" },
  { id: "s3", ts: tickAt(6), src: PLACEHOLDER_IMG, label: "TAO Downtown — detail page" },
  { id: "s4", ts: tickAt(8), src: PLACEHOLDER_IMG, label: "6:45 PM slot selected" },
  { id: "s5", ts: tickAt(11), src: PLACEHOLDER_IMG, label: "Guest info form" },
  { id: "s6", ts: tickAt(14), src: PLACEHOLDER_IMG, label: "Form filled" },
];

/* ─── Event timelines per demo state ───────────────────────────────────── */

export const FIXTURE_EVENTS: Record<
  "running" | "needs_otp" | "ready_for_confirmation" | "failed" | "no_availability" | "empty",
  TimelineEvent[]
> = {
  empty: [],

  running: [
    { ts: tickAt(0), kind: "opened_site", data: { domain: "opentable.com" }, snapshotId: "s1" },
    { ts: tickAt(2), kind: "searching", data: { term: "TAO Downtown" }, snapshotId: "s2" },
    { ts: tickAt(6), kind: "found_target", data: { label: "TAO Downtown New York" }, snapshotId: "s3" },
    { ts: tickAt(8), kind: "selected_slot", data: { slot: "6:45 PM, May 14" }, snapshotId: "s4" },
    { ts: tickAt(11), kind: "filling_form", snapshotId: "s5" },
  ],

  needs_otp: [
    { ts: tickAt(0), kind: "opened_site", data: { domain: "resy.com" }, snapshotId: "s1" },
    { ts: tickAt(2), kind: "searching", data: { term: "Carbone" }, snapshotId: "s2" },
    { ts: tickAt(6), kind: "found_target", data: { label: "Carbone — Greenwich Village" }, snapshotId: "s3" },
    { ts: tickAt(8), kind: "selected_slot", data: { slot: "8:00 PM, May 14" }, snapshotId: "s4" },
    { ts: tickAt(11), kind: "filling_form", snapshotId: "s5" },
    { ts: tickAt(14), kind: "needs_otp", data: { channel: "gmail" }, snapshotId: "s6" },
  ],

  ready_for_confirmation: [
    { ts: tickAt(0), kind: "opened_site", data: { domain: "opentable.com" }, snapshotId: "s1" },
    { ts: tickAt(2), kind: "searching", data: { term: "TAO Downtown" }, snapshotId: "s2" },
    { ts: tickAt(6), kind: "found_target", data: { label: "TAO Downtown New York" }, snapshotId: "s3" },
    { ts: tickAt(8), kind: "selected_slot", data: { slot: "6:45 PM, May 14" }, snapshotId: "s4" },
    { ts: tickAt(11), kind: "filling_form", snapshotId: "s5" },
    { ts: tickAt(14), kind: "ready_for_confirmation", snapshotId: "s6" },
  ],

  failed: [
    { ts: tickAt(0), kind: "opened_site", data: { domain: "booking.com" }, snapshotId: "s1" },
    { ts: tickAt(2), kind: "searching", data: { term: "NYC hotel" }, snapshotId: "s2" },
    {
      ts: tickAt(5),
      kind: "failed",
      data: { reason: "Anti-bot challenge could not be resolved" },
      snapshotId: "s3",
    },
  ],

  no_availability: [
    { ts: tickAt(0), kind: "opened_site", data: { domain: "opentable.com" }, snapshotId: "s1" },
    { ts: tickAt(2), kind: "searching", data: { term: "Per Se" }, snapshotId: "s2" },
    { ts: tickAt(6), kind: "found_target", data: { label: "Per Se" }, snapshotId: "s3" },
    {
      ts: tickAt(9),
      kind: "no_availability",
      data: { reason: "Fully booked at requested time" },
      snapshotId: "s4",
    },
  ],
};

export const FIXTURE_PANEL_LABELS = {
  title: "Agent — TAO Downtown New York",
  subtitle: "May 14 · 6:45 PM · 2 guests",
};
