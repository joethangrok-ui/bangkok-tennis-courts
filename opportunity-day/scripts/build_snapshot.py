#!/usr/bin/env python3
"""Build the read-only Opportunity Day snapshot from checked public extracts.

Inputs (already captured; this script does not fetch the web):
  data/source/calendar_q3_2026.json
  data/source/archive_sample_pages1-40.json

Output:
  data/snapshot.json

Schedule dates and slots come only from the calendar extract, which was
checked against the official Q3/2026 PDF export (Updated on 7 November 2026
13:31:49 Asia/Bangkok). Archive cards join a calendar row only when the
symbol and date match. A different date for the same symbol stays a separate
record. Recording status is copied as captured. Blank is not turned into Video.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "source"
OUT = ROOT / "data" / "snapshot.json"

CALENDAR_URL = "https://opportunity-day.setgroup.or.th/en/calendar"
SEARCH_URL = "https://opportunity-day.setgroup.or.th/en/search"
PORTAL_URL = "https://opportunity-day.setgroup.or.th/en"
PROFILE = "https://www.set.or.th/th/market/product/stock/quote/{symbol}/company-profile/information"
TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{0,14}$")
IAA_RE = re.compile(r"^IAA : ([A-Z]+)$")
CARD_SECTOR_RE = re.compile(r"^([A-Z]+):")
VDO_RE = re.compile(r"^https://opportunity-day\.setgroup\.or\.th/(en|th)/vdo/(\d+)$")
SLOTS = {
    "09:15-10:00",
    "10:15-11:00",
    "11:15-12:00",
    "13:15-14:00",
    "14:15-15:00",
    "15:15-16:00",
    "16:15-17:00",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def event_id(url: str) -> str:
    match = VDO_RE.match(url or "")
    if not match:
        raise SystemExit(f"Unexpected event URL: {url}")
    return match.group(2)


def profile_url(symbol: str, analyst: bool) -> str | None:
    if analyst or not TICKER_RE.match(symbol or ""):
        return None
    return PROFILE.format(symbol=symbol)


def load() -> tuple[list[dict], list[dict]]:
    calendar = json.loads((SOURCE / "calendar_q3_2026.json").read_text(encoding="utf-8"))
    archive = json.loads((SOURCE / "archive_sample_pages1-40.json").read_text(encoding="utf-8"))
    if not isinstance(calendar, list) or not isinstance(archive, list):
        raise SystemExit("Source files must be JSON arrays")
    return calendar, archive


def card_from(row: dict) -> dict:
    en = row["url"]
    th = row["url_th"]
    en_id = event_id(en)
    th_id = event_id(th)
    if en_id != th_id:
        raise SystemExit(f"EN/TH event id mismatch: {en} {th}")
    label = row.get("status_label")
    if label not in ("", "Upcoming", "Live", "Video"):
        raise SystemExit(f"Unexpected status label: {label!r}")
    return {
        "event_id": en_id,
        "url_en": en,
        "url_th": th,
        "event_type": row.get("event_type") or None,
        "reporting_period": row.get("quarter") or None,
        "recording_label": label,
        "title_th": row.get("title") or None,
        "company_name_en": row.get("company_name_en") or None,
        "industry": row.get("industry") or None,
        "date": row["date"],
        "symbol": row["symbol"],
    }


def unique(values: list) -> list:
    out = []
    seen = set()
    for value in values:
        if value in seen or value is None:
            continue
        seen.add(value)
        out.append(value)
    return out


def build() -> dict:
    calendar, archive = load()
    if len(calendar) != 352:
        raise SystemExit(f"Expected 352 calendar rows, found {len(calendar)}")
    if len(archive) != 354:
        raise SystemExit(f"Expected 354 archive cards, found {len(archive)}")

    cards = [card_from(row) for row in archive]
    ids = [c["event_id"] for c in cards]
    if len(ids) != len(set(ids)):
        raise SystemExit("Archive event ids are not unique")

    by_symbol_date: dict[tuple[str, str], list[dict]] = defaultdict(list)
    iaa_sector: dict[tuple[str, str], dict] = {}
    for card in cards:
        if card["symbol"] == "IAA" and card["event_type"] == "Sector Analysis":
            match = CARD_SECTOR_RE.match(card["company_name_en"] or "")
            if not match:
                raise SystemExit(f"Sector card missing code: {card['event_id']}")
            key = (card["date"], match.group(1))
            if key in iaa_sector:
                raise SystemExit(f"Duplicate IAA sector card: {key}")
            iaa_sector[key] = card
        else:
            by_symbol_date[(card["symbol"], card["date"])].append(card)

    names_by_symbol: dict[str, set[str]] = defaultdict(set)
    industry_by_symbol: dict[str, set[str | None]] = defaultdict(set)
    for card in cards:
        if card["symbol"] == "IAA":
            continue
        if card["company_name_en"]:
            names_by_symbol[card["symbol"]].add(card["company_name_en"])
        industry_by_symbol[card["symbol"]].add(card["industry"])

    used_ids: set[str] = set()
    sessions: list[dict] = []

    seen_pdf = set()
    for row in calendar:
        symbol_raw = row["symbol_or_title"]
        date = row["date"]
        slot = row["time_slot_ict"]
        if slot not in SLOTS:
            raise SystemExit(f"Unexpected slot {slot}")
        if row.get("timezone") != "Asia/Bangkok (UTC+7)":
            raise SystemExit("Calendar timezone changed")
        if row.get("schedule_quarter") != "Q3/2026":
            raise SystemExit("Unexpected schedule quarter")
        key = (date, slot, symbol_raw)
        if key in seen_pdf:
            raise SystemExit(f"Duplicate PDF row {key}")
        seen_pdf.add(key)

        sector = IAA_RE.match(symbol_raw)
        matched: list[dict] = []
        if sector:
            card = iaa_sector.get((date, sector.group(1)))
            if card:
                matched = [card]
            symbol = "IAA"
            schedule_label = symbol_raw
            analyst = True
        elif row.get("is_sector_analysis"):
            raise SystemExit(f"Sector flag without IAA label: {symbol_raw}")
        else:
            if symbol_raw.startswith("IAA"):
                raise SystemExit(symbol_raw)
            matched = list(by_symbol_date.get((symbol_raw, date), []))
            symbol = symbol_raw
            schedule_label = symbol_raw
            analyst = False

        for card in matched:
            if card["event_id"] in used_ids:
                raise SystemExit(f"Card joined twice: {card['event_id']}")
            used_ids.add(card["event_id"])

        same_day_names = unique([c["company_name_en"] for c in matched if c["company_name_en"]])
        same_day_industries = unique([c["industry"] for c in matched])
        # Analyst-card "names" are sector or theme labels, not legal company names.
        if analyst:
            company_name = None
            name_provenance = None
        elif len(same_day_names) == 1:
            company_name = same_day_names[0]
            name_provenance = "same_day_card"
        elif not matched and len(names_by_symbol.get(symbol, ())) == 1:
            company_name = next(iter(names_by_symbol[symbol]))
            name_provenance = "other_card_same_symbol"
        else:
            company_name = None
            name_provenance = None

        if len(same_day_industries) == 1:
            industry = same_day_industries[0]
            industry_provenance = "same_day_card"
        elif not matched and not analyst and len(industry_by_symbol.get(symbol, ())) == 1:
            only = next(iter(industry_by_symbol[symbol]))
            industry = only
            industry_provenance = "other_card_same_symbol" if only else None
            if not only:
                industry = None
                industry_provenance = None
        else:
            industry = None
            industry_provenance = None

        periods = unique([c["reporting_period"] for c in matched])
        reporting_period = periods[0] if len(periods) == 1 else None
        reporting_periods = periods
        event_types = unique([c["event_type"] for c in matched])
        titles = unique([c["title_th"] for c in matched])

        sessions.append(
            {
                "id": f"pdf-{date}-{slot}-{schedule_label}".replace(" ", "").replace(":", ""),
                "on_pdf": True,
                "symbol": symbol,
                "schedule_label": schedule_label,
                "is_analyst_session": analyst,
                "company_name_en": company_name,
                "company_name_th": None,
                "company_name_is_legal_entity": bool(company_name) and not analyst,
                "name_provenance": name_provenance,
                "titles_th": titles,
                "date": date,
                "time_slot_ict": slot,
                "timezone": "Asia/Bangkok",
                "utc_offset": "+07:00",
                "schedule_season": "Q3/2026",
                "reporting_period": reporting_period,
                "reporting_periods": reporting_periods,
                "event_types": event_types,
                "industry": industry,
                "industry_provenance": industry_provenance,
                "market": None,
                "archive_cards": matched,
                "presentation_direct_url": None,
                "calendar_url": CALENDAR_URL,
                "profile_url": profile_url(symbol, analyst),
                "other_dates": [],
            }
        )

    for card in cards:
        if card["event_id"] in used_ids:
            continue
        analyst = card["symbol"] == "IAA" or card["event_type"] == "Sector Analysis"
        if card["event_type"] == "Sector Analysis" and card["symbol"] != "IAA":
            raise SystemExit("Sector Analysis card was not symbol IAA; refusing to guess")
        sessions.append(
            {
                "id": f"archive-{card['event_id']}",
                "on_pdf": False,
                "symbol": card["symbol"],
                "schedule_label": card["symbol"],
                "is_analyst_session": analyst,
                "company_name_en": None if analyst else card["company_name_en"],
                "company_name_th": None,
                "company_name_is_legal_entity": (not analyst) and bool(card["company_name_en"]),
                "name_provenance": None if analyst or not card["company_name_en"] else "same_day_card",
                "titles_th": [card["title_th"]] if card["title_th"] else [],
                "date": card["date"],
                "time_slot_ict": None,
                "timezone": "Asia/Bangkok",
                "utc_offset": "+07:00",
                "schedule_season": None,
                "reporting_period": card["reporting_period"],
                "reporting_periods": [card["reporting_period"]] if card["reporting_period"] else [],
                "event_types": [card["event_type"]] if card["event_type"] else [],
                "industry": card["industry"],
                "industry_provenance": "same_day_card" if card["industry"] else None,
                "market": None,
                "archive_cards": [card],
                "presentation_direct_url": None,
                "calendar_url": CALENDAR_URL,
                "profile_url": profile_url(card["symbol"], analyst),
                "other_dates": [],
            }
        )

    dates_by_symbol: dict[str, set[str]] = defaultdict(set)
    for session in sessions:
        dates_by_symbol[session["symbol"]].add(session["date"])
    for session in sessions:
        session["other_dates"] = sorted(d for d in dates_by_symbol[session["symbol"]] if d != session["date"])

    # Invariants that protect the reader from source mix-ups.
    tkt = [s for s in sessions if s["schedule_label"] == "TKT" and s["on_pdf"]]
    if len(tkt) != 1 or tkt[0]["date"] != "2026-11-27" or tkt[0]["time_slot_ict"] != "11:15-12:00":
        raise SystemExit(f"TKT row failed visual PDF check: {tkt}")

    for symbol, expected in (("GGC", ["2026-11-12", "2026-11-16"]), ("INGRS", ["2026-10-15", "2026-11-18"])):
        got = sorted(s["date"] for s in sessions if s["symbol"] == symbol and s["on_pdf"])
        if got != expected:
            raise SystemExit(f"{symbol} dates {got} != {expected}")

    wha = [s for s in sessions if s["symbol"] == "WHA" and s["date"] == "2026-11-20" and s["on_pdf"]]
    if len(wha) != 1 or sorted(c["event_id"] for c in wha[0]["archive_cards"]) != ["10748", "10907"]:
        raise SystemExit("WHA same-day event pages were dropped or merged away")

    advanc_pdf = next(s for s in sessions if s["symbol"] == "ADVANC" and s["on_pdf"])
    if advanc_pdf["date"] != "2026-11-06" or advanc_pdf["archive_cards"]:
        raise SystemExit("ADVANC PDF row picked up a different-date archive card")
    advanc_extra = [s for s in sessions if s["symbol"] == "ADVANC" and not s["on_pdf"]]
    if len(advanc_extra) != 1 or advanc_extra[0]["date"] != "2026-11-16" or advanc_extra[0]["time_slot_ict"]:
        raise SystemExit("ADVANC archive-only session lost or inherited a PDF slot")

    for session in sessions:
        if session["market"] is not None or session["company_name_th"] is not None:
            raise SystemExit("Market or Thai legal name was filled without a source")
        if session["presentation_direct_url"] is not None:
            raise SystemExit("Direct presentation URL was invented")
        for card in session["archive_cards"]:
            if card["recording_label"] not in ("", "Upcoming", "Live", "Video"):
                raise SystemExit(card["recording_label"])
            if card["recording_label"] == "Video":
                raise SystemExit("No card in this snapshot is labeled Video; refusing an upgrade")
            if session["date"] >= "2026-11-07" and card["recording_label"] == "":
                raise SystemExit(f"Future card has a blank status: {card['event_id']}")
            if session["date"] < "2026-11-07" and card["recording_label"] == "Upcoming":
                raise SystemExit(f"Past card labeled Upcoming: {card['event_id']}")

    joined = sum(len(s["archive_cards"]) for s in sessions if s["on_pdf"])
    archive_only = [s for s in sessions if not s["on_pdf"]]
    if joined + len(archive_only) != len(cards):
        raise SystemExit("Not every archive card was kept exactly once")

    pdf_sessions = [s for s in sessions if s["on_pdf"]]
    window = [s for s in pdf_sessions if "2026-11-07" <= s["date"] <= "2027-01-07"]
    counts = {
        "pdf_rows": len(pdf_sessions),
        "pdf_rows_in_default_window": len(window),
        "pdf_analyst_rows": sum(1 for s in pdf_sessions if s["is_analyst_session"]),
        "pdf_company_rows": sum(1 for s in pdf_sessions if not s["is_analyst_session"]),
        "pdf_rows_with_archive_card": sum(1 for s in pdf_sessions if s["archive_cards"]),
        "pdf_rows_without_archive_card": sum(1 for s in pdf_sessions if not s["archive_cards"]),
        "archive_cards": len(cards),
        "archive_cards_joined_to_pdf": joined,
        "archive_only_sessions": len(archive_only),
        "archive_only_upcoming_on_or_after_snapshot_day": sum(
            1 for s in archive_only if s["date"] >= "2026-11-07"
        ),
        "verified_video_cards": sum(
            1 for c in cards if c["recording_label"] == "Video"
        ),
        "blank_recording_labels": sum(1 for c in cards if c["recording_label"] == ""),
        "upcoming_labels": sum(1 for c in cards if c["recording_label"] == "Upcoming"),
        "thai_legal_names": 0,
        "markets_known": 0,
        "direct_presentation_urls": 0,
        "english_names_on_pdf_company_rows": sum(
            1 for s in pdf_sessions if not s["is_analyst_session"] and s["company_name_en"]
        ),
        "pdf_company_rows_name_from_other_card": sum(
            1
            for s in pdf_sessions
            if s["name_provenance"] == "other_card_same_symbol"
        ),
    }

    snapshot = {
        "meta": {
            "product": "Unofficial SET/mai Opportunity Day reader",
            "read_only": True,
            "timezone": "Asia/Bangkok",
            "utc_offset": "+07:00",
            "snapshot_day": "2026-11-07",
            "default_window_months": 2,
            "default_window": {"start": "2026-11-07", "end": "2027-01-07"},
            "publication": {
                "title": "Event Calendar for Listed Company Presentation Q3/2026",
                "season": "Q3/2026",
                "start": "2026-10-14",
                "end": "2026-12-04",
                "updated_at": "2026-11-07T13:31:49+07:00",
                "updated_label": "7 November 2026 13:31:49 ICT",
                "weekday_rows_in_pdf": 38,
                "empty_weekdays": [
                    "2026-10-16",
                    "2026-10-19",
                    "2026-10-20",
                    "2026-10-21",
                    "2026-10-22",
                    "2026-10-23",
                    "2026-10-26",
                    "2026-10-29",
                ],
                "source_url": CALENDAR_URL,
                "source_name": "SET Opportunity Day calendar PDF export",
            },
            "archive": {
                "source_url": SEARCH_URL,
                "source_note": "Public search UI pages 1-40, captured 7 November 2026 Asia/Bangkok. Newest-first sample from about 1 Sep 2026 through 4 Dec 2026. Not the full archive (the public search was about 944 pages on that day).",
                "pages": "1-40",
                "captured_label": "7 November 2026 Asia/Bangkok",
                "covers_from": "2026-09-01",
                "covers_through": "2026-12-04",
                "official_full_archive_url": SEARCH_URL,
            },
            "portal_url": PORTAL_URL,
            "counts": counts,
            "limitations": [
                "Schedule dates and clock times are the Q3/2026 PDF export updated 7 November 2026 13:31:49 ICT. The export's last row is 4 December 2026.",
                "Dates after 4 December 2026 are outside this publication. They are not a checked empty calendar.",
                "The archive file is pages 1-40 of the public search, 354 cards. It is not every listed company and it is not every historical session.",
                "No captured card has status Video. Blank status on a past card is not treated as a replay.",
                "Upcoming cards are never given a replay link.",
                "Market (SET, mai, or LiVEx) is not in the PDF or the captured cards. Nothing here assigns a market.",
                "Thai legal company names were not captured. Thai text on a card is the session title, not a company name.",
                "Direct presentation-file URLs were not captured. Decks stay on the official event page.",
                "A PDF symbol with no same-day archive card links to the official calendar. Event ids are not invented.",
                "Same symbol on two dates, and two event ids on one date, are both kept.",
                "IAA sector-analysis and IAA theme sessions are analyst sessions, not company presentations. They are off the main company list unless the viewer turns that option on.",
                "This snapshot is not refreshed on a schedule. There is no hourly job.",
            ],
            "sources": {
                "calendar_sha256": sha256(SOURCE / "calendar_q3_2026.json"),
                "archive_sha256": sha256(SOURCE / "archive_sample_pages1-40.json"),
            },
        },
        "sessions": sessions,
    }
    return snapshot


def main() -> None:
    snapshot = build()
    payload = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8")
        if current != payload:
            raise SystemExit("snapshot.json does not match the source files. Re-run without --check.")
        print("snapshot.json matches")
        return
    OUT.write_text(payload, encoding="utf-8")
    counts = snapshot["meta"]["counts"]
    print(json.dumps(counts, indent=2))
    print(f"wrote {OUT} sessions={len(snapshot['sessions'])}")


if __name__ == "__main__":
    main()
