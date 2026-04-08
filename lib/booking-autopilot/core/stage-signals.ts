import type { RequestedStayDates } from "./stages";

export function containsAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export function looksLikeIntermediateBookNowGate(pageText: string): boolean {
  const gateSignals = [
    "review and pay",
    "continue with",
    "guarantee policy",
    "cancellation policy",
    "credit or debit card",
    "privacy policy",
    "i agree",
  ];
  const matchingSignalCount = gateSignals.filter((signal) => pageText.includes(signal)).length;
  const hasIntermediateSubmitButton =
    pageText.includes("book now") ||
    pageText.includes("reserve now") ||
    pageText.includes("request to book");

  return hasIntermediateSubmitButton && matchingSignalCount >= 2;
}

function buildDateNeedles(isoDate?: string): string[] {
  if (!isoDate) return [];
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];

  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  const dayNumber = Number(day);
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const monthName = monthNames[monthIndex];
  if (!monthName) return [];

  return [
    `${monthName} ${dayNumber}, ${year}`,
    `${dayNumber} ${monthName} ${year}`,
    `${monthName} ${dayNumber}`,
    `${dayNumber} ${monthName}`,
  ];
}

export function hasRequestedStaySelected(
  pageText: string,
  requestedDates: RequestedStayDates
): boolean {
  if (!requestedDates.checkin || !requestedDates.checkout) return false;
  const checkinMatches = buildDateNeedles(requestedDates.checkin).some((needle) => pageText.includes(needle));
  const checkoutMatches = buildDateNeedles(requestedDates.checkout).some((needle) => pageText.includes(needle));
  return checkinMatches && checkoutMatches;
}

export function looksLikeDateSelectionGate(
  pageText: string,
  requestedDates: RequestedStayDates,
  currentUrl = ""
): boolean {
  if (currentUrl.includes("secure.booking.com") || currentUrl.includes("booking.com/book")) {
    return false;
  }

  const hasDatePickerSignals = containsAny(pageText, [
    "check in",
    "check out",
    "guests",
  ]);

  const hasAdvanceButton = containsAny(pageText, [
    "\nnext\n",
    "button: next",
    " next ",
  ]);

  const hasSelectedDates = hasRequestedStaySelected(pageText, requestedDates);

  const hasDeeperCheckoutSignals = containsAny(pageText, [
    "proceed to payment",
    "review and pay",
    "guest details",
    "card number",
    "credit card",
    "next: final details",
    "your price summary",
    "your booking details",
  ]);

  return hasDatePickerSignals && hasAdvanceButton && hasSelectedDates && !hasDeeperCheckoutSignals;
}

export function looksLikeRoomSelectionGate(pageText: string): boolean {
  const hasRoomSignals = containsAny(pageText, [
    "standard cabin",
    "room details",
    "rack",
    "usd169",
    "usd338",
    "proceed to payment",
    "select room",
    "i'll reserve",
    "i\u2019ll reserve",
    "i will reserve",
    "select rooms",
    "number of guests",
    "today's price",
    "your options",
    "availability",
    "per night",
    "绌烘埧鎯呭喌",
    "瀹㈡埧绫诲瀷",
    "閫夋嫨瀹㈡埧",
    "reserve now",
    "姣忔櫄",
  ]);

  const hasDeeperCheckoutSignals = containsAny(pageText, [
    "review and pay",
    "guest details",
    "card number",
    "credit card",
    "cvv",
    "杈撳叆涓汉淇℃伅",
    "瀹屾垚棰勮",
    "credit card",
    "cardholder",
  ]);

  return hasRoomSignals && !hasDeeperCheckoutSignals;
}
