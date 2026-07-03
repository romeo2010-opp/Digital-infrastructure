from fastapi import HTTPException, Request, status

from app.config import get_settings


async def require_internal_token(request: Request) -> None:
    settings = get_settings()
    header = request.headers.get("authorization", "")
    expected = settings.internal_token.strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Solver internal token is not configured.",
        )
    if not header.startswith("Bearer ") or header.removeprefix("Bearer ").strip() != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid solver credentials.",
        )
