"""
Ticketmaster Browser Harness Spike — provider-debug / adaptation lab.

Goal: discover stable DOM/URL/ARIA/text/iframe signals for the Activity lane
(Ticketmaster — The Lion King NYC) so an Onegent L1 patch and a future L2
Browser Harness fallback can be designed.

Hard rules (per spike spec):
  - Do NOT modify Onegent production runtime (read-only on this side).
  - Do NOT touch .env / secrets / account credentials.
  - Do NOT submit checkout / Place Order.
  - Do NOT click final purchase. STOP at sign-in / account boundary.
  - Prefer stable DOM/URL/ARIA/text/iframe signals over pixel coords.

Run via:
  BU_CDP_URL=http://127.0.0.1:9333 \
    SPIKE_OUT=docs/spikes/ticketmaster-harness-spike-20260506 \
    browser-harness -c "$(cat scripts/browser-harness-spike/spike.py)"

Outputs (under SPIKE_OUT):
  - 01_artist_calendar.png  + accompanying signals in events.jsonl
  - 02_event_page.png       + signals
  - events.jsonl            (one JSON object per recorded step)

Browser Harness helpers used:
  goto_url, wait_for_load, page_info, capture_screenshot, js
"""

import json
import os
import time

# ─── config ────────────────────────────────────────────────────────────────
ARTIST_URL = "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581"
# Known-good event URL recovered from earlier worker.log (May 30 2026, 2:00 PM
# matinée). Direct goto bypasses the calendar click — the spike's goal is to
# map signals at each surface, not to re-prove the calendar click works.
EVENT_URL = "https://www.ticketmaster.com/the-lion-king-new-york-ny-new-york-new-york-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea"

OUT_DIR = os.environ.get("SPIKE_OUT") or "docs/spikes/ticketmaster-harness-spike-20260506"
os.makedirs(OUT_DIR, exist_ok=True)
EVENTS_PATH = os.path.join(OUT_DIR, "events.jsonl")


def emit(event_type, **kwargs):
    """Append one JSONL row to events.jsonl. Schema mirrors the proposed
    Onegent ExecutionEvent shape (subset — spike-only fields)."""
    row = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "layer": "browser_harness",
        "provider": "ticketmaster",
        "event_type": event_type,
        **kwargs,
    }
    with open(EVENTS_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"[{event_type}] " + json.dumps({k: v for k, v in kwargs.items() if k != "signals"})[:200])


# ─── DOM signal extractor ──────────────────────────────────────────────────
# Single string-source IIFE (no closure-vars, no async) so it works both via
# Browser Harness js() and via CDP Runtime.evaluate.
SIGNAL_PROBE = r"""
(function(){
  function isVis(el){ var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function txt(el){ return ((el.textContent||'').replace(/\s+/g,' ').trim()).slice(0,80); }

  // ── URL / title ──
  var url = location.href;
  var title = document.title;

  // ── Iframes (host + src; useful for L1 Find-Tickets fix and CC iframe locator) ──
  var iframes = Array.from(document.querySelectorAll('iframe')).map(function(f){
    var s = f.getAttribute('src') || '';
    return { src: s.slice(0,160), id: f.id || null, title: f.getAttribute('title') || null,
             w: f.clientWidth, h: f.clientHeight };
  }).slice(0,12);

  // ── Sign-in / account boundary ──
  var hasSignInHeading = !!Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'))
    .find(function(el){ return /sign in or create account|sign in|create account/i.test((el.textContent||'').trim()); });
  var hasEmailInput = !!document.querySelector('input[type="email"], input[name="email" i], input[id*="email" i], input[autocomplete="email"]');

  // ── Calendar / event-list indicators ──
  var calendarOpenLink = (function(){
    var hits = Array.from(document.querySelectorAll('a, button, [role="button"]'))
      .filter(isVis)
      .filter(function(el){ return /show events in calendar/i.test(txt(el)); });
    return hits[0] ? txt(hits[0]) : null;
  })();
  var monthTabs = Array.from(document.querySelectorAll('[aria-label][role="tab"], button[aria-label]'))
    .filter(isVis)
    .map(function(el){ return el.getAttribute('aria-label'); })
    .filter(function(a){ return a && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(a); })
    .slice(0,8);

  // ── Find Tickets anchors (the iframe-vs-main bug area) ──
  var findTicketsAnchors = Array.from(document.querySelectorAll('a'))
    .filter(isVis)
    .filter(function(a){ return /find tickets|buy tickets|get tickets/i.test(txt(a)); })
    .map(function(a){
      return {
        text: txt(a),
        href: (a.getAttribute('href')||'').slice(0,160),
        outerHtml: (a.outerHTML||'').slice(0,260)
      };
    })
    .slice(0,5);

  // ── Seat map / Reserve ──
  var hasSeatMapCanvas = !!document.querySelector('canvas, [data-testid*="seat" i], iframe[src*="seat" i], [class*="seat-map" i]');
  var hasYourTicketsPanel = /your tickets/i.test(document.body ? document.body.innerText : '');
  var hasSubtotal = /subtotal/i.test(document.body ? document.body.innerText : '');
  var reserveBtnInfo = (function(){
    var btns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(isVis);
    var hit = btns.find(function(el){
      var t = (el.textContent||'').trim().toLowerCase();
      return t.indexOf('reserve tickets') === 0 || t.indexOf('reserve seats') === 0 ||
             t.indexOf('continue to checkout') === 0 || t === 'reserve';
    });
    if (!hit) return null;
    return {
      text: txt(hit),
      tag: hit.tagName,
      ariaDisabled: hit.getAttribute('aria-disabled'),
      disabled: hit.disabled === true,
      hasDisabledAttr: hit.hasAttribute('disabled')
    };
  })();

  // ── Conditions of Purchase checkbox (checkout page) ──
  var conditionsCheckbox = (function(){
    var boxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(isVis);
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var lt = (box.getAttribute('aria-label') || '');
      var lb = box.getAttribute('aria-labelledby');
      if (lb) { var lbe = document.getElementById(lb); lt += ' ' + (lbe ? (lbe.textContent || '') : ''); }
      var p = box.parentElement;
      for (var j = 0; p && j < 4; j++) { lt += ' ' + (p.textContent || ''); p = p.parentElement; }
      if (/agree|terms|conditions of purchase|purchase polic/i.test(lt)) {
        return { checked: box.checked === true, aria: box.getAttribute('aria-label')||null,
                 nameAttr: box.getAttribute('name')||null, dataTestid: box.getAttribute('data-testid')||null };
      }
    }
    return null;
  })();

  // ── Proceed-to-Payment / payment surface ──
  var proceedBtn = (function(){
    var nodes = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(isVis);
    var hit = nodes.find(function(el){
      var t = (el.textContent||'').trim().toLowerCase();
      return t === 'proceed to payment' || t.indexOf('proceed to payment') === 0;
    });
    if (!hit) return null;
    return { text: txt(hit), tag: hit.tagName, disabled: hit.disabled === true, hasDisabledAttr: hit.hasAttribute('disabled') };
  })();

  // ── Top visible button/anchor labels (general DOM dump) ──
  var topControls = Array.from(document.querySelectorAll('a, button, [role="button"], [role="link"]'))
    .filter(isVis)
    .slice(0, 30)
    .map(function(el){ return { tag: el.tagName, text: txt(el), aria: (el.getAttribute('aria-label')||'').slice(0,60) }; });

  return {
    url: url, title: title,
    iframes: iframes, iframeCount: iframes.length,
    hasSignInHeading: hasSignInHeading, hasEmailInput: hasEmailInput,
    calendarOpenLink: calendarOpenLink, monthTabs: monthTabs,
    findTicketsAnchors: findTicketsAnchors,
    hasSeatMapCanvas: hasSeatMapCanvas, hasYourTicketsPanel: hasYourTicketsPanel, hasSubtotal: hasSubtotal,
    reserveBtnInfo: reserveBtnInfo,
    conditionsCheckbox: conditionsCheckbox,
    proceedBtn: proceedBtn,
    topControls: topControls
  };
})()
"""


