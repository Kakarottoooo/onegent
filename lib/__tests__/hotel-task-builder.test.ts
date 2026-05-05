import { describe, expect, it } from "vitest";

import { buildHotelTask } from "@/lib/booking-autopilot/core/task-builders";

const PROFILE = {
  first_name: "Test",
  last_name: "Guest",
  email: "test@example.com",
  phone: "5555550100",
};

describe("buildHotelTask", () => {
  it("locks the controlled Booking.com hotel prompt to safe manual-review boundaries", () => {
    const { task } = buildHotelTask({
      hotelName: "YOTEL New York Times Square",
      city: "New York",
      checkin: "2026-06-10",
      checkout: "2026-06-12",
      adults: 1,
      rooms: 1,
      profile: PROFILE,
    });

    expect(task).toContain("Use only public Booking.com pages");
    expect(task).toContain("YOTEL New York Times Square");
    expect(task).toContain("New York");
    expect(task).toContain("1 room(s), 1 adult(s)");
    expect(task).toContain("checking in 2026-06-10 and checking out 2026-06-12");
    expect(task).toContain("Verify the hotel name, city, check-in date, check-out date, guest count, and room count");
    expect(task).toContain("Stop at the first safe manual-review boundary");
    expect(task).toContain("Do not complete the booking");
    expect(task).toContain("Hard stop immediately if you see payment, CVV/security code, card entry");
    expect(task).toContain("login/sign-in, account verification, OTP, CAPTCHA");
    expect(task).toContain("Do not enter payment details");
    expect(task).toContain("Do not bypass any wall");
    expect(task).toContain("Do not click any final reserve, confirm, complete booking, purchase, or payment submission control");

    expect(task).not.toMatch(/fill in all guest details and payment information/i);
    expect(task).not.toMatch(/Stop before entering CVV or clicking the final payment confirmation button/i);
  });
});
