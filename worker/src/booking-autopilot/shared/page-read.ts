import type { Page } from "playwright";
import {
  getLocatorText,
  getInteractionScopes,
  getVisibleEditableFields,
  normalizeDigits,
  normalizeText,
} from "./field-utils";

type FieldCategory = { key: string; patterns: string[] };

const CHECKOUT_FIELD_CATEGORIES: FieldCategory[] = [
  { key: "full_name", patterns: ["full name"] },
  { key: "first_name", patterns: ["first name", "given name", "firstname"] },
  { key: "last_name", patterns: ["last name", "family name", "surname", "lastname"] },
  { key: "email", patterns: ["email", "e-mail"] },
  { key: "phone", patterns: ["phone", "mobile", "telephone"] },
  { key: "street", patterns: ["street address", "address line 1", "address 1", "billing address"] },
  { key: "city", patterns: ["city"] },
  { key: "state", patterns: ["state", "province"] },
  { key: "zip", patterns: ["zip", "postal code", "postcode"] },
  { key: "country", patterns: ["country"] },
  { key: "cardholder", patterns: ["name on card", "cardholder", "card holder"] },
  { key: "card_number", patterns: ["card number", "credit card number"] },
  { key: "card_expiry", patterns: ["expir", "expiry", "expiration", "mm/yy", "mm / yy"] },
];

export async function getVisibleFieldCategoryKeys(rawPage: Page): Promise<Set<string>> {
  const matches = new Set<string>();
  const scopes = getInteractionScopes(rawPage);

  for (const scope of scopes) {
    const candidates = await getVisibleEditableFields(scope);
    for (const candidate of candidates) {
      const candidateText = normalizeText(await getLocatorText(candidate));
      for (const category of CHECKOUT_FIELD_CATEGORIES) {
        if (category.patterns.some((pattern) => candidateText.includes(normalizeText(pattern)))) {
          matches.add(category.key);
        }
      }
    }
  }

  return matches;
}

export async function readCombinedText(rawPage: Page): Promise<string> {
  const pageUrl = rawPage.url().toLowerCase();
  const isBookingComPage =
    pageUrl.includes("booking.com") ||
    pageUrl.includes("secure.booking.com");
  const texts = await Promise.all(
    getInteractionScopes(rawPage).map(async (scope) => {
      try {
        return await scope.evaluate((bookingCom) => {
          const text = (document.body?.innerText ?? "").toLowerCase();
          if (!bookingCom) return text.slice(0, 12000);
          if (text.length <= 32000) return text;
          const head = text.slice(0, 18000);
          const tail = text.slice(-14000);
          return `${head}\n${tail}`;
        }, isBookingComPage) as string;
      } catch {
        return "";
      }
    })
  );

  let combined = texts.filter(Boolean).join("\n");

  const bookingKeywordsPresent =
    combined.includes("review and pay") ||
    combined.includes("book now") ||
    combined.includes("reserve now") ||
    combined.includes("card number") ||
    combined.includes("credit card") ||
    combined.includes("expiry") ||
    combined.includes("guarantee policy") ||
    combined.includes("cancellation policy") ||
    combined.includes("check-in") ||
    combined.includes("checkout");

  if (!bookingKeywordsPresent) {
    if (false) try {
      const snapshot = await (rawPage as unknown as {
        accessibility: { snapshot(): Promise<unknown> }
      }).accessibility.snapshot();
      if (snapshot) {
        combined += "\n" + JSON.stringify(snapshot).toLowerCase().slice(0, 30000);
      }
    } catch {
      // Ignore snapshot fallback failures.
    }
  }

  return combined;
}

export async function hasValueInScopes(rawPage: Page, expected: string): Promise<boolean> {
  if (!expected) return false;

  const normalizedExpected = normalizeText(expected);
  const digitExpected = normalizeDigits(expected);

  for (const scope of getInteractionScopes(rawPage)) {
    try {
      const matched = await scope.evaluate(
        ({ normalizedExpected, digitExpected }) => {
          const normalizeText = (value: string) =>
            value.toLowerCase().replace(/\s+/g, " ").trim();
          const normalizeDigits = (value: string) => value.replace(/\D+/g, "");
          const isVisible = (element: Element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0" &&
              rect.width > 0 &&
              rect.height > 0
            );
          };

          return Array.from(
            document.querySelectorAll("input, textarea, select")
          ).some((element) => {
            if (!isVisible(element)) return false;
            const value = (element as HTMLInputElement).value ?? "";
            const normalizedValue = normalizeText(value);
            const digitValue = normalizeDigits(value);

            if (normalizedExpected && normalizedValue.includes(normalizedExpected)) {
              return true;
            }

            return digitExpected.length >= 4 && digitValue.includes(digitExpected);
          });
        },
        { normalizedExpected, digitExpected }
      );

      if (matched) return true;
    } catch {
      // Ignore cross-origin/frame access issues and keep scanning.
    }
  }

  return false;
}
