from __future__ import annotations

import csv
import html
import io
import re
import textwrap
import zipfile
from datetime import datetime, timezone
from typing import Iterable
from xml.sax.saxutils import escape


EXPORT_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc": "application/msword",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
    "csv": "text/csv; charset=utf-8",
    "txt": "text/plain; charset=utf-8",
}
EXPORT_EXT_PATTERN = "|".join(re.escape(ext) for ext in EXPORT_CONTENT_TYPES)
MARKDOWN_LINK_RE = re.compile(r"^\[([^\]]+)\]\(([^)]+)\)$")
EXPORT_BLOCK_RE = re.compile(
    r"```export[^\n]*\bfilename=(?P<quote>[\"']?)(?P<filename>[^\"'\s]+)(?P=quote)[^\n]*\n"
    r"(?P<content>.*?)\n```",
    re.DOTALL | re.IGNORECASE,
)


def export_extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def export_content_type(filename: str) -> str:
    return EXPORT_CONTENT_TYPES[export_extension(filename)]


def is_supported_export(filename: str) -> bool:
    return export_extension(filename) in EXPORT_CONTENT_TYPES


def _is_export_download_line(line: str) -> bool:
    stripped = re.sub(r"^\s*[-*]\s+", "", line.strip())
    if not stripped:
        return False

    link = MARKDOWN_LINK_RE.fullmatch(stripped)
    if link:
        label, target = link.groups()
        return is_supported_export(target) and (
            re.search(r"\bdownload\b", label, re.IGNORECASE) is not None
            or is_supported_export(label)
        )

    return (
        re.fullmatch(
            rf"download\s+.+\.({EXPORT_EXT_PATTERN})",
            stripped,
            flags=re.IGNORECASE,
        )
        is not None
    )


def extract_export_content(filename: str, content: str) -> str | None:
    expected = filename.strip().lower()
    for match in EXPORT_BLOCK_RE.finditer(content or ""):
        block_filename = match.group("filename").strip().lower()
        if block_filename == expected:
            return match.group("content").strip()
    return None


def normalize_export_content(content: str) -> str:
    text = content or ""
    text = re.sub(r"<artifact\b[^>]*>.*?</artifact>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = EXPORT_BLOCK_RE.sub("", text)
    text = "\n".join(line for line in text.splitlines() if not _is_export_download_line(line))
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text.strip() or "No content was provided."


def build_export(filename: str, content: str) -> bytes:
    ext = export_extension(filename)
    export_content = extract_export_content(filename, content)
    normalized = normalize_export_content(export_content if export_content is not None else content)
    return EXPORT_BUILDERS[ext](normalized)


def _plain_text(text: str) -> str:
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"_([^_]+)_", r"\1", text)
    return html.unescape(text).strip()


def _document_blocks(content: str) -> list[dict]:
    blocks: list[dict] = []
    paragraph: list[str] = []
    lines = content.splitlines()
    i = 0

    def flush_paragraph():
        if paragraph:
            blocks.append({"type": "paragraph", "text": _plain_text(" ".join(paragraph))})
            paragraph.clear()

    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped:
            flush_paragraph()
            i += 1
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            flush_paragraph()
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|") and lines[i].strip().endswith("|"):
                table_lines.append(lines[i])
                i += 1
            rows = _markdown_table_rows("\n".join(table_lines))
            if rows:
                blocks.append({"type": "table", "rows": rows})
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            blocks.append(
                {
                    "type": "heading",
                    "level": min(len(heading.group(1)), 3),
                    "text": _plain_text(heading.group(2)),
                }
            )
            i += 1
            continue

        bullet = re.match(r"^[-*]\s+(.+)$", stripped)
        numbered = re.match(r"^\d+[.)]\s+(.+)$", stripped)
        if bullet or numbered:
            flush_paragraph()
            items = []
            ordered = numbered is not None
            while i < len(lines):
                candidate = lines[i].strip()
                match = re.match(r"^\d+[.)]\s+(.+)$", candidate) if ordered else re.match(r"^[-*]\s+(.+)$", candidate)
                if not match:
                    break
                items.append(_plain_text(match.group(1)))
                i += 1
            blocks.append({"type": "list", "ordered": ordered, "items": items})
            continue

        paragraph.append(stripped)
        i += 1

    flush_paragraph()
    return blocks or [{"type": "paragraph", "text": "No content was provided."}]


def _pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _pdf_text(text: str) -> str:
    return _pdf_escape(text.encode("latin-1", "replace").decode("latin-1"))


