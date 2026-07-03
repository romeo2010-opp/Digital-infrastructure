from collections.abc import Iterable

from ortools.sat.python import cp_model


def add_at_most_one_groups(
    model: cp_model.CpModel,
    groups: Iterable[list[cp_model.IntVar]],
) -> int:
    count = 0
    for variables in groups:
        if len(variables) > 1:
            model.AddAtMostOne(variables)
            count += 1
    return count


def add_exactly_one(
    model: cp_model.CpModel,
    variables: list[cp_model.IntVar],
) -> None:
    if not variables:
        raise ValueError("Cannot add exactly-one constraint with no variables")
    model.AddExactlyOne(variables)

