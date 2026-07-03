from app.models.common import Facility


def unique_facilities(*groups: list[Facility]) -> list[Facility]:
    seen: set[str] = set()
    result: list[Facility] = []
    for group in groups:
        for facility in group:
            if facility.id not in seen:
                seen.add(facility.id)
                result.append(facility)
    return result

