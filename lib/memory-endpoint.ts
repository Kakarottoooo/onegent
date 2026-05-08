import {
  getAgentFeedbackEvents,
  getBookingJobSummariesBySession,
  getRelationshipBySession,
} from "@/lib/db";
import {
  buildCompactMemoryResponse,
  DEFAULT_MEMORY_COMPACT_EVENT_LIMIT,
  DEFAULT_MEMORY_COMPACT_JOB_LIMIT,
  type CompactMemoryResponse,
} from "@/lib/memory-read-model";

export async function getCompactMemoryEndpointResponse(
  sessionId: string,
): Promise<CompactMemoryResponse> {
  const [events, jobs, relationship] = await Promise.all([
    getAgentFeedbackEvents(sessionId, DEFAULT_MEMORY_COMPACT_EVENT_LIMIT),
    getBookingJobSummariesBySession(sessionId, DEFAULT_MEMORY_COMPACT_JOB_LIMIT),
    getRelationshipBySession(sessionId),
  ]);

  return buildCompactMemoryResponse({
    events,
    jobs,
    relationship,
    eventLimit: DEFAULT_MEMORY_COMPACT_EVENT_LIMIT,
    jobLimit: DEFAULT_MEMORY_COMPACT_JOB_LIMIT,
  });
}
