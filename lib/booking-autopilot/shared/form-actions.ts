import type { Page } from "playwright";
import {
  evaluateLocatorElement,
  fillLocator,
  findVisibleField,
  getInteractionScopes,
  getLocatorText,
  getScopeUrl,
  isLikelyBookingScopeUrl,
  isVisible,
  normalizeText,
} from "./field-utils";

type FieldSpec = { patterns: string[]; value: string };

export async function fillFieldsInScopes(rawPage: Page, specs: FieldSpec[]): Promise<boolean> {
  let filledAny = false;

  for (const { patterns, value } of specs) {
    const locator = await findVisibleField(rawPage, patterns);
    if (!locator) continue;

    const filled = await fillLocator(locator, value);
    if (!filled) continue;

    filledAny = true;
    await locator.blur().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return filledAny;
}

export async function clickAgreementCheckboxes(rawPage: Page): Promise<number> {
  const scopes = getInteractionScopes(rawPage);
  const patterns = ["privacy policy", "terms", "cancellation policy", "i agree"];
  let checkedCount = 0;

  for (const scope of scopes) {
    try {
      const checkboxes = scope.locator('input[type="checkbox"], [role="checkbox"]');
      const count = Math.min(await checkboxes.count().catch(() => 0), 20);

      for (let index = 0; index < count; index += 1) {
        const checkbox = checkboxes.nth(index);
        if (!(await isVisible(checkbox))) continue;
        const checkedState = await evaluateLocatorElement(checkbox, (element) => {
          if (element instanceof HTMLInputElement && element.type === "checkbox") {
            return element.checked;
          }
          const ariaChecked = element.getAttribute("aria-checked");
          return ariaChecked === "true";
        }).catch(() => false);
        if (checkedState) continue;

        const text = normalizeText(
          await evaluateLocatorElement(checkbox, (element) => {
            const htmlElement = element as HTMLElement;
            const ownText =
              htmlElement.innerText ||
              htmlElement.textContent ||
              htmlElement.getAttribute("aria-label") ||
              "";
            const containerText =
              htmlElement.closest("label, div, section, form")?.textContent ?? "";
            return `${ownText} ${containerText}`;
          }).catch(async () => await getLocatorText(checkbox))
        );
        if (!patterns.some((pattern) => text.includes(pattern))) continue;

        const wasChecked = checkedState;
        await checkbox.check({ force: true }).catch(async () => {
          await checkbox.click({ force: true });
        });
        const isCheckedNow = await evaluateLocatorElement(checkbox, (element) => {
          if (element instanceof HTMLInputElement && element.type === "checkbox") {
            return element.checked;
          }
          const ariaChecked = element.getAttribute("aria-checked");
          return ariaChecked === "true";
        }).catch(() => false);
        if (!wasChecked && isCheckedNow) checkedCount += 1;
      }
    } catch {
      // Ignore and continue checking other consent boxes.
    }

    try {
      const checkedInDom = await scope.evaluate(() => {
        const matchesConsentText = (value: string) =>
          /privacy policy|terms|cancellation policy|i agree/i.test(value);
        const isChecked = (element: Element) => {
          if (element instanceof HTMLInputElement && element.type === "checkbox") {
            return element.checked;
          }
          return element.getAttribute("aria-checked") === "true";
        };
        let clicked = 0;

        const asElementArray = <T extends Element>(list: NodeListOf<T> | HTMLCollectionOf<T>) =>
          Array.from(list) as T[];

        const labels = asElementArray(document.querySelectorAll("label"));
        for (const label of labels) {
          const text = label.textContent ?? "";
          if (!matchesConsentText(text)) continue;

          const htmlFor = label.getAttribute("for");
          let checkbox: HTMLInputElement | null = null;

          if (htmlFor) {
            checkbox = document.getElementById(htmlFor) as HTMLInputElement | null;
          }

          checkbox ||= label.querySelector('input[type="checkbox"]');

          if (checkbox && !checkbox.checked) {
            (label as HTMLElement).click();
            if (!checkbox.checked) checkbox.click();
            if (checkbox.checked) clicked += 1;
          }
        }

        const checkboxes = asElementArray(
          document.querySelectorAll<Element>('input[type="checkbox"], [role="checkbox"]')
        );

        for (const checkbox of checkboxes) {
          if (isChecked(checkbox)) continue;
          const parentText = checkbox.closest("label, div, section, form")?.textContent ?? "";
          if (matchesConsentText(parentText)) {
            const label = checkbox.closest("label");
            if (label instanceof HTMLElement) label.click();
            if (checkbox instanceof HTMLElement) checkbox.click();
            if (isChecked(checkbox)) clicked += 1;
          }
        }

        return clicked;
      });
      checkedCount += checkedInDom;
    } catch {
      // Ignore DOM fallback issues and continue.
    }
  }

  if (checkedCount === 0) {
    for (const scope of getInteractionScopes(rawPage)) {
      const scopeUrl = getScopeUrl(scope);
      if (!isLikelyBookingScopeUrl(scopeUrl)) continue;
      try {
        const checkboxes = scope.locator('input[type="checkbox"]');
        const count = Math.min(await checkboxes.count().catch(() => 0), 10);
        for (let index = 0; index < count; index += 1) {
          const checkbox = checkboxes.nth(index);
          if (!(await checkbox.isVisible({ timeout: 600 }).catch(() => false))) continue;
          if (await checkbox.isChecked({ timeout: 600 }).catch(() => false)) continue;
          await checkbox.check({ force: true }).catch(async () => {
            await checkbox.click({ force: true }).catch(() => {});
          });
          const nowChecked = await checkbox.isChecked({ timeout: 600 }).catch(() => false);
          if (nowChecked) checkedCount += 1;
        }
      } catch {
        // Ignore per-frame errors - best-effort only.
      }
    }
  }

  return checkedCount;
}
