import {
  listMyChatSessionRows,
  listMyDecisionRoomSidebarRows,
  getUserProfile,
  type BookingJobSummary,
  type ChatSession,
  type DecisionRoomSidebarRow,
  type UserProfile,
} from "@/lib/db";
import {
  getVisibleBookingJobSummaries,
  summarizeBookingJobs,
  type BookingJobsSummary,
} from "@/lib/booking-jobs/read-model";

export type AppBootstrapSidebarRoom = DecisionRoomSidebarRow;
export type AppBootstrapSidebarSession = ChatSession;

export type AppBootstrapRecentJob = Pick<
  BookingJobSummary,
  "id" | "trip_label" | "status" | "created_at" | "updated_at"
>;

export type AppBootstrapAccountProfile = Pick<
  UserProfile,
  "user_id" | "profile_code" | "username" | "display_name" | "avatar_url"
> | null;

export type AppBootstrapData = {
  sidebar: {
    rooms: AppBootstrapSidebarRoom[];
    sessions: AppBootstrapSidebarSession[];
  };
  account_profile: AppBootstrapAccountProfile;
  recent_jobs: AppBootstrapRecentJob[];
  booking_jobs_summary: BookingJobsSummary;
  generated_at: string;
};

export function emptyAppBootstrapData(): AppBootstrapData {
  return {
    sidebar: {
      rooms: [],
      sessions: [],
    },
    account_profile: null,
    recent_jobs: [],
    booking_jobs_summary: summarizeBookingJobs([]),
    generated_at: new Date().toISOString(),
  };
}

async function bestEffort<T>(label: string, promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    console.warn(`[app-bootstrap] ${label} unavailable`, err);
    return fallback;
  }
}

export async function getAppBootstrapData(params: {
  userId?: string | null;
  sessionId?: string | null;
}): Promise<AppBootstrapData> {
  const userId = params.userId ?? null;
  const sessionId = params.sessionId?.trim() || null;

  const roomsPromise = userId
    ? bestEffort(
        "sidebar rooms",
        listMyDecisionRoomSidebarRows(userId, { includeInvited: true, limit: 40 }),
        [] as AppBootstrapSidebarRoom[],
      )
    : Promise.resolve([] as AppBootstrapSidebarRoom[]);

  const sessionsPromise = userId
    ? bestEffort(
        "sidebar sessions",
        listMyChatSessionRows(userId, 60),
        [] as AppBootstrapSidebarSession[],
      )
    : Promise.resolve([] as AppBootstrapSidebarSession[]);

  const bookingJobsPromise = sessionId
    ? bestEffort(
        "booking job summaries",
        getVisibleBookingJobSummaries({ sessionId, userId, limit: 30, includeUserJobs: false }),
        [] as BookingJobSummary[],
      )
    : Promise.resolve([] as BookingJobSummary[]);

  const accountProfilePromise = userId
    ? bestEffort("account profile", getUserProfile(userId), null as UserProfile | null)
    : Promise.resolve(null as UserProfile | null);

  const [rooms, sessions, bookingJobs, accountProfile] = await Promise.all([
    roomsPromise,
    sessionsPromise,
    bookingJobsPromise,
    accountProfilePromise,
  ]);

  return {
    sidebar: {
      rooms,
      sessions,
    },
    account_profile: accountProfile
      ? {
          user_id: accountProfile.user_id,
          profile_code: accountProfile.profile_code,
          username: accountProfile.username,
          display_name: accountProfile.display_name,
          avatar_url: accountProfile.avatar_url,
        }
      : null,
    recent_jobs: bookingJobs.slice(0, 3).map((job) => ({
      id: job.id,
      trip_label: job.trip_label,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
    })),
    booking_jobs_summary: summarizeBookingJobs(bookingJobs),
    generated_at: new Date().toISOString(),
  };
}
