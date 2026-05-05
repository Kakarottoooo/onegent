import type { BrowserTaskInput, BookingProfile } from "../types";

/** Build a natural-language task for restaurant booking. */
export function buildRestaurantTask(params: {
  restaurantName: string;
  city: string;
  date: string;
  time: string;
  covers: number;
  profile: BookingProfile;
}): Pick<BrowserTaskInput, "task" | "profile"> {
  return {
    profile: params.profile,
    task: `Find ${params.restaurantName} restaurant in ${params.city} and book a table for ${params.covers} people on ${params.date} at ${params.time}. Select the closest available time slot if the exact time is unavailable. Fill in the guest information form completely.`,
  };
}

/** Build a natural-language task for hotel booking. */
export function buildHotelTask(params: {
  hotelName: string;
  city: string;
  checkin: string;
  checkout: string;
  adults: number;
  rooms?: number;
  profile: BookingProfile;
  roomPreference?: string;
  breakfastIncluded?: boolean;
}): Pick<BrowserTaskInput, "task" | "profile"> {
  const roomPref = params.roomPreference ?? params.profile.room_preference;
  const wantsBreakfast = params.breakfastIncluded ?? params.profile.breakfast_preference;
  const rooms = Number.isFinite(params.rooms) && params.rooms && params.rooms > 0 ? params.rooms : 1;

  const roomInstruction = roomPref
    ? `Room preference: prefer a ${roomPref} room type if available after the exact target stay is visible.\n`
    : `Room preference: prefer the cheapest available room after the exact target stay is visible.\n`;

  const breakfastInstruction = wantsBreakfast
    ? `Breakfast preference: choose a rate that includes breakfast if available after the exact target stay is visible.\n`
    : ``;

  return {
    profile: params.profile,
    task:
      `Use only public Booking.com pages to prepare a manual hotel booking review.\n\n` +
      `Target stay:\n` +
      `- Hotel: ${params.hotelName}\n` +
      `- City: ${params.city}\n` +
      `- Check-in: ${params.checkin}\n` +
      `- Check-out: ${params.checkout}\n` +
      `- Guests: ${params.adults} adult${params.adults === 1 ? "" : "s"}\n` +
      `- Rooms: ${rooms} room${rooms === 1 ? "" : "s"}\n\n` +
      `Before any booking-step action, verify that the visible page matches the exact hotel name, city, check-in date, check-out date, adult count, and room count.\n\n` +
      `${roomInstruction}${breakfastInstruction}` +
      `Proceed only through public search/detail/room-selection pages. Stop at the first safe manual-review boundary and report the current page state, URL, and visible evidence.\n\n` +
      `Hard stop immediately if the page asks for or shows payment, card entry, CVV/CVC/security code, billing details, login, sign-in, account creation, account verification, OTP, SMS code, CAPTCHA, human verification, phone verification, credentials, or any final reserve, confirm, complete booking, purchase, pay, or submit control.\n\n` +
      `Do not enter payment details, card details, CVV/CVC/security code, credentials, OTP, CAPTCHA, verification, or personal account information.\n\n` +
      `Do not bypass login, verification, CAPTCHA, OTP, or account checks.\n\n` +
      `Do not click any final reserve, confirm, complete booking, purchase, payment, or submission control.\n\n` +
      `If it is unclear whether a button is final, irreversible, account-sensitive, or payment-related, stop and report the page state instead of clicking.`,
  };
}

/** Build a natural-language task for flight booking. */
export function buildFlightTask(params: {
  origin: string;
  destination: string;
  date: string;
  passengers: number;
  preferNonstop: boolean;
  profile: BookingProfile;
}): Pick<BrowserTaskInput, "task" | "profile"> {
  return {
    profile: params.profile,
    task: `Find the cheapest ${params.preferNonstop ? "non-stop " : ""}flight from ${params.origin} to ${params.destination} on ${params.date} for ${params.passengers} passenger(s). Select the best option and proceed to the passenger details form. Fill in all required information.`,
  };
}
