"""
Professional Government-Style Report PDF Generator
Generates styled PDFs with professional government/corporate formatting
Follows departmental standards for reports and presentations
Uses reportlab for high-quality document generation
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, PageTemplate, Frame
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER, TA_JUSTIFY
from reportlab.pdfgen import canvas
from datetime import datetime
import json
import sys
import re

def parse_markdown_table(text):
    """
    Parse markdown table into reportlab Table object
    Returns None if no table found
    """
    lines = text.strip().split('\n')
    table_data = []
    
    for line in lines:
        if '|' in line:
            # Remove leading/trailing pipes and split
            cells = [cell.strip() for cell in line.strip('|').split('|')]
            # Skip separator lines (those with dashes)
            if not all(set(cell.replace('-', '').replace(' ', '')) == set() for cell in cells if cell):
                table_data.append(cells)
    
    if len(table_data) >= 2:  # At least header + one row
        return table_data
    return None

def parse_content_with_tables(content):
    """
    Parse content and return list of elements (text chunks and tables)
    """
    elements = []
    
    # Split content by table patterns
    lines = content.split('\n')
    current_text = []
    in_table = False
    table_lines = []
    
    for line in lines:
        if '|' in line and ('-' in line or any(c.isalnum() for c in line)):
            if not in_table:
                # Save accumulated text
                if current_text:
                    elements.append(('text', '\n'.join(current_text)))
                    current_text = []
                in_table = True
            table_lines.append(line)
        else:
            if in_table:
                # End of table
                table_data = parse_markdown_table('\n'.join(table_lines))
                if table_data:
                    elements.append(('table', table_data))
                table_lines = []
                in_table = False
            current_text.append(line)
    
    # Handle remaining content
    if in_table and table_lines:
        table_data = parse_markdown_table('\n'.join(table_lines))
        if table_data:
            elements.append(('table', table_data))
    elif current_text:
        elements.append(('text', '\n'.join(current_text)))
    
    return elements

def create_table_from_data(table_data):
    """
    Create a professionally styled government-standard table
    Following departmental guidelines for reports
    """
    from reportlab.platypus import Paragraph
    from reportlab.lib.styles import ParagraphStyle
    
    # Government-style table cell styles
    cell_style = ParagraphStyle(
        'TableCell',
        fontName='Helvetica',
        fontSize=10,
        leading=13,
        wordWrap='LTR',
        alignment=TA_LEFT,
        textColor=HexColor('#1A1A1A')
    )
    
    cell_style_center = ParagraphStyle(
        'TableCellCenter',
        fontName='Helvetica',
        fontSize=10,
        leading=13,
        wordWrap='LTR',
        alignment=TA_CENTER,
        textColor=HexColor('#1A1A1A')
    )
    
    header_style = ParagraphStyle(
        'TableHeader',
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=14,
        textColor=white,
        alignment=TA_CENTER
    )
    
    # Calculate optimal column widths
    available_width = 17 * cm  # A4 width (21cm) - 2cm margins on each side
    num_cols = len(table_data[0]) if table_data else 1
    
    # Analyze content to determine column widths
    col_content_lengths = [0] * num_cols
    for row in table_data:
        for col_idx, cell in enumerate(row):
            cell_len = len(str(cell).strip())
            col_content_lengths[col_idx] = max(col_content_lengths[col_idx], cell_len)
    
    # Calculate proportional widths
    total_content_weight = sum(col_content_lengths)
    col_widths = []
    min_width = 2 * cm
    
    for content_length in col_content_lengths:
        if total_content_weight > 0:
            proportional_width = (content_length / total_content_weight) * available_width
            width = max(min_width, proportional_width)
        else:
            width = available_width / num_cols
        col_widths.append(width)
    
    # Normalize widths
    total_width = sum(col_widths)
    if total_width != available_width:
        scale_factor = available_width / total_width
        col_widths = [w * scale_factor for w in col_widths]
    
    # Convert cells to Paragraphs
    wrapped_data = []
    for i, row in enumerate(table_data):
        wrapped_row = []
        for col_idx, cell in enumerate(row):
            cell_text = str(cell).strip()
            
            # Check if cell contains numbers (for center alignment)
            is_numeric = bool(re.match(r'^[\d\s,.-]+$', cell_text)) if cell_text else False
            
            if i == 0:  # Header
                wrapped_row.append(Paragraph(cell_text, header_style))
            else:  # Body - center numbers, left-align text
                style = cell_style_center if is_numeric and col_idx > 0 else cell_style
                wrapped_row.append(Paragraph(cell_text, style))
        wrapped_data.append(wrapped_row)
    
    # Create table
    table = Table(wrapped_data, colWidths=col_widths, repeatRows=1)
    
    # Government-style professional table styling
    style = TableStyle([
        # Header styling - deep blue background
        ('BACKGROUND', (0, 0), (-1, 0), HexColor('#004C99')),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 11),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        
        # Body styling
        ('BACKGROUND', (0, 1), (-1, -1), white),
        ('TEXTCOLOR', (0, 1), (-1, -1), HexColor('#1A1A1A')),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        
        # Thin light grey borders
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#D9D9D9')),
        ('LINEBELOW', (0, 0), (-1, 0), 1, HexColor('#003366')),
        
        # Alternating row colors (white and light grey)
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor('#F8F8F8')]),
        
        # Text wrapping
        ('WORDWRAP', (0, 0), (-1, -1), True),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ])
    
    table.setStyle(style)
    return table

def clean_text_formatting(text):
    """
    Clean and enhance markdown formatting for professional government-style report
    Handles headers, bold, italic, code, lists, and indicators
    Returns a list of formatted text chunks and special elements
    """
    lines = text.split('\n')
    formatted_lines = []
    conclusion_text = []
    in_conclusion = False
    
    for line in lines:
        original_line = line
        line = line.strip()
        
        if not line:
            if not in_conclusion:
                formatted_lines.append('')
            continue
        
        # Check for conclusion box
        if line.lower().startswith('conclusion:'):
            if formatted_lines:
                # Yield accumulated content before conclusion
                yield ('text', '<br/>'.join(formatted_lines))
                formatted_lines = []
            in_conclusion = True
            # Get text after "Conclusion:" on the same line
            conclusion_start = line[11:].strip() if len(line) > 11 else ''
            if conclusion_start:
                conclusion_text = [conclusion_start]
            else:
                conclusion_text = []
            continue
        elif in_conclusion:
            # Check if conclusion ends (new heading or indicator or double newline)
            if line.startswith('#') or line.lower().startswith('indicator:'):
                # End conclusion, yield it
                if conclusion_text:
                    conclusion_content = ' '.join(conclusion_text)
                    yield ('conclusion', conclusion_content)
                    conclusion_text = []
                in_conclusion = False
                # Continue processing this line (don't skip it)
            else:
                # Add to conclusion
                conclusion_text.append(line)
                continue
                
        # Headers with government color scheme
        if line.startswith('### '):
            # H3 - Subheading (12pt, semi-bold, #333333)
            content = line[4:].strip()
            formatted_lines.append(f'<font size="12" color="#333333"><b>{content}</b></font>')
        elif line.startswith('## '):
            # H2 - Section header (14pt, bold, #004C99)
            content = line[3:].strip()
            formatted_lines.append(f'<font size="14" color="#004C99"><b>{content}</b></font>')
        elif line.startswith('# '):
            # H1 - Main header (18pt, bold, #003366)
            content = line[2:].strip()
            formatted_lines.append(f'<font size="18" color="#003366"><b>{content}</b></font>')
        else:
            # Process inline formatting
            # Bold
            line = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', line)
            # Italic
            line = re.sub(r'\*([^*]+)\*', r'<i>\1</i>', line)
            # Code - subtle styling
            line = re.sub(r'`([^`]+)`', r'<font face="Courier" color="#666666"><b>\1</b></font>', line)
            
            # Check marks for Yes/No indicators
            if '✔' in line or '✓' in line:
                line = line.replace('✔', '<font color="#008000">✔</font>')
                line = line.replace('✓', '<font color="#008000">✓</font>')
            if '✖' in line or '✗' in line:
                line = line.replace('✖', '<font color="#CC0000">✖</font>')
                line = line.replace('✗', '<font color="#CC0000">✗</font>')
            
            # Bullet points with proper indentation
            if line.startswith('- ') or line.startswith('* '):
                line = '  • ' + line[2:]
            elif re.match(r'^\d+\.\s', line):
                # Numbered lists
                line = '  ' + line
            
            # Specific keyword styling
            # Make "Indicator Assessment" a header
            if line.lower().startswith('indicator assessment'):
                line = f'<font size="14" color="#004C99"><b>{line}</b></font>'
            # Make only the word "Explanation" bold (not the explanation text)
            elif line.lower().startswith('explanation:'):
                line = re.sub(r'^(explanation:)', r'<b>\1</b>', line, flags=re.IGNORECASE)
            # Bold these specific assessment questions
            elif line.lower().startswith('reported indicator is consistent with planned indicator:'):
                line = re.sub(r'^(reported indicator is consistent with planned indicator:)', r'<b>\1</b>', line, flags=re.IGNORECASE)
            elif line.lower().startswith('reported planned annual target is consistent with planned target:'):
                line = re.sub(r'^(reported planned annual target is consistent with planned target:)', r'<b>\1</b>', line, flags=re.IGNORECASE)
            elif line.lower().startswith('reported achievement(s) is consistent with planned and reported indicators/targets:'):
                line = re.sub(r'^(reported achievement\(s\) is consistent with planned and reported indicators/targets:)', r'<b>\1</b>', line, flags=re.IGNORECASE)
            elif line.lower().startswith('reason for variances/deviation:'):
                line = re.sub(r'^(reason for variances/deviation:)', r'<b>\1</b>', line, flags=re.IGNORECASE)
            # Indicator: style (bold, navy)
            elif line.lower().startswith('indicator:'):
                line = f'<font size="12" color="#003366"><b>{line}</b></font>'
            
            formatted_lines.append(line)
    
    # Yield any remaining conclusion at the end of text
    if in_conclusion and conclusion_text:
        conclusion_content = ' '.join(conclusion_text)
        yield ('conclusion', conclusion_content)
    
    # Yield any remaining text
    if formatted_lines:
        yield ('text', '<br/>'.join(formatted_lines))

class HeaderFooterCanvas(canvas.Canvas):
    """
    Custom canvas for adding headers and footers to pages
    """
    def __init__(self, *args, **kwargs):
        canvas.Canvas.__init__(self, *args, **kwargs)
        self.pages = []
        
    def showPage(self):
        self.pages.append(dict(self.__dict__))
        self._startPage()
        
    def save(self):
        page_count = len(self.pages)
        for page_num, page_dict in enumerate(self.pages, 1):
            self.__dict__.update(page_dict)
            self.draw_page_decorations(page_num, page_count)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)
        
    def draw_page_decorations(self, page_num, page_count):
        """
        Draw header and footer on each page
        """
        # Header
        self.saveState()
        self.setFont('Helvetica', 10)
        self.setFillColor(HexColor('#666666'))
        self.drawString(2*cm, A4[1] - 1.3*cm, "Professional Report")
        
        # Header line
        self.setStrokeColor(HexColor('#D0D0D0'))
        self.setLineWidth(0.5)
        self.line(2*cm, A4[1] - 1.5*cm, A4[0] - 2*cm, A4[1] - 1.5*cm)
        
        # Footer - page numbers
        self.setFont('Helvetica', 9)
        self.setFillColor(HexColor('#666666'))
        footer_text = f"Page {page_num} of {page_count}"
        self.drawCentredString(A4[0] / 2, 1*cm, footer_text)
        
        # Footer - date
        date_text = datetime.now().strftime("%B %d, %Y")
        self.drawString(2*cm, 1*cm, date_text)
        
        self.restoreState()

def generate_chat_pdf(messages, output_path="output.pdf"):
    """
    Generate a professional government-style report PDF from messages
    Following departmental standards with proper headers, footers, and formatting
    
    Args:
        messages: List of message dicts with {role, content, timestamp}
        output_path: Where to save the PDF
    """
    
    # Create PDF document with government-standard margins
    doc = SimpleDocTemplate(
        output_path, 
        pagesize=A4, 
        rightMargin=2*cm,
        leftMargin=2*cm,
        topMargin=1.8*cm,
        bottomMargin=1.5*cm
    )
    story = []
    
    # Get default styles
    styles = getSampleStyleSheet()
    
    # Government-style professional body text
    report_body_style = ParagraphStyle(
        'ReportBody',
        parent=styles['Normal'],
        fontSize=11,
        textColor=HexColor('#1A1A1A'),
        spaceAfter=12,
        spaceBefore=6,
        leftIndent=0,
        rightIndent=0,
        alignment=TA_JUSTIFY,
        leading=16,
        fontName='Helvetica'
    )
    
    # Cover page title
    title_style = ParagraphStyle(
        'CoverTitle',
        parent=styles['Title'],
        fontSize=24,
        textColor=HexColor('#003366'),
        spaceAfter=20,
        fontName='Helvetica-Bold',
        alignment=TA_CENTER,
        leading=30
    )
    
    # Subtitle style
    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontSize=14,
        textColor=HexColor('#004C99'),
        spaceAfter=40,
        alignment=TA_CENTER,
        fontName='Helvetica'
    )
    
    # Metadata style
    metadata_style = ParagraphStyle(
        'Metadata',
        parent=styles['Normal'],
        fontSize=11,
        textColor=HexColor('#666666'),
        spaceAfter=8,
        alignment=TA_LEFT,
        fontName='Helvetica'
    )
    
    # Table title style
    table_title_style = ParagraphStyle(
        'TableTitle',
        parent=styles['Normal'],
        fontSize=12,
        textColor=HexColor('#003366'),
        spaceAfter=8,
        spaceBefore=16,
        fontName='Helvetica-Bold',
        alignment=TA_LEFT
    )
    
    # ===== COVER PAGE =====
    story.append(Spacer(1, 3*cm))
    
    # Main title
    title = Paragraph("Professional Assessment Report", title_style)
    story.append(title)
    
    # Subtitle
    subtitle = Paragraph("Performance Analysis and Evaluation", subtitle_style)
    story.append(subtitle)
    
    story.append(Spacer(1, 4*cm))
    
    # Metadata section
    date_str = datetime.now().strftime("%B %d, %Y")
    
    metadata_items = [
        f"<b>Date Generated:</b> {date_str}",
        f"<b>Document Type:</b> Professional Report",
        f"<b>Status:</b> Final"
    ]
    
    for item in metadata_items:
        story.append(Paragraph(item, metadata_style))
    
    story.append(Spacer(1, 2*cm))
    
    # Confidentiality notice
    notice_style = ParagraphStyle(
        'Notice',
        parent=styles['Normal'],
        fontSize=9,
        textColor=HexColor('#999999'),
        alignment=TA_CENTER,
        fontName='Helvetica-Oblique'
    )
    notice = Paragraph("This document contains professional analysis and assessment data", notice_style)
    story.append(notice)
    
    # Page break after cover
    story.append(PageBreak())
    
    # ===== CONTENT =====
    # Add section separator
    from reportlab.platypus import HRFlowable
    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width="100%", thickness=1, color=HexColor('#D0D0D0'), 
                           spaceAfter=20, spaceBefore=0, hAlign='LEFT'))
    
    # Table counter for professional table titles
    table_counter = 1
    
    # Add content from messages (assistant only)
    for idx, msg in enumerate(messages):
        role = msg.get('role', 'assistant')
        content = msg.get('content', '')
        
        # Skip non-assistant messages
        if role != 'assistant':
            continue
        
        # Parse content for tables
        content_elements = parse_content_with_tables(content)
        
        for elem_type, elem_data in content_elements:
            if elem_type == 'table':
                # Add professional table title
                table_title = Paragraph(f"Table {table_counter}: Data Overview", table_title_style)
                story.append(table_title)
                table_counter += 1
                
                # Create and add professional table
                table = create_table_from_data(elem_data)
                story.append(table)
                story.append(Spacer(1, 0.3*cm))
            else:
                # Regular text content with professional formatting
                if elem_data.strip():
                    # Process text chunks and conclusions separately
                    for chunk_type, chunk_data in clean_text_formatting(elem_data.strip()):
                        if chunk_type == 'conclusion':
                            # Create conclusion box as a separate styled table
                            conclusion_style = ParagraphStyle(
                                'ConclusionText',
                                parent=styles['Normal'],
                                fontSize=11,
                                textColor=HexColor('#003366'),
                                alignment=TA_LEFT,
                                leading=14,
                                fontName='Helvetica'
                            )
                            conclusion_para = Paragraph(f'<b>Conclusion:</b> {chunk_data}', conclusion_style)
                            
                            # Create a table for the conclusion box with styling
                            conclusion_table = Table([[conclusion_para]], colWidths=[17*cm])
                            conclusion_table.setStyle(TableStyle([
                                ('BACKGROUND', (0, 0), (-1, -1), HexColor('#E9F3FF')),
                                ('BOX', (0, 0), (-1, -1), 1, HexColor('#BBD4EE')),
                                ('TOPPADDING', (0, 0), (-1, -1), 12),
                                ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
                                ('LEFTPADDING', (0, 0), (-1, -1), 14),
                                ('RIGHTPADDING', (0, 0), (-1, -1), 14),
                                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                            ]))
                            story.append(Spacer(1, 0.2*cm))
                            story.append(conclusion_table)
                            story.append(Spacer(1, 0.3*cm))
                        elif chunk_type == 'text' and chunk_data:
                            # Regular text paragraph
                            content_para = Paragraph(chunk_data, report_body_style)
                            story.append(content_para)
        
        # Add spacing between sections if multiple messages
        if idx < len(messages) - 1:
            story.append(Spacer(1, 0.4*cm))
            story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor('#D0D0D0'), 
                                   spaceAfter=20, spaceBefore=0, hAlign='LEFT'))
    
    # Build PDF with custom header/footer
    doc.build(story, canvasmaker=HeaderFooterCanvas)
    return output_path

# CLI interface
if __name__ == "__main__":
    # Read JSON from stdin or command line argument
    if len(sys.argv) > 1:
        messages_json = sys.argv[1]
    else:
        messages_json = sys.stdin.read()
    
    messages = json.loads(messages_json)
    output_file = "output.pdf"
    
    generate_chat_pdf(messages, output_file)
    print(f"PDF generated: {output_file}")

