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
    ? `Prefer a ${roomPref} room type if available after the verified hotel and dates are visible. `
    : `Prefer the cheapest available room after the verified hotel and dates are visible. `;

  const breakfastInstruction = wantsBreakfast
    ? `Choose a rate that includes breakfast if available. `
    : ``;

  return {
    profile: params.profile,
    task:
      `Use only public Booking.com pages to prepare a manual hotel booking. ` +
      `Find ${params.hotelName} in ${params.city} for ${rooms} room(s), ${params.adults} adult(s), ` +
      `checking in ${params.checkin} and checking out ${params.checkout}. ` +
      `Verify the hotel name, city, check-in date, check-out date, guest count, and room count before taking any booking-step action. ` +
      `${roomInstruction}${breakfastInstruction}` +
      `Stop at the first safe manual-review boundary and report the current page state. Do not complete the booking. ` +
      `Hard stop immediately if you see payment, CVV/security code, card entry, login/sign-in, account verification, OTP, CAPTCHA, human verification, phone verification, credentials, or any final reserve/confirm/complete booking screen. ` +
      `Do not enter payment details, CVV/security code, credentials, OTP, CAPTCHA, or verification information. Do not bypass any wall. ` +
      `Do not click any final reserve, confirm, complete booking, purchase, or payment submission control.`,
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
