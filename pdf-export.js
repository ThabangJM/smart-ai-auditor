// ===========================
// PDF EXPORT FUNCTIONALITY
// Python-Based PDF Export using reportlab
// ===========================

function getPdfApiBaseUrl() {
  if (typeof window !== 'undefined' && window.API_BASE_URL) {
    return window.API_BASE_URL;
  }

  if (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) {
    return API_BASE_URL;
  }

  return `${window.location.origin}/api`;
}

/**
 * Extract content from element including HTML tables converted to markdown
 */
function extractContentWithTables(element) {
  if (!element) return '';
  
  let content = '';
  const clone = element.cloneNode(true);
  
  // Find all tables and convert to markdown
  const tables = clone.querySelectorAll('table');
  tables.forEach(table => {
    const markdown = convertTableToMarkdown(table);
    table.replaceWith(document.createTextNode(markdown));
  });
  
  // Get text content with preserved line breaks
  content = clone.textContent || clone.innerText || '';
  
  return content.trim();
}

/**
 * Convert HTML table to markdown table format
 */
function convertTableToMarkdown(table) {
  let markdown = '\n\n';
  const rows = table.querySelectorAll('tr');
  
  if (rows.length === 0) return '';
  
  rows.forEach((row, rowIndex) => {
    const cells = row.querySelectorAll('th, td');
    const cellTexts = Array.from(cells).map(cell => {
      return cell.textContent.trim().replace(/\|/g, '\\|');
    });
    
    markdown += '| ' + cellTexts.join(' | ') + ' |\n';
    
    // Add separator after header row
    if (rowIndex === 0) {
      const separator = cellTexts.map(() => '---').join(' | ');
      markdown += '| ' + separator + ' |\n';
    }
  });
  
  markdown += '\n';
  return markdown;
}

/**
 * Export chat messages to PDF using Python reportlab
 * This function collects messages from the chat content and sends them to the backend
 */
async function exportToPDF(userMessage, assistantMessage) {
  try {
    // Prepare messages array - only assistant messages for professional report
    const messages = [];
    
    if (assistantMessage) {
      // Extract content preserving HTML structure for tables
      const content = extractContentWithTables(assistantMessage);
      messages.push({
        role: 'assistant',
        content: content,
        timestamp: Date.now()
      });
    }

    if (messages.length === 0) {
      throw new Error('No assistant message to export');
    }

    console.log('Sending', messages.length, 'messages to backend for PDF generation');

    const pdfApiUrl = `${getPdfApiBaseUrl()}/export-pdf`;
    
    const response = await fetch(pdfApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages,
        reportType: 'general',
        reportTitle: 'Audit Report'
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to generate PDF' }));
      throw new Error(error.error || `PDF generation failed (${response.status})`);
    }

    // Get PDF blob
    const blob = await response.blob();
    
    // Create download link with display:none to prevent page jump
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `chat-export-${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup after a short delay to ensure download starts
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 100);
    
    console.log('PDF exported successfully');
    showAlert('✅ PDF exported successfully!', 'success');

  } catch (error) {
    console.error('PDF export failed:', error);
    showAlert(`Failed to export PDF: ${error.message}`, 'error');
  }
}

/**
 * Export all chat messages to PDF
 * Collects all user and assistant messages from the chat content
 */
async function exportAllChatToPDF() {
  try {
    const chatDiv = document.getElementById('chatContent');
    if (!chatDiv) {
      throw new Error('Chat content not found');
    }

    // Collect all messages
    const messages = [];
    const messageElements = chatDiv.querySelectorAll('.user-msg, .assistant-msg');
    
    messageElements.forEach(el => {
      const isUser = el.classList.contains('user-msg');
      // Only include assistant messages for professional report
      if (!isUser) {
        const content = extractContentWithTables(el);
        messages.push({
          role: 'assistant',
          content: content,
          timestamp: Date.now()
        });
      }
    });

    if (messages.length === 0) {
      throw new Error('No messages to export');
    }

    console.log('Exporting', messages.length, 'messages to PDF');

    const pdfApiUrl = `${getPdfApiBaseUrl()}/export-pdf`;
    const response = await fetch(pdfApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages,
        reportType: 'general',
        reportTitle: 'Audit Report'
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to generate PDF' }));
      throw new Error(error.error || `PDF generation failed (${response.status})`);
    }

    // Get PDF blob
    const blob = await response.blob();
    
    // Create download link with display:none to prevent page jump
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `chat-export-all-${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup after a short delay to ensure download starts
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 100);
    
    console.log('PDF exported successfully');
    showAlert('✅ PDF exported successfully!', 'success');

  } catch (error) {
    console.error('PDF export failed:', error);
    showAlert(`Failed to export PDF: ${error.message}`, 'error');
  }
}

/**
 * Check if backend is available for PDF generation
 */
async function isPDFServiceAvailable() {
  try {
    const response = await fetch(`${getPdfApiBaseUrl()}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// Verify service on load
window.addEventListener('load', async () => {
  const available = await isPDFServiceAvailable();
  if (!available) {
    console.warn('PDF export service not available. Make sure the backend server is running on port 3000.');
  }
});
