"""In-memory stand-in for the Supabase query builder used by API tests."""

import copy
from collections.abc import Callable, Iterable
from typing import Any
from unittest.mock import MagicMock


class FakeTable:
    """Chainable fake of ``supabase.table(name)`` that applies ``eq`` filters.

    Records every update/insert payload and every deleted row so tests can
    assert what the endpoint wrote.
    """

    def __init__(
        self,
        rows: list[dict[str, Any]],
        on_delete: Callable[[list[dict[str, Any]]], None] | None = None,
    ) -> None:
        self.rows = rows
        # Stand-in for ``ON DELETE`` rules of the database (e.g. ``set null``).
        self.on_delete = on_delete
        self.updates: list[dict[str, Any]] = []
        self.inserts: list[dict[str, Any]] = []
        self.deleted: list[dict[str, Any]] = []
        self._reset()

    def _reset(self) -> None:
        self._operation = "select"
        self._values: Any = None
        self._filters: list[tuple[str, Any]] = []
        self._in_filters: list[tuple[str, set[str]]] = []
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

    def upsert(self, values: dict[str, Any] | list[dict[str, Any]]) -> "FakeTable":
        return self.insert(values)

    def delete(self) -> "FakeTable":
        self._reset()
        self._operation = "delete"
        return self

    def eq(self, column: str, value: Any) -> "FakeTable":
        self._filters.append((column, value))
        return self

    def in_(self, column: str, values: Iterable[Any]) -> "FakeTable":
        self._in_filters.append((column, {str(v) for v in values}))
        return self

    def limit(self, *_args: Any) -> "FakeTable":
        return self

    def single(self) -> "FakeTable":
        self._single = True
        return self

    def execute(self) -> MagicMock:
        operation, values, filters = self._operation, self._values, self._filters
        in_filters = self._in_filters
        single = self._single
        self._reset()
        matched = [
            row
            for row in self.rows
            if all(str(row.get(column)) == str(value) for column, value in filters)
            and all(str(row.get(column)) in allowed for column, allowed in in_filters)
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
            if self.on_delete is not None:
                self.on_delete(matched)
        if single:
            return MagicMock(data=dict(matched[0]) if matched else None)
        return MagicMock(data=[dict(row) for row in matched])


def set_null_on_room_delete(
    *referencing: tuple[FakeTable, tuple[str, ...]],
) -> Callable[[list[dict[str, Any]]], None]:
    """``ON DELETE SET NULL`` for rows that point at deleted rooms.

    Each item is ``(table, columns)``: those columns of the table become ``None``
    when the room they reference is deleted, as the foreign keys of migrations
    013, 014 and 016 do. The real behaviour is checked on PostgreSQL by
    supabase/tests/assertions.sql.
    """

    def handler(deleted: list[dict[str, Any]]) -> None:
        ids = {str(room["id"]) for room in deleted}
        for table, columns in referencing:
            for row in table.rows:
                for column in columns:
                    if str(row.get(column)) in ids:
                        row[column] = None

    return handler


def fake_supabase(
    tables: dict[str, FakeTable],
    rpc: dict[str, Callable[[dict[str, Any]], Any]] | None = None,
) -> MagicMock:
    """Fake client. ``rpc`` maps a database function name to a Python handler.

    A function that is not in ``rpc`` fails loudly (KeyError) instead of silently
    returning a MagicMock "success".
    """
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: tables[name]
    handlers = rpc or {}

    def call_rpc(name: str, params: dict[str, Any] | None = None) -> MagicMock:
        handler = handlers[name]
        call = MagicMock()
        call.execute.side_effect = lambda: MagicMock(data=handler(params or {}))
        return call

    supabase.rpc.side_effect = call_rpc
    return supabase


def fake_replace_dxf_layout(
    tables: dict[str, FakeTable], fail_after_delete: bool = False
) -> Callable[[dict[str, Any]], Any]:
    """Stand-in for the ``replace_dxf_layout`` database function.

    Mirrors its all-or-nothing behaviour: the DXF exits/passages of the drawing are
    replaced, manual ones are kept, and when anything fails (``fail_after_delete``
    simulates a failing write after the old rows were removed) the tables are
    restored, as the transaction would roll back. The real function is exercised on
    PostgreSQL by supabase/tests/check_migrations.sh.
    """

    def handler(params: dict[str, Any]) -> dict[str, int]:
        exits, passages = tables["exits"], tables["passages"]
        snapshot = (copy.deepcopy(exits.rows), copy.deepcopy(passages.rows))
        drawing_id = params["p_drawing_id"]
        try:
            for table in (exits, passages):
                table.rows[:] = [
                    row
                    for row in table.rows
                    if not (
                        row.get("drawing_id") == drawing_id
                        and row.get("source") == "dxf"
                    )
                ]
            if fail_after_delete:
                raise RuntimeError("simulated write failure")
            for item in params.get("p_exits", []):
                exits.rows.append({**item, "drawing_id": drawing_id, "source": "dxf"})
            for item in params.get("p_passages", []):
                passages.rows.append(
                    {**item, "drawing_id": drawing_id, "source": "dxf"}
                )
            for link in params.get("p_manual_exit_rooms", []):
                for row in exits.rows:
                    if row["id"] == link["id"] and row.get("source") == "manual":
                        row["room_id"] = link["room_id"]
            for link in params.get("p_manual_passage_rooms", []):
                for row in passages.rows:
                    if row["id"] == link["id"] and row.get("source") == "manual":
                        row["room_a_id"] = link.get("room_a_id")
                        row["room_b_id"] = link.get("room_b_id")
        except Exception:
            exits.rows[:] = snapshot[0]
            passages.rows[:] = snapshot[1]
            raise
        return {
            "exits": len(params.get("p_exits", [])),
            "passages": len(params.get("p_passages", [])),
        }

    return handler
