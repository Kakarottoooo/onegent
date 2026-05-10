import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InlineJobCard from "../InlineJobCard";
import type { BookingJob, BookingJobStep } from "@/lib/db";

const OPTION_LABEL = "Sep 17 7:00 PM Disney On Ice Detroit";

function makeChoiceStep(): BookingJobStep {
  return {
    type: "activity",
    emoji: "ticket",
    label: "Disney On Ice (Ticketmaster)",
    apiEndpoint: "/api/booking-autopilot/universal",
    body: {
      activity_name: "Disney On Ice Presents",
      provider: "ticketmaster",
      provider_page_type: "artist",
      startUrl: "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
    },
    fallbackUrl: "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
    status: "awaiting_confirmation",
    handoff_url: "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
    actionItem: {
      message: "Ticketmaster shows multiple visible events. Which one should I use?",
      options: [
        { label: OPTION_LABEL, url: "" },
      ],
    },
    decisionLog: [
      {
        ts: "2026-05-10T12:00:00.000Z",
        type: "succeeded",
        message: "Provider-start task has no target date/time; pausing for user event choice",
        outcome: "user_event_choice_required",
      },
    ],
  };
}

function makeChoiceJob(): BookingJob {
  return {
    id: "job-choice-1",
    session_id: "session-1",
    user_id: "user-1",
    trip_label: "Disney On Ice Presents",
    status: "done",
    steps: [makeChoiceStep()],
    autonomy_settings: null,
    plan_version: 4,
    constraints: null,
    policy: null,
    created_at: "2026-05-10T12:00:00.000Z",
    updated_at: "2026-05-10T12:00:10.000Z",
    completed_at: "2026-05-10T12:00:10.000Z",
  };
}

describe("InlineJobCard provider event choices", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("turns provider candidates into clickable continuation choices", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: makeChoiceJob() }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onChoice = vi.fn().mockResolvedValue(undefined);

    render(
      <InlineJobCard
        jobId="job-choice-1"
        onProviderEventChoiceOption={onChoice}
      />,
    );

    const optionButton = await screen.findByRole("button", { name: OPTION_LABEL });
    fireEvent.click(optionButton);

    await waitFor(() => {
      expect(onChoice).toHaveBeenCalledWith({
        jobId: "job-choice-1",
        tripLabel: "Disney On Ice Presents",
        message: OPTION_LABEL,
      });
    });
  });
});
