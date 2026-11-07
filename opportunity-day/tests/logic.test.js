const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../logic.js");

const publication = { start: "2026-10-14", end: "2026-12-04" };

test("two calendar months from 7 Nov 2026 ends 7 Jan 2027", function () {
  const window = L.rollingWindow("2026-11-07", 2);
  assert.equal(window.start, "2026-11-07");
  assert.equal(window.end, "2027-01-07");
  assert.equal(window.timezone, "Asia/Bangkok");
});

test("month-end clamping does not spill into the following month", function () {
  assert.equal(L.addCalendarMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(L.addCalendarMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(L.addCalendarMonths("2025-01-31", 1), "2025-02-28");
  assert.equal(L.addCalendarMonths("2026-03-31", 1), "2026-04-30");
  assert.equal(L.addCalendarMonths("2026-05-31", 1), "2026-06-30");
  assert.equal(L.addCalendarMonths("2026-08-31", 6), "2027-02-28");
  assert.equal(L.addCalendarMonths("2026-12-31", 2), "2027-02-28");
  assert.equal(L.addCalendarMonths("2024-02-29", 12), "2025-02-28");
  assert.equal(L.addCalendarMonths("2026-01-31", 12), "2027-01-31");
  assert.equal(L.addCalendarMonths("2026-11-30", 2), "2027-01-30");
  assert.equal(L.addCalendarMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(L.rollingWindow("2026-12-31", 2).end, "2027-02-28");
  assert.equal(L.rollingWindow("2026-01-31", 1).end, "2026-02-28");
});

test("weekday labels use the calendar date, not a shifted timezone", function () {
  assert.equal(L.formatLongDate("2026-11-07"), "Sat 7 Nov 2026");
  assert.equal(L.formatLongDate("2026-11-09"), "Mon 9 Nov 2026");
  assert.equal(L.formatLongDate("2026-11-27"), "Fri 27 Nov 2026");
  assert.equal(L.formatLongDate("2026-10-27"), "Tue 27 Oct 2026");
  assert.equal(L.formatSlot("13:15-14:00"), "13:15–14:00 ICT (UTC+7)");
  assert.match(L.formatSlot(null), /not on a matching PDF row/);
});

test("dates after the export are unpublished even on a weekend and even if a count is passed", function () {
  assert.equal(L.dayStatus("2026-12-04", publication, 15), "has_sessions");
  assert.equal(L.dayStatus("2026-12-05", publication, 0), "not_yet_published");
  assert.equal(L.dayStatus("2026-12-05", publication, 4), "not_yet_published");
  assert.equal(L.dayStatus("2026-12-07", publication, 0), "not_yet_published");
  assert.equal(L.dayStatus("2027-01-07", publication, 0), "not_yet_published");
  assert.equal(L.dayStatus("2026-11-07", publication, 0), "weekend_not_in_export");
  assert.equal(L.dayStatus("2026-10-16", publication, 0), "no_sessions_in_published_schedule");
  assert.equal(L.dayStatus("2026-10-16", publication, 1), "has_sessions");
  assert.equal(L.dayStatus("2026-10-13", publication, 0), "before_publication");
});

test("default window separates published session days from the unpublished tail", function () {
  const summary = L.summarizeWindow("2026-11-07", publication, [
    { on_pdf: true, date: "2026-11-09" },
    { on_pdf: false, date: "2026-12-20" }
  ]);
  assert.equal(summary.window.end, "2027-01-07");
  assert.equal(summary.unpublished.from, "2026-12-05");
  assert.equal(summary.unpublished.to, "2027-01-07");
  assert.equal(summary.unpublished.days, 34);
  assert.ok(summary.counts.not_yet_published >= 34);
  assert.equal(summary.counts.has_sessions, 1);
  assert.equal(summary.emptyPublishedWeekdays.includes("2026-11-10"), true);
});

test("a whole window after the export is unpublished rather than empty", function () {
  const summary = L.summarizeWindow("2026-12-20", publication, []);
  assert.equal(summary.window.start, "2026-12-20");
  assert.equal(summary.window.end, "2027-02-20");
  assert.equal(summary.counts.has_sessions, 0);
  assert.equal(summary.counts.no_sessions_in_published_schedule, 0);
  assert.equal(summary.unpublished.from, "2026-12-20");
  assert.equal(summary.unpublished.days, summary.counts.not_yet_published);
});

test("search, quarter, industry, and analyst filters do not invent a market", function () {
  const sessions = [
    {
      symbol: "PTTEP",
      schedule_label: "PTTEP",
      company_name_en: "PTT EXPLORATION AND PRODUCTION PUBLIC COMPANY LIMITED",
      titles_th: ["การนำเสนอข้อมูลงบการเงิน ผลการดำเนินงานประจำ Q3/2026"],
      reporting_period: "Q3/2026",
      reporting_periods: ["Q3/2026"],
      industry: "Resources",
      event_types: ["Earnings Call (OPPDAY)"],
      date: "2026-11-06",
      on_pdf: true,
      is_analyst_session: false,
      view_status: "listed_past",
      archive_cards: []
    },
    {
      symbol: "INGRS",
      schedule_label: "INGRS",
      company_name_en: "INGRESS INDUSTRIAL (THAILAND) PUBLIC COMPANY LIMITED",
      titles_th: [],
      reporting_period: "Q3/2027",
      reporting_periods: ["Q3/2027"],
      industry: "Industrials",
      event_types: ["C-Sign Public Presentation"],
      date: "2026-11-18",
      on_pdf: true,
      is_analyst_session: false,
      view_status: "upcoming",
      archive_cards: []
    },
    {
      symbol: "IAA",
      schedule_label: "IAA : FOOD",
      company_name_en: null,
      titles_th: ["Sector Analysis Q3/2026"],
      reporting_period: "Q3/2026",
      reporting_periods: ["Q3/2026"],
      industry: null,
      event_types: ["Sector Analysis"],
      date: "2026-11-05",
      on_pdf: true,
      is_analyst_session: true,
      view_status: "recording_unverified",
      archive_cards: [{ company_name_en: "FOOD: มุมมองอาหาร", title_th: "Sector Analysis Q3/2026", event_type: "Sector Analysis" }]
    },
    {
      symbol: "NOCARD",
      schedule_label: "NOCARD",
      company_name_en: null,
      titles_th: [],
      reporting_period: null,
      reporting_periods: [],
      industry: null,
      event_types: [],
      date: "2026-11-12",
      on_pdf: true,
      is_analyst_session: false,
      view_status: "upcoming",
      market: null,
      archive_cards: []
    }
  ];
  assert.equal(L.applyFilters(sessions, { query: "exploration" }).length, 1);
  assert.equal(L.applyFilters(sessions, { query: "การนำเสนอ" })[0].symbol, "PTTEP");
  assert.equal(L.applyFilters(sessions, { query: "อาหาร", includeAnalyst: true })[0].symbol, "IAA");
  assert.deepEqual(L.applyFilters(sessions, { reportingPeriod: "Q3/2027" }).map(function (s) { return s.symbol; }), ["INGRS"]);
  assert.equal(L.applyFilters(sessions, { industry: "Resources" })[0].symbol, "PTTEP");
  assert.equal(L.applyFilters(sessions, { industry: "__none__" }).some(function (s) { return s.symbol === "PTTEP"; }), false);
  assert.equal(L.applyFilters(sessions, { reportingPeriod: "__none__" })[0].symbol, "NOCARD");
  const companyOnly = L.applyFilters(sessions, { includeAnalyst: false });
  assert.equal(companyOnly.some(function (s) { return s.is_analyst_session; }), false);
  const withAnalyst = L.applyFilters(sessions, { includeAnalyst: true, eventType: "Sector Analysis" });
  assert.equal(withAnalyst.length, 1);
  assert.equal(withAnalyst[0].market, undefined);
  sessions.forEach(function (s) { assert.equal(s.market || null, null); });
});

test("upcoming cards and blank past cards never become replay links", function () {
  const upcoming = { archive_cards: [{ recording_label: "Upcoming", url_en: "https://opportunity-day.setgroup.or.th/en/vdo/1" }], date: "2026-11-18" };
  const blank = { archive_cards: [{ recording_label: "", url_en: "https://opportunity-day.setgroup.or.th/en/vdo/2" }], date: "2026-10-27" };
  const video = { archive_cards: [{ recording_label: "Video", url_en: "https://opportunity-day.setgroup.or.th/en/vdo/3" }], date: "2026-10-27" };
  const poisoned = { archive_cards: [{ recording_label: "Video", url_en: "javascript:alert(1)" }], date: "2026-10-27" };
  assert.deepEqual(L.replayHrefs(upcoming), []);
  assert.deepEqual(L.replayHrefs(blank), []);
  assert.deepEqual(L.replayHrefs(video), ["https://opportunity-day.setgroup.or.th/en/vdo/3"]);
  assert.deepEqual(L.replayHrefs(poisoned), []);
  assert.equal(L.officialHref("http://opportunity-day.setgroup.or.th/en/vdo/3"), null);
  assert.equal(L.officialHref("https://example.com/vdo/3"), null);
  assert.equal(L.deriveViewStatus(upcoming, "2026-11-07"), "upcoming");
  assert.equal(L.deriveViewStatus(blank, "2026-11-07"), "recording_unverified");
  assert.equal(L.deriveViewStatus({ on_pdf: true, archive_cards: [], date: "2026-11-06" }, "2026-11-07"), "listed_past");
  assert.equal(L.deriveViewStatus(video, "2026-11-07"), "replay_verified");
});

test("html escaping covers the characters used in markup", function () {
  assert.equal(L.escapeHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(L.escapeHtml("a&b"), "a&amp;b");
});

test("renderer does not assign raw html from external fields", function () {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|document\.write|outerHTML|eval\(/);
});

test("snapshot search finds a real company and keeps duplicate dates", function () {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "snapshot.json"), "utf8"));
  const viewed = L.withViewStatus(snapshot.sessions, "2026-11-07");
  const window = L.rollingWindow("2026-11-07", 2);
  const upcoming = L.inWindow(L.upcomingBase(viewed), window);
  const cpall = L.applyFilters(upcoming, { query: "CPALL", includeAnalyst: false });
  assert.ok(cpall.length >= 1);
  assert.ok(cpall.every(function (s) { return s.symbol === "CPALL" || /CPALL/i.test(s.company_name_en || ""); }));
  const ggc = snapshot.sessions.filter(function (s) { return s.symbol === "GGC" && s.on_pdf; }).map(function (s) { return s.date; }).sort();
  assert.deepEqual(ggc, ["2026-11-12", "2026-11-16"]);
  const thai = L.applyFilters(viewed, { query: "การนำเสนอข้อมูลงบการเงิน", includeAnalyst: true });
  assert.ok(thai.length > 10);
});
