from app.models.common import BellSlot, OccupancyRecord, slot_overlaps


def slot_index(slot: BellSlot) -> int:
    return int(slot.sortOrder or slot.slotNumber)


def occupied_slot_ids(
    slots: list[BellSlot],
    start_slot_id: str,
    duration: int,
) -> list[str]:
    by_id = {slot.id: slot for slot in slots}
    start = by_id.get(start_slot_id)
    if not start:
        return []
    start_index = slot_index(start)
    end_index = start_index + max(1, int(duration)) - 1
    return [
        slot.id
        for slot in slots
        if slot.teachingAllowed and start_index <= slot_index(slot) <= end_index
    ]


def occupancy_overlaps_slots(
    occupancy: OccupancyRecord,
    slot_numbers: dict[str, int],
    cycle_day_id: str | None,
    start_slot_id: str,
    end_slot_id: str,
) -> bool:
    if occupancy.cycleDayId and cycle_day_id and occupancy.cycleDayId != cycle_day_id:
        return False
    if not occupancy.startSlotId or not occupancy.endSlotId:
        return False
    if occupancy.startSlotId not in slot_numbers or occupancy.endSlotId not in slot_numbers:
        return False
    return slot_overlaps(
        slot_numbers[start_slot_id],
        slot_numbers[end_slot_id],
        slot_numbers[occupancy.startSlotId],
        slot_numbers[occupancy.endSlotId],
    )

