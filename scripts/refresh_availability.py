#!/usr/bin/env python3
"""Probe public booking pages and write data/availability.json.

A successful HTTP check is not court availability. Slots are recorded only
when a public response contains OpenActive Slot JSON-LD with a start time
and an integer remainingUses. Opening hours are recorded only from
schema.org openingHoursSpecification in public JSON-LD.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
BANGKOK = ZoneInfo("Asia/Bangkok")
MAX_BYTES = 2_000_000
TIME_RE = re.compile(r"^\d{2}:\d{2}$")
START_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")
DURATION_RE = re.compile(r"^PT(?:\d+H)?(?:\d+M)?$")
FORBIDDEN_PATH_PARTS = ("/api/", "/ingest/")


class ProbeError(Exception):
    def __init__(self, kind: str, message: str, http_status: int | None = None):
        super().__init__(message)
        self.kind = kind
        self.http_status = http_status


def now_iso(clock=None) -> str:
    moment = clock() if clock else datetime.now(BANGKOK)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=BANGKOK)
    else:
        moment = moment.astimezone(BANGKOK)
    return moment.replace(microsecond=0).isoformat()


def assert_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ProbeError("refused", f"Refusing non-HTTPS URL: {url}")
    path = (parsed.path or "").lower()
    haystack = f"{path}/"
    for part in FORBIDDEN_PATH_PARTS:
        if part in haystack:
            raise ProbeError("refused", f"Refusing undocumented API path: {url}")


class _LDJSONParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._capture = False
        self._buf: list[str] = []
        self.blocks: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() != "script":
            return
        kind = ""
        for key, value in attrs:
            if key.lower() == "type":
                kind = value or ""
        if kind.lower() == "application/ld+json":
            self._capture = True
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._capture:
            self._capture = False
            self.blocks.append("".join(self._buf))

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buf.append(data)


def iter_nodes(value):
    if isinstance(value, list):
        for item in value:
            yield from iter_nodes(item)
        return
    if not isinstance(value, dict):
        return
    yield value
    graph = value.get("@graph")
    if isinstance(graph, list):
        for item in graph:
            yield from iter_nodes(item)


def types_of(node: dict) -> list[str]:
    raw = node.get("@type")
    if isinstance(raw, list):
        return [str(item) for item in raw]
    if raw:
        return [str(raw)]
    return []


def extract_jsonld(body: str, content_type: str) -> list[dict]:
    nodes: list[dict] = []
    ctype = (content_type or "").split(";")[0].strip().lower()
    payloads: list[str] = []
    if ctype == "application/json" or ctype.endswith("+json"):
        payloads.append(body)
    else:
        parser = _LDJSONParser()
        parser.feed(body)
        payloads.extend(parser.blocks)
    for payload in payloads:
        payload = payload.strip()
        if not payload:
            continue
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            continue
        nodes.extend(iter_nodes(parsed))
    return nodes


def extract_opening_hours(nodes: list[dict]) -> list[dict]:
    hours: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for node in nodes:
        specs = node.get("openingHoursSpecification")
        if not isinstance(specs, list):
            continue
        for spec in specs:
            if not isinstance(spec, dict):
                continue
            opens = spec.get("opens")
            closes = spec.get("closes")
            if not isinstance(opens, str) or not isinstance(closes, str):
                continue
            if not TIME_RE.match(opens) or not TIME_RE.match(closes):
                continue
            days = spec.get("dayOfWeek")
            if isinstance(days, str):
                days = [days]
            if not isinstance(days, list):
                continue
            for day in days:
                if not isinstance(day, str) or not day.strip():
                    continue
                day_name = day.rstrip("/").split("/")[-1]
                key = (day_name, opens, closes)
                if key in seen:
                    continue
                seen.add(key)
                hours.append({"dayOfWeek": day_name, "opens": opens, "closes": closes})
    return hours


def extract_slots(nodes: list[dict], source_url: str) -> list[dict]:
    slots: list[dict] = []
    for node in nodes:
        if "Slot" not in types_of(node):
            continue
        start = node.get("startDate")
        remaining = node.get("remainingUses")
        if not isinstance(start, str) or not START_RE.match(start):
            continue
        if isinstance(remaining, bool) or not isinstance(remaining, int) or remaining < 0:
            continue
        duration = node.get("duration")
        if not isinstance(duration, str) or not DURATION_RE.match(duration):
            duration = None
        slots.append(
            {
                "start": start,
                "remainingUses": remaining,
                "duration": duration,
                "sourceUrl": source_url,
            }
        )
    return slots


def is_bot_wall(body: str) -> bool:
    sample = body[:8000].lower()
    return (
        "sgcaptcha" in sample
        or "cf-mitigated" in sample
        or "/cdn-cgi/challenge-platform" in sample
        or "awswafcookiedomainlist" in sample
        or "<title>human verification</title>" in sample
    )


def default_fetch(url: str, timeout: int, user_agent: str) -> dict:
    assert_public_url(url)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            final_url = response.geturl()
            content_type = response.headers.get("content-type", "")
            raw = response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        status = exc.code
        final_url = exc.geturl() if hasattr(exc, "geturl") else url
        content_type = exc.headers.get("content-type", "") if exc.headers else ""
        try:
            raw = exc.read(MAX_BYTES + 1)
        except Exception:
            raw = b""
    except ProbeError:
        raise
    except Exception as exc:
        raise ProbeError("network_error", f"{type(exc).__name__}: {exc}") from exc
    truncated = len(raw) > MAX_BYTES
    text = raw[:MAX_BYTES].decode("utf-8", "replace")
    return {
        "status": status,
        "finalUrl": final_url,
        "contentType": content_type,
        "body": text,
        "truncated": truncated,
    }


def _carry_previous(base: dict, previous: dict | None) -> None:
    if not previous:
        return
    base["lastSuccessfulProbeAt"] = previous.get("lastSuccessfulProbeAt")
    if previous.get("openingHours") and previous.get("openingHoursConfirmedAt"):
        base["openingHours"] = previous["openingHours"]
        base["openingHoursConfirmedAt"] = previous["openingHoursConfirmedAt"]


def probe_source(source: dict, previous: dict | None, fetch, attempted_at: str) -> dict:
    base = {
        "id": source["id"],
        "venueId": source["venueId"],
        "title": source["title"],
        "url": source.get("url"),
        "mode": source["mode"],
        "access": source["access"],
        "attemptedAt": attempted_at,
        "slots": [],
        "openingHours": None,
        "openingHoursConfirmedAt": None,
        "lastSuccessfulProbeAt": None,
        "ok": False,
        "httpStatus": None,
        "finalUrl": None,
        "error": None,
        "result": "not_probed",
        "detail": source["access"],
    }
    if source["mode"] == "not_probed":
        return base
    if source["mode"] != "fetch_public_page":
        base["result"] = "refused"
        base["error"] = f"Unknown source mode: {source['mode']}"
        base["detail"] = base["error"]
        return base

    url = source.get("url") or ""
    try:
        assert_public_url(url)
        fetched = fetch(url)
    except ProbeError as exc:
        base["result"] = exc.kind
        base["error"] = str(exc)
        base["httpStatus"] = exc.http_status
        base["detail"] = f"{exc} No availability read. Courts are not marked free."
        _carry_previous(base, previous)
        return base

    status = int(fetched["status"])
    body = fetched.get("body") or ""
    final_url = fetched.get("finalUrl") or url
    base["httpStatus"] = status
    base["finalUrl"] = final_url
    try:
        assert_public_url(final_url)
    except ProbeError as exc:
        base["result"] = "refused"
        base["error"] = str(exc)
        base["detail"] = (
            f"Redirected to a path this job does not read: {final_url}. "
            "No availability read."
        )
        _carry_previous(base, previous)
        return base

    if status != 200 or is_bot_wall(body):
        if is_bot_wall(body):
            base["result"] = "bot_wall"
            base["error"] = f"HTTP {status} bot check. The booking page was not readable."
        else:
            base["result"] = "http_error"
            base["error"] = f"HTTP {status}."
        base["detail"] = f"{base['error']} No availability read. Courts are not marked free."
        _carry_previous(base, previous)
        return base

    nodes = extract_jsonld(body, fetched.get("contentType") or "")
    hours = extract_opening_hours(nodes)
    slots = extract_slots(nodes, url)
    open_count = sum(1 for slot in slots if slot["remainingUses"] > 0)
    base["ok"] = True
    base["lastSuccessfulProbeAt"] = attempted_at
    base["slots"] = slots
    if hours:
        base["openingHours"] = hours
        base["openingHoursConfirmedAt"] = attempted_at

    if fetched.get("truncated") and not slots:
        base["result"] = "incomplete"
        base["detail"] = (
            f"HTTP 200, but the body exceeded {MAX_BYTES} bytes and was cut off. "
            "No supported slot record was found in the portion read. "
            "Availability stays unknown."
        )
        return base

    if slots:
        base["result"] = "slots_published"
        base["detail"] = (
            f"HTTP 200. Supported OpenActive Slot records: {len(slots)} "
            f"({open_count} with remainingUses > 0). These are feed records, not a booking."
        )
    elif hours:
        base["result"] = "hours_only"
        base["detail"] = (
            f"HTTP 200. Public JSON-LD opening hours: {len(hours)} day record(s). "
            "No supported slot records, so availability stays unknown."
        )
    else:
        base["result"] = "no_availability_feed"
        base["detail"] = (
            "HTTP 200. No supported date/time availability records in the public response. "
            "Availability stays unknown."
        )
    if fetched.get("truncated"):
        base["detail"] += f" Response was truncated at {MAX_BYTES} bytes."
    return base


def build_report(source_results: list[dict], meta: dict, attempted_at: str) -> dict:
    open_slots = 0
    for source in source_results:
        if not source.get("ok"):
            continue
        for slot in source.get("slots") or []:
            if slot.get("remainingUses", 0) > 0:
                open_slots += 1
    fetched_ok = sum(1 for source in source_results if source.get("ok"))
    errors = sum(
        1
        for source in source_results
        if source["mode"] == "fetch_public_page" and not source.get("ok")
    )
    not_probed = sum(1 for source in source_results if source["result"] == "not_probed")
    with_hours = sum(1 for source in source_results if source.get("openingHours"))
    if open_slots:
        summary = (
            f"Supported feeds reported {open_slots} slot record(s) with remainingUses > 0. "
            "Confirm on the source page before going. Venues without a feed stay unknown."
        )
    else:
        summary = (
            "No supported public feed reported an open slot. "
            "Successful rows are page checks and, where present, published opening hours. "
            "They are not court availability. A new timestamp means the check ran again."
        )
    return {
        "schemaVersion": 1,
        "liveAvailability": open_slots > 0,
        "timezone": meta["timezone"],
        "staleAfterMinutes": meta["staleAfterMinutes"],
        "generatedAt": attempted_at,
        "summary": summary,
        "counts": {
            "sources": len(source_results),
            "fetchedOk": fetched_ok,
            "fetchErrors": errors,
            "notProbed": not_probed,
            "withPublishedHours": with_hours,
            "openSlots": open_slots,
        },
        "sources": source_results,
    }


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    sources_doc = load_json(DATA / "sources.json")
    previous_path = DATA / "availability.json"
    previous_by_id: dict[str, dict] = {}
    if previous_path.exists():
        previous_doc = load_json(previous_path)
        previous_by_id = {item["id"]: item for item in previous_doc.get("sources", [])}

    attempted_at = now_iso()
    user_agent = sources_doc["userAgent"]
    timeout = int(sources_doc.get("timeoutSeconds", 20))
    delay = float(sources_doc.get("delaySeconds", 1))
    results = []
    fetches_started = 0
    for source in sources_doc["sources"]:
        if source["mode"] == "fetch_public_page":
            if fetches_started:
                time.sleep(delay)
            fetches_started += 1

        def fetch(url: str, _timeout: int = timeout, _ua: str = user_agent) -> dict:
            return default_fetch(url, _timeout, _ua)

        results.append(
            probe_source(source, previous_by_id.get(source["id"]), fetch, attempted_at)
        )

    report = build_report(results, sources_doc, attempted_at)
    previous_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    counts = report["counts"]
    print(report["summary"])
    print(
        f"generatedAt={report['generatedAt']} fetchedOk={counts['fetchedOk']} "
        f"errors={counts['fetchErrors']} notProbed={counts['notProbed']} "
        f"hours={counts['withPublishedHours']} openSlots={counts['openSlots']} "
        f"liveAvailability={str(report['liveAvailability']).lower()}"
    )
    for source in results:
        print(
            f"- {source['id']}: result={source['result']} http={source['httpStatus']} "
            f"ok={str(source['ok']).lower()} slots={len(source['slots'])} "
            f"hours={len(source['openingHours'] or [])}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
