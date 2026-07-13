from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlalchemy.orm import Session

from app.api.relay import decode_relay_token
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import current_tenant_id, current_user_id
from app.core.exceptions import AppError

router = APIRouter(prefix="/v1/uploads", tags=["uploads"])

ALLOWED_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


@router.post("/images", status_code=201)
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    relay_token: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> dict:
    if relay_token:
        claims = decode_relay_token(relay_token)
        tenant_id = claims["tenant_id"]
    else:
        tenant_id = current_tenant_id(request)
        current_user_id(request)
    return await save_image(file, relative_dir=Path("images") / tenant_id)


@router.post("/store-task-feedback", status_code=201)
async def upload_store_task_feedback(
    relay_token: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    claims = decode_relay_token(relay_token)
    return await save_image(file, relative_dir=Path("task-feedback") / claims["tenant_id"])


async def save_image(file: UploadFile, *, relative_dir: Path) -> dict:
    suffix = ALLOWED_IMAGE_TYPES.get(str(file.content_type or "").lower())
    if not suffix:
        raise AppError(code="UPLOAD_TYPE_INVALID", message="Only PNG, JPG and WebP images are supported", status_code=400)

    content = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise AppError(code="UPLOAD_TOO_LARGE", message=f"File exceeds {settings.max_upload_size_mb}MB", status_code=413)

    upload_root = Path(settings.upload_dir)
    target_dir = upload_root / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}{suffix}"
    target = target_dir / filename
    target.write_bytes(content)
    url = "/" + str(Path("uploads") / relative_dir / filename).replace("\\", "/")
    return {"url": url, "content_type": file.content_type, "size": len(content)}
