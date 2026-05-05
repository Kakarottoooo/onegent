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

    expect(task).toContain("Use only public Booking.com pages to prepare a manual hotel booking review");
    expect(task).toContain("YOTEL New York Times Square");
    expect(task).toContain("New York");
    expect(task).toContain("- Check-in: 2026-06-10");
    expect(task).toContain("- Check-out: 2026-06-12");
    expect(task).toContain("- Guests: 1 adult");
    expect(task).toContain("- Rooms: 1 room");
    expect(task).toContain("Before any booking-step action, verify that the visible page matches the exact hotel name");
    expect(task).toContain("Proceed only through public search/detail/room-selection pages");
    expect(task).toContain("Stop at the first safe manual-review boundary");
    expect(task).toContain("current page state, URL, and visible evidence");
    expect(task).toContain("Hard stop immediately if the page asks for or shows payment, card entry, CVV/CVC/security code");
    expect(task).toContain("login, sign-in, account creation, account verification, OTP, SMS code, CAPTCHA");
    expect(task).toContain("Do not enter payment details, card details, CVV/CVC/security code");
    expect(task).toContain("Do not bypass login, verification, CAPTCHA, OTP, or account checks");
    expect(task).toContain("Do not click any final reserve, confirm, complete booking, purchase, payment, or submission control");
    expect(task).toContain("If it is unclear whether a button is final, irreversible, account-sensitive, or payment-related");

    expect(task).not.toMatch(/fill in all guest details and payment information/i);
    expect(task).not.toMatch(/Stop before entering CVV or clicking the final payment confirmation button/i);
    expect(task).not.toMatch(/fill.*payment/i);
  });
});
