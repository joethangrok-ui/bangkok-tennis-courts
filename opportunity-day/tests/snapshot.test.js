const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const snapshot = JSON.parse(fs.readFileSync(path.join(root, "data", "snapshot.json"), "utf8"));
const calendar = JSON.parse(fs.readFileSync(path.join(root, "data", "source", "calendar_q3_2026.json"), "utf8"));
const archive = JSON.parse(fs.readFileSync(path.join(root, "data", "source", "archive_sample_pages1-40.json"), "utf8"));

function pdfSessions() {
  return snapshot.sessions.filter(function (s) { return s.on_pdf; });
}

test("builder regenerates the committed snapshot without a live fetch", function () {
  const run = spawnSync("python3", ["scripts/build_snapshot.py", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("every PDF row is kept once with its own date and slot", function () {
  assert.equal(calendar.length, 352);
  assert.equal(pdfSessions().length, 352);
  const keys = new Set();
  calendar.forEach(function (row) {
    const label = row.symbol_or_title;
    const match = pdfSessions().find(function (s) {
      return s.date === row.date && s.time_slot_ict === row.time_slot_ict &&
        (s.schedule_label === label || s.symbol === label);
    });
    assert.ok(match, JSON.stringify(row));
    const key = row.date + "|" + row.time_slot_ict + "|" + label;
    assert.equal(keys.has(key), false);
    keys.add(key);
  });
  const tkt = pdfSessions().filter(function (s) { return s.schedule_label === "TKT"; });
  assert.equal(tkt.length, 1);
  assert.equal(tkt[0].date, "2026-11-27");
  assert.equal(tkt[0].time_slot_ict, "11:15-12:00");
});

test("same symbol on different dates and same-day event ids are both kept", function () {
  const ggc = pdfSessions().filter(function (s) { return s.symbol === "GGC"; }).map(function (s) { return s.date; }).sort();
  assert.deepEqual(ggc, ["2026-11-12", "2026-11-16"]);
  const ingrs = pdfSessions().filter(function (s) { return s.symbol === "INGRS"; }).map(function (s) { return s.date; }).sort();
  assert.deepEqual(ingrs, ["2026-10-15", "2026-11-18"]);
  const wha = pdfSessions().find(function (s) { return s.symbol === "WHA" && s.date === "2026-11-20"; });
  assert.deepEqual(wha.archive_cards.map(function (c) { return c.event_id; }).sort(), ["10748", "10907"]);
  const nov16 = pdfSessions().find(function (s) { return s.symbol === "GGC" && s.date === "2026-11-16"; });
  assert.equal(nov16.archive_cards.length, 0);
  assert.equal(nov16.calendar_url, "https://opportunity-day.setgroup.or.th/en/calendar");
  assert.equal(nov16.time_slot_ict, "10:15-11:00");
});

test("archive cards join only the same symbol and date", function () {
  assert.equal(archive.length, 354);
  const seen = new Map();
  snapshot.sessions.forEach(function (session) {
    session.archive_cards.forEach(function (card) {
      assert.equal(seen.has(card.event_id), false, card.event_id);
      seen.set(card.event_id, session);
      assert.equal(card.date, session.date);
      if (!session.is_analyst_session) assert.equal(card.symbol, session.symbol);
    });
  });
  assert.equal(seen.size, 354);
  const advancPdf = pdfSessions().find(function (s) { return s.symbol === "ADVANC"; });
  assert.equal(advancPdf.date, "2026-11-06");
  assert.equal(advancPdf.archive_cards.length, 0);
  const advancCard = snapshot.sessions.find(function (s) { return s.id === "archive-11339"; });
  assert.equal(advancCard.date, "2026-11-16");
  assert.equal(advancCard.on_pdf, false);
  assert.equal(advancCard.time_slot_ict, null);
  assert.equal(advancCard.archive_cards[0].url_en, "https://opportunity-day.setgroup.or.th/en/vdo/11339");
});

test("coverage stays incomplete and no unverified replay is stored", function () {
  const counts = snapshot.meta.counts;
  assert.equal(counts.verified_video_cards, 0);
  assert.equal(counts.direct_presentation_urls, 0);
  assert.equal(counts.thai_legal_names, 0);
  assert.equal(counts.markets_known, 0);
  assert.equal(counts.archive_cards, 354);
  assert.equal(counts.pdf_rows_without_archive_card, 85);
  assert.ok(counts.archive_only_sessions > 0);
  snapshot.sessions.forEach(function (session) {
    assert.equal(session.market, null);
    assert.equal(session.company_name_th, null);
    assert.equal(session.presentation_direct_url, null);
    assert.equal(session.timezone, "Asia/Bangkok");
    session.archive_cards.forEach(function (card) {
      assert.notEqual(card.recording_label, "Video");
      assert.match(card.url_en, /^https:\/\/opportunity-day\.setgroup\.or\.th\/en\/vdo\/\d+$/);
      assert.match(card.url_th, /^https:\/\/opportunity-day\.setgroup\.or\.th\/th\/vdo\/\d+$/);
      if (session.date >= "2026-11-07") assert.equal(card.recording_label, "Upcoming");
      if (session.date < "2026-11-07") assert.equal(card.recording_label, "");
    });
    if (session.company_name_en && session.company_name_is_legal_entity) {
      const names = new Set(archive.filter(function (row) { return row.symbol === session.symbol; }).map(function (row) { return row.company_name_en; }));
      assert.equal(names.has(session.company_name_en), true, session.symbol);
    }
  });
  assert.match(snapshot.meta.archive.source_note, /Not the full archive/);
  assert.equal(snapshot.meta.publication.end, "2026-12-04");
  assert.deepEqual(snapshot.meta.default_window, { start: "2026-11-07", end: "2027-01-07" });
});

test("IAA analyst rows are flagged and not given a company profile", function () {
  const analyst = pdfSessions().filter(function (s) { return s.is_analyst_session; });
  assert.equal(analyst.length, 5);
  analyst.forEach(function (session) {
    assert.equal(session.symbol, "IAA");
    assert.equal(session.profile_url, null);
    assert.equal(session.company_name_is_legal_entity, false);
    assert.equal(session.archive_cards.length, 1);
  });
  const company = snapshot.sessions.filter(function (s) { return !s.is_analyst_session && s.profile_url; });
  company.forEach(function (session) {
    assert.match(session.profile_url, /^https:\/\/www\.set\.or\.th\/th\/market\/product\/stock\/quote\/[A-Z0-9-]+\/company-profile\/information$/);
  });
});
