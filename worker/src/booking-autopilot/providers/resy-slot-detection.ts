export type ResySlotCandidateMeta = {
  text: string;
  ariaLabel?: string;
  href?: string;
  tagName?: string;
  role?: string;
  testId?: string;
  className?: string;
  parentText?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  disabled?: boolean;
};

export type ResySlotCandidateHit = ResySlotCandidateMeta & {
  minutes: number;
  diffMinutes: number;
  normalizedText: string;
};

export function parseResyTimeMinutes(text: string): number | null {
  const match = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function normalizeCandidateText(text: string | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasFilterControlNoise(text: string): boolean {
  if (/\bsearch restaurants\b|\blog in\b|\bshare\b|\bsave\b/.test(text)) return true;
  if (/\bdate\b/.test(text) && /\bguests?\b/.test(text) && /\btime\b/.test(text)) return true;
  if (/\btime\b/.test(text) && !/\b(bar|counter|dining|indoor|outdoor|patio|table|seats?|reservation)\b/.test(text)) {
    return true;
  }
  return false;
}

function hasAvailabilityContext(text: string): boolean {
  return /\b(bar|counter|dining|indoor|outdoor|patio|table|seats?|reservation|availability|available|time slot|timeslot)\b/.test(text);
}

function isInteractiveCandidate(candidate: ResySlotCandidateMeta): boolean {
  const tag = candidate.tagName?.toUpperCase();
  const role = candidate.role?.toLowerCase();
  return Boolean(
    candidate.href ||
      tag === "A" ||
      tag === "BUTTON" ||
      role === "button" ||
      role === "link",
  );
}

export function explainResySlotCandidate(
  candidate: ResySlotCandidateMeta,
  requestedMinutes: number,
  maxDiffMinutes: number,
): { ok: true; hit: ResySlotCandidateHit } | { ok: false; reason: string } {
  if (candidate.disabled) return { ok: false, reason: "disabled" };
  if (candidate.width <= 0 || candidate.height <= 0) return { ok: false, reason: "not-visible" };

  const text = candidate.text.trim().replace(/\s+/g, " ");
  const minutes = parseResyTimeMinutes(text);
  if (minutes === null) return { ok: false, reason: "no-time" };

  const diffMinutes = Math.abs(minutes - requestedMinutes);
  if (diffMinutes > maxDiffMinutes) return { ok: false, reason: "outside-window" };

  const normalizedText = normalizeCandidateText(text);
  const combined = normalizeCandidateText([
    candidate.text,
    candidate.ariaLabel,
    candidate.role,
    candidate.testId,
    candidate.className,
    candidate.parentText,
  ].filter(Boolean).join(" "));

  if (hasFilterControlNoise(combined)) return { ok: false, reason: "filter-control" };
  if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(text) && !hasAvailabilityContext(combined)) {
    return { ok: false, reason: "bare-time-control" };
  }
  if (!isInteractiveCandidate(candidate) && !hasAvailabilityContext(combined)) {
    return { ok: false, reason: "non-interactive-time" };
  }

  return {
    ok: true,
    hit: {
      ...candidate,
      text,
      minutes,
      diffMinutes,
      normalizedText,
    },
  };
}

export function pickBestResySlotCandidate(
  candidates: ResySlotCandidateMeta[],
  requestedMinutes: number,
  maxDiffMinutes: number,
): ResySlotCandidateHit | null {
  const hits = candidates
    .map((candidate) => explainResySlotCandidate(candidate, requestedMinutes, maxDiffMinutes))
    .filter((result): result is { ok: true; hit: ResySlotCandidateHit } => result.ok)
    .map((result) => result.hit);

  if (hits.length === 0) return null;

  return hits.sort((a, b) => {
    if (a.diffMinutes !== b.diffMinutes) return a.diffMinutes - b.diffMinutes;
    return a.y - b.y;
  })[0];
}