def build_pdf(content: str) -> bytes:
    pages = _pdf_page_streams(_document_blocks(content))

    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    page_ids: list[int] = []
    for stream in pages:
        stream_id = len(objects) + 1
        objects.append(
            f"<< /Length {len(stream.encode('latin-1', 'replace'))} >>\nstream\n{stream}\nendstream".encode(
                "latin-1",
                "replace",
            )
        )
        page_id = len(objects) + 1
        page_ids.append(page_id)
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {stream_id} 0 R >>".encode(
                "latin-1",
                "replace",
            )
        )
    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects[1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("latin-1")

    body = io.BytesIO()
    body.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(body.tell())
        body.write(f"{idx} 0 obj\n".encode("ascii"))
        body.write(obj)
        body.write(b"\nendobj\n")
    xref = body.tell()
    body.write(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    body.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        body.write(f"{offset:010d} 00000 n \n".encode("ascii"))
    body.write(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode(
            "ascii"
        )
    )
    return body.getvalue()


def _pdf_page_streams(blocks: list[dict]) -> list[str]:
    pages: list[list[str]] = [[]]
    y = 720
    margin_x = 72
    page_bottom = 72

    def new_page():
        nonlocal y
        pages.append([])
        y = 720

    def ensure_space(height: int):
        if y - height < page_bottom:
            new_page()

    def text_line(text: str, *, x: int = margin_x, size: int = 11, font: str = "F1", leading: int = 14):
        nonlocal y
        ensure_space(leading)
        pages[-1].append(f"BT /{font} {size} Tf {x} {y} Td ({_pdf_text(text)}) Tj ET")
        y -= leading

    def wrap(text: str, width: int) -> list[str]:
        return textwrap.wrap(text, width=width, replace_whitespace=False) or [""]

    for block in blocks:
        kind = block["type"]
        if kind == "heading":
            level = block["level"]
            size = {1: 18, 2: 15, 3: 13}[level]
            y -= 4 if y < 720 else 0
            for line in wrap(block["text"], 64 if level == 1 else 78):
                text_line(line, size=size, font="F2", leading=size + 6)
            y -= 4
        elif kind == "paragraph":
            for line in wrap(block["text"], 88):
                text_line(line)
            y -= 6
        elif kind == "list":
            for idx, item in enumerate(block["items"], start=1):
                prefix = f"{idx}. " if block["ordered"] else "- "
                wrapped = wrap(item, 82)
                text_line(prefix + wrapped[0], x=90)
                for continuation in wrapped[1:]:
                    text_line(continuation, x=108)
            y -= 6
        elif kind == "table":
            rows = block["rows"]
            if not rows:
                continue
            col_count = max(len(row) for row in rows)
            col_width = 468 / max(col_count, 1)
            row_height = 22
            for r_idx, row in enumerate(rows):
                ensure_space(row_height)
                y_top = y + 6
                commands = []
                for c_idx in range(col_count):
                    x = margin_x + (c_idx * col_width)
                    cell = _plain_text(row[c_idx]) if c_idx < len(row) else ""
                    commands.append(f"{x:.2f} {y_top - row_height:.2f} {col_width:.2f} {row_height:.2f} re S")
                    font = "F2" if r_idx == 0 else "F1"
                    commands.append(
                        f"BT /{font} 9 Tf {x + 4:.2f} {y_top - 15:.2f} Td ({_pdf_text(textwrap.shorten(cell, width=24, placeholder='...'))}) Tj ET"
                    )
                pages[-1].extend(commands)
                y -= row_height
            y -= 10

    return ["\n".join(page) for page in pages if page] or ["BT /F1 11 Tf 72 720 Td (No content was provided.) Tj ET"]


def build_docx(content: str) -> bytes:
    body_parts = [_docx_block(block) for block in _document_blocks(content)]
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{''.join(body_parts)}<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/>"
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
        "</w:body></w:document>"
    )
    return _zip_bytes(
        {
            "[Content_Types].xml": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/word/document.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                '<Override PartName="/word/styles.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                "</Types>"
            ),
            "_rels/.rels": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="word/document.xml"/></Relationships>'
            ),
            "word/document.xml": document_xml,
            "word/_rels/document.xml.rels": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
                'Target="styles.xml"/></Relationships>'
            ),
            "word/styles.xml": _docx_styles_xml(),
        }
    )


def _docx_styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        '<w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160"/></w:pPr>'
        '<w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
        '<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>'
        '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>'
        '<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="220" w:after="100"/></w:pPr>'
        '<w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/>'
        '<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr>'
        '<w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>'
        "</w:styles>"
    )


def _docx_paragraph(text: str, *, style: str | None = None, indent: int = 0, bold: bool = False) -> str:
    ppr = []
    if style:
        ppr.append(f'<w:pStyle w:val="{style}"/>')
    if indent:
        ppr.append(f'<w:ind w:left="{indent}"/>')
    ppr.append('<w:spacing w:after="120"/>')
    rpr = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return (
        "<w:p>"
        f"<w:pPr>{''.join(ppr)}</w:pPr>"
        f"<w:r>{rpr}<w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r>"
        "</w:p>"
    )


