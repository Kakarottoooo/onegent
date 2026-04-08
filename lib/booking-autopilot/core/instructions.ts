import type { BrowserTaskInput } from "../types";
import { buildEffectiveProfile } from "./profile";

export function buildInstruction(input: BrowserTaskInput): string {
  const p = buildEffectiveProfile(input.profile, input.task);
  const hasProfile = !!(p.full_name || p.first_name || p.last_name || p.email || p.phone);

  if (hasProfile) {
    const fullName = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ");
    const addressParts = [
      p.address_line1 && `Street: ${p.address_line1}`,
      p.city && `City: ${p.city}`,
      p.state && `State: ${p.state}`,
      p.zip && `ZIP: ${p.zip}`,
      p.country && `Country: ${p.country}`,
    ].filter(Boolean);
    const cardParts = [
      p.card_name && `Cardholder name: ${p.card_name}`,
      p.card_number && `Card number: ${p.card_number}`,
      p.card_expiry && `Expiry date: ${p.card_expiry}`,
    ].filter(Boolean);

    return `${input.task}

You are starting at: ${input.startUrl}
IMPORTANT: After navigating to the starting URL you may be redirected to a different domain - this is expected and correct (e.g. a hotel may have rebranded or moved). Stay on whatever website you actually land on and complete the booking there. Do NOT navigate to other hotel websites, search engines, or unrelated sites. If you land on the correct hotel's booking page, that IS the right site even if the domain differs from the starting URL.
${input.startUrl.includes("booking.com") ? `\nYou are on booking.com. Flow: search results -> click hotel card -> hotel detail page -> select room -> "Reserve" -> fill guest info -> fill card -> STOP before "Complete booking".` : ""}${input.startUrl.includes("expedia.com") ? `\nYou are on Expedia. Flow: search results -> click hotel -> select room -> "Reserve" -> fill guest info -> fill card -> STOP before final payment button.` : ""}

Guest details - fill these into ALL guest/contact information fields you encounter:
- Full name: ${fullName}
- Email: ${p.email}
- Phone: ${p.phone} (this is the 10-digit local number; if the phone field already displays "+1" or a country code, do NOT add another "+1" - type only these digits as-is)
${addressParts.length ? `\nBilling address:\n${addressParts.map((a) => `- ${a}`).join("\n")}` : ""}
${cardParts.length ? `\nPayment card (fill number and expiry, then STOP before CVV):\n${cardParts.map((c) => `- ${c}`).join("\n")}` : ""}

FIRST STEP - GET TO THE BOOKING FORM:
- If you are on a booking.com or Expedia SEARCH RESULTS page: find the hotel card matching the hotel name in the task, click on it to open its detail page. Do NOT click any generic "Reserve" button on the search results page itself - first open the hotel's own detail page.
- If you are on a booking.com HOTEL DETAIL page: FIRST scroll down past the photos and description to find the room list ("绌烘埧鎯呭喌"). Do NOT touch the search bar at the top. Do NOT type the guest name anywhere yet. Only interact with the room rows below.
- If you see a "Select a Rate" page with multiple rate options: pick the lowest-priced rate UNLESS the task mentions breakfast, free cancellation, or a specific preference. Click its "Select" button to proceed.
- If the hotel homepage shows a "BOOK NOW" or "Book Now" button in the header/navigation bar, click it FIRST to open the booking calendar widget. This is the entry point - you cannot select dates until you click this button.
- If a cookie consent banner appears, click "Decline all" or "Reject all" to dismiss it before proceeding.

HOTEL DETAIL PAGE - VERIFY DATES FIRST:
- When you land on a hotel detail page (e.g. IHG, Marriott, Hilton direct site) that shows a date picker or search bar with check-in/check-out dates, CHECK that the displayed dates match the task's required check-in and check-out before doing anything else.
- If the dates are WRONG (e.g. showing today's date instead of the required dates), update them FIRST:
  1. Click the check-in date field to open the date picker.
  2. Navigate to the correct month and select the correct check-in date.
  3. Set the correct check-out date or stay duration.
  4. Click "Search" / "View Prices" / "Update" to apply the dates.
- Only after dates are correct should you proceed to room selection or "View Prices".

AFTER CLICKING "BOOK NOW" - WAIT FOR CALENDAR TO LOAD:
- After clicking "BOOK NOW", take an ariaTree snapshot BEFORE trying to click anything else.
- Verify the ariaTree shows a BOOKING CALENDAR with a month/year header (e.g., "April 2026") and a date grid showing day numbers. If the calendar is not yet visible, take another screenshot and wait.
- The booking calendar navigation arrows ("<" left / ">" right) appear INSIDE the Namastay booking panel - they sit directly next to the month/year header text (e.g., "April 2026").
- The "Previous Slide" and "Next Slide" buttons belong to the PHOTO GALLERY carousel on the main hotel page - they control photos, NOT calendar months. NEVER click these.
- To distinguish: if clicking a button changes a photo but not the calendar month header, you clicked the wrong button. Use ariaTree to find the calendar navigation arrows instead.
- When acting on the calendar arrow, describe it as: "click the right arrow button next to the month/year heading inside the Namastay booking calendar"
- After each calendar arrow click, take an ariaTree to confirm the month header changed before clicking again.

BOOKING.COM SPECIFIC FLOW:
1. Search results page -> find and click the correct hotel card by name
   - If booking.com shows NO hotel cards, an error message, OR redirects to the booking.com homepage (booking.com/index.html) - this means the search FAILED. Immediately navigate to the fallback URL provided in the task. Do NOT wait or retry the search.
   - Signs of search failure: URL contains "errorc_searchstring_not_found", page shows "We couldn't find", page is booking.com homepage with no search results.
   - If results appear but the exact name isn't listed, click the closest match (same brand or city)
2. Hotel detail page -> verify/set dates -> scroll to room list -> choose cheapest room:
   - If the room list has a QUANTITY DROPDOWN (showing "0", "1", "2"... next to each room type: set the dropdown for the cheapest room to "1". After setting it to 1, a blue "I'll reserve" (English) or "鐜板湪灏遍璁?" (Chinese) button appears in the RIGHT-SIDE SUMMARY PANEL - click THAT button as your VERY NEXT action. Do NOT fill any name, email, phone, or other information on this page - the guest info form is on the NEXT page. Do NOT touch the search bar at the top.
   - If the room list has a direct "Reserve" / "I'll reserve" / "Select" / "Book" button per room: click it directly.
   - Always pick the lowest-priced available room unless the task specifies a room type preference.
3. Guest details form - Booking.com may show this form in CHINESE.
   IMPORTANT: Even if you are logged into a Booking.com account and fields are pre-filled, you MUST verify each field matches the guest info provided in the task. Pre-filled values from the account may be wrong - always correct them.
   Go through each field in this EXACT ORDER and fix any wrong values:
   STEP A: 濮?(鎷奸煶/鑻辫) = LAST NAME / FAMILY NAME / SURNAME. Check the current value. If it contains the first name or any wrong value, clear it and type ONLY the last name (e.g. if the guest is "Ziwei Guo", this field must contain "Guo"). Do NOT type digits or phone number here.
   STEP B: 鍚?(鎷奸煶/鑻辫) = FIRST NAME / GIVEN NAME. Check the current value. If it contains the last name or any wrong value, clear it and type ONLY the first name (e.g. "Ziwei"). Do NOT type digits or phone number here.
   STEP C: 鐢靛瓙閭鍦板潃 = Email address. Verify it matches; correct if wrong.
   STEP D: 鍥藉/鍦板尯 = Country/region. This MUST match the guest's country. If the guest has a US address/phone, it must show "缇庡浗" (United States). If it shows "涓浗" or any other wrong country, click the dropdown and change it to "缇庡浗".
   STEP E: 鐢佃瘽鍙风爜 / 鎵嬫満鍙风爜 = Phone number - two parts side by side:
     LEFT part: a country code dropdown. It MUST show "US +1" for US phone numbers. If it shows anything else (e.g. "BT +975", "涓浗 +86"), click the dropdown and select "United States +1" / "US +1".
     RIGHT part: a separate empty number input box to the right of the country code -> click ONLY this right-side input box, then type the 10-digit phone number (digits only, no +1, no dashes, no spaces).
   STEP F: After ALL fields are verified/filled, look for and click the button to advance to the NEXT page. This button may say: "Next: Final details", "Next step", "Continue", "涓嬩竴姝?", "缁х画", or "瀹屾垚". It is usually at the BOTTOM of the page. Scroll down to find it if needed.
   CRITICAL: The credit card / payment form is on a SEPARATE NEXT PAGE - it does NOT appear on the same page as the guest name/email/phone form. Do NOT attempt to fill card number, CVV, expiry, or address on the guest details page. Do NOT type anything else after the phone number. Immediately scroll down and click "Next: Final details" to go to the payment page.
4. Payment page (reached AFTER clicking 涓嬩竴姝? on guest details page) - may also be in Chinese:
   - 淇＄敤鍗℃垨鍊熻鍗? = Credit or debit card -> select this option
   - 鍗″彿 = Card number
   - 鍒版湡鏃? = Expiry date
   - 鎸佸崱浜哄鍚? = Cardholder name
   - 瀹屾垚棰勮 / 绔嬪嵆浠樻 = Complete booking / Pay now -> STOP before clicking this
5. STOP before CVV (瀹夊叏鐮? CVV) and before "瀹屾垚棰勮" / "绔嬪嵆浠樻" button

EXPEDIA SPECIFIC FLOW:
1. Search results -> click correct hotel -> "Select room"
2. Room selection -> choose room -> "Reserve"
3. Trip summary / checkout form -> fill guest info and card
4. STOP before final "Complete booking" button

Booking widget navigation rules:
- The booking calendar and room selection are inside an IFRAME on the page.
- After selecting dates, click ONLY the "Next" button that is INSIDE the booking widget iframe to advance to room selection. DO NOT click "Next Slide", "Previous Slide", photo carousel arrows, or any other button outside the booking iframe.
- If you clicked a "Next Slide" button by mistake (it navigates a photo gallery), that is the wrong button - look for the Next/Continue button inside the booking iframe instead.
- If any dialog or popup appears (error, warning, advertisement, newsletter, or any modal overlay), click its "Ok", "Close", "Dismiss", or "No thanks" button immediately to dismiss it and continue. Do NOT enter any coupon or promo code if asked.
- If a dialog says "We couldn't find this room", "room not available", "sold out", or similar - click Ok to dismiss, then go back to the room list and select a DIFFERENT available room.
- If a dialog says "no availability" for your dates - click Ok, then try adjusting the dates by +/-1 day and search again.
- Never leave a modal open - always dismiss it before trying to interact with the page behind it.
- If clicking "Book Now" or any booking button opens a NEW TAB or popup window, switch to that new tab immediately and continue the booking process there. Do not stay on the original page.

CALENDAR MONTH NAVIGATION:
- Before clicking any date, read the calendar header to see which month is shown.
- If the shown month is BEFORE the target month -> click the RIGHT arrow to advance forward.
- If the shown month is AFTER the target month -> click the LEFT arrow to go back.
- After each arrow click, re-read the calendar header to confirm the month changed correctly.
- NEVER click a date cell unless the header already shows the correct month and year.

STAY DURATION / SINGLE CHECK-IN DATE CALENDARS (IHG and similar):
- Some hotel calendars (e.g. IHG) use a CHECK-IN DATE + STAY DURATION model, NOT a check-in/check-out range picker.
- How to identify: the calendar shows a "Stay duration" control with +/- buttons (e.g. "1 night") at the bottom, and each date cell shows a price per night.
- On these calendars: click ONLY the check-in date cell. Do NOT click the checkout date - clicking a second date will OVERRIDE the check-in selection and move it forward.
- After clicking check-in, use the "+" (Increment) button next to "Stay duration" / "1 night" to increase the number of nights until it matches the required stay length.
- Example: check-in May 26, check-out May 28 = 2 nights -> click May 26, then click "+" once to go from 1 night to 2 nights.
- Then click CONTINUE to proceed to room selection.

ONLY FILL GUEST INFO ON THE ACTUAL CHECKOUT / GUEST DETAILS PAGE:
- Do NOT call fillForm or type any guest info while on the room selection page, search results page, or calendar dialog.
- The checkout / guest details page typically has clearly labeled fields: "First name", "Last name", "Email address", "Phone number", "Address", "City", "State", "ZIP", and a payment card section.
- If you are not sure whether you are on the checkout form, take an ariaTree snapshot and look for those labeled fields before typing anything.

Fill ALL guest info and billing address fields that are inside the booking widget or checkout form.
Do NOT fill newsletter subscription inputs, footer email fields, or any input outside the booking/checkout area.
If a page shows only card fields (no name/email/phone), skip those and fill just the card fields.

IMPORTANT - "Book Now" button handling:
If a page shows a booking review summary (dates, room, total price) with a privacy policy checkbox and a "Book Now" or "Reserve Now" button:
  1. Check the privacy policy checkbox.
  2. Select "Credit or debit card" if a payment method radio is present.
  3. Click "Book Now" / "Reserve Now" - this only opens the card entry form, it does NOT charge the card.
  4. After clicking, fill the card number and expiry date fields that appear.
  5. STOP before the CVV / security code field.

STOP before CVV and before any button that says "Pay Now", "Confirm Payment", "Complete Purchase", "Complete Booking", "Confirm Booking", or "Submit Payment".
Do NOT stop at "Book Now" or "Reserve Now" - those open the card form, not finalize payment.`;
  }

  return `${input.task}

You are starting at: ${input.startUrl}
IMPORTANT: After navigating you may be redirected to a different domain - stay on whatever site you land on. Do NOT use search engines or navigate to unrelated sites.

Navigate and select dates/room options. The booking calendar is inside an IFRAME - after selecting dates, click ONLY the "Next" button inside the booking iframe (not "Next Slide" or photo carousel buttons on the main page). When you reach a guest information form (name, email, phone), stop and clearly list every field the form is asking for so the user knows what to provide.`;
}
