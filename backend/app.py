from threading import Lock
from typing import Any, Dict

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit

from utils.moderation import ModerationError, check_message_safety

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

_stats_lock = Lock()
_usage_stats: Dict[str, Any] = {
    "total_messages": 0,
    "flagged_messages": 0,
}
_active_users: set[str] = set()


def _update_usage_stats(user: str, flagged: bool) -> None:
    with _stats_lock:
        _usage_stats["total_messages"] += 1
        if flagged:
            _usage_stats["flagged_messages"] += 1
        if user:
            _active_users.add(user)


@app.route("/")
def healthcheck() -> Dict[str, str]:
    return {"status": "ok", "message": "Backend is running"}


@app.route("/test")
def test_route() -> Dict[str, str]:
    return {"status": "ok"}


@app.route("/moderate", methods=["POST"])
def moderate() -> Any:
    payload = request.get_json(silent=True) or {}
    text = payload.get("text", "")

    try:
        moderation_result = check_message_safety(text)
    except ModerationError as exc:
        return jsonify({"error": str(exc)}), 503

    return jsonify(moderation_result)


@app.route("/stats")
def stats() -> Any:
    with _stats_lock:
        response = {
            **_usage_stats,
            "active_users": len(_active_users),
        }
    return jsonify(response)


@socketio.on("send_message")
def handle_send_message(data: Dict[str, Any]) -> None:
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
    socketio.run(app, host="0.0.0.0", port=5000, allow_unsafe_werkzeug=True)
