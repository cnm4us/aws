#!/usr/bin/env python3
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


HTTP_OPERATION_BY_PRESET = {
    "message_decide": "HTTP POST /api/feed/message-decision",
    "message_fetch": "HTTP GET /api/feed/messages/:id",
    "message_event": "HTTP POST /api/feed/message-events",
    "admin_messages": "HTTP GET /admin/messages",
    "admin_message_save": "HTTP POST /admin/messages/:id",
    "admin_message_analytics": "HTTP GET /admin/message-analytics",
    "payment_checkout_page": "HTTP GET /checkout/:intent",
    "payment_checkout_start": "HTTP POST /checkout/:intent",
    "payment_webhook": "HTTP POST /api/payments/paypal/webhook",
    "payment_webhook_ingest": "payments.webhook.ingest",
}

PRESET_FILES = [
    "message_decide",
    "message_fetch",
    "message_event",
    "admin_messages",
    "admin_message_save",
    "admin_message_analytics",
    "payment_checkout_page",
    "payment_checkout_start",
    "payment_webhook",
    "payment_webhook_ingest",
]


def iso_from_jaeger_micros(micros: Any) -> Optional[str]:
    try:
        us = int(micros)
        dt = datetime.fromtimestamp(us / 1_000_000, tz=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    except Exception:
        return None


def parse_iso_utc(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    v = str(s).strip()
    if not v:
        return None
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def parse_window_bounds(start_iso: Optional[str], end_iso: Optional[str]) -> (Optional[int], Optional[int]):
    start_dt = parse_iso_utc(start_iso)
    end_dt = parse_iso_utc(end_iso)
    start_us = int(start_dt.timestamp() * 1_000_000) if start_dt else None
    end_us = int(end_dt.timestamp() * 1_000_000) if end_dt else None
    return start_us, end_us


def jaeger_span_in_window(span: Dict[str, Any], start_us: Optional[int], end_us: Optional[int]) -> bool:
    try:
        us = int(span.get("startTime"))
    except Exception:
        return False
    if start_us is not None and us < start_us:
        return False
    if end_us is not None and us > end_us:
        return False
    return True


def load_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def span_tags_map(span: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for t in span.get("tags", []) or []:
        k = t.get("key")
        if not k:
            continue
        out[str(k)] = t.get("value")
    return out


def build_preset_counts(art_dir: Path, start_us: Optional[int], end_us: Optional[int]) -> List[List[str]]:
    rows: List[List[str]] = [["preset", "trace_count"]]
    for preset in PRESET_FILES:
        p = art_dir / f"jaeger-{preset}.json"
        payload = load_json(p)
        if not payload:
            rows.append([preset, "0"])
            continue
        count = 0
        for tr in payload.get("data", []) or []:
            spans = tr.get("spans", []) or []
            if any(jaeger_span_in_window(s, start_us, end_us) for s in spans):
                count += 1
        rows.append([preset, str(count)])
    return rows


def build_http_operation_counts(art_dir: Path, start_us: Optional[int], end_us: Optional[int]) -> List[List[str]]:
    rows: List[List[str]] = [["preset", "http_operation", "trace_count"]]
    for preset, operation_name in HTTP_OPERATION_BY_PRESET.items():
        p = art_dir / f"jaeger-{preset}.json"
        payload = load_json(p)
        if not payload:
            rows.append([preset, operation_name, "0"])
            continue
        count = 0
        for tr in payload.get("data", []) or []:
            spans = [
                s for s in (tr.get("spans", []) or [])
                if jaeger_span_in_window(s, start_us, end_us)
            ]
            if preset == "payment_webhook_ingest":
                if any(
                    any((t.get("key") == "app.operation" and str(t.get("value", "")) == operation_name) for t in (s.get("tags") or []))
                    for s in spans
                ):
                    count += 1
            else:
                alt_ok = False
                if preset == "payment_webhook":
                    alt_ok = any(str(s.get("operationName", "")) == "HTTP POST /api/payments/paypal/webhook/:mode" for s in spans)
                if any(str(s.get("operationName", "")) == operation_name for s in spans) or alt_ok:
                    count += 1
        rows.append([preset, operation_name, str(count)])
    return rows


def build_message_id_counts(art_dir: Path, start_us: Optional[int], end_us: Optional[int]) -> List[List[str]]:
    rows: List[List[str]] = [["message_id", "decide", "fetch", "event"]]
    signal_to_preset = {
        "decide": "message_decide",
        "fetch": "message_fetch",
        "event": "message_event",
    }
    agg: Dict[str, Dict[str, int]] = {}
    for signal, preset in signal_to_preset.items():
        p = art_dir / f"jaeger-{preset}.json"
        payload = load_json(p)
        if not payload:
            continue
        expected_op = HTTP_OPERATION_BY_PRESET[preset]
        for tr in payload.get("data", []) or []:
            for span in tr.get("spans", []) or []:
                if not jaeger_span_in_window(span, start_us, end_us):
                    continue
                if str(span.get("operationName", "")) != expected_op:
                    continue
                tags = span_tags_map(span)
                mid = tags.get("app.message_id")
                if mid is None:
                    continue
                key = str(mid)
                if key not in agg:
                    agg[key] = {"decide": 0, "fetch": 0, "event": 0}
                agg[key][signal] += 1
    for key in sorted(agg.keys(), key=lambda x: (int(x) if x.isdigit() else 10**9, x)):
        v = agg[key]
        rows.append([key, str(v["decide"]), str(v["fetch"]), str(v["event"])])
    return rows


def build_expectation_checks(preset_rows: List[List[str]]) -> List[str]:
    counts: Dict[str, int] = {}
    for r in preset_rows[1:]:
        if len(r) < 2:
            continue
        try:
            counts[r[0]] = int(r[1])
        except Exception:
            counts[r[0]] = 0
    lines: List[str] = []
    warnings = 0
    decide = counts.get("message_decide", 0)
    fetch = counts.get("message_fetch", 0)
    event = counts.get("message_event", 0)
    if decide > 0 and fetch == 0:
        lines.append("WARN: message_decide > 0 but message_fetch == 0")
        warnings += 1
    else:
        lines.append("PASS: message_decide/message_fetch relationship looks healthy")
    if fetch > 0 and event == 0:
        lines.append("WARN: message_fetch > 0 but message_event == 0")
        warnings += 1
    else:
        lines.append("PASS: message_fetch/message_event relationship looks healthy")
    if warnings == 0:
        lines.append("PASS: no expectation warnings")
    checkout_start = counts.get("payment_checkout_start", 0)
    webhook = counts.get("payment_webhook", 0)
    if checkout_start > 0 and webhook == 0:
        lines.append("WARN: payment_checkout_start > 0 but payment_webhook == 0")
    else:
        lines.append("PASS: payment checkout/webhook relationship looks healthy")
    return lines


def write_tsv(path: Path, rows: List[List[str]]) -> None:
    lines = ["\t".join(r) for r in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_console_events(console_path: Path, start_iso: Optional[str], end_iso: Optional[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    start_dt = parse_iso_utc(start_iso)
    end_dt = parse_iso_utc(end_iso)
    if not console_path.exists():
        return out
    for line in console_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        ts = rec.get("ts")
        if not ts:
            continue
        ts_dt = parse_iso_utc(str(ts))
        if start_dt and ts_dt and ts_dt < start_dt:
            continue
        if end_dt and ts_dt and ts_dt > end_dt:
            continue
        payload = rec.get("payload") or {}
        detail = payload.get("detail") if isinstance(payload, dict) else {}
        out.append({
            "ts": ts,
            "source": "console",
            "signal": f'{rec.get("category","unknown")}:{rec.get("event","unknown")}',
            "message_id": (detail or {}).get("message_id") or payload.get("message_id") or rec.get("message_id"),
            "message_session_id": rec.get("message_session_id") or (detail or {}).get("session_id") or payload.get("session_id"),
            "trace_id": None,
            "context": {
                "path": rec.get("path"),
                "event": rec.get("event"),
            },
        })
    return out


HEADER_RE = re.compile(r"^\[(?P<ts>[\d\-:\.\s\+]+)\]\s+(?P<level>[A-Z]+):\s+(?P<msg>.+)$")
KV_RE = re.compile(r'^\s*(?P<k>[a-zA-Z0-9_.-]+):\s*"?(?P<v>[^"]+?)"?\s*$')


def parse_terminal_events(terminal_path: Path, start_iso: Optional[str], end_iso: Optional[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    start_dt = parse_iso_utc(start_iso)
    end_dt = parse_iso_utc(end_iso)
    if not terminal_path.exists():
        return out
    lines = terminal_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    current: Optional[Dict[str, Any]] = None

    def flush() -> None:
        nonlocal current
        if not current:
            return
        msg = str(current.get("msg", ""))
        attrs = current.get("attrs", {})
        op = str(attrs.get("app_operation", "") or attrs.get("app.operation", ""))
        op_detail = str(attrs.get("app_operation_detail", "") or attrs.get("app.operation_detail", ""))
        path = str(attrs.get("path", ""))
        keep = (
            "feed.message." in msg
            or "message.analytics" in msg
            or op.startswith("feed.message")
            or op.startswith("message.analytics")
            or op_detail.startswith("feed.message")
            or op_detail.startswith("message.analytics")
            or path.startswith("/api/feed/message-")
            or path.startswith("/api/admin/message-analytics")
        )
        if keep:
            ts_iso = current.get("ts_iso")
            ts_dt = parse_iso_utc(str(ts_iso)) if ts_iso else None
            if start_dt and ts_dt and ts_dt < start_dt:
                current = None
                return
            if end_dt and ts_dt and ts_dt > end_dt:
                current = None
                return
            out.append({
                "ts": ts_iso,
                "source": "terminal",
                "signal": msg,
                "message_id": attrs.get("app_message_id") or attrs.get("app.message_id"),
                "message_session_id": attrs.get("app_message_session_id") or attrs.get("app.message_session_id"),
                "trace_id": attrs.get("trace_id"),
                "context": {
                    "level": current.get("level"),
                    "path": path or None,
                    "app_operation": op or None,
                    "app_operation_detail": op_detail or None,
                },
            })
        current = None

    for line in lines:
        m = HEADER_RE.match(line)
        if m:
            flush()
            raw_ts = m.group("ts")
            ts_iso = None
            try:
                # Format example: 2026-03-20 05:58:56.174 +0000
                dt = datetime.strptime(raw_ts, "%Y-%m-%d %H:%M:%S.%f %z")
                ts_iso = dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            except Exception:
                pass
            current = {
                "ts_iso": ts_iso,
                "level": m.group("level"),
                "msg": m.group("msg"),
                "attrs": {},
            }
            continue
        if current is None:
            continue
        km = KV_RE.match(line)
        if km:
            k = km.group("k")
            v = km.group("v")
            current["attrs"][k] = v
    flush()
    return out


def parse_jaeger_events(art_dir: Path, start_us: Optional[int], end_us: Optional[int]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in art_dir.glob("jaeger-*.json"):
        payload = load_json(p)
        if not payload:
            continue
        for tr in payload.get("data", []) or []:
            trace_id = tr.get("traceID")
            for span in tr.get("spans", []) or []:
                if not jaeger_span_in_window(span, start_us, end_us):
                    continue
                name = str(span.get("operationName", ""))
                tags = span_tags_map(span)
                op = str(tags.get("app.operation", "") or "")
                op_detail = str(tags.get("app.operation_detail", "") or "")
                keep = (
                    name.startswith("HTTP ") and (
                        "/api/feed/message-" in name
                        or "/api/admin/message-analytics" in name
                        or "/api/admin/messages" in name
                        or "/admin/message-analytics" in name
                        or "/admin/messages" in name
                        or "/checkout/" in name
                        or "/api/payments/paypal/webhook" in name
                    )
                ) or op.startswith("feed.message") or op.startswith("message.analytics") or op.startswith("payments.")
                if not keep:
                    continue
                out.append({
                    "ts": iso_from_jaeger_micros(span.get("startTime")),
                    "source": "jaeger",
                    "signal": name or op or op_detail or "span",
                    "message_id": tags.get("app.message_id"),
                    "message_session_id": tags.get("app.message_session_id"),
                    "trace_id": trace_id,
                    "context": {
                        "app_operation": op or None,
                        "app_operation_detail": op_detail or None,
                        "span_kind": tags.get("span.kind"),
                    },
                })
    return out


def write_timeline(art_dir: Path, events: List[Dict[str, Any]]) -> None:
    clean = [e for e in events if e.get("ts")]
    clean.sort(key=lambda x: x["ts"])
    ndjson_path = art_dir / "timeline.ndjson"
    with ndjson_path.open("w", encoding="utf-8") as f:
        for e in clean:
            f.write(json.dumps(e, ensure_ascii=True) + "\n")

    top_txt = art_dir / "timeline-top.txt"
    lines = []
    for e in clean[:80]:
        trace_url = e.get("trace_url") or "-"
        lines.append(
            f'{e.get("ts")} | {e.get("source")} | {e.get("signal")} | '
            f'message_id={e.get("message_id") or "-"} session={e.get("message_session_id") or "-"} trace={e.get("trace_id") or "-"} trace_url={trace_url}'
        )
    top_txt.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifacts-dir", required=True)
    ap.add_argument("--window-start-iso")
    ap.add_argument("--window-end-iso")
    ap.add_argument("--jaeger-base-url")
    args = ap.parse_args()
    art_dir = Path(args.artifacts_dir)
    art_dir.mkdir(parents=True, exist_ok=True)

    start_us, end_us = parse_window_bounds(args.window_start_iso, args.window_end_iso)
    preset_rows = build_preset_counts(art_dir, start_us, end_us)
    op_rows = build_http_operation_counts(art_dir, start_us, end_us)
    message_rows = build_message_id_counts(art_dir, start_us, end_us)
    checks = build_expectation_checks(preset_rows)
    write_tsv(art_dir / "jaeger-counts.tsv", preset_rows)
    write_tsv(art_dir / "jaeger-http-operation-counts.tsv", op_rows)
    write_tsv(art_dir / "jaeger-message-id-counts.tsv", message_rows)
    (art_dir / "expectation-checks.txt").write_text("\n".join(checks) + "\n", encoding="utf-8")

    console_events = parse_console_events(art_dir / "console-latest.ndjson", args.window_start_iso, args.window_end_iso)
    terminal_events = parse_terminal_events(art_dir / "terminal-latest.log", args.window_start_iso, args.window_end_iso)
    jaeger_events = parse_jaeger_events(art_dir, start_us, end_us)
    jaeger_base = (args.jaeger_base_url or "").strip().rstrip("/")
    merged = console_events + terminal_events + jaeger_events
    if jaeger_base:
        for e in merged:
            tid = e.get("trace_id")
            if tid:
                e["trace_url"] = f"{jaeger_base}/trace/{tid}"
    write_timeline(art_dir, merged)


if __name__ == "__main__":
    main()
