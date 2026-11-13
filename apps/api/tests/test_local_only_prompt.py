from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PROMPT = ROOT / "docs" / "specs" / "local-only-verification.md"
DENYLIST = ROOT / "docs" / "specs" / "local-only-verification.denylist.txt"


def _read(path: Path) -> str:
    assert path.is_file(), f"Missing required file: {path}"
    return path.read_text(encoding="utf-8")


def _denylist_entries() -> list[str]:
    entries = []
    for raw_line in _read(DENYLIST).splitlines():
        line = raw_line.strip().lower()
        if line and not line.startswith("#"):
            entries.append(line)
    return entries


def _matches_invocation(line: str, entry: str) -> bool:
    entry_tokens = entry.split()
    line_tokens = line.split()
    span = len(entry_tokens)
    for start in range(len(line_tokens) - span):
        if line_tokens[start:start + span] == entry_tokens:
            return True
    return False


def test_local_only_prompt_exists() -> None:
    assert PROMPT.is_file()
    assert DENYLIST.is_file()


def test_prompt_lists_allowed_one_shot_commands() -> None:
    prompt_text = _read(PROMPT)
    allowed = [
        "python -m pytest",
        "ruff check",
        "npm test -- --run",
        "vitest run",
        "tsc --noEmit",
    ]
    for command in allowed:
        assert command in prompt_text, f"Missing allowed command: {command}"


def test_prompt_references_denylist() -> None:
    prompt_text = _read(PROMPT)
    assert "local-only-verification.denylist.txt" in prompt_text


def test_denylist_covers_prohibited_infrastructure() -> None:
    entries = _denylist_entries()
    assert len(entries) >= 8
    assert len(entries) == len(set(entries))
    for entry in entries:
        assert entry.strip(), "Denylist contains a blank entry"


def test_prompt_contains_no_prohibited_commands() -> None:
    prompt_text = _read(PROMPT)
    lowered = prompt_text.lower()
    entries = _denylist_entries()
    for entry in entries:
        assert entry not in lowered, f"Prompt contains prohibited command: {entry}"
    for line in lowered.splitlines():
        for entry in entries:
            assert not _matches_invocation(line, entry), (
                f"Prompt contains long-running invocation for entry: {entry}"
            )


def test_prompt_declares_one_shot_and_timeout_safety() -> None:
    lowered = _read(PROMPT).lower()
    assert "one-shot" in lowered
    assert "300" in lowered
