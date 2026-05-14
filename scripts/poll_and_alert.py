#!/usr/bin/env python3
"""Poll Birdeye, persist narrative history, export dashboard data, print only actionable alerts.

Designed for Hermes cron no_agent=True: empty stdout means silent/no alert.
"""
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "radar.sqlite"
LATEST = ROOT / "data" / "latest.json"
PUB_HISTORY = ROOT / "public" / "data" / "history.json"
STATE = ROOT / "data" / "alert_state.json"

MIN_SCORE = int(os.getenv("RADAR_ALERT_MIN_SCORE", "150"))
MIN_SCORE_DELTA = int(os.getenv("RADAR_ALERT_MIN_SCORE_DELTA", "35"))
MIN_AVG_24H = float(os.getenv("RADAR_ALERT_MIN_AVG_24H", "15"))


def run_fetch():
    subprocess.run(["npm", "run", "fetch"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)


def db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          generated_at TEXT NOT NULL,
          chain TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          top_narrative TEXT NOT NULL,
          raw_json TEXT NOT NULL
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS narrative_points (
          snapshot_id INTEGER NOT NULL,
          generated_at TEXT NOT NULL,
          narrative_id TEXT NOT NULL,
          label TEXT NOT NULL,
          score INTEGER NOT NULL,
          token_count INTEGER NOT NULL,
          avg_change_24h REAL NOT NULL,
          total_volume_24h REAL NOT NULL,
          total_liquidity REAL NOT NULL,
          median_fdv REAL NOT NULL,
          PRIMARY KEY (snapshot_id, narrative_id)
        )
        """
    )
    return con


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return default


def save_snapshot(con, data):
    existing = con.execute("SELECT id FROM snapshots WHERE generated_at=?", (data["generatedAt"],)).fetchone()
    if existing:
        return existing[0]
    cur = con.execute(
        "INSERT INTO snapshots(generated_at,chain,token_count,top_narrative,raw_json) VALUES(?,?,?,?,?)",
        (data["generatedAt"], data.get("chain", "solana"), int(data.get("tokenCount", 0)), data.get("topNarrative", "N/A"), json.dumps(data)),
    )
    sid = cur.lastrowid
    for r in data.get("rotations", []):
        con.execute(
            """INSERT OR REPLACE INTO narrative_points
               (snapshot_id,generated_at,narrative_id,label,score,token_count,avg_change_24h,total_volume_24h,total_liquidity,median_fdv)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                sid,
                data["generatedAt"],
                r.get("id", "unknown"),
                r.get("label", "Unknown"),
                int(r.get("score", 0)),
                int(r.get("count", 0)),
                float(r.get("avgChange24h", 0)),
                float(r.get("totalVolume24h", 0)),
                float(r.get("totalLiquidity", 0)),
                float(r.get("medianFdv", 0)),
            ),
        )
    con.commit()
    return sid


def export_history(con):
    rows = con.execute(
        """
        SELECT generated_at,narrative_id,label,score,token_count,avg_change_24h,total_volume_24h,total_liquidity,median_fdv
        FROM narrative_points
        WHERE snapshot_id IN (SELECT id FROM snapshots ORDER BY generated_at DESC LIMIT 96)
        ORDER BY generated_at ASC, score DESC
        """
    ).fetchall()
    points = [
        {
            "generatedAt": a,
            "id": i,
            "label": l,
            "score": s,
            "count": c,
            "avgChange24h": ch,
            "totalVolume24h": v,
            "totalLiquidity": liq,
            "medianFdv": fdv,
        }
        for a, i, l, s, c, ch, v, liq, fdv in rows
    ]
    latest_by_id = {}
    for p in points:
        latest_by_id[p["id"]] = p
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "points": points,
        "latest": sorted(latest_by_id.values(), key=lambda x: x["score"], reverse=True),
    }
    PUB_HISTORY.parent.mkdir(parents=True, exist_ok=True)
    PUB_HISTORY.write_text(json.dumps(payload, indent=2))
    (ROOT / "data" / "history.json").write_text(json.dumps(payload, indent=2))
    return payload


def fmt_usd(n):
    n = float(n or 0)
    for unit in ["", "K", "M", "B"]:
        if abs(n) < 1000:
            return f"${n:.1f}{unit}"
        n /= 1000
    return f"${n:.1f}T"


def compute_alerts(data):
    prev = load_json(STATE, {"scores": {}, "last_alerted": {}})
    prev_scores = prev.get("scores", {})
    now_scores = {}
    alerts = []
    for r in data.get("rotations", []):
        rid = r.get("id", "unknown")
        if rid == "other":
            continue
        score = int(r.get("score", 0))
        old = int(prev_scores.get(rid, 0))
        delta = score - old
        avg = float(r.get("avgChange24h", 0))
        now_scores[rid] = score
        if score >= MIN_SCORE and (delta >= MIN_SCORE_DELTA or (old == 0 and avg >= MIN_AVG_24H)):
            top_tokens = ", ".join([t.get("symbol") or "?" for t in r.get("tokens", [])[:5]])
            alerts.append(
                f"🚨 Narrative rotate: {r.get('label')}\n"
                f"score {score} ({delta:+d}), avg24h {avg:+.1f}%, vol {fmt_usd(r.get('totalVolume24h'))}, liq {fmt_usd(r.get('totalLiquidity'))}\n"
                f"top tokens: {top_tokens}\n"
                f"dashboard: http://localhost:4173"
            )
    # Store all scores including other, so first run doesn't spam forever after same scores.
    for r in data.get("rotations", []):
        now_scores[r.get("id", "unknown")] = int(r.get("score", 0))
    STATE.write_text(json.dumps({"updatedAt": data.get("generatedAt"), "scores": now_scores}, indent=2))
    return alerts


def main():
    run_fetch()
    data = json.loads(LATEST.read_text())
    con = db()
    save_snapshot(con, data)
    export_history(con)
    alerts = compute_alerts(data)
    if alerts:
        print("\n\n".join(alerts))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        err = (e.stderr or str(e)).strip()
        print(f"Birdeye Narrative Radar ERROR: {err[:700]}")
        sys.exit(1)
    except Exception as e:
        print(f"Birdeye Narrative Radar ERROR: {e}")
        sys.exit(1)
