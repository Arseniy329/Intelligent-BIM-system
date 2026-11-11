"""In-memory stand-in for the Supabase query builder used by API tests."""

from typing import Any
from unittest.mock import MagicMock


class FakeTable:
    """Chainable fake of ``supabase.table(name)`` that applies ``eq`` filters.

    Records every update/insert payload and every deleted row so tests can
    assert what the endpoint wrote.
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.updates: list[dict[str, Any]] = []
        self.inserts: list[dict[str, Any]] = []
        self.deleted: list[dict[str, Any]] = []
        self._reset()

    def _reset(self) -> None:
        self._operation = "select"
        self._values: Any = None
        self._filters: list[tuple[str, Any]] = []
        self._single = False

    def select(self, *_args: Any) -> "FakeTable":
        self._reset()
        return self

    def update(self, values: dict[str, Any]) -> "FakeTable":
        self._reset()
        self._operation = "update"
        self._values = values
        self.updates.append(values)
        return self

    def insert(self, values: dict[str, Any] | list[dict[str, Any]]) -> "FakeTable":
        self._reset()
        self._operation = "insert"
        self._values = values
        self.inserts.extend(values if isinstance(values, list) else [values])
        return self

    def delete(self) -> "FakeTable":
        self._reset()
        self._operation = "delete"
        return self

    def eq(self, column: str, value: Any) -> "FakeTable":
        self._filters.append((column, value))
        return self

    def limit(self, *_args: Any) -> "FakeTable":
        return self

    def single(self) -> "FakeTable":
        self._single = True
        return self

    def execute(self) -> MagicMock:
        operation, values, filters = self._operation, self._values, self._filters
        single = self._single
        self._reset()
        matched = [
            row
            for row in self.rows
            if all(str(row.get(column)) == str(value) for column, value in filters)
        ]

        if operation == "insert":
            new_rows = [
                dict(row) for row in (values if isinstance(values, list) else [values])
            ]
            self.rows.extend(new_rows)
            return MagicMock(data=[dict(row) for row in new_rows])
        if operation == "update":
            for row in matched:
                row.update(values)
        elif operation == "delete":
            self.deleted.extend(matched)
            self.rows[:] = [
                row for row in self.rows if not any(row is m for m in matched)
            ]
        if single:
            return MagicMock(data=dict(matched[0]) if matched else None)
        return MagicMock(data=[dict(row) for row in matched])


def fake_supabase(tables: dict[str, FakeTable]) -> MagicMock:
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: tables[name]
    return supabase
