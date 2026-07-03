from app.models.common import BellSlot, CycleDay


def early_slot_penalty(slot: BellSlot) -> int:
    return max(0, int(slot.sortOrder or slot.slotNumber) - 1)


def day_sort(day: CycleDay) -> int:
    return int(day.sortOrder or 0)


def clamp_time_limit(value: int, default: int = 20, maximum: int = 180) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(1, min(maximum, parsed))

