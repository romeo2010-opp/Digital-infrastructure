from app.models.common import Diagnostic


def diagnostic(
    code: str,
    message: str,
    severity: str = "ERROR",
    entity_type: str | None = None,
    entity_id: str | None = None,
    **metadata,
) -> Diagnostic:
    return Diagnostic(
        code=code,
        message=message,
        severity=severity,  # type: ignore[arg-type]
        entityType=entity_type,
        entityId=entity_id,
        metadata=metadata,
    )


def hint_from_diagnostic(item: Diagnostic) -> str:
    return item.message

