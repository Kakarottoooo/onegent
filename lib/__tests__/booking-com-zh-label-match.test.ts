import { describe, expect, it } from "vitest";

import {
  bookingComLabelLooksLikePhone,
  bookingComLabelLooksLikeCountry,
} from "@/lib/booking-autopilot/providers/booking-com";

describe("Booking.com Chinese label detectors — fix mojibake regex strings", () => {
  // Bug 5a/5b (P1, observed live): the existing label-match helpers in
  // fillBookingComGuestForm contained mojibake-corrupted Chinese (e.g. "濮?",
  // "鐢佃瘽鍙风爜", "鎵嬫満鍙风爜") — bytes that GBK-decoded a UTF-8 stream and
  // never match any real Chinese on the live page. Result: on the zh-CN
  // version of secure.booking.com/book.html the country select and phone
  // input are never identified, so Country and Phone Number stay empty,
  // which blocks the fillGuestForm submit-readiness check from clicking
  // "下一步：最终信息".

  describe("phone label", () => {
    it("matches the live Booking.com Chinese labels (clean UTF-8)", () => {
      expect(bookingComLabelLooksLikePhone("电话号码")).toBe(true);
      expect(bookingComLabelLooksLikePhone("电话号码*")).toBe(true);
      expect(bookingComLabelLooksLikePhone("手机号码")).toBe(true);
      expect(bookingComLabelLooksLikePhone("电话")).toBe(true);
      expect(bookingComLabelLooksLikePhone("手机")).toBe(true);
    });

    it("still matches English labels", () => {
      expect(bookingComLabelLooksLikePhone("Phone number")).toBe(true);
      expect(bookingComLabelLooksLikePhone("Mobile number")).toBe(true);
      expect(bookingComLabelLooksLikePhone("Telephone")).toBe(true);
      expect(bookingComLabelLooksLikePhone("phone number*")).toBe(true);
    });

    it("matches traditional Chinese (zh-TW / zh-HK)", () => {
      expect(bookingComLabelLooksLikePhone("電話號碼")).toBe(true);
      expect(bookingComLabelLooksLikePhone("手機號碼")).toBe(true);
    });

    it("does not match unrelated labels", () => {
      expect(bookingComLabelLooksLikePhone("电子邮箱地址")).toBe(false);
      expect(bookingComLabelLooksLikePhone("Email")).toBe(false);
      expect(bookingComLabelLooksLikePhone("国家/地区")).toBe(false);
      expect(bookingComLabelLooksLikePhone("")).toBe(false);
    });
  });

  describe("country label", () => {
    it("matches the live Booking.com Chinese labels (clean UTF-8)", () => {
      expect(bookingComLabelLooksLikeCountry("国家/地区")).toBe(true);
      expect(bookingComLabelLooksLikeCountry("国家/地区*")).toBe(true);
      expect(bookingComLabelLooksLikeCountry("国家")).toBe(true);
    });

    it("still matches English labels", () => {
      expect(bookingComLabelLooksLikeCountry("Country/Region")).toBe(true);
      expect(bookingComLabelLooksLikeCountry("Country")).toBe(true);
      expect(bookingComLabelLooksLikeCountry("country*")).toBe(true);
    });

    it("matches traditional Chinese (zh-TW / zh-HK)", () => {
      expect(bookingComLabelLooksLikeCountry("國家/地區")).toBe(true);
      expect(bookingComLabelLooksLikeCountry("國家")).toBe(true);
    });

    it("does not match unrelated labels", () => {
      expect(bookingComLabelLooksLikeCountry("电话号码")).toBe(false);
      expect(bookingComLabelLooksLikeCountry("城市")).toBe(false);
      expect(bookingComLabelLooksLikeCountry("Email")).toBe(false);
      expect(bookingComLabelLooksLikeCountry("")).toBe(false);
    });
  });
});
