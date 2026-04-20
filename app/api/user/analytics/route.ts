import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Range = "week" | "month" | "all";

function parseRange(raw: string | null): Range {
  if (raw === "week" || raw === "all") return raw;
  return "month";
}

function rangeToDays(range: Range): number {
  if (range === "week") return 7;
  if (range === "month") return 30;
  return 365 * 10;
}

function rangeToBucket(range: Range): "day" | "week" {
  return range === "all" ? "week" : "day";
}

type KpiCards = {
  tasksDone: number;
  rooms: number;
  searches: number;
  optionsCompared: number;
  prefsLearned: number;
  votes: number;
  hoursSaved: number;
};

type TimeseriesPoint = { bucket: string; count: number };
type ScenarioSlice = { scenario: string; count: number };
type ActivityItem = {
  kind: "task" | "room" | "search" | "vote" | "pref";
  label: string;
  detail: string;
  scenario: string | null;
  at: string;
};

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = parseRange(req.nextUrl.searchParams.get("range"));
  const days = rangeToDays(range);
  const bucket = rangeToBucket(range);

  try {
    const [
      tasksBookingRes,
      tasksRoomsDoneRes,
      roomsRes,
      searchesRes,
      planOptionsRes,
      proposalOptionsRes,
      prefsRes,
      votesRes,
      scenarioPlansRes,
      scenarioRoomsRes,
      tsBookingRes,
      tsRoomRes,
      tsPlanRes,
      tsVoteRes,
      tsPrefRes,
      recentTasksRes,
      recentRoomsRes,
      recentSearchesRes,
      recentVotesRes,
      recentPrefsRes,
    ] = await Promise.all([
      sql<{ c: string }>`
        SELECT COUNT(*)::text AS c FROM booking_jobs
        WHERE user_id = ${userId}
          AND created_at >= NOW() - (${days} || ' days')::interval
      `,
      sql<{ c: string }>`
        SELECT COUNT(*)::text AS c FROM decision_rooms r
        JOIN decision_room_members m ON m.room_id = r.id
        WHERE m.user_id = ${userId}
          AND r.status IN ('done','abandoned')
          AND r.updated_at >= NOW() - (${days} || ' days')::interval
      `,
      sql<{ c: string }>`
        SELECT COUNT(DISTINCT r.id)::text AS c FROM decision_rooms r
        JOIN decision_room_members m ON m.room_id = r.id
        WHERE m.user_id = ${userId}
          AND r.created_at >= NOW() - (${days} || ' days')::interval
      `,
      sql<{ c: string }>`
        SELECT COUNT(*)::text AS c FROM decision_plans
        WHERE user_id = ${userId}
          AND created_at >= NOW() - (${days} || ' days')::interval
      `,
      sql<{ c: string }>`
        SELECT COALESCE(SUM(
          CASE WHEN jsonb_typeof(plan_json->'backup_plans') = 'array'
               THEN 1 + jsonb_array_length(plan_json->'backup_plans')
               ELSE 1 END
        ), 0)::text AS c
        FROM decision_plans
        WHERE user_id = ${userId}
          AND created_at >= NOW() - (${days} || ' days')::interval
      `,
      sql<{ c: string }>`
        SELECT COALESCE(SUM(
          CASE WHEN jsonb_typeof(p.content_json->'options') = 'array'
               THEN jsonb_array_length(p.content_json->'options')
               ELSE 1 END
        ), 0)::text AS c
        FROM decision_room_proposals p
        JOIN decision_room_members m ON m.room_id = p.room_id
        WHERE m.user_id = ${userId}
          AND p.created_at >= NOW() - (${days} || ' days')::interval
      `,
      sql<{ c: string }>`
        SELECT COUNT(*)::text AS c FROM user_preferences
        WHERE user_id = ${userId}
          AND updated_at >= NOW() - (${days} || ' days')::interval
      `,
      sql<{ c: string }>`
        SELECT COUNT(*)::text AS c FROM decision_room_votes
        WHERE user_id = ${userId}
          AND voted_at >= NOW() - (${days} || ' days')::interval
      `,
      sql<{ scenario: string | null; c: string }>`
        SELECT scenario, COUNT(*)::text AS c FROM decision_plans
        WHERE user_id = ${userId}
          AND created_at >= NOW() - (${days} || ' days')::interval
        GROUP BY scenario
      `,
      sql<{ type: string | null; c: string }>`
        SELECT r.type, COUNT(DISTINCT r.id)::text AS c FROM decision_rooms r
        JOIN decision_room_members m ON m.room_id = r.id
        WHERE m.user_id = ${userId}
          AND r.created_at >= NOW() - (${days} || ' days')::interval
        GROUP BY r.type
      `,
      sql<{ bucket: string; c: string }>`
        SELECT date_trunc(${bucket}, created_at)::text AS bucket, COUNT(*)::text AS c
        FROM booking_jobs
        WHERE user_id = ${userId}
          AND created_at >= NOW() - (${days} || ' days')::interval
        GROUP BY bucket
      `,
      sql<{ bucket: string; c: string }>`
        SELECT date_trunc(${bucket}, r.created_at)::text AS bucket, COUNT(DISTINCT r.id)::text AS c
        FROM decision_rooms r
        JOIN decision_room_members m ON m.room_id = r.id
        WHERE m.user_id = ${userId}
          AND r.created_at >= NOW() - (${days} || ' days')::interval
        GROUP BY bucket
      `,
      sql<{ bucket: string; c: string }>`
        SELECT date_trunc(${bucket}, created_at)::text AS bucket, COUNT(*)::text AS c
        FROM decision_plans
        WHERE user_id = ${userId}
          AND created_at >= NOW() - (${days} || ' days')::interval
        GROUP BY bucket
      `,
      sql<{ bucket: string; c: string }>`
        SELECT date_trunc(${bucket}, voted_at)::text AS bucket, COUNT(*)::text AS c
        FROM decision_room_votes
        WHERE user_id = ${userId}
          AND voted_at >= NOW() - (${days} || ' days')::interval
        GROUP BY bucket
      `,
      sql<{ bucket: string; c: string }>`
        SELECT date_trunc(${bucket}, updated_at)::text AS bucket, COUNT(*)::text AS c
        FROM user_preferences
        WHERE user_id = ${userId}
          AND updated_at >= NOW() - (${days} || ' days')::interval
        GROUP BY bucket
      `,
      sql<{ id: string; trip_label: string; status: string; created_at: string }>`
        SELECT id, trip_label, status, created_at::text
        FROM booking_jobs
        WHERE user_id = ${userId}
          AND created_at >= NOW() - (${days} || ' days')::interval
        ORDER BY created_at DESC LIMIT 12
      `,
      sql<{ id: string; title: string; type: string; status: string; created_at: string }>`
        SELECT r.id, r.title, r.type, r.status, r.created_at::text
        FROM decision_rooms r
        JOIN decision_room_members m ON m.room_id = r.id
        WHERE m.user_id = ${userId}
          AND r.created_at >= NOW() - (${days} || ' days')::interval
        ORDER BY r.created_at DESC LIMIT 12
      `,
      sql<{ id: string; scenario: string; query_text: string | null; created_at: string }>`
        SELECT id, scenario, query_text, created_at::text
        FROM decision_plans
        WHERE user_id = ${userId}
          AND created_at >= NOW() - (${days} || ' days')::interval
        ORDER BY created_at DESC LIMIT 12
      `,
      sql<{ proposal_id: string; option_id: string | null; voted_at: string }>`
        SELECT proposal_id, option_id, voted_at::text
        FROM decision_room_votes
        WHERE user_id = ${userId}
          AND voted_at >= NOW() - (${days} || ' days')::interval
        ORDER BY voted_at DESC LIMIT 12
      `,
      sql<{ preference_key: string; preference_value: string; updated_at: string }>`
        SELECT preference_key, preference_value, updated_at::text
        FROM user_preferences
        WHERE user_id = ${userId}
          AND updated_at >= NOW() - (${days} || ' days')::interval
        ORDER BY updated_at DESC LIMIT 12
      `,
    ]);

    const toInt = (x: string | undefined): number => (x ? parseInt(x, 10) || 0 : 0);

    const tasksDone = toInt(tasksBookingRes.rows[0]?.c) + toInt(tasksRoomsDoneRes.rows[0]?.c);
    const rooms = toInt(roomsRes.rows[0]?.c);
    const searches = toInt(searchesRes.rows[0]?.c);
    const optionsCompared =
      toInt(planOptionsRes.rows[0]?.c) + toInt(proposalOptionsRes.rows[0]?.c);
    const prefsLearned = toInt(prefsRes.rows[0]?.c);
    const votes = toInt(votesRes.rows[0]?.c);
    const hoursSaved = Math.round((optionsCompared * 45) / 3600 * 10) / 10;

    const cards: KpiCards = {
      tasksDone,
      rooms,
      searches,
      optionsCompared,
      prefsLearned,
      votes,
      hoursSaved,
    };

    const scenarioMap = new Map<string, number>();
    for (const row of scenarioPlansRes.rows) {
      const key = (row.scenario ?? "other").toLowerCase();
      scenarioMap.set(key, (scenarioMap.get(key) ?? 0) + toInt(row.c));
    }
    for (const row of scenarioRoomsRes.rows) {
      const key = (row.type ?? "other").toLowerCase();
      scenarioMap.set(key, (scenarioMap.get(key) ?? 0) + toInt(row.c));
    }
    const scenarios: ScenarioSlice[] = Array.from(scenarioMap.entries())
      .map(([scenario, count]) => ({ scenario, count }))
      .sort((a, b) => b.count - a.count);

    const tsMap = new Map<string, number>();
    const addTs = (rows: { bucket: string; c: string }[]) => {
      for (const row of rows) {
        const key = row.bucket.slice(0, 10);
        tsMap.set(key, (tsMap.get(key) ?? 0) + toInt(row.c));
      }
    };
    addTs(tsBookingRes.rows);
    addTs(tsRoomRes.rows);
    addTs(tsPlanRes.rows);
    addTs(tsVoteRes.rows);
    addTs(tsPrefRes.rows);
    const timeseries: TimeseriesPoint[] = Array.from(tsMap.entries())
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => (a.bucket < b.bucket ? -1 : 1));

    const activity: ActivityItem[] = [
      ...recentTasksRes.rows.map<ActivityItem>((r) => ({
        kind: "task",
        label: r.trip_label || "Booking task",
        detail: `Status: ${r.status}`,
        scenario: null,
        at: r.created_at,
      })),
      ...recentRoomsRes.rows.map<ActivityItem>((r) => ({
        kind: "room",
        label: r.title || "Decision room",
        detail: `${r.type} · ${r.status}`,
        scenario: r.type,
        at: r.created_at,
      })),
      ...recentSearchesRes.rows.map<ActivityItem>((r) => ({
        kind: "search",
        label: r.query_text || "Agent search",
        detail: r.scenario || "search",
        scenario: r.scenario,
        at: r.created_at,
      })),
      ...recentVotesRes.rows.map<ActivityItem>((r) => ({
        kind: "vote",
        label: "Voted on a proposal",
        detail: r.option_id ? `Picked option ${r.option_id.slice(0, 8)}` : "Cast vote",
        scenario: null,
        at: r.voted_at,
      })),
      ...recentPrefsRes.rows.map<ActivityItem>((r) => ({
        kind: "pref",
        label: `Learned preference: ${r.preference_key}`,
        detail: r.preference_value,
        scenario: null,
        at: r.updated_at,
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 20);

    return NextResponse.json({
      range,
      cards,
      timeseries,
      scenarios,
      activity,
    });
  } catch (err) {
    console.error("[analytics] error", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
