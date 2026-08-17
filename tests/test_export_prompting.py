from api.routes.chat import (
    _create_document_export_file,
    sanitize_leaked_export_instructions,
)


# Document-export intent is no longer detected with regex — the export tool is
# offered on every non-MCP turn and the MODEL decides when to call it, flowing
# through the normal streaming tool path (_stream_with_tools →
# _execute_export_tool_calls → _merge_export_links). The execution +
# file-writing logic below is unchanged and still fully tested.


def test_sanitizer_removes_leaked_instruction_and_preserves_export_download_card():
    old_leaked_instruction = (
        "If the user wants a downloadable PDF, Word document, spreadsheet, CSV, or text file, "
        "include the exact file body in a fenced code block with language export and a filename, "
        "for example ```export filename=\"report.pdf\". For PDF/Word/text exports, put only the document body "
        "inside that export block. For Excel/CSV exports, put only a markdown table or CSV rows inside that export block. "
        "After the export block, include a final markdown link whose href is the same filename, for example "
        "[Download report.pdf](report.pdf). Keep the visible chat summary separate from the export block. "
        "Use .docx for Word and .xlsx for Excel unless the user explicitly asks for .doc, .xls, .csv, or .txt. "
        "Do not provide browser print/save-as instructions when a downloadable file was requested."
    )
    contaminated = (
        "Here is your file.\n\n"
        "[Export instruction for assistant: "
        f"{old_leaked_instruction}"
        "]\n\n"
        "```export filename=\"hello.pdf\"\nhello\n```\n\n"
        "[Download hello.pdf](hello.pdf)"
    )

    cleaned = sanitize_leaked_export_instructions(contaminated)

    assert "Export instruction for assistant" not in cleaned
    assert "```export filename=\"hello.pdf\"\nhello\n```" in cleaned
    assert "[Download hello.pdf](hello.pdf)" in cleaned


def test_sanitizer_holds_partial_leaked_instruction():
    contaminated = "Visible text\n\n[Export instruction for assistant: If the user wants"

    assert sanitize_leaked_export_instructions(contaminated) == "Visible text"


def test_create_document_export_file_writes_downloadable_pdf(tmp_path, monkeypatch):
    from api.routes import files

    stored = {}
    monkeypatch.setattr(files, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(
        "api.routes.chat.state_service.file_meta.put",
        lambda partition_id, file_id, row: stored.update(
            {"partition_id": partition_id, "file_id": file_id, "row": row}
        ),
    )

    result = _create_document_export_file(
        partition_id="user-1",
        dir_key="user-1",
        filename="hello.pdf",
        content="hello",
    )

    assert result["filename"] == "hello.pdf"
    assert result["url"].startswith("/api/files/download/user-1/export_")
    assert stored["partition_id"] == "user-1"
    assert stored["row"]["filename"] == "hello.pdf"
    assert (tmp_path / "user-1").exists()
    assert (tmp_path / "user-1" / f"{stored['file_id']}_hello.pdf").exists()


def test_create_document_export_file_writes_code_as_plain_text(tmp_path, monkeypatch):
    from api.routes import files

    stored = {}
    monkeypatch.setattr(files, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(
        "api.routes.chat.state_service.file_meta.put",
        lambda partition_id, file_id, row: stored.update(
            {"partition_id": partition_id, "file_id": file_id, "row": row}
        ),
    )

    result = _create_document_export_file(
        partition_id="user-1",
        dir_key="user-1",
        filename="app.py",
        content="print('hello')\n",
    )

    path = tmp_path / "user-1" / f"{stored['file_id']}_app.py"
    assert result["filename"] == "app.py"
    assert stored["row"]["type"] == "text/plain; charset=utf-8"
    assert path.read_text() == "print('hello')\n"