def capture_step(step_name, screenshot_filename):
    """Run signal probe + capture a screenshot. Both the screenshot path and
    the signal blob are emitted as one JSONL event."""
    info = page_info()  # noqa: F821 — pre-imported by browser-harness
    shot_path = os.path.join(OUT_DIR, screenshot_filename)
    capture_screenshot(shot_path, max_dim=1800)  # noqa: F821
    try:
        signals = js(SIGNAL_PROBE)  # noqa: F821
    except Exception as exc:
        signals = {"_probe_error": str(exc)[:200]}
    emit(
        "step_captured",
        step=step_name,
        url=info.get("url"),
        title=info.get("title"),
        viewport=[info.get("w"), info.get("h")],
        screenshot=os.path.relpath(shot_path, "."),
        signals=signals,
    )
    return signals


# ─── flow ──────────────────────────────────────────────────────────────────
def main():
    emit("spike_started",
         message="Ticketmaster Browser Harness spike (no account cookies, isolated profile)",
         artist_url=ARTIST_URL, event_url=EVENT_URL, out_dir=OUT_DIR)

    # 1. Artist calendar page
    new_tab(ARTIST_URL)  # noqa: F821
    wait_for_load(timeout=20)  # noqa: F821
    time.sleep(2.0)  # let lazy-loaded sidebar/widget render
    s1 = capture_step("artist_calendar", "01_artist_calendar.png")

    # Hard stop check: TM may push to auth even on artist page if logged-out
    # session is treated as bot. Don't proceed if so.
    if s1.get("hasSignInHeading") or "auth.ticketmaster" in (s1.get("url") or ""):
        emit("manual_checkpoint", step="artist_calendar",
             reason="Sign-in / account boundary detected on artist page; spike stops here.")
        return

    # 2. Direct goto event page (skip calendar interaction — we already have
    # plenty of signal data for the calendar surface from worker.log archives)
    goto_url(EVENT_URL)  # noqa: F821
    wait_for_load(timeout=25)  # noqa: F821
    time.sleep(3.0)
    s2 = capture_step("event_page", "02_event_page.png")

    if s2.get("hasSignInHeading") or "auth.ticketmaster" in (s2.get("url") or ""):
        emit("manual_checkpoint", step="event_page",
             reason="Sign-in / account boundary detected on event page; spike stops here.")
        return

    # 3. Probe again 6s later — TM lazy-loads the seat map iframe; we want to
    # see whether seat-map DOM appears for a logged-out session.
    time.sleep(6.0)
    s3 = capture_step("event_page_after_render", "03_event_page_after_render.png")

    if s3.get("hasSignInHeading") or "auth.ticketmaster" in (s3.get("url") or ""):
        emit("manual_checkpoint", step="event_page_after_render",
             reason="Sign-in boundary appeared during seat-map render; spike stops here.")
        return

    # 4. STOP — we do NOT click reserve, do NOT pick a seat, do NOT navigate to
    # checkout. Spike's purpose is signal mapping, not booking.
    emit("manual_checkpoint", step="end",
         reason="Spike completed signal capture; manual checkpoint reached "
                "(seat selection requires user action, not automation).")


main()
