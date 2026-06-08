// ===========================
// STATE MANAGEMENT
// ===========================
let messages = [];
let isProcessing = false;

// Make messages accessible globally for PDF export
window.messages = messages;

// ===========================
// DOM ELEMENTS
// ===========================
const messagesList = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const exportBtn = document.getElementById('export-btn');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessageEl = document.getElementById('error-message');

// ===========================
// INITIALIZATION
// ===========================
document.addEventListener('DOMContentLoaded', () => {
  // Event listeners
  sendBtn.addEventListener('click', handleSend);
  exportBtn.addEventListener('click', handleExport);
  
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize textarea
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = userInput.scrollHeight + 'px';
  });
});

// ===========================
// CORE FUNCTIONS
// ===========================

/**
 * Add a message to the conversation
 */
function addMessage(role, content) {
  const message = {
    id: Date.now() + Math.random(),
    role: role,
    content: content,
    timestamp: Date.now()
  };
  
  messages.push(message);
  window.messages = messages; // Keep global reference updated
  renderMessages();
  scrollToBottom();
}

/**
 * Render all messages to the DOM
 */
function renderMessages() {
  messagesList.innerHTML = '';
  
  messages.forEach(msg => {
    const messageEl = createMessageElement(msg);
    messagesList.appendChild(messageEl);
  });
}

/**
 * Create a message DOM element
 */
function createMessageElement(message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${message.role}`;
  
  const roleLabel = document.createElement('div');
  roleLabel.className = 'message-role';
  roleLabel.textContent = message.role === 'user' ? 'You' : 'Assistant';
  
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  
  // Parse markdown for assistant messages
  if (message.role === 'assistant' && typeof marked !== 'undefined') {
    bubble.innerHTML = marked.parse(message.content);
  } else {
    bubble.textContent = message.content;
  }
  
  const timestamp = document.createElement('div');
  timestamp.className = 'message-timestamp';
  timestamp.textContent = formatTimestamp(message.timestamp);
  
  messageDiv.appendChild(roleLabel);
  messageDiv.appendChild(bubble);
  messageDiv.appendChild(timestamp);
  
  return messageDiv;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Handle send button click
 */
async function handleSend() {
  const content = userInput.value.trim();
  
  if (!content || isProcessing) return;
  
  // Clear input
  userInput.value = '';
  userInput.style.height = 'auto';
  
  // Add user message
  addMessage('user', content);
  
  // Disable input
  setProcessingState(true);
  
  try {
    // Prepare messages for API
    const apiMessages = messages.map(m => ({
      role: m.role,
      content: m.content
    }));
    
    // Call OpenAI API
    const response = await callOpenAI(apiMessages);
    
    // Add assistant response
    addMessage('assistant', response);
    
  } catch (error) {
    console.error('Error:', error);
    showError(error.message || 'Failed to get response. Please try again.');
  } finally {
    setProcessingState(false);
  }
}

/**
 * Handle export button click
 */
async function handleExport() {
  if (messages.length === 0) {
    showError('No messages to export');
    return;
  }
  
  try {
    await exportToPDF();
  } catch (error) {
    console.error('Export error:', error);
    showError('Failed to export PDF. Please try again.');
  }
}

/**
 * Set processing state (loading)
 */
function setProcessingState(processing) {
  isProcessing = processing;
  sendBtn.disabled = processing;
  userInput.disabled = processing;
  
  if (processing) {
    loadingIndicator.style.display = 'flex';
  } else {
    loadingIndicator.style.display = 'none';
  }
}

/**
 * Show error message
 */
function showError(message) {
  errorMessageEl.textContent = message;
  errorMessageEl.style.display = 'block';
  
  setTimeout(() => {
    errorMessageEl.style.display = 'none';
  }, 5000);
}

/**
 * Scroll chat to bottom
 */
function scrollToBottom() {
  setTimeout(() => {
    const chatMain = document.querySelector('.chat-main');
    chatMain.scrollTop = chatMain.scrollHeight;
  }, 100);
}
