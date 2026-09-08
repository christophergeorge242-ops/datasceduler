from datetime import datetime
from pathlib import Path
import json
import sqlite3
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
DATABASE = Path(app.root_path) / "planner.db"

TIME_WINDOWS = {
    "Morning": (8, 12),
    "Afternoon": (12, 17),
    "Evening": (17, 21),
    "Anytime": (8, 21),
}


def database():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("CREATE TABLE IF NOT EXISTS planner_state (id INTEGER PRIMARY KEY CHECK (id = 1), tasks TEXT NOT NULL DEFAULT '[]', busy_blocks TEXT NOT NULL DEFAULT '[]')")
    connection.execute("INSERT OR IGNORE INTO planner_state (id) VALUES (1)")
    connection.commit()
    return connection


def time_label(hour, minute=0):
    suffix = "AM" if hour < 12 else "PM"
    display = hour % 12 or 12
    return f"{display}:{minute:02d} {suffix}"


def schedule_tasks(tasks, busy_blocks=None, current_date=None, current_minutes=None):
    """Plan from the user's local current time, respecting same-day due times."""
    try:
        today = datetime.strptime(current_date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        today = datetime.now().date()
    try:
        now_minutes = max(0, min(24 * 60 - 1, int(current_minutes)))
    except (TypeError, ValueError):
        local_now = datetime.now()
        now_minutes = local_now.hour * 60 + local_now.minute

    parsed = []
    for task in tasks:
        try:
            deadline = datetime.strptime(task.get("deadline", ""), "%Y-%m-%d").date()
            duration = max(15, int(task.get("duration", 30)))
        except (TypeError, ValueError):
            continue
        try:
            due_hour, due_minute = map(int, (task.get("dueTime") or "23:59").split(":"))
            due_minutes = due_hour * 60 + due_minute
            if not 0 <= due_minutes < 24 * 60:
                raise ValueError
        except (AttributeError, TypeError, ValueError):
            due_minutes = 23 * 60 + 59
        parsed.append({**task, "deadline_date": deadline, "duration": duration, "due_minutes": due_minutes})

    priority_value = {"High": 3, "Medium": 2, "Low": 1}
    parsed.sort(key=lambda t: (t["deadline_date"], -priority_value.get(t.get("priority"), 2)))

    busy = []
    for block in busy_blocks or []:
        try:
            start_parts = list(map(int, block.get("start", "").split(":")))
            end_parts = list(map(int, block.get("end", "").split(":")))
            start, end = start_parts[0] * 60 + start_parts[1], end_parts[0] * 60 + end_parts[1]
            if end > start:
                busy.append((start, end))
        except (AttributeError, TypeError, ValueError, IndexError):
            continue
    busy.sort()

    def first_open_slot(start, latest_end, duration):
        candidate = start
        for block_start, block_end in busy:
            if candidate + duration <= block_start:
                return candidate if candidate + duration <= latest_end else None
            if candidate < block_end and candidate + duration > block_start:
                candidate = block_end
        return candidate if candidate + duration <= latest_end else None

    cursor = max(8 * 60, now_minutes)
    scheduled = []
    for task in parsed:
        if task["deadline_date"] < today:
            scheduled.append({**task, "unscheduled": True, "reason": "Deadline has passed"})
            continue
        start_hour, end_hour = TIME_WINDOWS.get(task.get("preferredTime"), TIME_WINDOWS["Anytime"])
        # On the due date, the selected due time is a hard finish-by limit.
        latest_end = min(22 * 60, task["due_minutes"]) if task["deadline_date"] == today else 22 * 60
        start = first_open_slot(max(cursor, start_hour * 60), min(end_hour * 60, latest_end), task["duration"])
        if start is None:
            start = first_open_slot(max(cursor, end_hour * 60), latest_end, task["duration"])
        if start is None:
            scheduled.append({**task, "unscheduled": True, "reason": "Not enough time before due time" if task["deadline_date"] == today else "No open time today"})
            continue
        end = start + task["duration"]
        scheduled.append({
            **task,
            "start": time_label(start // 60, start % 60),
            "end": time_label(end // 60, end % 60),
            "startMinutes": start,
            "endMinutes": end,
            "isToday": task["deadline_date"] == today,
        })
        cursor = end + 10  
    return scheduled


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/schedule")
def create_schedule():
    payload = request.get_json(silent=True) or {}
    tasks = payload.get("tasks", [])
    if not isinstance(tasks, list):
        return jsonify({"error": "Tasks must be a list."}), 400
    return jsonify({"schedule": schedule_tasks(tasks, payload.get("busyBlocks", []), payload.get("currentDate"), payload.get("currentMinutes"))})


@app.get("/api/state")
def get_state():
    with database() as connection:
        state = connection.execute("SELECT tasks, busy_blocks FROM planner_state WHERE id = 1").fetchone()
    return jsonify({"tasks": json.loads(state["tasks"]), "busyBlocks": json.loads(state["busy_blocks"])})


@app.put("/api/state")
def save_state():
    payload = request.get_json(silent=True) or {}
    tasks, busy_blocks = payload.get("tasks", []), payload.get("busyBlocks", [])
    if not isinstance(tasks, list) or not isinstance(busy_blocks, list):
        return jsonify({"error": "Tasks and unavailable blocks must be lists."}), 400
    with database() as connection:
        connection.execute("UPDATE planner_state SET tasks = ?, busy_blocks = ? WHERE id = 1", (json.dumps(tasks), json.dumps(busy_blocks)))
        connection.commit()
    return jsonify({"saved": True})


if __name__ == "__main__":
    app.run(debug=True)