def _docx_table(rows: list[list[str]]) -> str:
    table_rows = []
    for r_idx, row in enumerate(rows):
        cells = []
        for cell in row:
            cells.append(
                "<w:tc><w:tcPr><w:tcMar>"
                '<w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'
                '<w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/>'
                "</w:tcMar></w:tcPr>"
                f"{_docx_paragraph(_plain_text(cell), bold=(r_idx == 0))}</w:tc>"
            )
        table_rows.append(f"<w:tr>{''.join(cells)}</w:tr>")
    return (
        "<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>"
        '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8B8B8"/>'
        '<w:left w:val="single" w:sz="4" w:color="B8B8B8"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="B8B8B8"/>'
        '<w:right w:val="single" w:sz="4" w:color="B8B8B8"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="B8B8B8"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="B8B8B8"/></w:tblBorders>'
        "</w:tblPr>"
        + "".join(table_rows)
        + "</w:tbl>"
    )


def _docx_block(block: dict) -> str:
    kind = block["type"]
    if kind == "heading":
        return _docx_paragraph(block["text"], style=f"Heading{block['level']}")
    if kind == "list":
        out = []
        for idx, item in enumerate(block["items"], start=1):
            prefix = f"{idx}. " if block["ordered"] else "- "
            out.append(_docx_paragraph(prefix + item, indent=360))
        return "".join(out)
    if kind == "table":
        return _docx_table(block["rows"])
    return _docx_paragraph(block["text"])


def build_doc(content: str) -> bytes:
    body = "<br/>".join(html.escape(line) for line in content.splitlines())
    return (
        "<html><head><meta charset=\"utf-8\"></head><body>"
        f"<div style=\"font-family: Arial, sans-serif; font-size: 11pt;\">{body}</div>"
        "</body></html>"
    ).encode("utf-8")


def build_csv(content: str) -> bytes:
    rows = _table_rows(content)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def build_txt(content: str) -> bytes:
    return content.encode("utf-8")


def build_xls(content: str) -> bytes:
    rows = _table_rows(content)
    tr = []
    for row in rows:
        cells = "".join(f"<td>{html.escape(cell)}</td>" for cell in row)
        tr.append(f"<tr>{cells}</tr>")
    return (
        "<html><head><meta charset=\"utf-8\"></head><body><table>"
        + "".join(tr)
        + "</table></body></html>"
    ).encode("utf-8")


def build_xlsx(content: str) -> bytes:
    rows = _table_rows(content)
    sheet_rows = []
    for r_idx, row in enumerate(rows, start=1):
        cells = []
        for c_idx, value in enumerate(row, start=1):
            ref = f"{_column_name(c_idx)}{r_idx}"
            cells.append(
                f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
            )
        sheet_rows.append(f'<row r="{r_idx}">{"".join(cells)}</row>')
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return _zip_bytes(
        {
            "[Content_Types].xml": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/xl/workbook.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                '<Override PartName="/xl/worksheets/sheet1.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                '<Override PartName="/docProps/core.xml" '
                'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
                "</Types>"
            ),
            "_rels/.rels": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="xl/workbook.xml"/>'
                '<Relationship Id="rId2" '
                'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" '
                'Target="docProps/core.xml"/></Relationships>'
            ),
            "docProps/core.xml": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
                'xmlns:dcterms="http://purl.org/dc/terms/" '
                'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
                f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
                "</cp:coreProperties>"
            ),
            "xl/workbook.xml": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
            ),
            "xl/_rels/workbook.xml.rels": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                'Target="worksheets/sheet1.xml"/></Relationships>'
            ),
            "xl/worksheets/sheet1.xml": (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
            ),
        }
    )


def _zip_bytes(files: dict[str, str]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path, data in files.items():
            zf.writestr(path, data)
    return out.getvalue()


def _table_rows(content: str) -> list[list[str]]:
    markdown_rows = _markdown_table_rows(content)
    if markdown_rows:
        return markdown_rows

    parsed_rows = _delimited_rows(content)
    if parsed_rows:
        return parsed_rows

    return [[line] for line in content.splitlines() if line.strip()] or [["No content was provided."]]


def _markdown_table_rows(content: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if cells and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append(cells)
    return rows


def _delimited_rows(content: str) -> list[list[str]]:
    lines = [line for line in content.splitlines() if line.strip()]
    if not lines:
        return []
    delimiter = "\t" if any("\t" in line for line in lines) else ","
    if not any(delimiter in line for line in lines):
        return []
    return [row for row in csv.reader(lines, delimiter=delimiter)]


def _column_name(index: int) -> str:
    chars = []
    while index:
        index, rem = divmod(index - 1, 26)
        chars.append(chr(65 + rem))
    return "".join(reversed(chars))


EXPORT_BUILDERS = {
    "pdf": build_pdf,
    "docx": build_docx,
    "doc": build_doc,
    "xlsx": build_xlsx,
    "xls": build_xls,
    "csv": build_csv,
    "txt": build_txt,
}
