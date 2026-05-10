import type { LabTestPlanEntry } from "./types";

export const STAGE0B_HARNESS_SENTINEL_START = "ONEGENT_STAGE0B_RESULT_START";
export const STAGE0B_HARNESS_SENTINEL_END = "ONEGENT_STAGE0B_RESULT_END";

const INSPECT_JS = String.raw`
(() => {
  const body = document.body;
  const rawText = body ? (body.innerText || "") : "";
  const text = rawText.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const title = (document.querySelector("h1")?.textContent || document.title || "").replace(/\s+/g, " ").trim();
  const normalizeWords = (value) => value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const targetTokens = normalizeWords(title)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !/^(ticket|tickets|event|events|tour|live|show|shows|find|your|presents|official|page)$/.test(token))
    .slice(0, 8);
  const requiresTargetMatch = /ticketmaster\./i.test(location.hostname) && /\/(?:artist|venue)\//i.test(location.pathname);
  const labelMatchesTarget = (label) => {
    if (!requiresTargetMatch || targetTokens.length === 0) return true;
    const normalizedLabel = normalizeWords(label);
    return targetTokens.some((token) => normalizedLabel.includes(token));
  };
  const labelHasDateSignal = (label) =>
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z.]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?|\b\d{4}-\d{2}-\d{2}\b/i.test(label);
  const linkLooksLikeSeatGeekEvent = (link, label) => {
    if (!/seatgeek\.com/i.test(location.hostname)) return false;
    try {
      const parsed = new URL(link || "", location.href);
      if (!/seatgeek\.com$/i.test(parsed.hostname)) return false;
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts.length < 1) return false;
      return labelHasDateSignal(label || "") || /\b\d{4}-\d{2}-\d{2}-(?:\d{1,2})-(?:am|pm)\b/i.test(parsed.pathname);
    } catch {
      return false;
    }
  };
  const linkLooksLikeStubHubEvent = (link) => {
    if (!/stubhub\.com$/i.test(location.hostname)) return false;
    try {
      const parsed = new URL(link || "", location.href);
      return /stubhub\.com$/i.test(parsed.hostname) && /\/event\/\d+/i.test(parsed.pathname);
    } catch {
      return false;
    }
  };
  const linkLooksLikeEventbriteEvent = (link) => {
    if (!/eventbrite\.com$/i.test(location.hostname)) return false;
    try {
      const parsed = new URL(link || "", location.href);
      return /eventbrite\.com$/i.test(parsed.hostname) && /\/e\//i.test(parsed.pathname) && /(?:tickets-)?\d{8,}$/i.test(parsed.pathname);
    } catch {
      return false;
    }
  };
  const linkLooksLikeProviderEvent = (link, label, buttonText) => {
    if (!/ticketmaster\./i.test(location.hostname) || !requiresTargetMatch) return true;
    try {
      const parsed = new URL(link || "", location.href);
      if (/ticketmaster\./i.test(parsed.hostname) && /\/event\//i.test(parsed.pathname)) return true;
    } catch {
      // Some Ticketmaster artist pages render Find Tickets as a button without
      // an event href in the static DOM. The visible row label is still useful
      // user-choice evidence when it names the target and carries a date.
    }
    return /find tickets|view seats|see tickets|get tickets|buy tickets/i.test(buttonText || "") &&
      labelHasDateSignal(label || "");
  };
  const clickableElements = Array.from(document.querySelectorAll("button,a,[role='button']"))
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const textValue = (el.textContent || "").replace(/\s+/g, " ").trim();
      return {
        text: textValue,
        href: el instanceof HTMLAnchorElement ? el.href : "",
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        visible: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth,
      };
    })
    .filter((item) => item.text);
  const buttonTexts = clickableElements
    .map((item) => item.text)
    .filter(Boolean)
    .slice(0, 80);
  const buttonLower = buttonTexts.join("\n").toLowerCase();
  const findTicketButtons = clickableElements.filter((item) => /find tickets|view seats|see tickets|get tickets|buy tickets/i.test(item.text));
  const ignoredTicketmasterCandidate = (label) =>
    /parking|pre-?show|lounge access|club access|special entry|hotel deals|find my hotel|add-ons?/i.test(label || "");
  const eventCandidates = findTicketButtons
    .map((item) => {
      const element = Array.from(document.querySelectorAll("button,a,[role='button']"))
        .find((el) => (el.textContent || "").replace(/\s+/g, " ").trim() === item.text);
      const container = element?.closest?.("li, article, section, [data-testid*='event'], [class*='event'], [class*='Event'], [class*='card'], [class*='Card']") || element?.parentElement;
      const label = (container?.textContent || item.text || "")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "")
        .slice(0, 500);
      const link = item.href || (container?.querySelector?.("a[href]")?.href || "");
      return { label, link, text: item.text, href: item.href, x: item.x, y: item.y, visible: item.visible };
    })
    .filter((item) =>
      item.label &&
      !/ticketmaster home page|skip to main content|search|help|gift cards|sell|fans also viewed/i.test(item.label) &&
      !ignoredTicketmasterCandidate(item.label) &&
      labelMatchesTarget(item.label) &&
      linkLooksLikeProviderEvent(item.link, item.label, item.text)
    );
  const eventInfoLinkCandidates = Array.from(document.querySelectorAll("a[href]"))
    .map((link) => {
      const href = link.href || "";
      const label = (link.textContent || link.getAttribute("aria-label") || link.getAttribute("title") || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      const rect = link.getBoundingClientRect();
      return {
        label,
        link: href,
        text: label,
        href,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        visible: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth,
      };
    })
    .filter((item) => {
      if (!/ticketmaster\./i.test(location.hostname) || !requiresTargetMatch) return false;
      if (!item.label || ignoredTicketmasterCandidate(item.label)) return false;
      if (!labelMatchesTarget(item.label) || !labelHasDateSignal(item.label)) return false;
      try {
        const parsed = new URL(item.link, location.href);
        return /ticketmaster\./i.test(parsed.hostname) && /\/event\//i.test(parsed.pathname);
      } catch {
        return false;
      }
    });
  const seatGeekCardCandidates = Array.from(document.querySelectorAll("a[href]"))
    .map((link) => {
      const href = link.href || "";
      const container = link.closest?.("article,li,section,[data-testid*='event'],[class*='event'],[class*='Event'],[class*='card'],[class*='Card']") || link;
      const label = (container?.textContent || link.textContent || link.getAttribute("aria-label") || link.getAttribute("title") || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      const rect = link.getBoundingClientRect();
      return {
        label,
        link: href,
        text: label,
        href,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        visible: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth,
      };
    })
    .filter((item) =>
      item.visible &&
      item.label &&
      !/sign in|support|privacy|terms|developer|sell on seatgeek|download the app/i.test(item.label) &&
      linkLooksLikeSeatGeekEvent(item.link, item.label)
    );
  const stubHubCardCandidates = Array.from(document.querySelectorAll("a[href]"))
    .map((link) => {
      const href = link.href || "";
      const container = link.closest?.("article,li,section,[data-testid*='event'],[data-testid*='listing'],[class*='event'],[class*='Event'],[class*='card'],[class*='Card'],[class*='tile'],[class*='Tile']") || link;
      const label = (container?.textContent || link.textContent || link.getAttribute("aria-label") || link.getAttribute("title") || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      const rect = link.getBoundingClientRect();
      return {
        label,
        link: href,
        text: label,
        href,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        visible: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth,
      };
    })
    .filter((item) =>
      item.visible &&
      item.label &&
      !/sign in|privacy|terms|gift cards|sell tickets|support|download the app/i.test(item.label) &&
      linkLooksLikeStubHubEvent(item.link)
    );
  const eventbriteCardCandidates = Array.from(document.querySelectorAll("a[href]"))
    .map((link) => {
      const href = link.href || "";
      const container = link.closest?.("article,li,section,[data-testid*='event'],[data-testid*='card'],[class*='event'],[class*='Event'],[class*='card'],[class*='Card'],[class*='eds-event-card']") || link;
      const label = (container?.textContent || link.textContent || link.getAttribute("aria-label") || link.getAttribute("title") || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      const rect = link.getBoundingClientRect();
      return {
        label,
        link: href,
        text: label,
        href,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        visible: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth,
      };
    })
    .filter((item) =>
      item.visible &&
      item.label &&
      !/sign in|create event|help center|privacy|terms|sell tickets|organizer|download the app/i.test(item.label) &&
      linkLooksLikeEventbriteEvent(item.link)
    );
  const seenCandidateKeys = new Set();
  const allEventCandidates = [...eventCandidates, ...eventInfoLinkCandidates, ...seatGeekCardCandidates, ...stubHubCardCandidates, ...eventbriteCardCandidates]
    .filter((item) => {
      const key = item.link || item.label;
      if (!key || seenCandidateKeys.has(key)) return false;
      seenCandidateKeys.add(key);
      return true;
    })
    .slice(0, 20);
  const safeFollowTarget = findTicketButtons.find((item) =>
    item.visible &&
    !/sign in|log in|checkout|place order|confirm purchase|complete purchase|buy now|payment|card number/i.test(item.text)
  );
  const dateMatches = Array.from(text.matchAll(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z.]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?|\b\d{4}-\d{2}-\d{2}\b/gi))
    .map((match) => match[0])
    .slice(0, 20);
  const timeMatches = Array.from(text.matchAll(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b/gi))
    .map((match) => match[0])
    .slice(0, 20);
  const hardStops = [];
  const urlLower = location.href.toLowerCase();
  const stubHubCheckoutUrl = /checkout\.stubhub\.com/i.test(location.hostname) || /\/secure\/buy\/checkout/i.test(location.pathname);
  const eventPageLike = /\/event\//i.test(location.pathname);
  const authUrl = /auth\.ticketmaster|\/login|\/signin|\/account/.test(urlLower);
  const passwordFieldVisible = Array.from(document.querySelectorAll("input[type='password']")).some((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  const paymentInputVisible = Array.from(document.querySelectorAll("input,select,textarea")).some((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const haystack = [
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("autocomplete") || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("placeholder") || "",
      el.closest("label")?.textContent || "",
    ].join(" ").toLowerCase();
    return /card number|credit card|cc-number|cvv|cvc|security code|expiration|exp-date|billing address|name on card/.test(haystack);
  });
  const loginHeading = Array.from(document.querySelectorAll("h1,h2,[role='heading']"))
    .some((el) => /^(sign in|log in|login|create account|verify your account)$/i.test((el.textContent || "").trim()));
  const checkoutPaymentHeading = /checkout|order summary|subtotal|total due|place order|confirm purchase|complete purchase/.test(lower) &&
    /credit card|card number|billing address|payment method|cvv|expiration date/.test(lower);
  if (stubHubCheckoutUrl) {
    hardStops.push("payment_form_visible");
  }
  if (authUrl || passwordFieldVisible || loginHeading || /account required|verify your account/.test(lower)) {
    hardStops.push("login_or_signin_wall");
  }
  if (/captcha|recaptcha|hcaptcha|verify you are human|are you a real fan|security check|cloudflare/.test(lower)) {
    hardStops.push("captcha_or_challenge");
  }
  if (/one-time code|verification code|enter code|otp|two-factor|2fa|phone verification/.test(lower)) {
    hardStops.push("otp_or_phone_verification");
  }
  if (
    !stubHubCheckoutUrl &&
    (
      /select seats|choose seats|seat map/i.test(rawText) ||
      /how many tickets\?|you.?ll be seated together/i.test(rawText) ||
      (eventPageLike && /lowest price|best seats|standard tickets|sec\s+\d+[\s\S]{0,80}row\s+\w+/i.test(rawText)) ||
      /view seats|select seats|choose seats/i.test(buttonTexts.join(" "))
    )
  ) {
    hardStops.push("seat_selection_required");
  }
  if (paymentInputVisible || checkoutPaymentHeading) {
    hardStops.push("payment_form_visible");
  }
  if (/place order|confirm purchase|complete purchase|buy now|submit order/.test(buttonLower)) {
    hardStops.push("final_confirm_button");
  }
  if (/cookie/.test(lower) && /accept all|manage cookies|cookie settings/.test(buttonLower) && text.length < 1200) {
    hardStops.push("cookie_consent_blocking_render");
  }
  const notes = allEventCandidates.map((item) => item.label).slice(0, 20);
  if (/page requested could not be found|page not found|well,\s*this isn't right|we can't seem to find|something went wrong|try again later/.test(lower)) {
    notes.unshift("provider_error_page_visible");
  }
  if (/\bloading\b|please wait|hang tight/.test(lower)) {
    notes.unshift("loading_indicator_visible");
  }
  return {
    ok: true,
    currentUrl: location.href,
    title,
    visibleFacts: {
      title,
      visible_dates: dateMatches,
      visible_times: timeMatches,
      candidate_count: allEventCandidates.length,
      candidate_labels: allEventCandidates.map((item) => item.label),
      candidate_links: allEventCandidates.map((item) => item.link).filter(Boolean),
      notes,
    },
    safeFollowTarget,
    hardStops,
  };
})()
`;

