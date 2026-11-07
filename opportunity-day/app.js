/* Read-only renderer. External strings go through textContent or officialHref. */
(function () {
  var L = window.OppdayLogic;
  var state = {
    data: null,
    asof: null,
    tab: "upcoming",
    query: "",
    reportingPeriod: "",
    industry: "",
    eventType: "",
    origin: "",
    date: "",
    includeAnalyst: false,
    viewMode: "list"
  };

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function extLink(href, label) {
    var safe = L.officialHref(href);
    if (!safe) return null;
    var a = document.createElement("a");
    a.href = safe;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label;
    return a;
  }

  function addLink(list, href, label) {
    var a = extLink(href, label);
    if (!a) return;
    var li = document.createElement("li");
    li.appendChild(a);
    list.appendChild(li);
  }

  function filters() {
    return {
      query: state.query,
      reportingPeriod: state.reportingPeriod,
      industry: state.industry,
      eventType: state.eventType,
      origin: state.origin,
      date: state.date,
      includeAnalyst: state.includeAnalyst
    };
  }

  function viewed() {
    return L.withViewStatus(state.data.sessions, state.asof);
  }

  function summary() {
    return L.summarizeWindow(state.asof, state.data.meta.publication, state.data.sessions);
  }

  function baseForTab(all) {
    var sum = summary();
    if (state.tab === "upcoming") {
      return L.inWindow(L.upcomingBase(all), sum.window);
    }
    return L.publishedBase(all);
  }

  function visibleSessions() {
    var all = viewed();
    var base = baseForTab(all);
    var rows = L.applyFilters(base, filters());
    var query = state.query.trim();
    rows.sort(function (a, b) {
      if (query) {
        var ae = a.symbol.toLowerCase() === query.toLowerCase() ? 0 : 1;
        var be = b.symbol.toLowerCase() === query.toLowerCase() ? 0 : 1;
        if (ae !== be) return ae - be;
      }
      return state.tab === "published" ? L.compareRecent(a, b) : L.compareUpcoming(a, b);
    });
    return { base: base, rows: rows };
  }

  function fillSelect(id, values, anyLabel, noneLabel) {
    var select = document.getElementById(id);
    clear(select);
    select.appendChild(new Option(anyLabel, ""));
    if (noneLabel) select.appendChild(new Option(noneLabel, "__none__"));
    values.forEach(function (value) {
      select.appendChild(new Option(value, value));
    });
  }

  function uniqueSorted(all, pick) {
    var set = {};
    all.forEach(function (session) {
      pick(session).forEach(function (value) {
        if (value) set[value] = true;
      });
    });
    return Object.keys(set).sort();
  }

  function renderCoverage() {
    var meta = state.data.meta;
    var counts = meta.counts;
    var box = document.getElementById("coverage");
    clear(box);
    box.appendChild(el("h2", null, "Coverage and last verified snapshot"));
    var verified = el("p");
    verified.appendChild(document.createTextNode("Last verified schedule snapshot: "));
    var time = document.createElement("time");
    time.dateTime = meta.publication.updated_at;
    time.textContent = meta.publication.updated_label + " (Asia/Bangkok).";
    verified.appendChild(time);
    verified.appendChild(document.createTextNode(
      " Archive cards were captured " + meta.archive.captured_label + ". That archive capture has no finer clock time."
    ));
    box.appendChild(verified);

    var partial = el("p");
    partial.appendChild(el("strong", null, "Partial archive. "));
    partial.appendChild(document.createTextNode(
      counts.archive_cards + " cards from search pages " + meta.archive.pages +
      " (" + L.formatLongDate(meta.archive.covers_from) + " – " + L.formatLongDate(meta.archive.covers_through) +
      "). This is not the full official archive (about 944 pages on the capture day). "
    ));
    var full = extLink(meta.archive.official_full_archive_url, "Open the full official archive");
    if (full) partial.appendChild(full);
    partial.appendChild(document.createTextNode("."));
    box.appendChild(partial);

    box.appendChild(el("p", null,
      "Thai legal names captured: " + counts.thai_legal_names +
      ". Rows show the symbol and, when a card had one, the English name. Search includes Thai session titles from those cards. Names are not invented."
    ));
    box.appendChild(el("p", null,
      "Market is not in this snapshot (known markets: " + counts.markets_known +
      "). Direct presentation files captured: " + counts.direct_presentation_urls +
      ". Verified Video labels: " + counts.verified_video_cards + "."
    ));

    var metrics = el("div", "metrics");
    [
      [String(counts.pdf_rows), "PDF schedule rows"],
      [String(counts.pdf_rows_in_default_window), "PDF rows from 7 Nov–7 Jan"],
      [String(counts.archive_cards), "Archive cards in sample"],
      [String(counts.verified_video_cards), "Verified replays"]
    ].forEach(function (pair) {
      var m = el("div", "metric");
      m.appendChild(el("span", "num", pair[0]));
      m.appendChild(el("span", "label", pair[1]));
      metrics.appendChild(m);
    });
    box.appendChild(metrics);

    var details = document.createElement("details");
    var summaryEl = document.createElement("summary");
    summaryEl.textContent = "What this snapshot does not contain";
    details.appendChild(summaryEl);
    var list = document.createElement("ul");
    meta.limitations.forEach(function (item) {
      list.appendChild(el("li", null, item));
    });
    details.appendChild(list);
    box.appendChild(details);
  }

  function renderWindowSummary() {
    var mount = document.getElementById("window-summary");
    clear(mount);
    var sum = summary();
    var p = el("p", "notice");
    p.appendChild(el("strong", null, "Rolling two calendar months. "));
    var pdfInWindow = state.data.sessions.filter(function (session) {
      return session.on_pdf && session.date >= sum.window.start && session.date <= sum.window.end;
    }).length;
    p.appendChild(document.createTextNode(
      "Today in this view is " + L.formatLongDate(state.asof) +
      ". The window is " + L.formatLongDate(sum.window.start) + " – " + L.formatLongDate(sum.window.end) +
      ", Asia/Bangkok. PDF rows inside the window: " + pdfInWindow +
      ". The Q3/2026 export publishes weekdays from " +
      L.formatLongDate(state.data.meta.publication.start) + " through " +
      L.formatLongDate(state.data.meta.publication.end) + "."
    ));
    mount.appendChild(p);
    if (sum.counts.no_sessions_in_published_schedule > 0) {
      var empty = el("p", "notice");
      empty.appendChild(el("strong", null, "No sessions in the published schedule"));
      empty.appendChild(document.createTextNode(
        " on " + sum.emptyPublishedWeekdays.map(L.formatLongDate).join(", ") +
        ". Those weekdays are inside the export and were checked. This is not an unpublished date."
      ));
      mount.appendChild(empty);
    }
  }

  function renderUnpublished() {
    var mount = document.getElementById("unpublished-notice");
    clear(mount);
    var unpublished = summary().unpublished;
    if (!unpublished) return;
    var p = el("p", "notice loud");
    p.appendChild(el("strong", null, "Schedule not yet published"));
    p.appendChild(document.createTextNode(
      " for " + L.formatLongDate(unpublished.from) + " – " + L.formatLongDate(unpublished.to) +
      " (" + unpublished.days + " days). The export stops on " +
      L.formatLongDate(state.data.meta.publication.end) +
      ". These later dates are not a checked empty calendar and they are not “no events”."
    ));
    mount.appendChild(p);
  }

  function badge(text, warn) {
    return el("span", warn ? "badge warn" : "badge", text);
  }

  function sessionArticle(session, compact) {
    var article = document.createElement(compact ? "div" : "article");
    article.className = compact ? "mini" : "session";

    if (!compact) {
      var when = el("div", "when");
      var time = document.createElement("time");
      time.dateTime = session.date + (session.time_slot_ict ? "T" + session.time_slot_ict.slice(0, 5) + ":00+07:00" : "");
      time.textContent = L.formatLongDate(session.date);
      when.appendChild(time);
      when.appendChild(el("div", "slot", L.formatSlot(session.time_slot_ict)));
      article.appendChild(when);
    }

    var body = el("div", "who");
    var button = document.createElement("button");
    button.type = "button";
    button.className = "symbol";
    button.textContent = session.schedule_label || session.symbol;
    button.setAttribute("aria-label", "Open history for " + (session.schedule_label || session.symbol));
    button.addEventListener("click", function () { openCompany(session.symbol); });
    body.appendChild(button);

    if (!session.is_analyst_session && session.company_name_en) {
      var name = el("p", "name", session.company_name_en);
      body.appendChild(name);
      if (session.name_provenance === "other_card_same_symbol") {
        body.appendChild(el("p", "provenance", "English name from another captured card for this symbol, not from this date."));
      }
    } else if (!session.is_analyst_session) {
      body.appendChild(el("p", "provenance", "English name not in this archive sample."));
    }

    if (!compact && session.titles_th && session.titles_th.length) {
      session.titles_th.forEach(function (title) {
        var thai = el("p", "thai", title);
        thai.lang = "th";
        body.appendChild(thai);
      });
    }

    var meta = [];
    if (session.reporting_period) meta.push("Reporting period " + session.reporting_period);
    else if (session.on_pdf) meta.push("Reporting period not on a matching card");
    if (session.schedule_season) meta.push("PDF season " + session.schedule_season);
    if (session.event_types && session.event_types.length) meta.push(session.event_types.join("; "));
    else if (session.on_pdf) meta.push("Event type not on a matching card");
    if (session.industry) {
      meta.push(session.industry + (session.industry_provenance === "other_card_same_symbol" ? " (industry from another card)" : ""));
    }
    if (!compact && meta.length) body.appendChild(el("p", "meta-line", meta.join(" · ")));

    var badges = el("div", "badges");
    if (session.is_analyst_session) badges.appendChild(badge("IAA analyst session, not a company presentation", true));
    if (session.on_pdf) badges.appendChild(badge("PDF schedule"));
    else badges.appendChild(badge("Archive card not on this PDF date", true));
    if (session.view_status === "upcoming") badges.appendChild(badge("Upcoming"));
    if (session.view_status === "recording_unverified") badges.appendChild(badge("Recording status not labeled Video", true));
    if (session.view_status === "replay_verified") badges.appendChild(badge("Video"));
    if (session.other_dates && session.other_dates.length) {
      badges.appendChild(badge("Also listed " + session.other_dates.map(L.formatLongDate).join(", ")));
    }
    body.appendChild(badges);

    if (!compact) {
      if (!session.on_pdf) {
        body.appendChild(el("p", "quiet", "Kept as its own record. No clock time was copied from a different PDF row."));
      }
      if (session.archive_cards.length > 1) {
        body.appendChild(el("p", "quiet", "More than one official event page shares this symbol and date. Each page is listed."));
      }
      var links = el("ul", "links");
      if (!session.archive_cards.length) {
        addLink(links, session.calendar_url, "Official calendar");
      }
      session.archive_cards.forEach(function (card) {
        var kind = card.event_type ? " · " + card.event_type : "";
        addLink(links, card.url_en, "Official event page EN " + card.event_id + kind);
        addLink(links, card.url_th, "Thai event page " + card.event_id);
      });
      if (session.profile_url && !session.is_analyst_session) {
        addLink(links, session.profile_url, "SET company profile");
      }
      body.appendChild(links);
      var presentation = el("p", "presentation", "Presentation on official event page");
      if (!session.archive_cards.length) {
        presentation.textContent = "Presentation on official event page. This row has no captured event id, so use the official calendar rather than a made-up event link.";
      }
      body.appendChild(presentation);
      L.replayHrefs(session).forEach(function (href) {
        var replay = extLink(href, "Official replay");
        if (replay) {
          replay.className = "replay-link";
          body.appendChild(replay);
        }
      });
    }
    article.appendChild(body);
    return article;
  }

  function renderList(mount, rows) {
    clear(mount);
    var current = "";
    var block = null;
    rows.forEach(function (session) {
      if (session.date !== current) {
        current = session.date;
        block = el("section", "day-block");
        var heading = el("h3", null, L.formatLongDate(session.date));
        block.appendChild(heading);
        mount.appendChild(block);
      }
      block.appendChild(sessionArticle(session, false));
    });
  }

  function renderGrid(mount, rows) {
    clear(mount);
    var byDate = {};
    rows.forEach(function (session) {
      if (!byDate[session.date]) byDate[session.date] = [];
      byDate[session.date].push(session);
    });
    Object.keys(byDate).sort().forEach(function (date) {
      var section = el("section", "day-block");
      section.appendChild(el("h3", null, L.formatLongDate(date)));
      var grid = el("div", "day-grid");
      L.SLOTS.forEach(function (slot) {
        var cell = el("div", "slot-cell");
        cell.appendChild(el("h4", null, L.formatSlot(slot)));
        var inSlot = byDate[date].filter(function (session) { return session.time_slot_ict === slot; });
        if (!inSlot.length) cell.appendChild(el("p", "quiet", "Nothing to show in this slot"));
        inSlot.forEach(function (session) { cell.appendChild(sessionArticle(session, true)); });
        grid.appendChild(cell);
      });
      section.appendChild(grid);
      var extras = byDate[date].filter(function (session) { return !session.time_slot_ict; });
      if (extras.length) {
        section.appendChild(el("p", "quiet", "Archive cards on this date that are not a PDF row. No slot was assigned."));
        extras.forEach(function (session) { section.appendChild(sessionArticle(session, false)); });
      }
      mount.appendChild(section);
    });
  }

  function renderResults() {
    var found = visibleSessions();
    var count = document.getElementById("result-count");
    if (state.tab === "upcoming") {
      renderWindowSummary();
      renderUnpublished();
      var mount = document.getElementById("upcoming-results");
      if (!found.rows.length) {
        clear(mount);
        var empty = el("p", "notice");
        if (found.base.length) empty.textContent = "No sessions match these filters.";
        else empty.textContent = "No upcoming sessions fall in this window. If the dates sit after the published export, use the schedule-not-yet-published notice. That is not a checked empty calendar.";
        mount.appendChild(empty);
      } else if (state.viewMode === "grid") renderGrid(mount, found.rows);
      else renderList(mount, found.rows);
      count.textContent = found.rows.length + " upcoming session" + (found.rows.length === 1 ? "" : "s") + " in " + L.formatLongDate(summary().window.start) + " – " + L.formatLongDate(summary().window.end) + ".";
    } else {
      renderPublishedIntro(found);
      var publishedMount = document.getElementById("published-results");
      if (!found.rows.length) {
        clear(publishedMount);
        var none = el("p", "notice");
        none.textContent = found.base.length ? "No sessions match these filters." : "No captured past event pages are in this view.";
        publishedMount.appendChild(none);
      } else renderList(publishedMount, found.rows);
      var verified = found.rows.filter(function (session) { return session.view_status === "replay_verified"; }).length;
      count.textContent = found.rows.length + " captured past session" + (found.rows.length === 1 ? "" : "s") + " shown. Verified replays in this result: " + verified + ".";
    }
  }

  function renderPublishedIntro(found) {
    var intro = document.getElementById("published-intro");
    clear(intro);
    var verifiedAll = L.verifiedReplaySessions(baseForTab(viewed()).concat([]));
    var loud = el("p", "notice loud");
    loud.appendChild(el("strong", null, "Verified replays in this snapshot: " + state.data.meta.counts.verified_video_cards + ". "));
    loud.appendChild(document.createTextNode(
      "A replay link is shown only when a captured card says Video. None do. Upcoming sessions are not listed on this tab and are not marked as replays."
    ));
    intro.appendChild(loud);
    intro.appendChild(el("p", "notice",
      "The list below is captured past event pages whose status label was blank. Recording status was not labeled Video. Open the official event page to see what the exchange posted. The sample is pages 1–40 only, from " +
      L.formatLongDate(state.data.meta.archive.covers_from) + " through the day before this snapshot, not every company that has ever presented."
    ));
    if (!state.includeAnalyst) {
      intro.appendChild(el("p", "quiet", "IAA analyst sessions are hidden. Turn on “Show IAA analyst sessions” to include them in a separate badge, still not as company presentations."));
    }
    void found;
    void verifiedAll;
  }

  function renderSources() {
    var meta = state.data.meta;
    var mount = document.getElementById("source-notes");
    clear(mount);
    var list = document.createElement("ul");
    [
      "Schedule: " + meta.publication.title + ", updated " + meta.publication.updated_label + ". " + meta.publication.source_url,
      "Archive sample: " + meta.archive.source_note + " " + meta.archive.source_url,
      "Event links use only ids present on a captured card, as /en/vdo/<id> and /th/vdo/<id>.",
      "SET company-profile links follow the public quote URL pattern. PTT was opened while checking the pattern. Every other symbol was not re-fetched.",
      "A text extraction of three event pages moved the calendar date back by one day against the PDF weekday heading (PTTEP, GPSC, SCGD) while the clock time matched. Those extracted dates were not used. The PDF weekday rows were kept.",
      "The public calendar and search pages did not return the company grid to a plain fetch. They were not treated as an empty schedule or an empty archive.",
      "No scheduler updates this folder. Refresh is a manual rebuild from a new official export. See the README in this folder."
    ].forEach(function (line) {
      list.appendChild(el("li", null, line));
    });
    mount.appendChild(list);
  }

  function openCompany(symbol) {
    var dialog = document.getElementById("company-dialog");
    var sessions = viewed().filter(function (session) { return session.symbol === symbol; })
      .sort(L.compareUpcoming);
    clear(dialog);
    var head = el("div", "dialog-head");
    var title = el("h2", null, symbol);
    title.id = "company-title";
    head.appendChild(title);
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", function () { dialog.close(); });
    head.appendChild(close);
    dialog.appendChild(head);
    var body = el("div", "dialog-body");
    var first = sessions[0];
    if (first && first.company_name_en && !first.is_analyst_session) {
      body.appendChild(el("p", null, first.company_name_en));
    }
    body.appendChild(el("p", null, "Thai legal name: not captured."));
    body.appendChild(el("p", null, "Market: not in source. Not classified as SET, mai, or LiVEx."));
    if (first && first.is_analyst_session) {
      body.appendChild(el("p", null, "These are IAA analyst sessions, kept separate from company Opportunity Day rows."));
    }
    body.appendChild(el("p", null, sessions.length + " record" + (sessions.length === 1 ? "" : "s") + " in this snapshot. Different dates are not merged."));
    if (first && first.profile_url) {
      var profile = extLink(first.profile_url, "SET company profile");
      if (profile) {
        var p = el("p");
        p.appendChild(profile);
        p.appendChild(document.createTextNode(" The Thai legal name, if the exchange publishes one, is on that page. It was not copied here."));
        body.appendChild(p);
      }
    }
    sessions.forEach(function (session) {
      body.appendChild(sessionArticle(session, false));
    });
    dialog.appendChild(body);
    if (location.hash !== "#symbol=" + encodeURIComponent(symbol)) {
      history.replaceState(null, "", "#symbol=" + encodeURIComponent(symbol));
    }
    dialog.showModal();
  }

  function selectTab(tab) {
    state.tab = tab;
    ["upcoming", "published"].forEach(function (name) {
      var button = document.getElementById("tab-" + name);
      var panel = document.getElementById("panel-" + name);
      var on = name === tab;
      button.setAttribute("aria-selected", on ? "true" : "false");
      button.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    });
    var gridUseful = tab === "upcoming";
    document.getElementById("view-list").disabled = !gridUseful;
    document.getElementById("view-grid").disabled = !gridUseful;
    renderResults();
  }

  function bind() {
    var tabs = [document.getElementById("tab-upcoming"), document.getElementById("tab-published")];
    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () { selectTab(tab.dataset.tab); });
      tab.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        var next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
        tabs[next].focus();
        selectTab(tabs[next].dataset.tab);
      });
    });

    document.getElementById("filters").addEventListener("submit", function (event) { event.preventDefault(); });
    document.getElementById("q").addEventListener("input", function (event) {
      state.query = event.target.value;
      renderResults();
    });
    document.getElementById("reporting-period").addEventListener("change", function (event) {
      state.reportingPeriod = event.target.value;
      renderResults();
    });
    document.getElementById("industry").addEventListener("change", function (event) {
      state.industry = event.target.value;
      renderResults();
    });
    document.getElementById("event-type").addEventListener("change", function (event) {
      state.eventType = event.target.value;
      renderResults();
    });
    document.getElementById("origin").addEventListener("change", function (event) {
      state.origin = event.target.value;
      renderResults();
    });
    document.getElementById("on-date").addEventListener("change", function (event) {
      state.date = event.target.value;
      renderResults();
    });
    document.getElementById("include-analyst").addEventListener("change", function (event) {
      state.includeAnalyst = event.target.checked;
      renderResults();
    });
    document.getElementById("clear-filters").addEventListener("click", function () {
      state.query = "";
      state.reportingPeriod = "";
      state.industry = "";
      state.eventType = "";
      state.origin = "";
      state.date = "";
      state.includeAnalyst = false;
      document.getElementById("q").value = "";
      document.getElementById("reporting-period").value = "";
      document.getElementById("industry").value = "";
      document.getElementById("event-type").value = "";
      document.getElementById("origin").value = "";
      document.getElementById("on-date").value = "";
      document.getElementById("include-analyst").checked = false;
      renderResults();
    });
    document.getElementById("view-list").addEventListener("click", function () {
      state.viewMode = "list";
      document.getElementById("view-list").setAttribute("aria-pressed", "true");
      document.getElementById("view-grid").setAttribute("aria-pressed", "false");
      renderResults();
    });
    document.getElementById("view-grid").addEventListener("click", function () {
      state.viewMode = "grid";
      document.getElementById("view-grid").setAttribute("aria-pressed", "true");
      document.getElementById("view-list").setAttribute("aria-pressed", "false");
      renderResults();
    });
    document.addEventListener("keydown", function (event) {
      var tag = (event.target && event.target.tagName) || "";
      if (event.key === "/" && tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") {
        event.preventDefault();
        document.getElementById("q").focus();
      }
    });
    document.getElementById("company-dialog").addEventListener("close", function () {
      if (location.hash.indexOf("#symbol=") === 0) history.replaceState(null, "", location.pathname + location.search);
    });
    window.addEventListener("hashchange", function () {
      var match = /^#symbol=(.+)$/.exec(location.hash);
      if (match) openCompany(decodeURIComponent(match[1]));
      else if (location.hash === "#published") selectTab("published");
      else if (location.hash === "#upcoming") selectTab("upcoming");
    });
  }

  function runSelfTest() {
    var input = document.getElementById("q");
    input.value = "CPALL";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    var cpallText = document.getElementById("upcoming-results").textContent;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    var linkProblems = [];
    document.querySelectorAll("a").forEach(function (anchor) {
      var label = (anchor.textContent || "") + " " + (anchor.getAttribute("aria-label") || "");
      if (/\breplay\b/i.test(label)) linkProblems.push(label);
      var href = anchor.getAttribute("href") || "";
      if (href.charAt(0) === "#") return;
      if (!L.officialHref(anchor.href)) linkProblems.push(href);
      if (/\.pdf($|\?)/i.test(href)) linkProblems.push(href);
    });
    document.getElementById("tab-published").click();
    var publishedText = document.getElementById("panel-published").textContent;
    document.getElementById("tab-upcoming").click();
    var doc = document.documentElement;
    var overflow = doc.scrollWidth > doc.clientWidth + 1;
    var sample = document.querySelector("#upcoming-results .session");
    var cols = sample ? getComputedStyle(sample).gridTemplateColumns : "";
    var columnCount = cols ? cols.trim().split(/\s+/).length : 0;
    var expectColumns = window.innerWidth <= 720 ? 1 : 2;
    input.value = "GGC";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    var symbol = document.querySelector("#upcoming-results .symbol");
    if (symbol) symbol.click();
    var dialogText = document.getElementById("company-dialog").textContent || "";
    var result = {
      ok: true,
      overflow: overflow,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      innerWidth: window.innerWidth,
      columnCount: columnCount,
      columnsOk: columnCount === expectColumns,
      hasUnpublished: /schedule not yet published/i.test(document.body.textContent),
      hasPartial: /partial archive/i.test(document.body.textContent),
      cpallHit: /CPALL/.test(cpallText),
      publishedHasUnverified: /not labeled Video/i.test(publishedText),
      publishedNotCallingReplayLinks: document.querySelectorAll("a.replay-link").length === 0,
      linkProblems: linkProblems,
      dialogOpen: document.getElementById("company-dialog").open,
      dialogHasBothGgcDates: /12 Nov 2026/.test(dialogText) && /16 Nov 2026/.test(dialogText),
      presentationPhrase: /Presentation on official event page/.test(document.body.textContent)
    };
    result.ok = !result.overflow && result.columnsOk && result.hasUnpublished && result.hasPartial && result.cpallHit &&
      result.publishedHasUnverified && result.publishedNotCallingReplayLinks &&
      result.linkProblems.length === 0 && result.dialogOpen && result.dialogHasBothGgcDates &&
      result.presentationPhrase;
    var pre = document.createElement("pre");
    pre.id = "selftest-result";
    pre.textContent = JSON.stringify(result);
    document.body.appendChild(pre);
  }

  function main() {
    var params = new URLSearchParams(location.search);
    state.asof = params.get("asof") || L.todayBangkok();
    fetch("data/snapshot.json", { credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error("Snapshot HTTP " + response.status);
      return response.json();
    }).then(function (data) {
      state.data = data;
      var all = data.sessions;
      fillSelect("reporting-period", uniqueSorted(all, function (s) { return s.reporting_periods || []; }), "Any reporting period", "Not on a matching card");
      fillSelect("industry", uniqueSorted(all, function (s) { return [s.industry]; }), "Any industry", "Not in source");
      fillSelect("event-type", uniqueSorted(all, function (s) { return s.event_types || []; }), "Any event type");
      bind();
      renderCoverage();
      renderSources();
      if (location.hash === "#published") selectTab("published");
      else selectTab("upcoming");
      var symbol = /^#symbol=(.+)$/.exec(location.hash);
      if (symbol) openCompany(decodeURIComponent(symbol[1]));
      if (params.get("selftest") === "1") runSelfTest();
    }).catch(function (error) {
      var box = document.getElementById("coverage");
      box.textContent = "The snapshot file did not load. Open this folder through a local web server. " + error.message;
    });
  }

  main();
})();
