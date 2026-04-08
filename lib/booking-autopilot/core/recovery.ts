import type { Page } from "playwright";
import { COMMON_DISALLOWED_ADVANCE_BUTTONS, type BookingStage } from "./stages";

export interface RecoveryDependencies {
  getInteractionScopes: (rawPage: Page) => Array<Page | ReturnType<Page["mainFrame"]>>;
  isVisible: (locator: ReturnType<Page["locator"]>) => Promise<boolean>;
  isLocatorEnabled: (locator: ReturnType<Page["locator"]>) => Promise<boolean>;
  evaluateLocatorElement: <T>(
    locator: ReturnType<Page["locator"]>,
    pageFunction: (element: Element) => T
  ) => Promise<T>;
  getLocatorText: (locator: ReturnType<Page["locator"]>) => Promise<string>;
  clickLocatorDom: (locator: ReturnType<Page["locator"]>) => Promise<void>;
  normalizeText: (value: string) => string;
}

export function buildStageRecoveryInstruction(stage: BookingStage): string {
  switch (stage) {
    case "date_selection":
      return `Continue the CURRENT hotel booking from the booking widget.

The requested dates are already selected.
Click only the booking widget button that advances the flow, such as "Next" or "Continue", near the selected dates / guests summary.
Do NOT click generic page controls like "Next Slide", page carousels, gallery arrows, or site navigation.`;
    case "room_selection":
      return `Continue the CURRENT hotel booking from the room-selection step.

Choose the best available room or rate inside the booking widget, then click only the booking widget button that advances to checkout, such as "Select", "Select room", "Proceed to payment", or "Continue".
Do NOT click "Add more rooms", page carousels, gallery arrows, or site navigation.`;
    case "intermediate_gate":
      return `Continue the CURRENT hotel booking from the review-and-pay gate.

If a privacy-policy or terms checkbox is present, check it.
Then click the intermediate booking button inside the widget, such as "Book Now" or "Reserve Now", to reach the actual guest/payment form.
Do NOT stop at the review summary and do NOT treat this as the final payment step yet.`;
    default:
      return `Continue the CURRENT hotel booking from the current booking widget state and advance to the actual guest/payment form without using generic page controls.`;
  }
}

export async function clickAllowedAdvanceButton(
  rawPage: Page,
  buttonNames: RegExp[],
  deps: RecoveryDependencies,
  options?: {
    dryRun?: boolean;
    excludeText?: RegExp[];
    skipEnabledCheck?: boolean;
  }
): Promise<string | null> {
  const scopes = deps.getInteractionScopes(rawPage);
  const dryRun = options?.dryRun ?? false;
  const excludeText = options?.excludeText ?? COMMON_DISALLOWED_ADVANCE_BUTTONS;
  const skipEnabledCheck = options?.skipEnabledCheck ?? false;

  for (const scope of scopes) {
    try {
      const buttons = scope.locator('button, [role="button"], input[type="submit"], a');
      const count = Math.min(await buttons.count().catch(() => 0), 40);

      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        if (!(await deps.isVisible(button))) continue;
        if (!skipEnabledCheck && !(await deps.isLocatorEnabled(button))) continue;

        const primaryText = deps.normalizeText(
          await deps.evaluateLocatorElement(button, (element) => {
            const htmlElement = element as HTMLElement;
            if (element instanceof HTMLInputElement) {
              return element.value ?? "";
            }
            return (
              htmlElement.innerText ||
              htmlElement.textContent ||
              htmlElement.getAttribute("aria-label") ||
              htmlElement.getAttribute("title") ||
              ""
            );
          }).catch(() => "")
        );
        const fullText = deps.normalizeText(await deps.getLocatorText(button));
        if (excludeText.some((pattern) => pattern.test(primaryText) || pattern.test(fullText))) {
          continue;
        }
        if (!buttonNames.some((buttonName) => buttonName.test(primaryText) || buttonName.test(fullText))) {
          continue;
        }

        if (!dryRun) {
          await button.click({ force: true }).catch(async () => {
            await deps.clickLocatorDom(button);
          });
        }
        return primaryText || fullText || "<unnamed button>";
      }
    } catch {
      // Try the next scope.
    }
  }

  return null;
}

export async function clickAdvanceButton(
  rawPage: Page,
  buttonNames: RegExp[],
  deps: RecoveryDependencies,
  dryRun = false
): Promise<string | null> {
  return clickAllowedAdvanceButton(rawPage, buttonNames, deps, {
    dryRun,
    excludeText: [],
    skipEnabledCheck: true,
  });
}
