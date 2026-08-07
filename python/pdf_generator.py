"""
Modern Professional Report PDF Generator
---------------------------------------
Drop-in replacement for the existing ReportLab PDF generator.

Key upgrades:
- Modern cover page with branded hero panel and metadata card
- Cleaner typography and spacing
- Adaptive, less-dense tables with repeated headers
- Modern indicator/assessment cards
- Yes/No status pills
- Refined conclusion callouts
- Cleaner headers, footers, page numbering and document chrome
- Markdown headings, bold, italic, code and simple lists

Expected input:
    messages = [
        {"role": "assistant", "content": "...", "timestamp": "..."},
        ...
    ]

Public interface is intentionally kept compatible:
    generate_chat_pdf(messages, output_path="output.pdf")
"""

from datetime import datetime
from xml.sax.saxutils import escape
import json
import re
import sys

from reportlab.lib import colors
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# -----------------------------------------------------------------------------
# DESIGN TOKENS - change these to rebrand the whole PDF in one place
# -----------------------------------------------------------------------------
NAVY = HexColor("#12304A")
BLUE = HexColor("#2878B5")
BLUE_DARK = HexColor("#1D5D8D")
TEAL = HexColor("#1D8F8A")
INK = HexColor("#18212B")
MUTED = HexColor("#687582")
BORDER = HexColor("#DCE4EA")
SURFACE = HexColor("#F7F9FB")
SURFACE_BLUE = HexColor("#EEF5FA")
SURFACE_TEAL = HexColor("#ECF8F6")
SUCCESS = HexColor("#1C7C54")
SUCCESS_BG = HexColor("#EAF6F0")
DANGER = HexColor("#B33A3A")
DANGER_BG = HexColor("#FBECEC")
WARNING = HexColor("#9A6817")
WARNING_BG = HexColor("#FFF6DF")
WHITE = white
PAGE_W, PAGE_H = A4

LEFT_MARGIN = 1.65 * cm
RIGHT_MARGIN = 1.65 * cm
TOP_MARGIN = 2.15 * cm
BOTTOM_MARGIN = 1.75 * cm
CONTENT_WIDTH = PAGE_W - LEFT_MARGIN - RIGHT_MARGIN


# -----------------------------------------------------------------------------
# HELPERS
# -----------------------------------------------------------------------------
def _safe(text):
    """Escape text for ReportLab Paragraph XML while preserving None safely."""
    return escape(str(text or ""))


