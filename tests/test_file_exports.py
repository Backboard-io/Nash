from __future__ import annotations

import io
import zipfile
import unittest

from flask import Flask, g

from api.routes import files


class FileExportTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    def _export(self, filename: str, content: str):
        with self.app.test_request_context(
            "/api/files/export",
            method="POST",
            json={"filename": filename, "content": content},
        ):
            g.user_id = "user-1"
            g.session_key = "session-1"
            return files.export_file.__wrapped__()

    def test_exports_pdf(self):
        response = self._export("report.pdf", "# Quarterly report\n\nRevenue is up.")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "application/pdf")
        self.assertTrue(response.data.startswith(b"%PDF-1.4"))
        self.assertIn(b"Quarterly report", response.data)
        self.assertIn(b"Helvetica-Bold", response.data)

    def test_export_strips_generated_download_link_from_pdf(self):
        response = self._export(
            "hello.pdf",
            "Hello\n\n[Download hello.pdf](hello.pdf)",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Hello", response.data)
        self.assertNotIn(b"Download hello.pdf", response.data)

    def test_export_strips_plain_generated_download_line_from_pdf(self):
        response = self._export("hello.pdf", "Hello\n\nDownload hello.pdf")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Hello", response.data)
        self.assertNotIn(b"Download hello.pdf", response.data)

    def test_exports_docx(self):
        response = self._export("report.docx", "# Quarterly report\n\nRevenue is up.")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.mimetype,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        with zipfile.ZipFile(io.BytesIO(response.data)) as zf:
            self.assertIn("word/document.xml", zf.namelist())
            self.assertIn("word/styles.xml", zf.namelist())
            document_xml = zf.read("word/document.xml").decode()
            self.assertIn("Quarterly report", document_xml)
            self.assertIn('w:pStyle w:val="Heading1"', document_xml)

    def test_docx_exports_markdown_table_as_table(self):
        response = self._export(
            "report.docx",
            "| Name | Value |\n| --- | --- |\n| Revenue | 100 |",
        )

        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.data)) as zf:
            document_xml = zf.read("word/document.xml").decode()
            self.assertIn("<w:tbl>", document_xml)
            self.assertIn("Revenue", document_xml)

    def test_exports_xlsx_from_markdown_table(self):
        response = self._export(
            "report.xlsx",
            "| Name | Value |\n| --- | --- |\n| Revenue | 100 |\n| Cost | 40 |",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.mimetype,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        with zipfile.ZipFile(io.BytesIO(response.data)) as zf:
            sheet = zf.read("xl/worksheets/sheet1.xml").decode()
            self.assertIn("Revenue", sheet)
            self.assertIn("100", sheet)

    def test_xlsx_prefers_matching_export_block_over_visible_summary(self):
        response = self._export(
            "resume_score_rating.xlsx",
            (
                "I created an Excel-style resume scorecard based on the resume.\n\n"
                "It includes an overall resume score and category ratings.\n\n"
                "```export filename=\"resume_score_rating.xlsx\"\n"
                "| Category | Score | Notes |\n"
                "| --- | --- | --- |\n"
                "| Overall | 88 / 100 | Strong resume |\n"
                "| Technical skills | 90 / 100 | Clear skills section |\n"
                "```\n\n"
                "[Download resume_score_rating.xlsx](resume_score_rating.xlsx)"
            ),
        )

        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.data)) as zf:
            sheet = zf.read("xl/worksheets/sheet1.xml").decode()
            self.assertIn("Overall", sheet)
            self.assertIn("88 / 100", sheet)
            self.assertNotIn("I created an Excel-style resume scorecard", sheet)
            self.assertNotIn("Download resume_score_rating.xlsx", sheet)

    def test_rejects_unsupported_export_type(self):
        response, status = self._export("report.exe", "content")

        self.assertEqual(status, 400)
        self.assertEqual(response.get_json()["error"], "Unsupported export file type")


if __name__ == "__main__":
    unittest.main()
