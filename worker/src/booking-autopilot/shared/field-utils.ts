import type { Frame, Locator, Page } from "playwright";

type InteractionScope = Page | Frame;

/** URLs that are usually tracking, captcha, or other non-booking side frames. */
const NON_BOOKING_SCOPE_URL_PATTERNS = [
  /recaptcha/i,
  /google-analytics/i,
  /googletagmanager/i,
  /doubleclick/i,
  /applepay/i,
  /cdn-apple/i,
  /weglot/i,
  /accessibe/i,
  /acsbapp/i,
  /performance\.squarespace/i,
];

/** URLs that strongly suggest a real booking widget / checkout surface. */
const BOOKING_SCOPE_URL_PATTERNS = [
  /namastay/i,
  /booking/i,
  /checkout/i,
  /reservation/i,
  /reserve/i,
  /guest/i,
  /payment/i,
  /book/i,
  /engine/i,
  /stay/i,
];

export function getScopeUrl(scope: unknown): string {
  if (!scope || typeof scope !== "object") return "";

  const candidate = scope as {
    url?: (() => string) | string;
  };

  try {
    if (typeof candidate.url === "function") {
      return candidate.url();
    }
    if (typeof candidate.url === "string") {
      return candidate.url;
    }
  } catch {
    // Ignore and fall through.
  }

  return "";
}

export function isNoiseScopeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return NON_BOOKING_SCOPE_URL_PATTERNS.some((pattern) => pattern.test(lower));
}

export function isLikelyBookingScopeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return BOOKING_SCOPE_URL_PATTERNS.some((pattern) => pattern.test(lower));
}

export function getInteractionScopes(rawPage: Page): InteractionScope[] {
  const childFrames = rawPage.frames().filter((frame) => frame !== rawPage.mainFrame());
  const usableFrames = childFrames.filter((frame) => !isNoiseScopeUrl(getScopeUrl(frame)));
  const bookingFrames = usableFrames.filter((frame) => isLikelyBookingScopeUrl(getScopeUrl(frame)));
  const mainUrl = getScopeUrl(rawPage);
  const mainScope = isNoiseScopeUrl(mainUrl) ? [] : [rawPage];

  if (bookingFrames.length > 0) {
    return [...bookingFrames, ...(isLikelyBookingScopeUrl(mainUrl) ? mainScope : [])];
  }

  if (isLikelyBookingScopeUrl(mainUrl)) {
    return [...mainScope, ...usableFrames];
  }

  return [...usableFrames, ...mainScope];
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeLooseText(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

export async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible({ timeout: 800 }).catch(() => false);
}

export async function getLocatorElementHandle(locator: Locator) {
  const candidate = locator as Locator & {
    elementHandle?: () => Promise<{
      evaluate: <T, TArg = undefined>(
        pageFunction: (element: Element, arg: TArg) => T,
        arg?: TArg
      ) => Promise<T>;
      dispose?: () => Promise<void>;
    } | null>;
  };

  if (typeof candidate.elementHandle !== "function") return null;
  return candidate.elementHandle().catch(() => null);
}

export async function evaluateLocatorElement<T>(
  locator: Locator,
  pageFunction: (element: Element) => T
): Promise<T>;
export async function evaluateLocatorElement<T, TArg>(
  locator: Locator,
  pageFunction: (element: Element, arg: TArg) => T,
  arg: TArg
): Promise<T>;
export async function evaluateLocatorElement<T>(
  locator: Locator,
  pageFunction: (element: Element, arg?: unknown) => T,
  arg?: unknown
): Promise<T> {
  const candidate = locator as Locator & {
    evaluate?: <R, TArg = undefined>(
      pageFunction: (element: Element, arg: TArg) => R,
      arg?: TArg
    ) => Promise<R>;
  };

  if (typeof candidate.evaluate === "function") {
    return candidate.evaluate(pageFunction, arg);
  }

  const handle = await getLocatorElementHandle(locator);
  if (!handle) {
    throw new Error("Locator does not support element evaluation");
  }

  try {
    return await handle.evaluate(pageFunction, arg);
  } finally {
    await handle.dispose?.().catch(() => {});
  }
}

export async function clickLocatorDom(locator: Locator): Promise<void> {
  const handle = await getLocatorElementHandle(locator);
  if (!handle) {
    throw new Error("Locator does not support DOM click fallback");
  }

  try {
    await handle.evaluate((element) => {
      (element as HTMLElement).click();
    });
  } finally {
    await handle.dispose?.().catch(() => {});
  }
}

export async function isLocatorEnabled(locator: Locator): Promise<boolean> {
  return evaluateLocatorElement(locator, (element) => {
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement;
    const ariaDisabled = element.getAttribute("aria-disabled");
    if (ariaDisabled === "true") return false;
    if ("disabled" in control && control.disabled) return false;
    return true;
  }).catch(() => false);
}

export async function isEditable(locator: Locator): Promise<boolean> {
  if (!(await isVisible(locator))) return false;

  return evaluateLocatorElement(locator, (element) => {
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const ariaDisabled = element.getAttribute("aria-disabled");
    if (ariaDisabled === "true") return false;
    if ("disabled" in control && control.disabled) return false;
    if ("readOnly" in control && control.readOnly) return false;
    if (element instanceof HTMLInputElement) {
      return element.type !== "hidden";
    }
    return true;
  }).catch(() => false);
}

export async function fillLocator(locator: Locator, value: string): Promise<boolean> {
  try {
    const tagName = await evaluateLocatorElement(locator, (el) => el.tagName.toLowerCase());
    if (tagName === "select") {
      const select = locator as Locator;
      await select.selectOption({ label: value }).catch(async () => {
        await select.selectOption({ value }).catch(async () => {
          await locator.fill(value);
        });
      });
    } else {
      await locator.fill(value);
    }

    return true;
  } catch {
    return false;
  }
}

export async function getVisibleEditableFields(scope: InteractionScope): Promise<Locator[]> {
  const fields = scope.locator([
    'input:not([type])',
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="search"]',
    'input[type="number"]',
    'input[type="url"]',
    'input[type="password"]',
    'input[type="date"]',
    'input[type="month"]',
    "textarea",
    "select",
  ].join(", "));
  const count = Math.min(await fields.count().catch(() => 0), 100);
  const visibleFields: Locator[] = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = fields.nth(index);
    if (await isEditable(candidate)) {
      visibleFields.push(candidate);
    }
  }

  return visibleFields;
}

