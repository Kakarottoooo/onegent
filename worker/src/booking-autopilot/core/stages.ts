export type RequestedStayDates = { checkin?: string; checkout?: string };

export type BookingStage =
  | "blocked"
  | "listing"
  | "date_selection"
  | "room_selection"
  | "intermediate_gate"
  | "checkout_form"
  | "payment_gate"
  | "no_availability"
  | "unknown";

export type BookingStageAssessment = {
  stage: BookingStage;
  reason: string;
  currentUrl: string;
  pageText: string;
  hitPaymentUrl: boolean;
  hitPaymentGate: boolean;
  visibleCheckoutFields: boolean;
  stalledAtDateSelection: boolean;
  stalledAtRoomSelection: boolean;
  stalledAtIntermediateBookNow: boolean;
  listingSignals: boolean;
  bookingProgressSignals: boolean;
  blocked: boolean;
};

export const COMMON_DISALLOWED_ADVANCE_BUTTONS = [
  /next slide/i,
  /previous slide/i,
  /add more rooms/i,
  /promo code/i,
  /close icon/i,
  /^close$/i,
  /manage cookies/i,
  /accept all/i,
  /decline all/i,
  /directory/i,
];

export const DATE_SELECTION_ADVANCE_BUTTONS = [
  /^next\b/i,
  /^continue\b/i,
  /^check\s+availability/i,
  /^show\s+rooms/i,
];

export const ROOM_SELECTION_ADVANCE_BUTTONS = [
  /^select\s+room/i,
  /^proceed\s+to\s+payment/i,
  /^select$/i,
  /^continue\b/i,
  /^reserve$/i,
  /^i['']ll\s+reserve/i,
  /^reserve\s+now/i,
  /^next\b/i,
];

export const INTERMEDIATE_GATE_ADVANCE_BUTTONS = [
  /^book\s+now/i,
  /^reserve\s+now/i,
  /^reserve$/i,
];

export function extractRequestedStayDates(task: string): RequestedStayDates {
  const checkin = task.match(/check(?:ing)?-?\s*in(?:\s+date)?[:\s]+(\d{4}-\d{2}-\d{2})/i)?.[1];
  const checkout = task.match(/check(?:ing)?-?\s*out(?:\s+date)?[:\s]+(\d{4}-\d{2}-\d{2})/i)?.[1];
  return { checkin, checkout };
}
