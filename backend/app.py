"""Flask application powering SafeSpace backend services.

This module wires together the moderation routes, focus-mode helpers,
dashboard asset serving, and Socket.IO chat bridge used by the browser
extension and dashboard UI.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict

from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit

from utils.moderation import (
    ModerationError,
    check_message_safety,
    get_all_keywords,
)

app = Flask(__name__)
CORS(app)  # Allow extension & dashboard requests from chrome-extension:// origins.
socketio = SocketIO(app, cors_allowed_origins="*")

_stats_lock = Lock()
# Running counters + caches guarded by `_stats_lock`.
_usage_stats: Dict[str, Any] = {
    "total_messages": 0,
    "flagged_messages": 0,
}
_active_users: set[str] = set()
_flagged_messages: list[Dict[str, Any]] = []
_FLAGGED_HISTORY_LIMIT = 200
_focus_state: Dict[str, Any] = {
    "active": False,
    "started_at": None,
    "blocked_sites": [],
    "total_focus_time": timedelta(),
}
_message_history: list[Dict[str, Any]] = []
DASHBOARD_DIR = Path(__file__).resolve().parent.parent / "dashboard"
EXTENSION_DIR = Path(__file__).resolve().parent.parent / "extension"


def _update_usage_stats(user: str, flagged: bool) -> None:
    """Increment counters and keep a short audit of moderated messages."""
    with _stats_lock:
        _usage_stats["total_messages"] += 1
        if flagged:
            _usage_stats["flagged_messages"] += 1
        if user:
            _active_users.add(user)
        _message_history.append(
            {
                "user": user or "unknown",
                "flagged": bool(flagged),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        if len(_message_history) > 1000:
            _message_history.pop(0)


def _record_flagged_message(user: str, text: str, categories: Dict[str, Any]) -> None:
    """Store a trimmed history of flagged messages for the dashboard."""
    entry = {
        "user": user or "unknown",
        "text": text,
        "categories": categories,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    with _stats_lock:
        _flagged_messages.append(entry)
        if len(_flagged_messages) > _FLAGGED_HISTORY_LIMIT:
            _flagged_messages.pop(0)


def _focus_status_snapshot() -> Dict[str, Any]:
    """Compute focus statistics without acquiring locks (call inside guarded sections)."""
    active = _focus_state["active"]
    started_at = _focus_state["started_at"]
    total_focus = _focus_state["total_focus_time"]
    blocked_sites = list(_focus_state["blocked_sites"])

    if active and started_at:
        elapsed = datetime.now(timezone.utc) - started_at
    else:
        elapsed = timedelta()

    total_seconds = int((total_focus + elapsed).total_seconds())

    return {
        "active": active,
        "started_at": started_at.isoformat() if started_at else None,
        "duration_seconds": total_seconds,
        "blocked_sites": blocked_sites,
    }


def _get_focus_status() -> Dict[str, Any]:
    """Thread-safe accessor for focus state."""
    with _stats_lock:
        return _focus_status_snapshot()


@app.route("/")
def healthcheck() -> Dict[str, str]:
    """Basic liveness probe."""
    return {"status": "ok", "message": "Backend is running"}


@app.route("/test")
def test_route() -> Dict[str, str]:
    """Legacy helper used by the extension popup."""
    return {"status": "ok"}


@app.route("/moderate", methods=["POST"])
def moderate() -> Any:
    """Keyword-based moderation endpoint used by the extension + chat."""
    payload = request.get_json(silent=True) or {}
    text = payload.get("text", "")

    try:
        moderation_result = check_message_safety(text)
    except ModerationError as exc:
        return jsonify({"error": str(exc)}), 503

    if moderation_result.get("flagged"):
        _record_flagged_message(
            payload.get("user") or "api",
            text,
            moderation_result.get("categories", {}),
        )

    _update_usage_stats(payload.get("user") or "api", bool(moderation_result.get("flagged")))

    return jsonify(moderation_result)


@app.route("/moderation/keywords")
def moderation_keywords() -> Any:
    """Expose keyword list so the extension can stay in sync."""
    return jsonify({"keywords": get_all_keywords()})


@app.route("/stats")
def stats() -> Any:
    """Return aggregate stats for the dashboard."""
    with _stats_lock:
        total_messages = len(_message_history)
        flagged_messages = sum(1 for entry in _message_history if entry["flagged"])
        response = {
            "total_messages": total_messages,
            "flagged_messages": flagged_messages,
            "active_users": len(_active_users),
            "flagged_recent": len(_flagged_messages),
            "focus_active": _focus_state["active"],
            "focus_duration_seconds": _focus_status_snapshot()["duration_seconds"],
        }
    return jsonify(response)


@app.route("/flagged")
def flagged_messages() -> Any:
    """Expose recently flagged messages."""
    with _stats_lock:
        return jsonify({"messages": list(_flagged_messages)})


@app.route("/dashboard/")
def dashboard_index() -> Any:
    """Serve the dashboard landing page."""
    if not DASHBOARD_DIR.exists():
        return (
            "<h1>Dashboard not found</h1><p>The dashboard directory is missing.</p>",
            404,
        )
    return send_from_directory(DASHBOARD_DIR, "index.html")


@app.route("/dashboard/<path:resource>")
def dashboard_assets(resource: str) -> Any:
    """Serve static dashboard assets (CSS, JS)."""
    if not DASHBOARD_DIR.exists():
        return jsonify({"error": "dashboard directory not found"}), 404
    return send_from_directory(DASHBOARD_DIR, resource)


@app.route("/extension/<path:resource>")
def extension_assets(resource: str) -> Any:
    """Allow dashboard to reference extension assets (e.g., logo)."""
    target = (EXTENSION_DIR / resource).resolve()
    extension_root = EXTENSION_DIR.resolve()
    try:
        target.relative_to(extension_root)
    except ValueError:
        abort(404)
    if not target.exists() or not target.is_file():
        abort(404)
    return send_from_directory(target.parent, target.name)


@app.route("/focus/start", methods=["POST"])
def focus_start() -> Any:
    """Begin focus mode and track blocked sites."""
    payload = request.get_json(silent=True) or {}
    sites = payload.get("blocked_sites") or payload.get("sites") or []
    now = datetime.now(timezone.utc)

    with _stats_lock:
        if not _focus_state["active"]:
            _focus_state["started_at"] = now
            _focus_state["active"] = True
        _focus_state["blocked_sites"] = list({site.lower() for site in sites})

    status = _get_focus_status()
    socketio.emit("focus_status", status)
    return jsonify(status)


@app.route("/focus/stop", methods=["POST"])
def focus_stop() -> Any:
    """Stop focus mode and accumulate total focus time."""
    now = datetime.now(timezone.utc)
    with _stats_lock:
        if _focus_state["active"] and _focus_state["started_at"]:
            _focus_state["total_focus_time"] += now - _focus_state["started_at"]
        _focus_state["active"] = False
        _focus_state["started_at"] = None

    status = _get_focus_status()
    socketio.emit("focus_status", status)
    return jsonify(status)


@app.route("/focus/status")
def focus_status() -> Any:
    """Return the current focus status snapshot."""
    status = _get_focus_status()
    return jsonify(status)


@socketio.on("send_message")
def handle_send_message(data: Dict[str, Any]) -> None:
    """Moderate chat messages from the Socket.IO channel."""
    payload = data or {}
    message = payload.get("message") or payload.get("text") or ""
    user = payload.get("user") or "anonymous"

    try:
        moderation_result = check_message_safety(message)
    except ModerationError as exc:
        emit(
            "message_response",
            {
                "user": user,
                "text": message,
                "flagged": False,
                "categories": {},
                "error": str(exc),
            },
            room=request.sid,
        )
        return

    flagged = moderation_result["flagged"]
    _update_usage_stats(user, flagged)

    if flagged:
        _record_flagged_message(
            user,
            message,
            moderation_result.get("categories", {}),
        )

    socketio.emit(
        "message_response",
        {
            "user": user,
            "text": message,
            "flagged": flagged,
            "categories": moderation_result.get("categories", {}),
        },
    )


if __name__ == "__main__":
    # Werkzeug is fine for the hackathon demo; production should run gunicorn + eventlet/uvicorn.
    socketio.run(app, host="0.0.0.0", port=5000, allow_unsafe_werkzeug=True)
