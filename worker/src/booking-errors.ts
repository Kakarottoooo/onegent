export function isFlightInventoryDriftError(message: string | null | undefined): boolean {
  const text = (message ?? "").toLowerCase();
  return (
    text.includes("could not find the outbound flight on the search results page") ||
    text.includes("could not find the return flight on the search results page") ||
    text.includes("the flight may no longer be available") ||
    text.includes("expedia no longer shows that exact flight")
  );
}

export function buildFlightInventoryDriftMessage(legLabel: string): string {
  return `Found a matching ${legLabel} earlier, but Expedia no longer shows that exact option. The fare may have sold out, changed price, or shifted to a different schedule.`;
}

export function buildFlightInventoryDriftManualMessage(): string {
  return "We found a flight earlier, but Expedia no longer shows that exact fare. Open the current results to pick the closest live option.";
}
