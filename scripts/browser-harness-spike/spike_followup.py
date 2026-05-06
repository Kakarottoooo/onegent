"""Follow-up spike — fill 2 gaps:
   1. Artist page LIST mode: do <a href=".../event/..."> "Find Tickets" anchors
      appear after scroll? (initial probe got 0; suspect lazy/virtualized cards)
   2. Event page right panel: what tag/data-attr do the ticket cards use?
      (initial probe slice(0,30) was nav-only)
"""
import json, os, time

OUT_DIR = os.environ.get("SPIKE_OUT") or "docs/spikes/ticketmaster-harness-spike-20260506"
EVENTS_PATH = os.path.join(OUT_DIR, "events.jsonl")
ARTIST_URL = "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581"
EVENT_URL = "https://www.ticketmaster.com/the-lion-king-new-york-ny-new-york-new-york-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea"


def emit(et, **kw):
    row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "layer": "browser_harness", "provider": "ticketmaster", "event_type": et, **kw}
    with open(EVENTS_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"[{et}] " + json.dumps({k: v for k, v in kw.items() if k != "signals"})[:200])


# Probe A: scan ALL <a> on the page whose href contains "/event/" (the durable
# pattern). Also count event cards by class / data-attr.
EVENT_ANCHOR_PROBE = r"""
(function(){
  function isVis(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
  var allA = Array.from(document.querySelectorAll('a[href*="/event/"]'));
  var visA = allA.filter(isVis);
  var samples = visA.slice(0, 8).map(function(a){
    return {
      href: (a.getAttribute('href')||'').slice(0,160),
      text: ((a.textContent||'').replace(/\s+/g,' ').trim()).slice(0,80),
      ariaLabel: (a.getAttribute('aria-label')||'').slice(0,80),
      classOuter: (a.getAttribute('class')||'').split(' ').slice(0,3).join(' '),
      hasFindTicketsText: /find tickets|buy tickets|get tickets/i.test((a.textContent||'').trim())
    };
  });
  // Also count any "ticket card"-shaped element by common attrs
  var dataBdd = document.querySelectorAll('[data-bdd]').length;
  var dataTestid = document.querySelectorAll('[data-testid]').length;
  var dataTl = document.querySelectorAll('[data-tl-name]').length;
  return {
    totalEventAnchors: allA.length, visibleEventAnchors: visA.length,
    samples: samples,
    dataAttrCount: { bdd: dataBdd, testid: dataTestid, tlName: dataTl }
  };
})()
"""

# Probe B: on the event page, what shape are the ticket cards in the right panel?
# We look for any element with role=listitem, data-bdd="quick-picks", or text
# matching "Sec * • Row *".
TICKET_LIST_PROBE = r"""
(function(){
  function isVis(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
  function txt(el){return ((el.textContent||'').replace(/\s+/g,' ').trim()).slice(0,80);}

  // Strategy 1: data-bdd matches
  var bddNodes = Array.from(document.querySelectorAll('[data-bdd]'))
    .filter(isVis)
    .slice(0, 30)
    .map(function(el){
      return { tag: el.tagName, bdd: el.getAttribute('data-bdd'), text: txt(el),
               role: el.getAttribute('role')||null };
    });
  // Strategy 2: role=listitem
  var listItems = Array.from(document.querySelectorAll('[role="listitem"], [role="option"], li'))
    .filter(isVis)
    .slice(0, 20)
    .map(function(el){
      return { tag: el.tagName, role: el.getAttribute('role')||'(li)', text: txt(el).slice(0,60) };
    });
  // Strategy 3: text-match for "Sec X • Row Y"
  var allEls = Array.from(document.querySelectorAll('*')).filter(isVis);
  var ticketCards = allEls
    .filter(function(el){
      var t = (el.textContent || '').trim();
      return /^Sec\s+\w+\s*[•·•]\s*Row\s*\w+/i.test(t.slice(0, 60)) && el.children.length < 20;
    })
    .slice(0, 8)
    .map(function(el){
      var p = el;
      var path = el.tagName;
      for (var i = 0; i < 3 && p.parentElement; i++) {
        p = p.parentElement;
        path = p.tagName + (p.getAttribute('data-bdd')?'[data-bdd='+p.getAttribute('data-bdd')+']':'') + ' > ' + path;
      }
      return { tag: el.tagName, text: txt(el), parentPath: path,
               selfBdd: el.getAttribute('data-bdd')||null,
               selfTestid: el.getAttribute('data-testid')||null,
               role: el.getAttribute('role')||null };
    });

  // Strategy 4: look for "More Dates" sidebar
  var moreDatesText = (function(){
    var hits = Array.from(document.querySelectorAll('h1,h2,h3,h4,div,span'))
      .filter(isVis)
      .filter(function(el){ return /^More Dates$/.test((el.textContent||'').trim()); });
    return hits.length;
  })();
  // Time buttons in More Dates sidebar — should match e.g. "1:00 PM", "7:00 PM"
  var timeBtns = Array.from(document.querySelectorAll('button'))
    .filter(isVis)
    .filter(function(b){ return /^\s*\d{1,2}:\d{2}\s*(AM|PM)\s*$/.test((b.textContent||'').trim()); })
    .slice(0, 12)
    .map(function(b){ return { text: txt(b), ariaLabel: b.getAttribute('aria-label')||null,
                                bdd: b.getAttribute('data-bdd')||null, classes: (b.getAttribute('class')||'').slice(0,80) }; });

  return {
    bddNodesCount: bddNodes.length, bddSample: bddNodes,
    listItemsCount: listItems.length, listItemsSample: listItems,
    ticketCardsByText: ticketCards,
    moreDatesSidebarHits: moreDatesText,
    timeButtons: timeBtns
  };
})()
"""


def main():
    emit("followup_started", message="Probe gaps: list-mode event anchors + event-page card shape")

    # Phase A: artist page → wait → scroll → re-probe
    new_tab(ARTIST_URL)  # noqa
    wait_for_load(timeout=20)  # noqa
    time.sleep(3.0)
    js("window.scrollTo(0, 1200);")  # noqa
    time.sleep(2.5)
    capture_screenshot(os.path.join(OUT_DIR, "04_artist_list_scrolled.png"), max_dim=1800)  # noqa
    info = page_info()  # noqa
    try:
        sigs = js(EVENT_ANCHOR_PROBE)  # noqa
    except Exception as exc:
        sigs = {"_probe_error": str(exc)[:200]}
    emit("step_captured", step="artist_list_scrolled",
         url=info.get("url"), screenshot="docs/spikes/ticketmaster-harness-spike-20260506/04_artist_list_scrolled.png",
         signals=sigs)

    # Phase B: event page → wait → probe ticket list shape
    goto_url(EVENT_URL)  # noqa
    wait_for_load(timeout=25)  # noqa
    time.sleep(7.0)
    capture_screenshot(os.path.join(OUT_DIR, "05_event_page_full_render.png"), max_dim=1800)  # noqa
    info2 = page_info()  # noqa
    try:
        sigs2 = js(TICKET_LIST_PROBE)  # noqa
    except Exception as exc:
        sigs2 = {"_probe_error": str(exc)[:200]}
    emit("step_captured", step="event_page_ticket_card_shape",
         url=info2.get("url"), screenshot="docs/spikes/ticketmaster-harness-spike-20260506/05_event_page_full_render.png",
         signals=sigs2)

    emit("followup_done", message="Probe gaps complete")


main()