def _inline_markup(text):
    """Convert a small, safe subset of markdown into ReportLab paragraph markup."""
    text = _safe(text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", text)
    text = re.sub(
        r"`([^`]+)`",
        r'<font face="Courier" color="#52606D">\1</font>',
        text,
    )
    return text


def _is_numeric(text):
    return bool(re.fullmatch(r"[\d\s,.*%()/:+\-]+", str(text).strip()))


def _is_yes_no_line(line):
    match = re.match(r"^(.*?):\s*(Yes|No)\s*$", line.strip(), flags=re.I)
    return match.groups() if match else None


def _looks_like_markdown_separator(cells):
    if not cells:
        return False
    return all(bool(re.fullmatch(r":?-{3,}:?", c.replace(" ", ""))) for c in cells)


# -----------------------------------------------------------------------------
# MARKDOWN TABLE PARSING
# -----------------------------------------------------------------------------
def parse_markdown_table(text):
    """Parse a markdown-style table into a list of rows."""
    rows = []
    for raw_line in text.strip().splitlines():
        line = raw_line.strip()
        if "|" not in line:
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if _looks_like_markdown_separator(cells):
            continue
        rows.append(cells)

    if len(rows) < 2:
        return None

    width = max(len(r) for r in rows)
    return [r + [""] * (width - len(r)) for r in rows]


def parse_content_with_tables(content):
    """Split assistant content into text blocks and markdown tables."""
    elements = []
    current_text = []
    table_lines = []
    in_table = False

    for line in content.splitlines():
        stripped = line.strip()
        is_table_line = "|" in stripped and len(stripped.split("|")) >= 3

        if is_table_line:
            if not in_table:
                if current_text:
                    elements.append(("text", "\n".join(current_text)))
                    current_text = []
                in_table = True
            table_lines.append(line)
        else:
            if in_table:
                table_data = parse_markdown_table("\n".join(table_lines))
                if table_data:
                    elements.append(("table", table_data))
                table_lines = []
                in_table = False
            current_text.append(line)

    if in_table and table_lines:
        table_data = parse_markdown_table("\n".join(table_lines))
        if table_data:
            elements.append(("table", table_data))
    elif current_text:
        elements.append(("text", "\n".join(current_text)))

    return elements


# -----------------------------------------------------------------------------
# STYLE SYSTEM
# -----------------------------------------------------------------------------
def build_styles():
    base = getSampleStyleSheet()
    styles = {}

    styles["body"] = ParagraphStyle(
        "Body",
        parent=base["Normal"],
        fontName="Helvetica",
        fontSize=10.4,
        leading=15.2,
        textColor=INK,
        alignment=TA_LEFT,
        spaceAfter=7,
    )
    styles["body_justify"] = ParagraphStyle(
        "BodyJustify",
        parent=styles["body"],
        alignment=TA_JUSTIFY,
    )
    styles["small"] = ParagraphStyle(
        "Small",
        parent=styles["body"],
        fontSize=8.8,
        leading=12,
        textColor=MUTED,
    )
    styles["eyebrow"] = ParagraphStyle(
        "Eyebrow",
        parent=base["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.4,
        leading=10,
        textColor=TEAL,
        uppercase=True,
        tracking=0.9,
        spaceAfter=8,
    )
    styles["h1"] = ParagraphStyle(
        "H1",
        parent=base["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=NAVY,
        spaceBefore=8,
        spaceAfter=10,
    )
    styles["h2"] = ParagraphStyle(
        "H2",
        parent=base["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14.5,
        leading=18,
        textColor=NAVY,
        spaceBefore=12,
        spaceAfter=8,
    )
    styles["h3"] = ParagraphStyle(
        "H3",
        parent=base["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=11.6,
        leading=15,
        textColor=BLUE_DARK,
        spaceBefore=9,
        spaceAfter=5,
    )
    styles["indicator"] = ParagraphStyle(
        "Indicator",
        parent=styles["body"],
        fontName="Helvetica-Bold",
        fontSize=12.2,
        leading=16,
        textColor=NAVY,
        spaceAfter=0,
    )
    styles["label"] = ParagraphStyle(
        "Label",
        parent=styles["body"],
        fontName="Helvetica-Bold",
        fontSize=9.4,
        leading=12.5,
        textColor=NAVY,
        spaceAfter=0,
    )
    styles["explanation"] = ParagraphStyle(
        "Explanation",
        parent=styles["body"],
        fontSize=9.7,
        leading=14,
        textColor=INK,
        leftIndent=0.15 * cm,
        spaceAfter=7,
    )
    styles["conclusion"] = ParagraphStyle(
        "Conclusion",
        parent=styles["body"],
        fontSize=9.8,
        leading=14.2,
        textColor=NAVY,
        spaceAfter=0,
    )
    styles["table_header"] = ParagraphStyle(
        "TableHeader",
        parent=base["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=10.6,
        textColor=WHITE,
        alignment=TA_CENTER,
    )
    styles["table_cell"] = ParagraphStyle(
        "TableCell",
        parent=base["Normal"],
        fontName="Helvetica",
        fontSize=8.25,
        leading=10.8,
        textColor=INK,
        alignment=TA_LEFT,
    )
    styles["table_cell_center"] = ParagraphStyle(
        "TableCellCenter",
        parent=styles["table_cell"],
        alignment=TA_CENTER,
    )
    styles["table_title"] = ParagraphStyle(
        "TableTitle",
        parent=styles["body"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=14,
        textColor=NAVY,
        spaceBefore=8,
        spaceAfter=7,
    )
    styles["cover_title"] = ParagraphStyle(
        "CoverTitle",
        parent=base["Title"],
        fontName="Helvetica-Bold",
        fontSize=27,
        leading=31,
        textColor=WHITE,
        alignment=TA_LEFT,
        spaceAfter=9,
    )
    styles["cover_subtitle"] = ParagraphStyle(
        "CoverSubtitle",
        parent=styles["body"],
        fontSize=12.5,
        leading=17,
        textColor=HexColor("#D8E7F1"),
        spaceAfter=0,
    )
    return styles


# -----------------------------------------------------------------------------
# COMPONENTS
# -----------------------------------------------------------------------------
def make_status_pill(value, styles):
    val = str(value).strip().lower()
    if val == "yes":
        fg, bg, label = SUCCESS, SUCCESS_BG, "YES"
    elif val == "no":
        fg, bg, label = DANGER, DANGER_BG, "NO"
    else:
        fg, bg, label = WARNING, WARNING_BG, str(value).upper()

    pill_style = ParagraphStyle(
        "Pill",
        parent=styles["small"],
        fontName="Helvetica-Bold",
        fontSize=8.2,
        leading=9,
        textColor=fg,
        alignment=TA_CENTER,
    )
    pill = Table([[Paragraph(_safe(label), pill_style)]], colWidths=[1.28 * cm])
    pill.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("BOX", (0, 0), (-1, -1), 0.6, fg),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 3.2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return pill


def make_indicator_card(indicator_text, styles):
    eyebrow = Paragraph("INDICATOR", styles["eyebrow"])
    title = Paragraph(_inline_markup(indicator_text), styles["indicator"])
    inner = Table([[eyebrow], [title]], colWidths=[CONTENT_WIDTH - 0.6 * cm])
    inner.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE_BLUE),
                ("LINEBEFORE", (0, 0), (0, -1), 3.2, BLUE),
                ("TOPPADDING", (0, 0), (-1, 0), 11),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
                ("TOPPADDING", (0, 1), (-1, 1), 0),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 11),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return inner


def make_question_row(question, value, styles):
    question_para = Paragraph(_inline_markup(question), styles["label"])
    pill = make_status_pill(value, styles)
    row = Table([[question_para, pill]], colWidths=[CONTENT_WIDTH - 2.25 * cm, 1.45 * cm])
    row.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 8),
                ("LEFTPADDING", (1, 0), (1, 0), 0),
                ("RIGHTPADDING", (1, 0), (1, 0), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return row


def make_conclusion_box(text, styles):
    label_style = ParagraphStyle(
        "ConclusionLabel",
        parent=styles["eyebrow"],
        textColor=TEAL,
        spaceAfter=4,
    )
    content = [
        Paragraph("CONCLUSION", label_style),
        Paragraph(_inline_markup(text), styles["conclusion"]),
    ]
    body = Table([[content]], colWidths=[CONTENT_WIDTH - 0.55 * cm])
    body.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE_TEAL),
                ("BOX", (0, 0), (-1, -1), 0.7, HexColor("#B9DED8")),
                ("LINEBEFORE", (0, 0), (0, -1), 3.2, TEAL),
                ("TOPPADDING", (0, 0), (-1, -1), 11),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return body


def _calculate_col_widths(table_data, available_width):
    cols = max(len(row) for row in table_data)
    max_lengths = [1] * cols
    header_lengths = [1] * cols

    for r_idx, row in enumerate(table_data):
        for c in range(cols):
            text = str(row[c] if c < len(row) else "").strip()
            # cap influence of extremely long cells so one column does not dominate
            effective_len = min(max(len(text), 1), 80)
            max_lengths[c] = max(max_lengths[c], effective_len)
            if r_idx == 0:
                header_lengths[c] = max(header_lengths[c], min(len(text), 40))

    weights = [max(6, 0.72 * max_lengths[i] + 0.28 * header_lengths[i]) for i in range(cols)]

    # Common report pattern: first column is a row number/id, keep it compact.
    first_header = str(table_data[0][0]).strip().lower() if table_data and table_data[0] else ""
    if cols >= 4 and first_header in {"no", "#", "id", "nr", "number"}:
        first_width = 1.05 * cm
        rest = available_width - first_width
        rest_weights = weights[1:]
        rest_total = sum(rest_weights) or 1
        widths = [first_width] + [rest * (w / rest_total) for w in rest_weights]
    else:
        total = sum(weights) or 1
        widths = [available_width * (w / total) for w in weights]

    # Prevent unusably narrow data columns.
    min_width = 1.35 * cm if cols >= 6 else 1.65 * cm
    widths = [max(min_width, w) for w in widths]
    scale = available_width / sum(widths)
    return [w * scale for w in widths]


def create_table_from_data(table_data, styles=None):
    """Create a modern, adaptive professional table."""
    styles = styles or build_styles()
    if not table_data:
        return Spacer(1, 0)

    cols = max(len(r) for r in table_data)
    normalized = [r + [""] * (cols - len(r)) for r in table_data]
    col_widths = _calculate_col_widths(normalized, CONTENT_WIDTH)

    # Reduce type slightly for very wide tables.
    if cols >= 6:
        cell_style = ParagraphStyle(
            "WideCell", parent=styles["table_cell"], fontSize=7.7, leading=9.8
        )
        center_style = ParagraphStyle(
            "WideCellCenter", parent=cell_style, alignment=TA_CENTER
        )
        header_style = ParagraphStyle(
            "WideHeader", parent=styles["table_header"], fontSize=7.9, leading=9.7
        )
    else:
        cell_style = styles["table_cell"]
        center_style = styles["table_cell_center"]
        header_style = styles["table_header"]

    wrapped = []
    for r_idx, row in enumerate(normalized):
        wrapped_row = []
        for c_idx, cell in enumerate(row):
            text = str(cell).strip()
            if r_idx == 0:
                wrapped_row.append(Paragraph(_inline_markup(text), header_style))
            else:
                p_style = center_style if _is_numeric(text) else cell_style
                wrapped_row.append(Paragraph(_inline_markup(text), p_style))
        wrapped.append(wrapped_row)

    table = Table(
        wrapped,
        colWidths=col_widths,
        repeatRows=1,
        hAlign="LEFT",
        splitByRow=1,
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                ("LEFTPADDING", (0, 0), (-1, 0), 6),
                ("RIGHTPADDING", (0, 0), (-1, 0), 6),
                ("TOPPADDING", (0, 1), (-1, -1), 6.5),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 6.5),
                ("LEFTPADDING", (0, 1), (-1, -1), 6),
                ("RIGHTPADDING", (0, 1), (-1, -1), 6),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, SURFACE]),
                ("LINEBELOW", (0, 0), (-1, 0), 1.15, BLUE),
                ("INNERGRID", (0, 1), (-1, -1), 0.35, BORDER),
                ("BOX", (0, 0), (-1, -1), 0.55, BORDER),
            ]
        )
    )
    return table