export function buildBrowserHarnessPython(entry: LabTestPlanEntry, screenshotPath: string, keepOpen = false): string {
  return [
    "import json, traceback",
    `url = ${toPythonString(entry.url)}`,
    `screenshot_path = ${toPythonString(screenshotPath)}`,
    `expected_direct = ${entry.expected_resolver_execution_mode === "direct_execution" ? "True" : "False"}`,
    `keep_open = ${keepOpen ? "True" : "False"}`,
    `inspect_js = ${toPythonString(INSPECT_JS)}`,
    "payload = {}",
    "opened_target = None",
    "try:",
    "    opened_target = new_tab(url)",
    "    wait_for_load()",
    "    wait(3)",
    "    info = page_info()",
    "    observed = js(inspect_js)",
    "    payload = observed if isinstance(observed, dict) else {}",
    "    visible = payload.get('visibleFacts') if isinstance(payload.get('visibleFacts'), dict) else {}",
    "    candidate_count = visible.get('candidate_count') if isinstance(visible, dict) else 0",
    "    target = payload.get('safeFollowTarget') if isinstance(payload.get('safeFollowTarget'), dict) else None",
    "    if target and (expected_direct or candidate_count == 1):",
    "        click_at_xy(target.get('x'), target.get('y'))",
    "        wait_for_load()",
    "        wait(3)",
    "        after = js(inspect_js)",
    "        if isinstance(after, dict):",
    "            after['followedSafeLink'] = True",
    "            after['followTarget'] = {'text': target.get('text'), 'href': target.get('href')}",
    "            after['beforeFollowVisibleFacts'] = visible",
    "            payload = after",
    "    captured = capture_screenshot(screenshot_path, full=True)",
    "    payload['ok'] = True",
    "    payload['screenshotPath'] = captured or screenshot_path",
    "    if isinstance(info, dict):",
    "        payload.setdefault('currentUrl', info.get('url'))",
    "        payload.setdefault('title', info.get('title'))",
    "except Exception as exc:",
    "    captured = None",
    "    info = {}",
    "    try:",
    "        captured = capture_screenshot(screenshot_path, full=True)",
    "    except Exception:",
    "        captured = None",
    "    try:",
    "        info = page_info()",
    "    except Exception:",
    "        info = {}",
    "    payload = {'ok': False, 'error': str(exc), 'traceback': traceback.format_exc()}",
    "    if captured:",
    "        payload['screenshotPath'] = captured",
    "    if isinstance(info, dict):",
    "        payload['currentUrl'] = info.get('url')",
    "        payload['title'] = info.get('title')",
    "finally:",
    "    if opened_target and not keep_open:",
    "        try:",
    "            cdp('Target.closeTarget', targetId=opened_target)",
    "            payload['closedLabTab'] = True",
    "        except Exception as close_exc:",
    "            payload.setdefault('closeError', str(close_exc))",
    `print(${toPythonString(STAGE0B_HARNESS_SENTINEL_START)})`,
    "print(json.dumps(payload, ensure_ascii=False))",
    `print(${toPythonString(STAGE0B_HARNESS_SENTINEL_END)})`,
  ].join("\n");
}

function toPythonString(value: string): string {
  return JSON.stringify(value);
}
