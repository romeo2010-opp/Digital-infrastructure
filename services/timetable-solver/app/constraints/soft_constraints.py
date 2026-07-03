from ortools.sat.python import cp_model


def weighted_bool(var: cp_model.IntVar, weight: int) -> cp_model.LinearExpr:
    return var * int(weight)