# -----------------------------------------------------------------------------
# CONTENT RENDERER
# -----------------------------------------------------------------------------
def render_text_block(text, styles):
    """Convert text into modern report flowables while preserving source content."""
    flowables = []
    lines = text.splitlines()
    i = 0
    paragraph_buffer = []

    def flush_buffer():
        nonlocal paragraph_buffer
        if paragraph_buffer:
            merged = " ".join(x.strip() for x in paragraph_buffer if x.strip())
            if merged:
                flowables.append(Paragraph(_inline_markup(merged), styles["body_justify"]))
            paragraph_buffer = []

    while i < len(lines):
        raw = lines[i]
        line = raw.strip()

        if not line:
            flush_buffer()
            i += 1
            continue

        if line.startswith("# "):
            flush_buffer()
            flowables.append(Paragraph(_inline_markup(line[2:].strip()), styles["h1"]))
            flowables.append(HRFlowable(width="100%", thickness=1.2, color=BLUE, spaceAfter=8))
            i += 1
            continue

        if line.startswith("## "):
            flush_buffer()
            flowables.append(Paragraph(_inline_markup(line[3:].strip()), styles["h2"]))
            i += 1
            continue

        if line.startswith("### "):
            flush_buffer()
            flowables.append(Paragraph(_inline_markup(line[4:].strip()), styles["h3"]))
            i += 1
            continue

        if line.lower() == "indicator assessment":
            flush_buffer()
            flowables.append(Spacer(1, 0.08 * cm))
            flowables.append(Paragraph("INDICATOR ASSESSMENT", styles["h2"]))
            flowables.append(HRFlowable(width="100%", thickness=0.8, color=BORDER, spaceAfter=7))
            i += 1
            continue

        if line.lower().startswith("indicator:"):
            flush_buffer()
            indicator_text = line.split(":", 1)[1].strip()
            flowables.append(Spacer(1, 0.1 * cm))
            flowables.append(make_indicator_card(indicator_text, styles))
            flowables.append(Spacer(1, 0.15 * cm))
            i += 1
            continue

        yn = _is_yes_no_line(line)
        if yn:
            flush_buffer()
            question, value = yn
            flowables.append(make_question_row(question + ":", value, styles))
            i += 1
            continue

        if line.lower().startswith("explanation:"):
            flush_buffer()
            explanation = line.split(":", 1)[1].strip()
            # Continue wrapped source lines until the next recognized structural line.
            j = i + 1
            while j < len(lines):
                nxt = lines[j].strip()
                if (
                    not nxt
                    or nxt.lower().startswith("indicator:")
                    or nxt.lower().startswith("conclusion:")
                    or nxt.lower() == "indicator assessment"
                    or _is_yes_no_line(nxt)
                    or nxt.startswith("#")
                ):
                    break
                explanation += " " + nxt
                j += 1
            label = Paragraph("<b>Explanation</b>", styles["small"])
            content = Paragraph(_inline_markup(explanation), styles["explanation"])
            flowables.extend([label, content])
            i = j
            continue

        if line.lower().startswith("conclusion:"):
            flush_buffer()
            conclusion = line.split(":", 1)[1].strip()
            j = i + 1
            while j < len(lines):
                nxt = lines[j].strip()
                if (
                    not nxt
                    or nxt.lower().startswith("indicator:")
                    or nxt.lower() == "indicator assessment"
                    or nxt.startswith("#")
                    or _is_yes_no_line(nxt)
                ):
                    break
                conclusion += " " + nxt
                j += 1
            flowables.append(Spacer(1, 0.06 * cm))
            flowables.append(make_conclusion_box(conclusion, styles))
            flowables.append(Spacer(1, 0.19 * cm))
            i = j
            continue

        if line.startswith("- ") or line.startswith("* "):
            flush_buffer()
            bullet_text = line[2:].strip()
            bullet_style = ParagraphStyle(
                "BulletModern",
                parent=styles["body"],
                leftIndent=0.45 * cm,
                firstLineIndent=-0.22 * cm,
                bulletIndent=0.12 * cm,
                spaceAfter=4,
            )
            flowables.append(Paragraph(_inline_markup(bullet_text), bullet_style, bulletText="•"))
            i += 1
            continue

        if re.match(r"^\d+\.\s+", line):
            flush_buffer()
            num, content = line.split(".", 1)
            list_style = ParagraphStyle(
                "NumberedModern",
                parent=styles["body"],
                leftIndent=0.52 * cm,
                firstLineIndent=-0.34 * cm,
                spaceAfter=4,
            )
            flowables.append(Paragraph(_inline_markup(content.strip()), list_style, bulletText=f"{num}."))
            i += 1
            continue

        paragraph_buffer.append(line)
        i += 1

    flush_buffer()
    return flowables


