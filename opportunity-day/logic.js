/* Pure date, coverage, search, and link rules for the Opportunity Day reader.
   Shared by the static page (global OppdayLogic) and node:test (module.exports).
   No network and no DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OppdayLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SLOTS = [
    "09:15-10:00",
    "10:15-11:00",
    "11:15-12:00",
    "13:15-14:00",
    "14:15-15:00",
    "15:15-16:00",
    "16:15-17:00"
  ];
  var ALLOWED_HOSTS = {
    "opportunity-day.setgroup.or.th": true,
    "www.set.or.th": true,
    "set.or.th": true
  };

  function parseISODate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) throw new Error("Bad date: " + iso);
    var y = Number(m[1]);
    var mon = Number(m[2]);
    var d = Number(m[3]);
    var dt = new Date(Date.UTC(y, mon - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mon - 1 || dt.getUTCDate() !== d) {
      throw new Error("Bad date: " + iso);
    }
    return dt;
  }

  function formatISODate(dt) {
    var y = dt.getUTCFullYear();
    var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    var d = String(dt.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function addDays(iso, n) {
    var dt = parseISODate(iso);
    dt.setUTCDate(dt.getUTCDate() + n);
    return formatISODate(dt);
  }

  function addCalendarMonths(iso, months) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) throw new Error("Bad date: " + iso);
    var year = Number(m[1]);
    var monthIndex = Number(m[2]) - 1 + months;
    var day = Number(m[3]);
    year += Math.floor(monthIndex / 12);
    monthIndex = monthIndex % 12;
    if (monthIndex < 0) {
      monthIndex += 12;
      year -= 1;
    }
    var last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    var clamped = Math.min(day, last);
    return formatISODate(new Date(Date.UTC(year, monthIndex, clamped)));
  }

  function rollingWindow(todayIso, months) {
    var span = months == null ? 2 : months;
    return {
      start: todayIso,
      end: addCalendarMonths(todayIso, span),
      months: span,
      timezone: "Asia/Bangkok",
      utcOffset: "+07:00"
    };
  }

  function todayBangkok(now) {
    var dt = now || new Date();
    var fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return fmt.format(dt);
  }

  function weekdayIndex(iso) {
    return parseISODate(iso).getUTCDay();
  }

  function isWeekend(iso) {
    var w = weekdayIndex(iso);
    return w === 0 || w === 6;
  }

  function formatLongDate(iso) {
    var dt = parseISODate(iso);
    return WEEKDAYS[dt.getUTCDay()] + " " + dt.getUTCDate() + " " + MONTHS[dt.getUTCMonth()] + " " + dt.getUTCFullYear();
  }

  function formatSlot(slot) {
    if (!slot) return "Time slot not on a matching PDF row";
    return slot.replace("-", "–") + " ICT (UTC+7)";
  }

  function slotIndex(slot) {
    var i = SLOTS.indexOf(slot);
    return i === -1 ? 99 : i;
  }

  function eachDate(start, end) {
    var out = [];
    var cur = start;
    while (cur <= end) {
      out.push(cur);
      cur = addDays(cur, 1);
    }
    return out;
  }

  function pdfCountByDate(sessions) {
    var by = {};
    (sessions || []).forEach(function (s) {
      if (!s.on_pdf) return;
      by[s.date] = (by[s.date] || 0) + 1;
    });
    return by;
  }

  function dayStatus(iso, publication, pdfSessionCount) {
    if (iso < publication.start) return "before_publication";
    if (iso > publication.end) return "not_yet_published";
    if (isWeekend(iso)) return "weekend_not_in_export";
    if ((pdfSessionCount || 0) > 0) return "has_sessions";
    return "no_sessions_in_published_schedule";
  }

  function summarizeWindow(asof, publication, sessions) {
    var window = rollingWindow(asof, 2);
    var counts = {
      has_sessions: 0,
      no_sessions_in_published_schedule: 0,
      weekend_not_in_export: 0,
      not_yet_published: 0,
      before_publication: 0
    };
    var byDate = pdfCountByDate(sessions);
    var emptyPublished = [];
    eachDate(window.start, window.end).forEach(function (iso) {
      var status = dayStatus(iso, publication, byDate[iso] || 0);
      counts[status] = (counts[status] || 0) + 1;
      if (status === "no_sessions_in_published_schedule") emptyPublished.push(iso);
    });
    var unpublished = null;
    var from = addDays(publication.end, 1);
    if (window.end >= from && window.start <= window.end) {
      var start = window.start > from ? window.start : from;
      if (start <= window.end) {
        unpublished = { from: start, to: window.end, days: eachDate(start, window.end).length };
      }
    }
    return {
      asof: asof,
      window: window,
      counts: counts,
      emptyPublishedWeekdays: emptyPublished,
      unpublished: unpublished
    };
  }

  function haystack(session) {
    var parts = [
      session.symbol,
      session.schedule_label,
      session.company_name_en,
      session.event_type
    ];
    (session.titles_th || []).forEach(function (t) { parts.push(t); });
    (session.archive_cards || []).forEach(function (c) {
      parts.push(c.company_name_en, c.title_th, c.event_type, c.symbol, c.event_id);
    });
    return parts.filter(Boolean).join("\n").toLowerCase();
  }

  function matchesQuery(session, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    return haystack(session).indexOf(q) !== -1;
  }

  function applyFilters(sessions, filters) {
    var f = filters || {};
    return (sessions || []).filter(function (s) {
      if (!f.includeAnalyst && s.is_analyst_session) return false;
      if (f.query && !matchesQuery(s, f.query)) return false;
      if (f.reportingPeriod) {
        var period = s.reporting_period || "";
        if (f.reportingPeriod === "__none__") {
          if (period) return false;
        } else if (period !== f.reportingPeriod) return false;
      }
      if (f.industry) {
        var industry = s.industry || "";
        if (f.industry === "__none__") {
          if (industry) return false;
        } else if (industry !== f.industry) return false;
      }
      if (f.eventType) {
        var types = s.event_types || [];
        if (types.indexOf(f.eventType) === -1) return false;
      }
      if (f.date && s.date !== f.date) return false;
      if (f.status && s.view_status !== f.status) return false;
      if (f.origin === "pdf" && !s.on_pdf) return false;
      if (f.origin === "archive_only" && s.on_pdf) return false;
      return true;
    });
  }

  function compareUpcoming(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    var sa = slotIndex(a.time_slot_ict);
    var sb = slotIndex(b.time_slot_ict);
    if (sa !== sb) return sa - sb;
    if (a.on_pdf !== b.on_pdf) return a.on_pdf ? -1 : 1;
    return String(a.symbol).localeCompare(String(b.symbol)) || String(a.id).localeCompare(String(b.id));
  }

  function compareRecent(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    var sa = slotIndex(a.time_slot_ict);
    var sb = slotIndex(b.time_slot_ict);
    if (sa !== sb) return sa - sb;
    return String(a.symbol).localeCompare(String(b.symbol)) || String(a.id).localeCompare(String(b.id));
  }

  function deriveViewStatus(session, asof) {
    var cards = session.archive_cards || [];
    var labels = cards.map(function (c) { return c.recording_label || ""; });
    if (labels.indexOf("Video") !== -1) return "replay_verified";
    if (session.date >= asof) return "upcoming";
    if (cards.length) return "recording_unverified";
    if (session.on_pdf) return "listed_past";
    return "recording_unverified";
  }

  function withViewStatus(sessions, asof) {
    return (sessions || []).map(function (s) {
      var copy = Object.assign({}, s);
      copy.view_status = deriveViewStatus(s, asof);
      return copy;
    });
  }

  function officialHref(url) {
    if (typeof url !== "string" || !url) return null;
    var u;
    try {
      u = new URL(url);
    } catch (e) {
      return null;
    }
    if (u.protocol !== "https:") return null;
    if (!ALLOWED_HOSTS[u.hostname.toLowerCase()]) return null;
    if (u.username || u.password) return null;
    return u.href;
  }

  function replayHrefs(session) {
    if (!session) return [];
    var out = [];
    (session.archive_cards || []).forEach(function (card) {
      if (card.recording_label !== "Video") return;
      var href = officialHref(card.url_en);
      if (href) out.push(href);
    });
    return out;
  }

  function upcomingBase(sessions) {
    return sessions.filter(function (s) { return s.view_status === "upcoming"; });
  }

  function inWindow(sessions, window) {
    return sessions.filter(function (s) { return s.date >= window.start && s.date <= window.end; });
  }

  function publishedBase(sessions) {
    return sessions.filter(function (s) {
      return s.view_status === "replay_verified" || s.view_status === "recording_unverified";
    });
  }

  function verifiedReplaySessions(sessions) {
    return (sessions || []).filter(function (s) { return s.view_status === "replay_verified"; });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  return {
    SLOTS: SLOTS,
    parseISODate: parseISODate,
    formatISODate: formatISODate,
    addDays: addDays,
    addCalendarMonths: addCalendarMonths,
    rollingWindow: rollingWindow,
    todayBangkok: todayBangkok,
    isWeekend: isWeekend,
    formatLongDate: formatLongDate,
    formatSlot: formatSlot,
    slotIndex: slotIndex,
    eachDate: eachDate,
    dayStatus: dayStatus,
    summarizeWindow: summarizeWindow,
    pdfCountByDate: pdfCountByDate,
    matchesQuery: matchesQuery,
    applyFilters: applyFilters,
    compareUpcoming: compareUpcoming,
    compareRecent: compareRecent,
    deriveViewStatus: deriveViewStatus,
    withViewStatus: withViewStatus,
    officialHref: officialHref,
    replayHrefs: replayHrefs,
    upcomingBase: upcomingBase,
    inWindow: inWindow,
    publishedBase: publishedBase,
    verifiedReplaySessions: verifiedReplaySessions,
    escapeHtml: escapeHtml
  };
});
