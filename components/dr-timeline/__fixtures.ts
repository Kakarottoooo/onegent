/**
 * Mock snapshots for /dev/dr-timeline-demo.
 *
 * Each fixture mirrors a realistic DR moment so the timeline can be
 * validated without spinning up real rooms. Internal-only; not exported
 * via the barrel to keep production data paths fixture-free.
 */

import type { DRTimelineInputs } from "./types";

const T0 = new Date("2026-05-02T17:30:00Z").getTime();
const at = (offsetSec: number) => new Date(T0 + offsetSec * 1000).toISOString();

const NAMES = {
  alice: "Alice",
  bob: "Bob",
  carol: "Carol",
  dave: "Dave",
};

const baseInput = (overrides: Partial<DRTimelineInputs>): DRTimelineInputs => ({
  room: {
    id: "room_demo",
    title: "Date night — Friday in Greenwich Village",
    status: "collecting",
    creator_id: "alice",
    created_at: at(0),
    updated_at: at(0),
    booking_job_id: null,
    approval_rule: "majority",
  },
  members: [
    { user_id: "alice", role: "creator", status: "joined", joined_at: at(0) },
  ],
  constraints: [],
  proposals: [],
  member_names: NAMES,
  ...overrides,
});

/** State 1 — just created, no other activity. */
const justCreated = baseInput({});

/** State 2 — collecting, 3 of 4 submitted. */
const collecting = baseInput({
  members: [
    { user_id: "alice", role: "creator", status: "joined", joined_at: at(0) },
    { user_id: "bob", role: "member", status: "joined", joined_at: at(120) },
    { user_id: "carol", role: "member", status: "joined", joined_at: at(180) },
    { user_id: "dave", role: "member", status: "joined", joined_at: at(240) },
  ],
  constraints: [
    { user_id: "alice", submitted: true, updated_at: at(360) },
    { user_id: "bob", submitted: true, updated_at: at(480) },
    { user_id: "carol", submitted: true, updated_at: at(600) },
    // dave hasn't submitted yet
  ],
});

/** State 3 — voting in progress, 2 of 4 voted approve. */
const voting = baseInput({
  room: {
    ...baseInput({}).room,
    status: "approving",
    updated_at: at(720),
  },
  members: collecting.members,
  constraints: [
    ...collecting.constraints,
    { user_id: "dave", submitted: true, updated_at: at(720) },
  ],
  proposals: [
    {
      id: "prop_1",
      status: "active",
      created_at: at(750),
      venue: "Carbone",
      votes: [
        { user_id: "alice", vote: "approve", voted_at: at(810) },
        { user_id: "bob", vote: "approve", voted_at: at(840) },
        // carol + dave still voting
      ],
    },
  ],
});

/** State 4 — proposal accepted, booking starts. */
const accepted = baseInput({
  room: {
    ...baseInput({}).room,
    status: "executing",
    updated_at: at(950),
  },
  members: collecting.members,
  constraints: voting.constraints,
  proposals: [
    {
      id: "prop_1",
      status: "accepted",
      created_at: at(750),
      venue: "Carbone",
      votes: [
        { user_id: "alice", vote: "approve", voted_at: at(810) },
        { user_id: "bob", vote: "approve", voted_at: at(840) },
        { user_id: "carol", vote: "approve", voted_at: at(860) },
        { user_id: "dave", vote: "approve", voted_at: at(890) },
      ],
    },
  ],
});

/** State 5 — first proposal rejected, regenerated, booking complete on the second. */
const completed = baseInput({
  room: {
    ...baseInput({}).room,
    status: "done",
    updated_at: at(1500),
  },
  members: collecting.members,
  constraints: voting.constraints,
  proposals: [
    {
      id: "prop_1",
      status: "rejected",
      created_at: at(750),
      venue: "Per Se",
      votes: [
        { user_id: "alice", vote: "approve", voted_at: at(810) },
        { user_id: "bob", vote: "decline", voted_at: at(840) },
        { user_id: "carol", vote: "decline", voted_at: at(870) },
        { user_id: "dave", vote: "request_changes", voted_at: at(890) },
      ],
    },
    {
      id: "prop_2",
      status: "accepted",
      created_at: at(1000),
      venue: "Carbone",
      votes: [
        { user_id: "alice", vote: "approve", voted_at: at(1100) },
        { user_id: "bob", vote: "approve", voted_at: at(1120) },
        { user_id: "carol", vote: "approve", voted_at: at(1140) },
        { user_id: "dave", vote: "approve", voted_at: at(1180) },
      ],
    },
  ],
});

/** State 6 — empty / freshly-loaded skeleton. */
const empty = baseInput({
  room: {
    ...baseInput({}).room,
    // unrealistic: pretend the room hasn't even been "created" yet
    created_at: "",
  },
  members: [],
});

export const FIXTURE_INPUTS: Record<string, { label: string; input: DRTimelineInputs }> = {
  just_created: { label: "Just created", input: justCreated },
  collecting: { label: "Collecting (3/4 submitted)", input: collecting },
  voting: { label: "Voting (2/4 approved)", input: voting },
  accepted: { label: "Accepted, booking", input: accepted },
  completed: { label: "Rejected → regenerated → complete", input: completed },
  empty: { label: "Empty / loading", input: empty },
};

export const FIXTURE_ORDER = [
  "just_created",
  "collecting",
  "voting",
  "accepted",
  "completed",
  "empty",
] as const;