# -----------------------------------------------------------------------------
# HEADER / FOOTER CANVAS
# -----------------------------------------------------------------------------
class ModernReportCanvas(canvas.Canvas):
    """Canvas that adds polished running headers, footers and total page count."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_pages = []

    def showPage(self):
        self._saved_pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_pages)
        for page_no, page_state in enumerate(self._saved_pages, 1):
            self.__dict__.update(page_state)
            self._draw_chrome(page_no, total)
            super().showPage()
        super().save()

    def _draw_chrome(self, page_no, total):
        self.saveState()

        # Cover page has intentionally minimal chrome.
        if page_no == 1:
            self.setFillColor(MUTED)
            self.setFont("Helvetica", 8.2)
            self.drawRightString(PAGE_W - LEFT_MARGIN, 0.8 * cm, f"{page_no:02d}")
            self.restoreState()
            return

        # top accent + running title
        self.setFillColor(BLUE)
        self.rect(LEFT_MARGIN, PAGE_H - 1.14 * cm, 0.42 * cm, 0.07 * cm, fill=1, stroke=0)
        self.setFillColor(NAVY)
        self.setFont("Helvetica-Bold", 8.4)
        self.drawString(LEFT_MARGIN + 0.55 * cm, PAGE_H - 1.15 * cm, "PROFESSIONAL ASSESSMENT REPORT")

        self.setStrokeColor(BORDER)
        self.setLineWidth(0.45)
        self.line(LEFT_MARGIN, PAGE_H - 1.42 * cm, PAGE_W - RIGHT_MARGIN, PAGE_H - 1.42 * cm)

        # footer
        self.line(LEFT_MARGIN, 1.25 * cm, PAGE_W - RIGHT_MARGIN, 1.25 * cm)
        self.setFillColor(MUTED)
        self.setFont("Helvetica", 7.9)
        self.drawString(LEFT_MARGIN, 0.83 * cm, datetime.now().strftime("%d %B %Y"))
        self.drawRightString(PAGE_W - RIGHT_MARGIN, 0.83 * cm, f"Page {page_no} of {total}")

        self.restoreState()


# -----------------------------------------------------------------------------
# COVER PAGE
# -----------------------------------------------------------------------------
def add_cover_page(story, styles, title, subtitle, document_type="Professional Report", status="Final"):
    story.append(Spacer(1, 1.05 * cm))

    # Hero panel
    hero_content = [
        Paragraph("PERFORMANCE & ASSURANCE", styles["eyebrow"]),
        Paragraph(_safe(title), styles["cover_title"]),
        Paragraph(_safe(subtitle), styles["cover_subtitle"]),
    ]
    hero = Table([[hero_content]], colWidths=[CONTENT_WIDTH])
    hero.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), NAVY),
                ("LINEBEFORE", (0, 0), (0, -1), 5, TEAL),
                ("TOPPADDING", (0, 0), (-1, -1), 28),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 30),
                ("LEFTPADDING", (0, 0), (-1, -1), 24),
                ("RIGHTPADDING", (0, 0), (-1, -1), 24),
            ]
        )
    )
    story.append(hero)
    story.append(Spacer(1, 0.75 * cm))

    intro = Paragraph(
        "A structured, presentation-ready report generated from the assessment output, with emphasis on clarity, traceability and professional readability.",
        ParagraphStyle(
            "CoverIntro",
            parent=styles["body"],
            fontSize=11,
            leading=16.3,
            textColor=MUTED,
            spaceAfter=0,
        ),
    )
    story.append(intro)
    story.append(Spacer(1, 1.2 * cm))

    date_str = datetime.now().strftime("%d %B %Y")
    meta = [
        ["DATE GENERATED", "DOCUMENT TYPE", "STATUS"],
        [date_str, document_type, status.upper()],
    ]
    meta_header = ParagraphStyle(
        "MetaHeader",
        parent=styles["small"],
        fontName="Helvetica-Bold",
        fontSize=7.8,
        textColor=MUTED,
        alignment=TA_LEFT,
    )
    meta_value = ParagraphStyle(
        "MetaValue",
        parent=styles["body"],
        fontName="Helvetica-Bold",
        fontSize=10.1,
        textColor=NAVY,
    )
    wrapped_meta = [
        [Paragraph(_safe(x), meta_header) for x in meta[0]],
        [Paragraph(_safe(x), meta_value) for x in meta[1]],
    ]
    meta_table = Table(wrapped_meta, colWidths=[CONTENT_WIDTH / 3] * 3)
    meta_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
                ("TOPPADDING", (0, 0), (-1, 0), 10),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 3),
                ("TOPPADDING", (0, 1), (-1, 1), 2),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 11),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    story.append(meta_table)

    story.append(Spacer(1, 2.1 * cm))
    story.append(
        HRFlowable(width="22%", thickness=2.4, color=TEAL, hAlign="LEFT", spaceAfter=10)
    )
    confidentiality = Paragraph(
        "Prepared for professional review. Content reflects the source assessment supplied to the generator.",
        styles["small"],
    )
    story.append(confidentiality)
    story.append(PageBreak())


# -----------------------------------------------------------------------------
# PUBLIC GENERATOR
# -----------------------------------------------------------------------------
def generate_chat_pdf(
    messages,
    output_path="output.pdf",
    title="Professional Assessment Report",
    subtitle="Performance Analysis and Evaluation",
):
    """Generate a modern professional PDF from assistant messages."""
    styles = build_styles()

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=LEFT_MARGIN,
        rightMargin=RIGHT_MARGIN,
        topMargin=TOP_MARGIN,
        bottomMargin=BOTTOM_MARGIN,
        title=title,
        author="Professional PDF Generator",
        subject=subtitle,
    )

    story = []
    add_cover_page(story, styles, title, subtitle)

    table_counter = 1
    assistant_messages = [m for m in messages if m.get("role", "assistant") == "assistant"]

    for message_index, msg in enumerate(assistant_messages):
        content = str(msg.get("content", "") or "").strip()
        if not content:
            continue

        for elem_type, elem_data in parse_content_with_tables(content):
            if elem_type == "table":
                story.append(Spacer(1, 0.05 * cm))
                story.append(
                    Paragraph(
                        f"TABLE {table_counter:02d}  |  DATA OVERVIEW",
                        styles["table_title"],
                    )
                )
                story.append(create_table_from_data(elem_data, styles))
                story.append(Spacer(1, 0.35 * cm))
                table_counter += 1
            else:
                story.extend(render_text_block(elem_data, styles))

        if message_index < len(assistant_messages) - 1:
            story.append(Spacer(1, 0.18 * cm))
            story.append(HRFlowable(width="100%", thickness=0.55, color=BORDER, spaceAfter=9))

    doc.build(story, canvasmaker=ModernReportCanvas)
    return output_path


if __name__ == "__main__":
    if len(sys.argv) > 1:
        messages_json = sys.argv[1]
    else:
        messages_json = sys.stdin.read()

    messages = json.loads(messages_json)
    output_file = "output.pdf"
    generate_chat_pdf(messages, output_file)
    print(f"PDF generated: {output_file}")