export async function getLocatorText(locator: Locator): Promise<string> {
  return evaluateLocatorElement(locator, (element) => {
    const htmlElement = element as HTMLElement;
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const labels =
      "labels" in control && control.labels
        ? Array.from(control.labels).map((label) => label.textContent ?? "")
        : [];

    const ariaLabel = htmlElement.getAttribute("aria-label") ?? "";
    const placeholder = "placeholder" in control ? control.placeholder ?? "" : "";
    const name = htmlElement.getAttribute("name") ?? "";
    const id = htmlElement.getAttribute("id") ?? "";
    const autocomplete = htmlElement.getAttribute("autocomplete") ?? "";
    const title = htmlElement.getAttribute("title") ?? "";
    const value = "value" in control ? control.value ?? "" : "";
    const textContent = htmlElement.textContent ?? "";
    const containerText = htmlElement.closest("label, fieldset")?.textContent ?? "";

    return [labels.join(" "), ariaLabel, placeholder, name, id, autocomplete, title, value, textContent, containerText]
      .filter(Boolean)
      .join(" ");
  }).catch(() => "");
}

export async function findVisibleField(
  rawPage: Page,
  patterns: string[]
): Promise<Locator | null> {
  const scopes = getInteractionScopes(rawPage);

  for (const scope of scopes) {
    const candidates = await getVisibleEditableFields(scope);
    for (const candidate of candidates) {
      const candidateText = normalizeText(await getLocatorText(candidate));
      for (const pattern of patterns) {
        if (candidateText.includes(normalizeText(pattern))) {
          return candidate;
        }
      }
    }
  }

  return null;
}
