#!/usr/bin/env python3
"""Unit tests for the booking-source probe. Network is not required."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from stage_public_site import stage_public_site
from refresh_availability import (
    ProbeError,
    assert_public_url,
    build_report,
    default_fetch,
    extract_jsonld,
    extract_opening_hours,
    extract_slots,
    probe_source,
)

ROOT = Path(__file__).resolve().parents[1]
ATTEMPTED = "2026-11-07T14:00:00+07:00"


def source(**overrides):
    base = {
        "id": "example",
        "venueId": "example-venue",
        "title": "Example",
        "mode": "fetch_public_page",
        "url": "https://example.com/booking",
        "access": "Public page.",
    }
    base.update(overrides)
    return base


def ok_fetch(body: str, status: int = 200, content_type: str = "text/html", final_url: str | None = None):
    def fetch(url: str) -> dict:
        return {
            "status": status,
            "finalUrl": final_url or url,
            "contentType": content_type,
            "body": body,
            "truncated": False,
        }

    return fetch


HOURS_HTML = """
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SportsActivityLocation",
  "name": "Curve Tennis Club",
  "openingHoursSpecification": [
    {"@type": "OpeningHoursSpecification", "dayOfWeek": "Monday", "opens": "06:00", "closes": "00:00"},
    {"@type": "OpeningHoursSpecification", "dayOfWeek": "https://schema.org/Tuesday", "opens": "06:00", "closes": "00:00"}
  ]
}
</script>
</head><body>
<p>Choose from available time slots. Live availability. 06:00-22:00. data-slot="carousel"</p>
</body></html>
"""

SLOT_HTML = """
<script type="application/ld+json">
{
  "@context": "https://openactive.io/",
  "@type": "Slot",
  "startDate": "2026-11-08T07:00:00+07:00",
  "duration": "PT1H",
  "remainingUses": 2
}
</script>
"""


class ProbeTests(unittest.TestCase):
    def test_marketing_copy_is_not_availability(self):
        result = probe_source(
            source(),
            None,
            ok_fetch("<html><body>Available time slots from 06:00. Book now. live availability.</body></html>"),
            ATTEMPTED,
        )
        self.assertEqual(result["result"], "no_availability_feed")
        self.assertEqual(result["slots"], [])
        self.assertIsNone(result["openingHours"])
        self.assertTrue(result["ok"])
        self.assertEqual(result["lastSuccessfulProbeAt"], ATTEMPTED)
        report = build_report([result], {"timezone": "Asia/Bangkok", "staleAfterMinutes": 180}, ATTEMPTED)
        self.assertFalse(report["liveAvailability"])
        self.assertEqual(report["counts"]["openSlots"], 0)

    def test_schema_hours_do_not_become_slots(self):
        result = probe_source(source(), None, ok_fetch(HOURS_HTML), ATTEMPTED)
        self.assertEqual(result["result"], "hours_only")
        self.assertEqual(result["slots"], [])
        self.assertEqual(
            result["openingHours"],
            [
                {"dayOfWeek": "Monday", "opens": "06:00", "closes": "00:00"},
                {"dayOfWeek": "Tuesday", "opens": "06:00", "closes": "00:00"},
            ],
        )
        self.assertEqual(result["openingHoursConfirmedAt"], ATTEMPTED)
        report = build_report([result], {"timezone": "Asia/Bangkok", "staleAfterMinutes": 180}, ATTEMPTED)
        self.assertFalse(report["liveAvailability"])

    def test_openactive_slot_is_recorded_and_partial_slots_are_not(self):
        nodes = extract_jsonld(
            SLOT_HTML
            + """
            <script type="application/ld+json">
            {"@type":"Slot","startDate":"2026-11-08T08:00:00+07:00"}
            </script>
            <script type="application/ld+json">
            {"@type":"Slot","startDate":"tomorrow","remainingUses":1}
            </script>
            <script type="application/ld+json">
            {"@type":"Slot","startDate":"2026-11-08T09:00:00+07:00","remainingUses":0}
            </script>
            """,
            "text/html",
        )
        slots = extract_slots(nodes, "https://example.com/booking")
        self.assertEqual(
            [(slot["start"], slot["remainingUses"]) for slot in slots],
            [
                ("2026-11-08T07:00:00+07:00", 2),
                ("2026-11-08T09:00:00+07:00", 0),
            ],
        )
        result = probe_source(source(), None, ok_fetch(SLOT_HTML), ATTEMPTED)
        self.assertEqual(result["result"], "slots_published")
        report = build_report([result], {"timezone": "Asia/Bangkok", "staleAfterMinutes": 180}, ATTEMPTED)
        self.assertTrue(report["liveAvailability"])
        self.assertEqual(report["counts"]["openSlots"], 1)

    def test_zero_remaining_is_not_live(self):
        html = """
        <script type="application/ld+json">
        {"@type":"Slot","startDate":"2026-11-08T09:00:00+07:00","remainingUses":0,"duration":"PT1H"}
        </script>
        """
        result = probe_source(source(), None, ok_fetch(html), ATTEMPTED)
        report = build_report([result], {"timezone": "Asia/Bangkok", "staleAfterMinutes": 180}, ATTEMPTED)
        self.assertEqual(result["slots"][0]["remainingUses"], 0)
        self.assertFalse(report["liveAvailability"])
        self.assertEqual(report["counts"]["openSlots"], 0)

    def test_http_error_keeps_prior_hours_and_drops_slots(self):
        previous = {
            "lastSuccessfulProbeAt": "2026-11-07T12:00:00+07:00",
            "openingHours": [{"dayOfWeek": "Monday", "opens": "06:00", "closes": "00:00"}],
            "openingHoursConfirmedAt": "2026-11-07T12:00:00+07:00",
            "slots": [
                {
                    "start": "2026-11-08T07:00:00+07:00",
                    "remainingUses": 3,
                    "duration": "PT1H",
                    "sourceUrl": "https://example.com/booking",
                }
            ],
        }
        result = probe_source(source(), previous, ok_fetch("nope", status=503), ATTEMPTED)
        self.assertEqual(result["result"], "http_error")
        self.assertFalse(result["ok"])
        self.assertEqual(result["slots"], [])
        self.assertEqual(result["lastSuccessfulProbeAt"], "2026-11-07T12:00:00+07:00")
        self.assertEqual(result["openingHoursConfirmedAt"], "2026-11-07T12:00:00+07:00")
        self.assertIn("not marked free", result["detail"])
        report = build_report([result], {"timezone": "Asia/Bangkok", "staleAfterMinutes": 180}, ATTEMPTED)
        self.assertFalse(report["liveAvailability"])
        self.assertEqual(report["counts"]["fetchErrors"], 1)

    def test_successful_page_without_hours_clears_old_hours(self):
        previous = {
            "lastSuccessfulProbeAt": "2026-11-07T12:00:00+07:00",
            "openingHours": [{"dayOfWeek": "Monday", "opens": "06:00", "closes": "00:00"}],
            "openingHoursConfirmedAt": "2026-11-07T12:00:00+07:00",
        }
        result = probe_source(source(), previous, ok_fetch("<html>club</html>"), ATTEMPTED)
        self.assertIsNone(result["openingHours"])
        self.assertEqual(result["lastSuccessfulProbeAt"], ATTEMPTED)

    def test_bot_wall_does_not_parse_embedded_slots(self):
        body = "sgcaptcha challenge\n" + SLOT_HTML
        result = probe_source(source(), None, ok_fetch(body, status=202), ATTEMPTED)
        self.assertEqual(result["result"], "bot_wall")
        self.assertEqual(result["slots"], [])
        self.assertFalse(result["ok"])
        self.assertIsNone(result["lastSuccessfulProbeAt"])

        waf = "<html><title>Human Verification</title><script>window.awsWafCookieDomainList = [];</script>" + SLOT_HTML
        blocked = probe_source(source(), None, ok_fetch(waf, status=405), ATTEMPTED)
        self.assertEqual(blocked["result"], "bot_wall")
        self.assertEqual(blocked["httpStatus"], 405)
        self.assertEqual(blocked["slots"], [])

    def test_network_error_and_not_probed(self):
        def explode(_url: str):
            raise ProbeError("network_error", "URLError: timed out")

        failed = probe_source(source(), None, explode, ATTEMPTED)
        self.assertEqual(failed["result"], "network_error")
        self.assertEqual(failed["slots"], [])
        self.assertIsNone(failed["lastSuccessfulProbeAt"])

        skipped = probe_source(
            source(mode="not_probed", url=None, access="LINE only. Not probed."),
            None,
            explode,
            ATTEMPTED,
        )
        self.assertEqual(skipped["result"], "not_probed")
        self.assertFalse(skipped["ok"])
        self.assertIsNone(skipped["lastSuccessfulProbeAt"])

    def test_refuses_undocumented_api_without_fetching(self):
        def explode(_url: str):
            raise AssertionError("fetch should not be called")

        with self.assertRaises(ProbeError):
            assert_public_url("https://getoncourt.app/api/availability")
        result = probe_source(
            source(url="https://getoncourt.app/api/availability"),
            None,
            explode,
            ATTEMPTED,
        )
        self.assertEqual(result["result"], "refused")
        self.assertEqual(result["slots"], [])
        redirected = probe_source(
            source(),
            None,
            ok_fetch("{}", final_url="https://getoncourt.app/api/slots"),
            ATTEMPTED,
        )
        self.assertEqual(redirected["result"], "refused")
        self.assertEqual(redirected["slots"], [])

    def test_invalid_hours_are_dropped(self):
        nodes = extract_jsonld(
            """
            <script type="application/ld+json">
            {"openingHoursSpecification":[
              {"dayOfWeek":"Monday","opens":"6am","closes":"late"},
              {"dayOfWeek":"Tuesday","opens":"07:00","closes":"22:00"}
            ]}
            </script>
            """,
            "text/html",
        )
        self.assertEqual(
            extract_opening_hours(nodes),
            [{"dayOfWeek": "Tuesday", "opens": "07:00", "closes": "22:00"}],
        )

    def test_truncated_body_is_not_a_confident_empty_feed(self):
        def fetch(url: str) -> dict:
            return {
                "status": 200,
                "finalUrl": url,
                "contentType": "text/html",
                "body": "<html>no slots here</html>",
                "truncated": True,
            }

        result = probe_source(source(), None, fetch, ATTEMPTED)
        self.assertEqual(result["result"], "incomplete")
        self.assertEqual(result["slots"], [])
        self.assertTrue(result["ok"])

    def test_default_fetch_network_failure(self):
        with self.assertRaises(ProbeError) as caught:
            default_fetch("https://127.0.0.1:9/", timeout=3, user_agent="probe-test")
        self.assertEqual(caught.exception.kind, "network_error")

    def test_repository_sources_match_venues_and_stay_public(self):
        sources_doc = json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8"))
        venues_doc = json.loads((ROOT / "data" / "venues.json").read_text(encoding="utf-8"))
        self.assertEqual(sources_doc["timezone"], "Asia/Bangkok")
        self.assertGreaterEqual(sources_doc["staleAfterMinutes"], 60)
        venue_ids = {venue["id"] for venue in venues_doc["venues"]}
        source_ids = set()
        for item in sources_doc["sources"]:
            self.assertIn(item["venueId"], venue_ids)
            self.assertNotIn(item["id"], source_ids)
            source_ids.add(item["id"])
            if item["mode"] == "fetch_public_page":
                assert_public_url(item["url"])
                self.assertNotIn("/api/", item["url"])
                self.assertNotIn("/ingest/", item["url"])
            else:
                self.assertEqual(item["mode"], "not_probed")
        linked = {source_id for venue in venues_doc["venues"] for source_id in venue["sourceIds"]}
        self.assertEqual(linked, source_ids)
        self.assertEqual(len(venues_doc["venues"]), 16)

    def test_pages_artifact_keeps_opportunity_day_and_tennis_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "site"
            copied = stage_public_site(ROOT, dest)
            self.assertIn("index.html", copied)
            self.assertIn("data/availability.json", copied)
            self.assertIn("opportunity-day/index.html", copied)
            self.assertIn("opportunity-day/data/snapshot.json", copied)
            self.assertNotIn(".github/workflows/probe-booking-sources.yml", copied)
            self.assertTrue((dest / "opportunity-day" / "index.html").is_file())
            self.assertTrue((dest / "index.html").is_file())
            self.assertIn("Not a live slot board", (dest / "index.html").read_text(encoding="utf-8"))
        workflow = (ROOT / ".github" / "workflows" / "probe-booking-sources.yml").read_text(encoding="utf-8")
        self.assertIn('cron: "17 * * * *"', workflow)
        self.assertIn("python3 scripts/stage_public_site.py _site", workflow)
        self.assertNotIn("cp index.html .nojekyll", workflow)


if __name__ == "__main__":
    unittest.main()
