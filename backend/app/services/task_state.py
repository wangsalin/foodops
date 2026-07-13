from app.core.exceptions import AppError

VALID_TASK_STATUSES = {
    "pending_confirm",
    "confirmed",
    "processing",
    "pending_review",
    "closed",
    "archived",
    "overdue",
}

CLOSED_TASK_STATUSES = {"closed", "archived"}
FEEDBACK_ALLOWED_STATUSES = {"processing"}
DISPATCHABLE_STATUSES = {"pending_confirm", "confirmed", "processing", "overdue"}

TASK_STATUS_TRANSITIONS = {
    "pending_confirm": {"confirmed"},
    "confirmed": {"processing"},
    "processing": {"pending_review", "overdue"},
    "pending_review": {"closed", "pending_confirm", "processing", "overdue"},
    "closed": {"archived"},
    "archived": set(),
    "overdue": {"processing"},
}


def ensure_valid_status(status: str) -> None:
    if status not in VALID_TASK_STATUSES:
        raise AppError(
            code="TASK_STATUS_INVALID",
            message="Invalid task status",
            status_code=400,
            detail={"status": status},
        )


def ensure_status_transition(current_status: str, next_status: str) -> None:
    ensure_valid_status(next_status)
    if current_status == next_status:
        return
    allowed = TASK_STATUS_TRANSITIONS.get(current_status, set())
    if next_status not in allowed:
        raise AppError(
            code="TASK_STATUS_INVALID_TRANSITION",
            message="Task status transition is not allowed",
            status_code=409,
            detail={"from": current_status, "to": next_status},
        )


def ensure_feedback_allowed(current_status: str) -> None:
    if current_status in CLOSED_TASK_STATUSES:
        raise AppError(
            code="TASK_ALREADY_CLOSED",
            message="Task is closed and cannot receive feedback",
            status_code=409,
        )
    if current_status not in FEEDBACK_ALLOWED_STATUSES:
        raise AppError(
            code="TASK_STATUS_INVALID_TRANSITION",
            message="Task feedback is only allowed while processing",
            status_code=409,
            detail={"status": current_status},
        )


def ensure_dispatchable(current_status: str) -> None:
    if current_status in CLOSED_TASK_STATUSES:
        raise AppError(
            code="TASK_ALREADY_CLOSED",
            message="Task is closed and cannot generate an H5 link",
            status_code=409,
        )
    if current_status == "pending_review":
        raise AppError(
            code="TASK_FEEDBACK_ALREADY_SUBMITTED",
            message="Task feedback has already been submitted",
            status_code=409,
        )
    if current_status not in DISPATCHABLE_STATUSES:
        raise AppError(
            code="TASK_STATUS_INVALID_TRANSITION",
            message="Task cannot be dispatched from current status",
            status_code=409,
            detail={"status": current_status},
        )
