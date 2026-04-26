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
  profile: BookingProfile;
  roomPreference?: string;
  breakfastIncluded?: boolean;
}): Pick<BrowserTaskInput, "task" | "profile"> {
  const roomPref = params.roomPreference ?? params.profile.room_preference;
  const wantsBreakfast = params.breakfastIncluded ?? params.profile.breakfast_preference;

  const roomInstruction = roomPref
    ? `Prefer a ${roomPref} room type if available. `
    : `Select the cheapest available room (preferably a standard king or queen room). `;

  const breakfastInstruction = wantsBreakfast
    ? `Choose a rate that includes breakfast if available. `
    : ``;

  return {
    profile: params.profile,
    task: `Find ${params.hotelName} hotel in ${params.city} and book a room for ${params.adults} adult(s), checking in ${params.checkin} and checking out ${params.checkout}. ${roomInstruction}${breakfastInstruction}Fill in the guest information completely.`,
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
