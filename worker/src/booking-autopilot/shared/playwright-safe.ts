import type { Page } from "playwright";
import { normalizeLooseText } from "./field-utils";

export async function waitForEvaluateCondition<TArg>(
  rawPage: Page,
  evaluator: (arg: TArg) => boolean,
  arg: TArg,
  timeoutMs = 6000,
  intervalMs = 200
): Promise<boolean> {
  const candidate = rawPage as Page & {
    evaluate?: <TResult, TEvalArg>(
      pageFunction: (arg: TEvalArg) => TResult,
      arg: TEvalArg
    ) => Promise<TResult>;
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = await candidate.evaluate?.(evaluator, arg).catch(() => false);
    if (matched) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export async function waitForPageSignals(
  rawPage: Page,
  options: {
    fromUrl?: string;
    untilUrlIncludes?: string[];
    untilUrlExcludes?: string[];
    untilTextIncludes?: string[];
    untilTextExcludes?: string[];
    timeoutMs?: number;
  } = {}
): Promise<boolean> {
  const {
    fromUrl,
    untilUrlIncludes = [],
    untilUrlExcludes = [],
    untilTextIncludes = [],
    untilTextExcludes = [],
    timeoutMs = 6000,
  } = options;

  return waitForEvaluateCondition(
    rawPage,
    ({ fromUrl, untilUrlIncludes, untilUrlExcludes, untilTextIncludes, untilTextExcludes }) => {
      const href = window.location.href.toLowerCase();
      const text = (document.body?.innerText ?? "").toLowerCase();

      const urlChanged = !!fromUrl && href !== fromUrl.toLowerCase();
      const urlIncludesOk =
        untilUrlIncludes.length === 0 || untilUrlIncludes.some((pattern) => href.includes(pattern));
      const urlExcludesOk =
        untilUrlExcludes.length === 0 || untilUrlExcludes.every((pattern) => !href.includes(pattern));
      const textIncludesOk =
        untilTextIncludes.length === 0 || untilTextIncludes.some((pattern) => text.includes(pattern));
      const textExcludesOk =
        untilTextExcludes.length === 0 || untilTextExcludes.every((pattern) => !text.includes(pattern));

      return urlChanged || (urlIncludesOk && urlExcludesOk && textIncludesOk && textExcludesOk);
    },
    {
      fromUrl,
      untilUrlIncludes: untilUrlIncludes.map((value) => value.toLowerCase()),
      untilUrlExcludes: untilUrlExcludes.map((value) => value.toLowerCase()),
      untilTextIncludes: untilTextIncludes.map((value) => value.toLowerCase()),
      untilTextExcludes: untilTextExcludes.map((value) => value.toLowerCase()),
    },
    timeoutMs
  );
}

export async function waitForVisibleActionText(
  rawPage: Page,
  texts: string[],
  timeoutMs = 4000
): Promise<boolean> {
  const normalizedTexts = texts.map((value) => normalizeLooseText(value));
  return waitForEvaluateCondition(
    rawPage,
    (patterns) => {
      const normalize = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      return Array.from(document.querySelectorAll("button, a, [role='button']")).some((element) => {
        if (!isVisible(element)) return false;
        const text = normalize(element.textContent ?? "");
        return patterns.some((pattern) => text.includes(pattern));
      });
    },
    normalizedTexts,
    timeoutMs
  );
}

export async function safePressEscape(rawPage: Page): Promise<void> {
  try {
    const candidate = rawPage as Page & {
      keyboard?: { press?: (key: string) => Promise<unknown> };
    };
    if (candidate.keyboard?.press) {
      await candidate.keyboard.press("Escape");
      return;
    }
  } catch {
    // Fall through to DOM-dispatch fallback.
  }

  await rawPage.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true, cancelable: true }));
  }).catch(() => {});
}

export async function safeMouseClick(rawPage: Page, x: number, y: number): Promise<void> {
  try {
    const candidate = rawPage as Page & {
      mouse?: { click?: (x: number, y: number, options?: { delay?: number }) => Promise<unknown> };
    };
    if (candidate.mouse?.click) {
      await candidate.mouse.click(x, y, { delay: 80 });
      return;
    }
  } catch {
    // Fall through to DOM-dispatch fallback.
  }

  await rawPage.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!element) return;
      const options = { bubbles: true, cancelable: true, clientX: x, clientY: y };
      element.dispatchEvent(new MouseEvent("pointerdown", options));
      element.dispatchEvent(new MouseEvent("mousedown", options));
      element.dispatchEvent(new MouseEvent("mouseup", options));
      element.dispatchEvent(new MouseEvent("click", options));
      element.click?.();
    },
    { x, y }
  ).catch(() => {});
}
