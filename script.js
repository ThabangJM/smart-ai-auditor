// point pdf.js at the CDN’d worker so you don’t get that “no GlobalWorkerOptions.workerSrc” warning
window.addEventListener('DOMContentLoaded', () => {
  // now pdfjsLib is guaranteed to exist
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.5.141/pdf.worker.min.js';
});

/* script.js */
// Note: API key is now stored securely on the backend server
// No API key needed in frontend code
/* script.js */

// Backend API Configuration
function resolveApiBaseUrl() {
  if (typeof window !== 'undefined' && window.API_BASE_URL) {
    return window.API_BASE_URL;
  }

  const host = window.location.hostname;
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';

  // In production, keep requests same-origin to avoid www/non-www CORS issues.
  return isLocalhost ? 'http://localhost:3000/api' : `${window.location.origin}/api`;
}

const API_BASE_URL = resolveApiBaseUrl();
window.API_BASE_URL = API_BASE_URL;
programmeList = [];
programmeSelectionList = [];
const EMBEDDING_URL = `${API_BASE_URL}/embeddings/generate`;
const CHAT_URL      = `${API_BASE_URL}/chat/completions`;
// Global variables for aggregated results
let aggregatedDoc1 = [];
let aggregatedDoc2 = [];
let aggregatedDoc3 = [];
let aggregatedDoc4 = [];
let aggregatedDoc5 = [];
let chatHistoryList = [];
let chatSessions = [];
let vectorStore = [];

let currentAbortController = null;



let strategicPlanText = "", appText = "", aprText = "", uncertainTextList = [];
let appMeasuringOurPerformanceText = "", aprPerformanceInfomationText = "";

// Separate from chatHistoryList (which tracks the last few messages for OpenAI context),
// chatSessions holds full historical conversations for the History/New Chat UI. Each
// element has the shape { title: string, messages: Array<{ type: "User"|"Assistant", text: string, timestamp?: string }>, timestamp: string }


// -------------------------------------------------------------------------
// Helper to build an assistant message wrapper with export/delete controls
// This function is used when restoring messages from local storage or chat
// history. It replicates the structure of assistant responses during live
// chat: a wrapper div containing the assistant message (<p>) plus a
// container for two buttons—export to PDF and remove message. The export
// logic mirrors the streaming code’s implementation (adds a faded
// watermark and paginates text) while the remove logic cleans up the
// corresponding user/assistant pair.
function buildAssistantWrapper(msgText, timestamp) {
  // Create the top-level wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-msg-wrapper';

  // Build the assistant message element
  const ap = document.createElement('p');
  ap.className = 'assistant-msg';
  // Append the timestamp into the text if provided
  if (timestamp) {
    const timeStr = new Date(timestamp).toLocaleTimeString();
    ap.textContent = `${msgText}  (${timeStr})`;
  } else {
    ap.textContent = msgText;
  }
  wrapper.appendChild(ap);

  // Build a container for the export and delete buttons
  const btncontainer = document.createElement('div');
  btncontainer.className = 'btncontainerDiv';

  // Export button: when clicked, generate a PDF of the user and assistant
  // messages. This duplicates the behaviour of the streaming logic’s
  // export handler. It constructs a PDF with a watermark and wraps long
  // text lines appropriately across pages.
  const exportBtn = document.createElement('button');
  exportBtn.className = 'export-pdf-btn';
  exportBtn.title = 'Export PDF';
  exportBtn.innerHTML = `<img src="export.png" alt="PDF" onerror="this.style.display='none'"/> Export PDF`;
  
  // Add click handler for PDF export
  exportBtn.addEventListener('click', async () => {
    // Find the previous user message and the current assistant message
    const userEl = wrapper.previousElementSibling;
    const assistantEl = wrapper.querySelector('.assistant-msg');
    
    if (userEl && assistantEl) {
      // Call the PDF export function from pdf-export.js
      await exportToPDF(userEl, assistantEl);
    } else {
      console.error('Could not find user or assistant message for export');
      if (typeof showAlert === 'function') {
        showAlert('Could not export PDF: message not found', 'error');
      }
    }
  });
  
  // Delete button: removes the assistant wrapper and its preceding user message
  const removeBtn = document.createElement('button');
  removeBtn.className = 'export-pdf-btn remove-msg-btn';
  removeBtn.title = 'Delete message';
  removeBtn.innerHTML = `<img src="delete.png" alt="Delete" onerror="this.style.display='none'"/> Delete`;
  removeBtn.addEventListener('click', () => {
    const userEl      = wrapper.previousElementSibling;
    const assistantEl = wrapper.querySelector('.assistant-msg');
    if (userEl)      userEl.remove();
    if (assistantEl) assistantEl.remove();
    exportBtn.remove();
    removeBtn.remove();
  });

  // Append controls
  btncontainer.appendChild(removeBtn);
  btncontainer.appendChild(exportBtn);
  wrapper.appendChild(btncontainer);
  return wrapper;
}

const changeScopedProgramme = document.getElementById("scoped-in-Btn")
changeScopedProgramme.disabled = true;
changeScopedProgramme.addEventListener("click",changeProgrammes);


// In script.js (home.html)
window.addEventListener("DOMContentLoaded", async () => {
  // Only allow access if user is logged in
  // Display all global variables in the console
  console.group("Global Variables");
  console.log("messagesDiv:", typeof messagesDiv !== 'undefined' ? messagesDiv : 'undefined');
  console.log("chatContent:", typeof chatContent !== 'undefined' ? chatContent : 'undefined');
  console.log("submitBtn:", typeof submitBtn !== 'undefined' ? submitBtn : 'undefined');
  console.log("caretaker:", caretaker);
  console.log("uploadedFiles:", Array.from(document.querySelectorAll("#uploadedFiles p")).map(p => p.textContent));
  console.groupEnd();
  const uid = localStorage.getItem("currentUserUID") || 'guest';
  const nameDisplay = document.getElementById("userNameDisplay");

  // In offline/guest mode we skip loading user metadata from Firestore. If the UID
  // does not correspond to a Firestore document the welcome message will use a
  // default name. When deploying with Firebase auth enabled you can restore
  // this fetch for personalised greetings.
  if (uid === 'guest') {
    nameDisplay.textContent = `Welcome, Guest!`;
  } else {
    // Check if Firebase is properly initialized and authenticated
    if (typeof db === 'undefined' || typeof auth === 'undefined') {
      console.warn("⚠️ Firebase not initialized. Running in offline mode.");
      nameDisplay.textContent = `Welcome, User!`;
    } else {
      try {
        // Check if user is authenticated
        const currentUser = auth.currentUser;
        if (!currentUser) {
          console.warn("⚠️ No authenticated user. Using local storage.");
          nameDisplay.textContent = `Welcome, User!`;
        } else {
          const userDoc = await db.collection('users').doc(uid).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            const userName = userData.name || "User";
            nameDisplay.textContent = `Welcome, ${userName}!`;
            // refresh stored name
            localStorage.setItem("currentUserName", userName);
          } else {
            console.warn("⚠️ No user profile found for UID:", uid);
            nameDisplay.textContent = `Welcome, User!`;
          }
        }
      } catch (error) {
        console.warn("⚠️ Firebase access error (using offline mode):", error.message);
        nameDisplay.textContent = `Welcome, User!`;
      }
    }
  }
 // appText = await loadTextChunks("appText");
 // aprText = await loadTextChunks("aprText");

  // 🧠 Restore any locally saved state. This ensures that if the user refreshes the page
  // or returns later, we pull their last working context from localStorage. We run this
  // after loading text chunks from Firestore so that local state can override those values.
  try {
   // await restoreStateFromLocal();
  } catch (err) {
    console.error('Failed to restore local state:', err);
  }
});

  document.getElementById("presentationBtn").addEventListener("click", async () => {
  if (!appText && !aprText) {
    showAlert("❗Please upload or restore documents before using this feature.", "error");
    return;
  }

  try {
    await presentation(); // this should call OpenAI
  } catch (error) {
    console.error("🔥 OpenAI request failed:", error.message);
    showAlert("OpenAI request failed: " + error.message, "error");
  }
});

// new code classes

class Memento {
  constructor(state) {
    this.state = JSON.stringify(state); // store a deep copy
  }

  getState() {
    return JSON.parse(this.state); // return a fresh copy to avoid mutation
  }
}

class Caretaker {
  constructor() {
    this.mementos = [];
  }

  async save(state) {
    const uid = localStorage.getItem("currentUserUID");
    if (!uid) {
      console.warn("No user UID available for saving state.");
      return;
    }

    const memento = new Memento(state);
    this.mementos.push(memento);

    // Persist to Firestore only if we have a non-guest UID and Firebase is available.
    // For local/guest users we skip this step. The state is still persisted to localStorage
    // via saveStateToLocal() which should be invoked outside of this helper.
    if (uid !== 'guest' && typeof db !== 'undefined' && typeof firebase !== 'undefined') {
      try {
        // Check if user is authenticated before attempting to write
        const currentUser = auth?.currentUser;
        if (!currentUser) {
          console.warn("⚠️ No authenticated user. Skipping Firestore save.");
          return;
        }
        
        await db.collection("users").doc(uid).collection("savedStates").doc("latest").set({
          state: memento.getState(),
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log("✅ App state saved to Firestore.");
      } catch (error) {
        console.warn("⚠️ Could not save to Firestore (using local storage):", error.message);
      }
    }
  }

  async restore() {
    const uid = localStorage.getItem("currentUserUID");
    if (!uid) return null;

    // Only attempt to restore from Firestore for non-guest users and if Firebase is available.
    // For guest users we return null here and rely on restoreStateFromLocal() instead.
    if (uid !== 'guest' && typeof db !== 'undefined') {
      try {
        // Check if user is authenticated before attempting to read
        const currentUser = auth?.currentUser;
        if (!currentUser) {
          console.warn("⚠️ No authenticated user. Skipping Firestore restore.");
          return null;
        }
        
        const doc = await db.collection("users").doc(uid).collection("savedStates").doc("latest").get();
        if (doc.exists) {
          return doc.data().state;
        }
      } catch (error) {
        console.warn("⚠️ Could not restore from Firestore (using local storage):", error.message);
      }
    }
    return null;
  }
}

/* ==========================================================================
   Local storage persistence helpers
   These functions save and restore the current application state to/from
   the browser's localStorage. Each state is associated with the current user.
   ========================================================================== */
function saveStateToLocal() {
  const uid = localStorage.getItem('currentUserUID') || 'guest';
  try {
    // gather chat content
    const chatMsgs = [];
    const chatEls = document.querySelectorAll('#chatContent .user-msg, #chatContent .assistant-msg');
    chatEls.forEach(el => {
      chatMsgs.push({
        type: el.className.includes('user-msg') ? 'User' : 'Assistant',
        text: el.textContent
      });
    });

    // gather uploaded file names
    const uploadedNames = Array.from(document.querySelectorAll('#uploadedFiles p')).map(p => p.textContent);

    const state = {
      programmeList,
      // Preserve the programmeSelectionList so the Change Programme modal
      // can be reconstructed after refresh. Without this the drop-down
      // would be empty even if the user had previously scoped programmes.
      programmeSelectionList,
      aggregatedDoc1,
      aggregatedDoc2,
      aggregatedDoc3,
      aggregatedDoc4,
      aggregatedDoc5,
      appText,
      aprText,
      strategicPlanText,
      uploadedFileNames: uploadedNames,
      chatSessions,
      chatContentMessages: chatMsgs
    };
    localStorage.setItem(`appState_${uid}`, JSON.stringify(state));
    console.log('✅ App state saved locally');
  } catch (err) {
    console.error('Failed to save state locally:', err);
  }
}
/*
async function restoreStateFromLocal() {
  const uid = localStorage.getItem('currentUserUID') || 'guest';
  const json = localStorage.getItem(`appState_${uid}`);
  if (!json) {
    return;
  }
  try {
    const state = JSON.parse(json);
    if (state.programmeList) programmeList = state.programmeList;
    // Restore previously scoped-in programmes so the Change Programme
    // functionality can show the correct options after a page refresh.
    if (Array.isArray(state.programmeSelectionList)) {
      programmeSelectionList = state.programmeSelectionList;
    }
    if (state.aggregatedDoc1) aggregatedDoc1 = state.aggregatedDoc1;
    if (state.aggregatedDoc2) aggregatedDoc2 = state.aggregatedDoc2;
    if (state.aggregatedDoc3) aggregatedDoc3 = state.aggregatedDoc3;
    if (state.aggregatedDoc4) aggregatedDoc4 = state.aggregatedDoc4;
    if (state.aggregatedDoc5) aggregatedDoc5 = state.aggregatedDoc5;
    if (state.appText) appText = state.appText;
    if (state.aprText) aprText = state.aprText;
    if (state.strategicPlanText) strategicPlanText = state.strategicPlanText;
    if (state.uploadedFileNames && Array.isArray(state.uploadedFileNames)) {
      const uploadedFilesDiv = document.getElementById('uploadedFiles');
      if (uploadedFilesDiv) {
        uploadedFilesDiv.innerHTML = '';
        state.uploadedFileNames.forEach(name => {
          const ul = document.createElement('ul');
          const li = document.createElement('li');
          const p = document.createElement('p');
          p.textContent = name;
          li.appendChild(p);
          ul.appendChild(li);
          ul.style.marginTop = '10px';
          li.style.marginLeft = '25px';
          uploadedFilesDiv.appendChild(ul);
        });
      }
    }
    // Restore saved chat sessions for History UI
    if (Array.isArray(state.chatSessions)) {
      chatSessions = state.chatSessions;
    }
    if (Array.isArray(state.chatContentMessages)) {
      const chatDiv = document.getElementById('chatContent');
      if (chatDiv) {
        chatDiv.innerHTML = '';
        state.chatContentMessages.forEach(msg => {
          if (msg.type === 'User') {
            const p = document.createElement('p');
            p.className = 'user-msg';
            p.textContent = msg.text;
            chatDiv.appendChild(p);
          } else if (msg.type === 'Assistant') {
            // Use our helper to rebuild the assistant wrapper with controls
            const wrapper = buildAssistantWrapper(msg.text, msg.timestamp);
            chatDiv.appendChild(wrapper);
          }
        });
      }
    }
    console.log('✅ App state restored from localStorage');
    // enable buttons if we have programmeList or aggregatedDocs
    const hasDocs = programmeList && programmeList.length > 0;
    const cBtn = document.getElementById('consistencyBtn');
    const mBtn = document.getElementById('measurabilityBtn');
    const rBtn = document.getElementById('relevanceBtn');
    const pBtn = document.getElementById('presentationBtn');
    const sBtn = document.getElementById('scoped-in-Btn');
    if (hasDocs) {
      if (cBtn) cBtn.disabled = false;
      if (mBtn) mBtn.disabled = false;
      if (rBtn) rBtn.disabled = false;
      if (pBtn) pBtn.disabled = false;
    }
    // Even if programmeList is empty, re-enable the Change Programme button
    // if we have previously scoped programme options saved. This allows
    // users to reselect from saved programmeSelectionList.
    if (programmeSelectionList && programmeSelectionList.length > 0) {
      if (sBtn) sBtn.disabled = false;
    }
  } catch (err) {
    console.error('Failed to restore local state:', err);
  }
}
*/
// Save the state whenever the user navigates away or refreshes the page
window.addEventListener('beforeunload', () => {
  saveStateToLocal();
});

// On page load, attempt to restore any locally saved state immediately. We
// register this listener separately from the more complex DOMContentLoaded
// handler defined later in the file. If the later handler also restores
// state the operation is idempotent. This ensures that chat history and
// uploaded files are restored even if Firestore calls in the other handler
// fail or hang.
window.addEventListener('DOMContentLoaded', () => {
  try {
   // restoreStateFromLocal();
  } catch (err) {
    console.warn('Failed to restore state on initial load:', err);
  }
});

// Wrap key functions so they automatically persist the state after running
(function() {
  // Only wrap functions if they exist on the global scope
  if (typeof window.extractIndicatorsAndTargets === 'function') {
    const origExtract = window.extractIndicatorsAndTargets;
    window.extractIndicatorsAndTargets = async function(...args) {
      const res = await origExtract.apply(this, args);
      saveStateToLocal();
      return res;
    };
  }
  if (typeof window.consistency === 'function') {
    const origConsistency = window.consistency;
    window.consistency = async function(...args) {
      const res = await origConsistency.apply(this, args);
      saveStateToLocal();
      return res;
    };
  }
  if (typeof window.measurability2 === 'function') {
    const origMea = window.measurability2;
    window.measurability2 = async function(...args) {
      const res = await origMea.apply(this, args);
      saveStateToLocal();
      return res;
    };
  }
  if (typeof window.relevance === 'function') {
    const origRel = window.relevance;
    window.relevance = async function(...args) {
      const res = await origRel.apply(this, args);
      saveStateToLocal();
      return res;
    };
  }
  if (typeof window.presentation === 'function') {
    const origPres = window.presentation;
    window.presentation = async function(...args) {
      const res = await origPres.apply(this, args);
      saveStateToLocal();
      return res;
    };
  }
  if (typeof window.changeProgrammes === 'function') {
    const origChange = window.changeProgrammes;
    window.changeProgrammes = function(...args) {
      const res = origChange.apply(this, args);
      saveStateToLocal();
      return res;
    };
  }
})();


const caretaker = new Caretaker();


function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function saveVectorStoreChunks(vectorStore) {
  const uid = localStorage.getItem("currentUserUID");
  if (!uid) return;

  const chunks = chunkArray(vectorStore, 1000); // adjust chunk size as needed

  const batch = db.batch();
  const collectionRef = db.collection("users").doc(uid).collection("vectorChunks");

  // Delete old chunks first (optional cleanup)
  const oldDocs = await collectionRef.get();
  oldDocs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  // Store new chunks
  for (let i = 0; i < chunks.length; i++) {
    await collectionRef.doc(`chunk_${i}`).set({ data: chunks[i] });
  }

  console.log(`✅ Stored ${chunks.length} chunks of vectorStore.`);
}

async function loadVectorStoreChunks() {
  const uid = localStorage.getItem("currentUserUID");
  if (!uid) return [];

  const collectionRef = db.collection("users").doc(uid).collection("vectorChunks");
  const snapshot = await collectionRef.get();

  const allChunks = [];
  snapshot.forEach(doc => {
    const chunkData = doc.data().data;
    if (Array.isArray(chunkData)) {
      allChunks.push(...chunkData);
    }
  });

  console.log(`✅ Restored vectorStore with ${allChunks.length} items.`);
  return allChunks;
}

function chunkLargeText2(text, size = 10000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

async function saveTextChunks(fieldName, text) {
  const uid = localStorage.getItem("currentUserUID");
  if (!uid) return;

  const collectionRef = db.collection("users").doc(uid).collection(`${fieldName}_chunks`);

  // Step 1: Delete existing chunks (if any)
  const existingDocs = await collectionRef.get();
  const deleteBatch = db.batch();

  existingDocs.forEach((doc) => {
    deleteBatch.delete(doc.ref);
  });

  if (!existingDocs.empty) {
    await deleteBatch.commit();
    console.log(`🧹 Deleted old chunks for ${fieldName}`);
  }

  // Step 2: Chunk the text
  const chunks = chunkLargeText2(text, 10000); // you can adjust the size if needed

  // Step 3: Save each chunk
  for (let i = 0; i < chunks.length; i++) {
    await collectionRef.doc(`chunk_${i}`).set({
      content: chunks[i],
      order: i
    });
  }

  console.log(`✅ Saved ${chunks.length} chunks for ${fieldName}`);
}

const stopBtn = document.getElementById("stopBtn");

function showStopBtn() {
  stopBtn.style.display = "inline-block";
}
function hideStopBtn() {
  stopBtn.style.display = "none";
}

stopBtn.addEventListener("click", () => {
  if (currentAbortController) {
    currentAbortController.abort();  // 🔴 stop request
    hideStopBtn();
    sendBtn.style.display = "block";
  }
});


async function loadTextChunks(fieldName) {
  const uid = localStorage.getItem("currentUserUID");
  if (!uid) return '';

  const collectionRef = db.collection("users").doc(uid).collection(`${fieldName}_chunks`);
  const snapshot = await collectionRef.orderBy("order").get();

  let fullText = '';
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data && data.content) {
      fullText += data.content;
    }
  });

  console.log(`✅ Restored ${fieldName} with ${fullText.length} characters`);
  return fullText;
}


function chunkArray2(array, size = 100) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function saveAggregatedDocChunks(fieldName, aggregatedDoc) {
  const uid = localStorage.getItem("currentUserUID");
  if (!uid) return;

  const collectionRef = db.collection("users").doc(uid).collection(`${fieldName}_chunks`);

  // Step 1: Delete old chunks
  const oldDocs = await collectionRef.get();
  const batch = db.batch();
  oldDocs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  // Step 2: Chunk the array
  const chunks = chunkArray2(aggregatedDoc, 1000); // Adjust chunk size if needed

  // Step 3: Save each chunk
  for (let i = 0; i < chunks.length; i++) {
    await collectionRef.doc(`chunk_${i}`).set({
      data: chunks[i],
      order: i
    });
  }

  console.log(`✅ Saved ${chunks.length} chunks for ${fieldName}`);
}

async function loadAggregatedDocChunks(fieldName) {
  const uid = localStorage.getItem("currentUserUID");
  if (!uid) return [];

  const collectionRef = db.collection("users").doc(uid).collection(`${fieldName}_chunks`);
  const snapshot = await collectionRef.orderBy("order").get();

  const combined = [];
  snapshot.forEach(doc => {
    const chunk = doc.data().data;
    if (Array.isArray(chunk)) {
      combined.push(...chunk);
    }
  });

  console.log(`✅ Restored ${fieldName} with ${combined.length} items`);
  return combined;
}


async function restoreListVariables() {
  const savedState = await caretaker.restore();
  if (!savedState) {
    showAlert("⚠️ No saved state found.", "error");
    return;
  }

  // Restore each variable safely
  if (Array.isArray(savedState.programmeList)) {
    programmeList = [...savedState.programmeList];
  }

  if (Array.isArray(savedState.aggregatedDoc1)) {
    aggregatedDoc1 = [...savedState.aggregatedDoc1];
  }

  if (Array.isArray(savedState.aggregatedDoc2)) {
    aggregatedDoc2 = [...savedState.aggregatedDoc2];
  }
  console.log(`✅ List variables Restored ${programmeList} , ${aggregatedDoc2.length} and ${aggregatedDoc2.length} `);
}

async function saveListVariables() {
  const stateToSave = {
    programmeList,
    aggregatedDoc1,
    aggregatedDoc2
  };

  await caretaker.save(stateToSave);
    console.log(`✅ List variables saved successfully`);
}


function cleanDocumentText(text) {
  return text
    .replace(/\s{2,}/g, ' ')                  // Collapse multiple spaces into one
    .replace(/(\r\n|\n|\r)/g, ' ')             // Remove all line breaks
    .replace(/([^\w\s])\s+/g, '$1 ')           // Remove space after punctuation
    .replace(/\s+([^\w\s])/g, ' $1')           // Remove space before punctuation
    .replace(/\s{2,}/g, ' ')                  // Clean up again if necessary
    .trim();                                   // Trim leading/trailing spaces
}



//end of new code
// Toggle Dark Mode
const darkModeToggle = document.getElementById('darkModeToggle');
darkModeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
});


// Simple "Send" Functionality
const sendBtn = document.getElementById('sendBtn');
const fileInput = document.getElementById("hiddenFileInput");
const userInput = document.getElementById('userInput');
const chatContent = document.getElementById('chatContent');
const messagesDiv   = document.getElementById('chatContent');
const logOutBtn = document.getElementById('logOutBtn');

 // holds { embedding: number[], text: string }
const CHUNK_SIZE = 5000;

/** wrapper for fetch→JSON + HTTP‐error check */
async function openAIRequest(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json'
    },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) {
    console.error('OpenAI error', json);
    throw new Error(json.error?.message || `HTTP ${res.status}`);
  }
  return json;
}

/** break text into 1 000-char slices */
function chunkText(text) {
  const out = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    out.push(text.slice(i, i + CHUNK_SIZE));
  }
  return out;
}

/** send up to 20 pieces at once for embeddings */
async function batchEmbeddings(chunks) {
  const json = await openAIRequest(EMBEDDING_URL, {
    model: 'text-embedding-ada-002',
    input: chunks
  });
  return json.data.map(d => d.embedding);
}

/** read each PDF→text, chunk, embed, store */
async function ingestFiles(files) {
  const allChunks = [];
  const names = [];

  for (const file of files) {
    names.push(file.name);
    const arrayBuf = await file.arrayBuffer();
    let fullText = '';
    let metadata = {
      source: file.name,
      type: file.type || 'unknown',
      pages: 0
    };

    if (file.name.endsWith('.pdf')) {
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
      metadata.pages = pdfDoc.numPages;

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const txt = await page.getTextContent();
        fullText += txt.items.map(it => it.str).join(' ') + ' ';
      }
    } else if (file.name.endsWith('.doc') || file.name.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuf });
      fullText = result.value;
      metadata.pages = 1; // fallback assumption
    } else {
      console.warn(`Unsupported file type: ${file.name}`);
      continue;
    }

    const chunks = chunkText(fullText);
    const embeds = await batchEmbeddings(chunks);

    embeds.forEach((embedding, idx) => {
      vectorStore.push({
        embedding,
        text: chunks[idx],
        metadata: {
          ...metadata,
          chunkIndex: idx
        }
      });
    });
  }

  // Display uploaded file names
  const uploadedFileNames = new Set();
  names.forEach(n => {
    if (!uploadedFileNames.has(n)) {
      uploadedFileNames.add(n);
      const ul = document.createElement('ul');
      const li = document.createElement('li');
      const p = document.createElement('p');
      p.textContent = n;
      li.appendChild(p);
      ul.appendChild(li);
      ul.style.marginTop = "10px";
      li.style.marginLeft = "25px";
      uploadedFiles.appendChild(ul);
    }
  });
}


/** read each PDF→text, chunk, embed, store 
async function ingestFiles(files) {
  const allChunks = [];
  const names = [];

  for (const file of files) {
    names.push(file.name);
    const arrayBuf = await file.arrayBuffer();
    let fullText = '';

    if (file.name.endsWith('.pdf')) {
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const txt = await page.getTextContent();
        fullText += txt.items.map(it => it.str).join(' ') + ' ';
      }
    } else if (file.name.endsWith('.doc') || file.name.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuf });
      fullText = result.value;
    } else {
      console.warn(`Unsupported file type: ${file.name}`);
      continue;
    }

    allChunks.push(...chunkText(fullText));
  }

  for (let i = 0; i < allChunks.length; i += 20) {
    const slice = allChunks.slice(i, i + 20);
    const embeds = await batchEmbeddings(slice);
    embeds.forEach((emb, idx) => {
      vectorStore.push({ embedding: emb, text: slice[idx] });
    });
  }

  const uploadedFileNames = new Set();
  names.forEach(n => {
    if (!uploadedFileNames.has(n)) {
      uploadedFileNames.add(n);
      const ul = document.createElement('ul');
      const li = document.createElement('li');
      const p = document.createElement('p');
      p.textContent = n;
      li.appendChild(p);
      ul.appendChild(li);
      ul.style.marginTop = "10px";
      li.style.marginLeft = "25px";
      uploadedFiles.appendChild(ul);
    }
  });
}
*/
/** cosine similarity helper */
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

sendBtn.addEventListener('click', handleUserSubmit);



userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault(); // Prevent form submission/reload
    handleUserSubmit();
  }
});



function showAlert(message, type = "info") {
  const alertBox = document.getElementById("userAlerts");
  alertBox.textContent = message;
  alertBox.style.display = "block";
  alertBox.style.backgroundColor = type === "success" ? "#d4edda" : type === "error" ? "#f8d7da" : "#fff3cd";
  alertBox.style.color = type === "success" ? "#155724" : type === "error" ? "#721c24" : "#856404";

  setTimeout(() => {
    alertBox.style.display = "none";
  }, 4000);
}

function showAlert2(message, type = "info") {
  const alertBox = document.getElementById("userAlerts");

  // Clear any previous content
  alertBox.innerHTML = "";

  // Create message text
  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;
  alertBox.appendChild(msgSpan);

  // Create OK button
  const okButton = document.createElement("button");
  okButton.textContent = "OK";
  okButton.style.marginLeft = "12px";
  okButton.addEventListener("click", () => {
    alertBox.style.display = "none";
  });
  alertBox.appendChild(okButton);

  // Style the alert box
  alertBox.style.display = "block";
  alertBox.style.padding = "10px";
  alertBox.style.borderRadius = "4px";
  alertBox.style.backgroundColor =
    type === "success" ? "#d4edda" :
    type === "error"   ? "#f8d7da" :
                        "#fff3cd";
  alertBox.style.color =
    type === "success" ? "#155724" :
    type === "error"   ? "#721c24" :
                        "#856404";
}



// Navigation and Pre-Prompt Button Handlers
// ───────────────────────────────────────────────────────────────────────────
// Helper: current user’s UID (must be set on login)
function getCurrentUID() {
  return localStorage.getItem("currentUserUID");
}

// ───────────────────────────────────────────────────────────────────────────
// 1) “New Chat” & “History” navigation logic
// ───────────────────────────────────────────────────────────────────────────
function handleNavClick(pageName) {
  const uid = getCurrentUID();
  if (!uid) {
    console.warn("handleNavClick(): No user logged in!");
    return;
  }

  if (pageName === "New Chat") {
    // (1) Save the current session (if any) to Firestore + in-memory
    saveCurrentChat().then(() => {
      // (2) After saving, clear the chatContent DOM for a fresh conversation
      chatContent.innerHTML = "";
      // Show any classified outputs panel again, if hidden
      document.getElementById("classifiedOutputs")?.classList?.remove("hidden");
      // Persist that we are starting a new chat (empty chatContent)
      saveStateToLocal();
    });
  }
}
/*
  if (pageName === "History") {
    // Build a container for the history listing
    const historySection = document.createElement("div");
    historySection.innerHTML = "<h3>Chat History</h3>";

    if (chatSessions.length === 0) {
      historySection.innerHTML += "<p>(No chats saved yet.)</p>";
    } else {
      chatSessions.forEach((chat, index) => {
        // Construct a small “card” showing title + timestamp + buttons
        const thread = document.createElement("div");
        thread.style.border = "1px solid #ccc";
        thread.style.padding = "8px";
        thread.style.marginBottom = "8px";

        // Format timestamp, whether a Firestore Timestamp or ISO string
        let displayTime = "";
        if (chat.timestamp) {
          if (chat.timestamp.toDate) {
            // Firestore Timestamp object
            displayTime = chat.timestamp.toDate().toLocaleString();
          } else {
            // ISO string or Date
            try {
              displayTime = new Date(chat.timestamp).toLocaleString();
            } catch (e) {
              displayTime = String(chat.timestamp);
            }
          }
        }

        thread.innerHTML = `
          <strong>${chat.title}</strong>
          ${displayTime ? `<br/><small>${displayTime}</small>` : ""}
          <div style="margin-top:6px;">
            <button class="restore-btn" data-index="${index}">Restore</button>
            <button class="delete-btn" data-index="${index}">Delete</button>
          </div>
        `;
        historySection.appendChild(thread);
      });
    }

    // Clear chatContent and show the historySection instead
    chatContent.innerHTML = "";
    chatContent.appendChild(historySection);
    // Hide other panels:
    document.getElementById("classifiedOutputs")?.classList?.add("hidden");

    // Attach event listeners for the new buttons
    chatContent.querySelectorAll(".restore-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.currentTarget.getAttribute("data-index"), 10);
        restoreChat(idx);
      });
    });
    chatContent.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.currentTarget.getAttribute("data-index"), 10);
        deleteChat(idx);
      });
    });
  }
}
*/

function showStopButton(){ 
  if(stopBtn){
   stopBtn.style.display = 'inline-block';
 }
  else{
     sendBtn.style.display = 'none';
} }
function hideStopButton(){ 
 if(stopBtn){
   stopBtn.style.display = 'none';
 }
  else{
     sendBtn.style.display = 'inline-block';
}
}
function chunkLargeText(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

async function fetchChunkAnswer(prompt, retries = 5) {
  let backoff = 1000;
  for (let i = 0; i < retries; i++) {
    const res = await fetch(`${API_BASE_URL}/chat/completions/non-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a helpful assistant…" },
          { role: "user", content: prompt }
        ],
        temperature: 0.0
      })
    });

    // if we’re rate‑limited, wait and retry
    if (res.status === 429) {
      // try to honour Retry-After header if present
      const ra = res.headers.get("retry-after");
      const wait = ra ? parseFloat(ra)*1000 : backoff;
      console.warn(`Rate limited, retrying in ${wait}ms… (attempt ${i+1})`);
      await new Promise(r => setTimeout(r, wait));
      backoff *= 2;          // exponential back-off
      continue;
    }
    if (!res.ok) {
      throw new Error(`OpenAI error ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  throw new Error("Exceeded retry limit due to rate‑limits.");
}

// helper to sleep
function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// fetch with backoff on 429
async function fetchWithBackoff(prompt, options = {}, maxRetries = 3) {
  let attempt = 0;
  let backoff = 1000;
  while (true) {
    const res = await fetch(`${API_BASE_URL}/chat/completions/non-stream`, options);
    if (res.status !== 429) {
      if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
      return res.json();
    }
    // 429 → wait & retry
    attempt++;
    if (attempt > maxRetries) throw new Error("Too many rate‐limit retries");
    console.warn(`429 received, retry #${attempt} in ${backoff}ms…`);
    await sleep(backoff);
    backoff *= 2;
  }
}

/**
 * Push a message into chatHistoryList, keeping max length 5.
 * Oldest entries are removed once the buffer is full.
 * @param {{role: string, content: string}} msg
 */
function addToChatHistory(msg) {
  chatHistoryList.push(msg);
  if (chatHistoryList.length > 5) {
    chatHistoryList.shift();
  }
}
let measurabilityTable = [];

function addToChatHistory2(msg) {
  measurabilityTable.push(msg);
  if (measurabilityTable.length > 5) {
    measurabilityTable.shift();
  }
}


// Put this near CHAT_URL / EMBEDDING_URL
const tools = [
  {
    type: "function",
    function: {
      name: "consistency",
      description:
        "Check consistency between the annual performance plan (APP) and the annual performance report (APR).",
      parameters: { type: "object", properties: {} } // no arguments
    }
  },
  {
    type: "function",
    function: {
      name: "presentation",
      description:
        "Check whether the indicator are correctly presented in the annual performance peport",
      parameters: { type: "object", properties: {} } // no arguments
    }
  },
  {
    type: "function",
    function: {
      name: "relevance",
      description:
        "Check whether the indicator are relevant in the annual performance peport",
      parameters: { type: "object", properties: {} } // no arguments
    }
  },
  {
    type: "function",
    function: {
      name: "measurability2",
      description:
        "Check whether the indicator are measurable in the annual performance plan",
      parameters: { type: "object", properties: {} } // no arguments
    }
  }
];

async function handleUserSubmit() {
  const prompt = userInput.value.trim();
  if (!prompt) return;

  // 1) Show the user's message in the chat
  const userP = document.createElement("p");
  userP.className = "user-msg";
  userP.textContent = prompt;
  chatContent.appendChild(userP);
  userInput.value = "";

  // 2) Prepare messages (tell the model when to call the function)
  const messages = [
    {
      role: "system",
      content:
        "You are a smart audit assistant. If the user asks to check consistency " +
        "between the APP and APR (or mentions consistency checks), call the `consistency` function with no arguments."
    },
    { role: "user", content: prompt }
  ];

  // helper: markdown -> safe HTML
  const renderMarkdown = (text) => {
    try {
      if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
        return DOMPurify.sanitize(marked.parse(text));
      }
    } catch (e) {}
    // fallback: basic escape
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  };

  // Create an assistant wrapper now so we can live-update it
  const liveWrapper = buildAssistantWrapper("");
  chatContent.appendChild(liveWrapper);

  // streaming state
  let accumulated = "";
  let sawAnyTokens = false;

  // tool call assembly (streamed)
  const toolCalls = []; // [{name, arguments: '...'}]
  // Each delta can reference an index; we accumulate by index
  const ensureToolIndex = (idx) => {
    if (!toolCalls[idx]) toolCalls[idx] = { name: "", arguments: "" };
    return toolCalls[idx];
  };

  try {
    // 3) Wire up AbortController + show Stop button
    if (currentAbortController) currentAbortController.abort();
    currentAbortController = new AbortController();

    if (typeof showStopBtn === "function") {
      showStopBtn();
      sendBtn.style.display = "none";
    }

    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        tools,
        stream: true,
        // tool_choice: "auto", // optional; uncomment if you want to force auto tool selection
      }),
      signal: currentAbortController.signal
    });

    if (!res.ok) {
      // Even on streams, non-2xx may carry JSON
      let errText = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error?.message) errText = j.error.message;
      } catch {}
      throw new Error(errText);
    }

    // ---- STREAM READ ----
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = "";

    const processEvent = async (evtStr) => {
      if (!evtStr) return;
      if (evtStr.trim() === "[DONE]") return "done";

      // Each SSE event line is "data: {...json...}"
      // Some runtimes send multiple "data:" lines per event; join them.
      const lines = evtStr.split("\n").filter(l => l.startsWith("data:"));
      for (const line of lines) {
        const jsonStr = line.replace(/^data:\s*/, "").trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        let obj;
        try {
          obj = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const choice = obj?.choices?.[0];
        const delta = choice?.delta || {};

        // content tokens
        if (typeof delta.content === "string" && delta.content.length > 0) {
          sawAnyTokens = true;
          accumulated += delta.content;
          const msgEl = liveWrapper.querySelector('.assistant-msg');
          if (msgEl) msgEl.innerHTML = renderMarkdown(accumulated);
        }

        // tool call deltas (function calling)
        // Two possible shapes depending on API version:
        // 1) delta.tool_calls (OpenAI chat-completions)
        // 2) delta.function_call (older style)
        if (Array.isArray(delta.tool_calls)) {
          delta.tool_calls.forEach((tc) => {
            const idx = tc.index ?? 0;
            const slot = ensureToolIndex(idx);
            if (tc.function?.name) slot.name = tc.function.name;
            if (typeof tc.function?.arguments === "string") {
              slot.arguments += tc.function.arguments;
            }
          });
        } else if (delta.function_call) {
          // legacy single function call path
          const slot = ensureToolIndex(0);
          if (delta.function_call.name) slot.name = delta.function_call.name;
          if (typeof delta.function_call.arguments === "string") {
            slot.arguments += delta.function_call.arguments;
          }
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on double newlines between SSE events
      const parts = buffer.split("\n\n");
      // Keep last (possibly partial) chunk in buffer
      buffer = parts.pop() || "";

      for (const p of parts) {
        const endSignal = await processEvent(p);
        if (endSignal === "done") {
          // drain any partial buffer before breaking
          buffer = "";
          break;
        }
      }
    }

    // Flush any final event in buffer
    if (buffer.trim().length) {
      await processEvent(buffer);
      buffer = "";
    }

    // All chunks consumed — hide stop, show send
    if (typeof hideStopBtn === "function") {
      hideStopBtn();
      sendBtn.style.display = "block";
    }

    // If tool calls were produced, run them now (in order)
    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        const fname = call?.name || "";
        let result;
        try {
          if (fname === "consistency") {
            result = await consistency();
          } else if (fname === "measurability2") {
            result = await measurability2();
          } else if (fname === "relevance") {
            result = await relevance();
          } else if (fname === "presentation") {
            result = await presentation();
          } else {
            const warn = `⚠️ Unsupported tool invoked: ${fname || "unknown"}`;
            const warnEl = buildAssistantWrapper(warn);
            chatContent.appendChild(warnEl);
            continue;
          }

          const toolOut = typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2);

          const toolWrapper = buildAssistantWrapper("");
          const toolMsgEl = toolWrapper.querySelector('.assistant-msg');
          if (toolMsgEl) toolMsgEl.innerHTML = renderMarkdown(toolOut);
          chatContent.appendChild(toolWrapper);
        } catch (e) {
          const errEl = buildAssistantWrapper(
            `❌ Tool "${fname}" failed: ${e?.message || e}`
          );
          chatContent.appendChild(errEl);
        }
      }
    } else {
      // No tool calls and no text? give a fallback
      if (!sawAnyTokens) {
        const fallbackEl = liveWrapper.querySelector('.assistant-msg');
        if (fallbackEl) fallbackEl.innerHTML = renderMarkdown("I couldn’t generate a reply.");
      }
    }
  } catch (err) {
    if (typeof hideStopBtn === "function") {
      hideStopBtn();
      sendBtn.style.display = "block";
    }
    if (err?.name === "AbortError") {
      // Keep whatever streamed so far, just add a stopped note
      const note = buildAssistantWrapper("⏹️ Response stopped.");
      chatContent.appendChild(note);
    } else {
      console.error("🔥 OpenAI request failed:", err);
      showAlert("OpenAI request failed: " + err.message, "error");
    }
  } finally {
    currentAbortController = null;
    if (typeof saveStateToLocal === "function") saveStateToLocal();
  }
}



/*
async function handleUserSubmit() {
  sendBtn.style.display="none";
  currentAbortController = new AbortController();
  showStopButton();
  const query = (userInput?.value || "").trim();
  if (!query) return;

  // 1) show the user's message
  const up = document.createElement("p");
  up.className = "user-msg";
  up.textContent = query;
  messagesDiv.appendChild(up);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  userInput.value = "";

  try {
    // 2) embed the query to retrieve relevant context
    const qe = await openAIRequest(EMBEDDING_URL, {
      model: "text-embedding-ada-002",
      input: [query]
    });
    const qEmb = qe.data[0].embedding;

    const top3 = (vectorStore || [])
      .map(item => ({
        score: cosineSimilarity(qEmb, item.embedding),
        text: item.text
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(x => x.text);

    // 3) set up the assistant wrapper
    const wrapper = buildAssistantWrapper("", Date.now());
    const ap = wrapper.querySelector(".assistant-msg");
    chatContent.appendChild(wrapper);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // 4) stream from OpenAI (SSE)
    const chatBody = {
      model: "gpt-4o-mini",
      temperature: 0.2,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant. Render replies in GitHub-flavored Markdown. " +
            "Preserve tables, lists, and code blocks. Use headings only if needed."
        },
        { role: "system", content: "Context:\n\n" + top3.join("\n\n") },
        { role: "user", content: query }
      ],

    };

    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(chatBody),
      signal: currentAbortController.signal
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Chat API ${res.status}`);
    }

    // --- helper: convert <h1-6> to <p><strong>…</strong></p> ---
    function convertHeadingsToPStrong(html) {
      return html.replace(/<h([1-6])([^>]*)>(.*?)<\/h\1>/gi,
        (_match, _level, attrs, content) =>
          `<p${attrs} style="font-size: 0.9 rem;line-height: 1.5;
  white-space: pre-wrap;  
  word-wrap: break-word; font-family: Arial, sans-serif;"><strong>${content}</strong></p>`
      );
    }

    // 5) read & parse SSE chunks
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let accumulated = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let lineEnd;
      while ((lineEnd = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (!line) continue;
        if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (payload === "[DONE]") break;
          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content || "";
            if (delta) {
              accumulated += delta;
              let html = marked.parse(accumulated);
              html = convertHeadingsToPStrong(html);
              ap.innerHTML = DOMPurify.sanitize(html);
              messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
          } catch (_) {}
        }
      }
    }

    // 6) final sanitize & optional persistence
    let finalHtml = marked.parse(accumulated);
    finalHtml = convertHeadingsToPStrong(finalHtml);
    ap.innerHTML = DOMPurify.sanitize(finalHtml);
    sendBtn.style.display="block"; 
    hideStopBtn();
    
    if (typeof saveStateToLocal === "function") {
      try { saveStateToLocal(); } catch (_) {}
    }
  } catch (error) {
    console.error("handleUserSubmit error:", error);
    const errWrapper = buildAssistantWrapper("", Date.now());
    const errP = errWrapper.querySelector(".assistant-msg");
    errP.innerHTML = DOMPurify.sanitize(
      `<p><strong>Error:</strong> ${error.message || "Request failed."}</p>`
    );
    chatContent.appendChild(errWrapper);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
   
  }
}
*/


/////////////////////////////////////////////////////////

function formatMarkdownToHTML(markdown) {
  // Remove ### and #### headers
  markdown = markdown.replace(/^###\s?/gm, '<h3>').replace(/\n/g, '</h3>\n');
  markdown = markdown.replace(/^####\s?/gm, '<h4>').replace(/\n/g, '</h4>\n');

  // Convert bold **text**
  markdown = markdown.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Convert unordered list items (- )
  markdown = markdown.replace(/^- (.*)/gm, '<li>$1</li>');
  markdown = markdown.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>'); // wrap <li> in <ul>

  // Italics (optional)
  markdown = markdown.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Line breaks for paragraphs
  markdown = markdown.replace(/\n{2,}/g, '<br/><br/>');

  return markdown;
}

// ───────────────────────────────────────────────────────────────────────────
// Helper #1: strip out markdown noise and wrap text in simple HTML
function formatAssistant(text) {
  // 1) Remove **bold** markers and any leading # headings
  text = text.replace(/(\*{2}|#{1,6})/g, '');

  // 2) Convert any remaining **text** to <strong>
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // 3) Convert lines into <br/> breaks
  return text
    .split('\n')
    .map(line => line.trim() || '<br/>')
    .join('<br/>');
}
// ───────────────────────────────────────────────────────────────────────────

const uploadedFilesDiv = document.getElementById("uploadedFiles");
// existing “click to open file picker” logic
document.getElementById("uploadButton").addEventListener("click", () => {
  document.getElementById("hiddenFileInput").click();

});

 const processConBtn = document.getElementById('consistencyBtn');
  const processMeaBtn = document.getElementById('measurabilityBtn');
   const processRelBtn = document.getElementById('relevanceBtn');
    const processPreBtn = document.getElementById('presentationBtn');

// new: automatically process as soon as files are chosen
document.getElementById("hiddenFileInput").addEventListener("change", handleFiles);
document.getElementById("hiddenFileInput").addEventListener("change", async e => {
  uploadedFilesDiv.innerHTML = "";
  programmeList = [];
  const files = Array.from(e.target.files);
  if (files.length) {
    try {
      await ingestFiles(files);

    } catch (err) {
      showAlert2('Failed to ingest files:\n' + err.message,'error');
    }
  }
});



async function handleFiles() {  
  const files = Array.from(fileInput.files);
  if (files.length === 0) return;
  
  document.getElementById("loadingSpinner").style.display = "block";
  for (let i = 0; i < files.length; i += 2) {
    const filePair = files.slice(i, i + 2);

    console.log("File names");
    console.log(filePair);
    const promises = filePair.map(file => processSingleFile(file));
    await Promise.all(promises);
  }
   document.getElementById("loadingSpinner").style.display = "none";
  
  await processFile(fileInput.files[0]);
}

async function processSingleFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = async function () {
      let fullText = "";
      showAlert(`🔍 Processing: ${file.name}`, "info");

      try {
        if (file.type === "application/pdf") {
          const typedArray = new Uint8Array(this.result);
          const pdf = await pdfjsLib.getDocument(typedArray).promise;

          for (let i = 0; i < pdf.numPages; i++) {
            const page = await pdf.getPage(i + 1);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(" ") + "\n";
          }

        } else if (
          file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          file.type === "application/msword"
        ) {
          const result = await mammoth.extractRawText({ arrayBuffer: this.result });
          fullText = result.value;

        } else if (file.type === "text/plain") {
          fullText = this.result;

        } else {
          showAlert(`⚠️ Unsupported file type: ${file.name}`, "error");
          return resolve();
        }

        await classifyInChunks(fullText);
        showAlert(`✅ Done processing: ${file.name}`, "success");
        // Add this check before calling processFile in handleFiles
        // Need Reviewing 
        //return an empty string and terminate the file upload

      } catch (err) {
        showAlert(`❌ Error processing: ${file.name}`, "error");
        console.error(err);
      }

      resolve();
    };

    if (file.type === "application/pdf" || file.type.includes("word")) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  });
}

function chunkIntoFive(text) {
  const chunkLength = Math.ceil(text.length / 5);
  return Array.from({ length: 5 }, (_, i) => text.slice(i * chunkLength, (i + 1) * chunkLength));
}

async function retryWithBackoff(requestFunc, retries = 5, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await requestFunc();
    if (response.status !== 429) return response;
    await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt)));
  }
  throw new Error("Rate limit exceeded.");
}


async function classifyInChunks(fullText) {
  const chunks = chunkIntoFive(fullText);
  const classificationCounts = {
    "Strategic Plan": 0,
    "Annual Performance Plan": 0,
    "Annual Performance Report": 0,
    "Uncertain": 0
  };

  for (let chunk of chunks) {
    try {
      const response = await retryWithBackoff(() => fetch(`${API_BASE_URL}/chat/completions/non-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a classification assistant. Your job is to determine whether a document is a Strategic Plan, Annual Performance Plan, or Annual Performance Report.
Here is how to distinguish them:

- A **Strategic Plan** often includes long-term goals (3-5 years), vision, mission, strategic objectives, and high-level initiatives. It is forward-looking and sets the broad direction.
Here’s a standard structure of an strategic Plan and this is a structure you need to look for.
PART A: OUR MANDATE
    Constitutional mandates
    Legislative mandates
    Policy mandates
    Relevant court rulings
  PART B: Our Strategic Focus
    Vision
    Mission
    Values 
    Situational Analysis 
  PART C: Measuring Our Performance
    Institutional performance information 
    Impact statement 
    Measuring our outcomes 38
      Explanation of planned performance over the five-year planning period 
    Key risks and mitigations
    Public entities 
  PART D: Technical Indicator Descriptions
    annexure A

  end of Strategic Plan Stracture

- An **Annual Performance Plan (APP)** includes annual targets, performance indicators, programme performance information, planned targets per year, and output indicators. It is forward-focused but detailed at an operational level.
  Here’s a standard structure of an Annual Performance Plan and this is a structure you need to look for.
  PART A: OUR MANDATE
    Constitutional mandates
    Legislative mandates
    Policy mandates
    Relevant court rulings
  PART B: Our Strategic Focus 
    Situational Analysis 
    External Environment Analysis
    Internal Environment Analysis
  PART C: Measuring Our Performance
    Per Programme:
    Programme Purpose
    Sub-programmes (if any)
    Strategic Objectives
    Performance Indicators (with Technical Indicator Descriptions)
    Annual and Quarterly Targets
    Resource Implications
    Risk Management Strategies
  PART D: Technical Indicator Descriptions
    annexure A

 end of annual Performance Plan Stracture

- An **Annual Performance Report (APR)** is a structured document that provides a comprehensive review of an organisation’s performance over a financial year. It must report against what was planned.it includes general information, Performance Information, actual Achievements,Governance,Human Resources and many more.
  Here’s a standard structure of an Annual Performance Report and this is a structure you need to look for.
  PART A General Information
     Executive and accounting authority’s overview
     Organisational mandate and structure
  PART B Performance Information
     Auditor-General’s performance audit summary
     Organisational performance by programme:
     Purpose, indicators, targets vs achievements
     Reasons for deviation and corrective actions
     Budget-performance linkage
  PART C Governance
     Risk management, audit functions, internal controls
     Compliance and ethics
  PART D Human Resources
     Staffing statistics, equity, training, and HR trends
  end of annual Performance Report Stracture

if the context doesn't resemble the structured mentioneed above mark them as Uncertain

 only respond with: 'Strategic Plan', 'Annual Performance Plan','Annual Performance Report,Uncertain`

            },
            {
              role: "user",
              content: `Classify the following text:\n\n${chunk}`
            }
          ],
          temperature: 0
        })
      }));

      const data = await response.json();
      const classification = data.choices?.[0]?.message?.content?.trim();

      if (classification.includes("Strategic Plan")) classificationCounts["Strategic Plan"]++;
      else if (classification.includes("Annual Performance Plan")) classificationCounts["Annual Performance Plan"]++;
      else if (classification.includes("Annual Performance Report")) classificationCounts["Annual Performance Report"]++;
      else classificationCounts["Uncertain"]++;
    } catch (error) {
      console.error(error);
    }
  }

  const finalClassification = Object.entries(classificationCounts).sort((a, b) => b[1] - a[1])[0][0];

  if (finalClassification === "Strategic Plan") {
    strategicPlanText = fullText;
    showAlert2("Strategic Plan uploading complete",'success');
    await saveTextChunks("strategicPlanText", strategicPlanText);
    
  }
  else if (finalClassification === "Annual Performance Plan"){
    appText = fullText;
    appText = cleanDocumentText(appText);

    showAlert2("Annual Performance Plan uploading complete",'success');
    await saveTextChunks("appText", appText);
  }
  else if (finalClassification === "Annual Performance Report"){
    aprText = fullText;
    aprText = cleanDocumentText(aprText);
    showAlert2("Annual Performance Report uploading complete",'success');
    await saveTextChunks("aprText", aprText);
  } 
  else {
    showAlert2("The uploaded document is not any of these document \n Strategic Plan, Annual Performance Plan, Annual Performance Report",'error')
  }
}

// JavaScript conversion of the Python `consistency` auditing functio
// Function to extract indicators and targets from APP and APR\

async function extractIndicatorsAndTargets(appText, aprText, programmeList) {
  // 0) Ensure both documents are loaded (same as your original check)
  if (!appText || !aprText) {
    showAlert(
      "Please upload and process both the Annual Performance Plan and Report before running check",
      "error"
    );
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1) Build two arrays of Promises—one for APP extraction, one for APR extraction—
  //    so that both sets of operations start immediately (in parallel) instead of
  //    waiting for one loop to finish before the other begins.
  // ──────────────────────────────────────────────────────────────────────────

  // 1.A) Create an array of Promises for APP extraction
  const appPromises = programmeList.map((prog) => {
    return (async () => {
      // 1.A.1) Build the prompt for this programme’s APP extraction
      const promptApp = `
You are an auditing assistant your given the information from the Annual Performance Plan document below to use when auditing.
Information from the Annual Performance Plan document.
{chunk}
Your task is to extract the key performance indicators from the 'Measuring Our Performance' section all the text that is explicitly presented as Output Indicators and their corresponding Annual Targets only for the programme: ${prog}.
Do not generate or infer any additional information; only use the exact text that appears in the document. If a particular Indicator or Target is not explicitly stated, do not include it in your output.
Format your output, exactly as follows for each pair found:
1. Indicator : exact text of the Indicator as it appears in the document , Target : exact Target as it appears in the document\n
2. Indicator : exact text of the Indicator as it appears in the document, Target : exact Target as it appears in the document\n
...\n
n. Indicator : exact text of the Indicator as it appears in the document, Target : exact Target as it appears in the document\n
Do not include any additional commentary or text and also do not auto correct the any sentences from the information above write it as it appears.
proritise the rule "extract the information as it is in the chunk do not change it or simplify it. i want strictly 100% accuracy no mater what."
`;


      // 1.A.2) Run your existing APP-processing function and await its result
      const doc1 = await processDocumentWithChaining(appText, promptApp, 1000);

      console.log("APP")
      console.log(doc1);
      // 1.A.3) Push that result into aggregatedDoc1
      aggregatedDoc1.push(doc1);

      // 1.A.4) Wait 15 seconds (throttle) before finishing this Promise

      // 1.A.5) Return the result (in case you want the resolved value later)
      return doc1;
    })(); // immediately invoke the async function, returning a Promise
  });




  1// 1.B) Create an array of Promises for APR extraction
  const aprPromises = programmeList.map((prog) => {
    return (async () => {
      // 1.B.1) Build the prompt for this programme’s APR extraction
      const promptApr = `
You are an auditing assistant your given the information from the Annual Performance Report document below to use when auditing.
Information from the Annual Performance Report document.
{chunk}
Your task is to extract the key performance indicators from the 'Performance information' section all the text that is explicitly presented as only for the programme: ${prog}.
Do not generate or infer any additional information; only use the exact text that appears in the document.
If a particular Indicator or Target is not explicitly stated, do not include it in your output.
Format your output, exactly as follows for each pair found:
1. Indicator : exact text of the Indicator as it appears in the document , Target : exact Target as it appears in the document, Actual Achievement : exact  Actual Achievement as it appears in the document\n
2. Indicator : exact text of the Indicator as it appears in the document, Target : exact Target as it appears in the document, Actual Achievement : exact  Actual Achievement as it appears in the document\n
...\n
n. Indicator : exact text of the Indicator as it appears in the document, Target : exact Target as it appears in the document, Actual Achievement : exact  Actual Achievement as it appears in the document\n

Do not include any additional commentary or text and also do not auto correct the any sentences from the information above write it as it appears.
Make sure that all indicators are extracted from ${prog} as they are written do not change the wordings.     
proritise the rule "extract the information as it is in the chunk do not change it or simplify it. i want strictly 100% accuracy no mater what."
`;

      // 1.B.2) Run your existing APR-processing function and await its result
      const doc2 = await processDocumentWithChainingFixedChunks(aprText, promptApr, 3);
      
      console.log("APR")
      console.log(doc2);
      // 1.B.3) Push that result into aggregatedDoc2
      aggregatedDoc2.push(doc2);
     

      // 1.B.4) Wait 15 seconds (throttle) before finishing this Promise
      

      // 1.B.5) Return the result
      return doc2;
    })();
  });


  // 1.B) Create an array of Promises for APR extraction
  const aprPromises2 = programmeList.map((prog) => {
    return (async () => {
      // 1.B.1) Build the prompt for this programme’s APR extraction
      const promptApr2 = `
You are an auditing assistant your given the information from the Annual Performance Report document below to use when auditing.
Information from the Annual Performance Report document.
{chunk}
Your task is to extract all key performance indicators from the 'Performance information' section only for ${prog} only found in a table. 
Do not extract duplicate key Performance indicators always check if you havent extracted it.if you have extracted it ignore it and move to the next KPIs.
Do not generate or infer any additional information; only use the exact text that appears in the document.
If a particular Indicator or Target is not explicitly stated, do not include it in your output and if the
Format your output, exactly as follows for each pair found:
1. i) Indicator : exact text of the Indicator as it appears in the document , 
   ii) Target : exact Target as it appears in the document, 
   iii) Actual Achievement : exact  Actual Achievement as it appears in the document, 
   iv) Variances/Deviations: exact Variance/Deviations,
   v) Reason for Deviation: Exact Reason for Deviations. 
2. i) Indicator : exact text of the Indicator as it appears in the document, 
   ii) Target : exact Target as it appears in the document, 
   iii) Actual Achievement : exact  Actual Achievement as it appears in the document, 
   iv) Variances/Deviations: exact Variance/Deviations,
   v) Reason for Deviation: Exact Reason for Deviations.
...\n
n. i) Indicator : exact text of the Indicator as it appears in the document, 
   ii) Target : exact Target as it appears in the document, 
   iii) Actual Achievement : exact  Actual Achievement as it appears in the document, 
   iv) Variances/Deviations: exact Variance/Deviations,
   v) Reason for Deviation: Exact Reason for Deviations.

Do not include any additional commentary or text and also do not auto correct the any sentences from the information above write it as it appears.
Make sure that all indicators are extracted from ${prog} as they are written do not change the wordings.    
proritise the rule "extract the information as it is in the chunk do not change it or simplify it. i want strictly 100% accuracy no mater what.
NB: Do not extract duplicate information
`;

      // 1.B.2) Run your existing APR-processing function and await its result
      const doc3 = await processDocumentWithChainingFixedChunks(aprText, promptApr2, 4);
      
      console.log("APR Presentation")
      console.log(doc3);
      // 1.B.3) Push that result into aggregatedDoc2
      aggregatedDoc3.push(doc3);
     

      // 1.B.4) Wait 15 seconds (throttle) before finishing this Promise
      

      // 1.B.5) Return the result
      return doc3;
    })();
  });

  1// 1.B) Create an array of Promises for APR extraction
  const aprPromises3 = programmeList.map((prog) => {
    return (async () => {
      // 1.B.1) Build the prompt for this programme’s APR extraction
      const promptApr3 = `
You are an auditing assistant your given the information from the Annual Performance Report document below to use when auditing.
Information from the Annual Performance Report document.
{chunk}
Your task is to extract all key Performance indicators from the 'Performance information' section only for ${prog} only found in a table.
Do not extract duplicate key Performance indicators always check if you havent extracted it.if you have extracted it ignore it and move to the next KPIs
Do not generate or infer any additional information; only use the exact text that appears in the document.
Format your output, exactly as follows for each pair found:
1. i. Outcomes: exact text of the outcome
   ii.  Output : exact text of the output 
   iii. Indicator : exact text of the Indicator as it appears in the document , 
   iv. Target : exact Target as it appears in the document, 
   v. Actual Achievement : exact  Actual Achievement as it appears in the document

2. i. Outcomes: exact text of the outcome 
   ii. Output : exact text of the output 
   iii. Indicator : exact text of the Indicator as it appears in the document 
   iv. Target : exact Target as it appears in the document 
   v. Actual Achievement : exact  Actual Achievement as it appears in the document
...
n. i. Outcomes: exact text of the outcome 
   ii. Output : exact text of the output 
   iii. Indicator : exact text of the Indicator as it appears in the document
   iv. Target : exact Target as it appears in the document
   v. Actual Achievement : exact  Actual Achievement as it appears in the document

Do not include any additional commentary or text and also do not auto correct the any sentences from the information above write it as it appears.
Make sure that all key performance indicators are extracted from ${prog} as they are written do not change the wordings.     
proritise the rule "extract the information as it is in the chunk do not change it or simplify it. i want strictly 100% accuracy no mater what."
NB: DO NOT EXTRACT DUBLICATE INDICATORS AND ALSO ENSURE THAT YOU ONLY EXTRACT KEY PERFORMANCE INDICATORS`;

      // 1.B.2) Run your existing APR-processing function and await its result
      const doc4 = await processDocumentWithChainingFixedChunks(aprText, promptApr3, 4);
      
      console.log("APR Relevance");
      console.log(doc4);
      // 1.B.3) Push that result into aggregatedDoc2
      aggregatedDoc4.push(doc4);
     

      // 1.B.4) Wait 15 seconds (throttle) before finishing this Promise
      

      // 1.B.5) Return the result
      return doc4;
    })();
  });


 const appPromises2 = programmeList.map((prog) => {
    return (async () => {
      // 1.A.1) Build the prompt for this programme’s APP extraction
      const promptApp2 = `
You are an auditing assistant your given the information from the Annual Performance Plan document below to use when auditing.
Information from the Annual Performance Plan document.
{chunk}
Your task is to extract and use information from the 'Performance information and Technical Indicator Description' section only. from Personal Information Section on extract
the text that is explicitly presented as Output Indicators and their corresponding Annual Targets and Actual Achievements for the programme: ${prog}
and from Technical indicator Description section only use the text that is explicitly presented as an Indicator and its corresponding Definition, 
Method of Measurement/collection of data and lastly Method of data Collection or Verification for the ${prog}
Do not generate or infer any additional information; only use the exact text that appears in the document.
If a particular Indicator or Target is not explicitly stated, do not include it in your output.
Format your output, exactly as follows for each pair found:
1. Indicator : exact text of the Indicator as it appears in the document , Target : exact Target as it appears in the document, Definition : exact definitions as it appears in the document Technical Indicator Descriptions Section, Method of calculation/assessment : exactly as it appears in the document Technical Indicator Descriptions Section, Means of verification : exactly as it appears in the document Technical Indicator Descriptions Section, Reporting cycle : exactly as it appears in the document Technical Indicator Descriptions Section. \n
2. Indicator : exact text of the Indicator as it appears in the document, Target : exact Target as it appears in the document, Definition : exact definitions as it appears in the document Technical Indicator Descriptions Section, Method of calculation/assessment : exactly as it appears in the document Technical Indicator Descriptions Section, Means of verification : exactly as it appears in the document Technical Indicator Descriptions Section, Reporting cycle : exactly as it appears in the document Technical Indicator Descriptions Section.\n
...\n
n. Indicator : exact text of the Indicator as it appears in the document, Target : exact Target as it appears in the document, Definition : exact definitions as it appears in the document Technical Indicator Descriptions Section, Method of calculation/assessment : exactly as it appears in the document Technical Indicator Descriptions Section, Means of verification : exactly as it appears in the document Technical Indicator Descriptions Section, Reporting cycle : exactly as it appears in the document Technical Indicator Descriptions Section.\n

Do not include any additional commentary or text and also do not auto correct the any sentences from the information above write it as it appears.
proritise the rule "extract the information as it is in the chunk do not change it or simplify it. i want strictly 100% accuracy no mater what."
NB: Do not extract dublicate the information

`;


      // 1.A.2) Run your existing APP-processing function and await its result
      const doc5 = await processDocumentWithChaining(appText, promptApp2, 1000);

      console.log("App measurability Processed")
      console.log(doc5);
      // 1.A.3) Push that result into aggregatedDoc1
      aggregatedDoc5.push(doc5);

      // 1.A.4) Wait 15 seconds (throttle) before finishing this Promise

      // 1.A.5) Return the result (in case you want the resolved value later)
      return doc5;
    })(); // immediately invoke the async function, returning a Promise
  });



  // ──────────────────────────────────────────────────────────────────────────
  // 2) Both arrays of Promises have now been created AND started:
  //    - appPromises: one Promise per programme’s APP extraction
  //    - aprPromises: one Promise per programme’s APR extraction
  //    They run concurrently (in parallel) because we never awaited inside the map.
  //
  //    Now we simply await each batch to know when ALL of them finish.
  // ──────────────────────────────────────────────────────────────────────────

  // 2.A) Wait for every single APP-Promise to resolve
  await Promise.all(appPromises);
  document.getElementById("loadingSpinner2").style.display = "none";
  document.getElementById("loadingSpinner4").style.display = "block";
  // 2.B) Wait for every single APR-Promise to resolve
  await Promise.all(aprPromises);
  document.getElementById("loadingSpinner4").style.display = "none";
  document.getElementById("loadingSpinner3").style.display = "block";

  await Promise.all(aprPromises2);

  document.getElementById("loadingSpinner3").style.display = "none";
  document.getElementById("loadingSpinner5").style.display = "block";
  await Promise.all(aprPromises3);

   await Promise.all(appPromises2);
  // ──────────────────────────────────────────────────────────────────────────
  // 3) At this point, every APP extraction (including its 15s sleep) and every APR
  //    extraction (including its 15s sleep) has completed. The arrays
  //    aggregatedDoc1 and aggregatedDoc2 now contain all results in order.
  // ──────────────────────────────────────────────────────────────────────────
}

/* ───────────────────────────────────────────────────────────────────────────────────── */
/* ✏️ NEW: 3.1 Helper to render a message in the DOM given its role ("user" / "assistant") */
/* ───────────────────────────────────────────────────────────────────────────────────── */
/**
 * renderMessage(role, content)
 *   role:   "user" or "assistant"
 *   content: string
 *
 * Creates the correct <p> or <pre> bubble, appends it, and scrolls down.
 */
function renderMessage(role, content) {
  let el;
  if (role === 'user') {
    el = document.createElement('p');
    el.className = 'user-msg';
    el.textContent = content;
  } else if (role === 'assistant') {
    el = document.createElement('pre');
    el.className = 'assistant-msg';
    el.style.whiteSpace = 'pre-wrap';
    el.style.wordWrap = 'break-word';
    el.textContent = content;
  } else {
    return;
  }

  chatContent.appendChild(el);
  chatContent.scrollTop = chatContent.scrollHeight;
}

/* ───────────────────────────────────────────────────────────────────────────────────── */
/* ✏️ NEW: 3.2 Save a chat message to Firestore under the current user’s subcollection */
/*                    Format: users/{uid}/messages/{autoId}                           */
/* ───────────────────────────────────────────────────────────────────────────────────── */
 //─────────────────────────────────────────────────────────────────────────────────────
// ✏️ NEW: Helper #1 → Create a new chat‐pair doc with only userContent.
//         Returns a DocumentReference so we can update it later.
// ─────────────────────────────────────────────────────────────────────────────────────
async function createChatDocument(userContent) {
  const uid = window.currentUserUID;
  if (!uid) {
    console.warn("🚨 Cannot create chat doc: no currentUserUID.");
    return null;
  }

  try {
    const docRef = await db
      .collection('users')
      .doc(uid)
      .collection('messages')
      .add({
        userContent: userContent,
        assistantContent: null,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    return docRef; // we will call docRef.id to update later
  } catch (err) {
    console.error("🔥 Error creating chat document:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// ✏️ NEW: Helper #2 → Update the same doc with assistantContent.
// ─────────────────────────────────────────────────────────────────────────────────────
async function updateChatDocument(docId, assistantContent) {
  const uid = window.currentUserUID;
  if (!uid || !docId) {
    console.warn("🚨 Cannot update chat doc: missing uid or docId.");
    return;
  }

  try {
    await db
      .collection('users')
      .doc(uid)
      .collection('messages')
      .doc(docId)
      .update({
        assistantContent: assistantContent,
        // Optionally, you could store a second timestamp, e.g.:
        // assistantTimestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
  } catch (err) {
    console.error("🔥 Error updating chat document:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// ✏️ NEW (modified): loadChatHistory now expects each doc to have { userContent, assistantContent }.
//                     It will render the user bubble first, then the assistant bubble (if present).
// ─────────────────────────────────────────────────────────────────────────────────────
async function loadChatHistory() {
  const uid = window.currentUserUID;
  if (!uid || uid === 'guest') {
    console.log('Skipping chat history load for guest user');
    return;
  }

  // Check if Firebase is available and user is authenticated
  if (typeof db === 'undefined' || typeof auth === 'undefined') {
    console.warn('Firebase not initialized. Cannot load chat history.');
    return;
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    console.warn('No authenticated user. Cannot load chat history.');
    return;
  }

  try {
    const snapshot = await db
      .collection('users')
      .doc(uid)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .get();

    // Clear the chat pane before replaying:
    chatContent.innerHTML = '';

    snapshot.forEach(doc => {
      const data = doc.data();
      // Render the userContent:
      if (data.userContent) {
        renderMessage('user', data.userContent);
      }
      // Then render the assistantContent (if it exists):
      if (data.assistantContent) {
        renderMessage('assistant', data.assistantContent);
      }
    });
  } catch (err) {
    console.warn("⚠️ Could not load chat history (offline mode or insufficient permissions):", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// ✏️ NEW: When auth state changes, loadChatHistory() so all paired docs replay properly.
// ─────────────────────────────────────────────────────────────────────────────────────
// Only set up auth listener if Firebase auth is available
if (typeof auth !== 'undefined') {
  auth.onAuthStateChanged(user => {
    if (user) {
      window.currentUserUID = user.uid;
      // Only attempt to load chat history from Firestore for authenticated users.
      try {
        loadChatHistory();
      } catch (err) {
        console.warn('Could not load chat history from Firestore:', err);
      }
    } else {
      // When not authenticated, we do not redirect. Instead we fallback to
      // the UID stored in localStorage (defaulting to guest) so the app can
      // continue to function offline.
      const uid = localStorage.getItem('currentUserUID') || 'guest';
      window.currentUserUID = uid;
      // There is no Firestore chat history for guests; we rely on local storage
      console.log('No authenticated user; using local UID:', uid);
    }
  });
} else {
  // Firebase not initialized, use localStorage UID
  const uid = localStorage.getItem('currentUserUID') || 'guest';
  window.currentUserUID = uid;
  console.log('Firebase auth not available; using local UID:', uid);
}

/**
 * Extracts the section between the second occurrence of the keyword
 * and the next "Part D" marker.
 *
 * @param {string} text - The full document text.
 * @return {string|null} - The extracted section, or null if not found.
 */
function extractSecondPerformanceSection(text) {
  const keyword = "Measuring Our Performance";
  const marker = "Part D";

  // Find first occurrence
  const firstIdx = text.indexOf(keyword);
  if (firstIdx === -1) return null;

  // Find second occurrence (starting just after the first)
  const secondIdx = text.indexOf(keyword, firstIdx + keyword.length);
  if (secondIdx === -1) return null;

  // Find where "Part D" begins, after that second occurrence
  const partDIdx = text.indexOf(marker, secondIdx);
  if (partDIdx === -1) return null;

  // Extract from the second keyword up to (but not including) "Part D"
  return text.substring(secondIdx, partDIdx).trim();
}


/**
 * Extracts the section between the second occurrence of the keyword
 * and the next "Part D" marker.
 */
 
function extractSecondPerformanceInfoSectionAPR(text) {
  const keyword = "Performance Information";
  const marker  = "Part C";

  // 1. Find first occurrence
  const firstIdx = text.indexOf(keyword);
  if (firstIdx === -1) return null;

  // 2. Take the slice *after* that first occurrence
  const afterFirst = text.slice(firstIdx + keyword.length);

  // 3. Check if that slice still includes the keyword (i.e., a second occurrence)
  if (!afterFirst.includes(keyword)) return null;

  // 4. Compute the start index of the second occurrence in the original text
  const secondIdx = firstIdx + keyword.length + afterFirst.indexOf(keyword);

  // 5. Locate "Part C" after the second occurrence
  const endIdx = text.indexOf(marker, secondIdx);
  if (endIdx === -1) return null;

  // 6. Extract and return (including the second keyword itself)
  return text.substring(secondIdx, endIdx).trim();
}



/* Note:
   - We assume elsewhere in home.html you have already done:
       const db = firebase.firestore();
       const auth = firebase.auth();
   - And that you have a <div id="chatContent"></div> in your HTML.
*/
/* ───────────────────────────────────────────────────────────────────────────────────── */
/* 3.5 MODIFY your existing consistency() to write to Firestore each time a message is appended */
/* ───────────────────────────────────────────────────────────────────────────────────── */
/**
 *  UPDATED consistency()
 *  ---------------------
 *  1. Ensure APP & APR are loaded.
 *  2. Create → render the user prompt (and createChatDocument).
 *  3. Show “Processing…” placeholder.
 *  4. Extract once if needed.
 *  5. Loop through programmeList, build comparisonPrompt, get LLM response.
 *  6. Accumulate all assistant replies into a single string (assistantFullText).
 *  7. When finished, remove placeholder, render assistant bubble(s), AND updateChatDocument().
 */
async function consistency() {
  // 1) Ensure both documents are loaded
        processConBtn.disabled = true;
        processMeaBtn.disabled = true;
        processRelBtn.disabled = true;
        processPreBtn.disabled = true;

  if (!appText || !aprText) {
    showAlert(
      "Please upload and process both the Annual Performance Plan and Report before running consistency check",
      "error"
    );
    return;
  }

  // 2. placeholder *user* message
  const userMsg = document.createElement('p');
  userMsg.className = 'user-msg';
  userMsg.textContent = 'Checking for Consistency';
  chatContent.appendChild(userMsg);

  // 3) Create & render the assistant placeholder (animated “Processing”)
  const thinkingEl = document.createElement('p');
  thinkingEl.className = 'assistant-msg';
  thinkingEl.textContent = 'Processing';
  const dots = document.createElement('span');
  dots.className = 'dots';
  thinkingEl.appendChild(dots);
  chatContent.appendChild(thinkingEl);
  chatContent.scrollTop = chatContent.scrollHeight;

  // Start dot animation
  let dotCount = 0;
  const dotInterval = setInterval(() => {
    dotCount = (dotCount + 1) % 4; // cycles 0 → 1 → 2 → 3 → 0
    dots.textContent = '.'.repeat(dotCount);
  }, 500);

 
  // 5) For each programme, build comparisonPrompt and get a partial LLM reply
  let assistantFullText = ""; 

  for (let k = 0; k < programmeList.length; k++) {
    const comparisonPrompt = `
You are an expert auditing assistant. Below are the aggregated extracted data from two documents.
----- Extracted Data from Document 1 (APP) -----
${aggregatedDoc1[k]}
----- End of Data from Document 1 -----
----- Extracted Data from Document 2 (APR) -----
${aggregatedDoc2[k]}
----- End of Data from Document 2 -----

Instructions:
1. Forget any definition of “consistent.” Use only this definition below:
   • Consistent means the way targets are represented in the APP vs. the APR is uniform.
   • The APP’s target should be reported in the APR using the same format (percentages, words, numbers, etc.).
   • Differences in raw values do not matter as long as formatting is identical.
   • The actual achievements do not have to meet planned targets to be “consistent”; only the format matters. 
    examples of consistent. 
   i) if the target is <85% and the actual achievement is 95% (Target Not Achieved) then its consistent since both are presented as percentage even though the target was not achieved.
   ii) if the target is Monitoring report on the number of Imbali Precinct projects completed in collaboration with DUT approved by the Director - General by 31 March 2024 and the actual achievement is Target Not Achieved Monitoring report on the number of Imbali Precinct projects completed in collaboration with DUT was not developed as planned is still consistent since the formart for representatiom is wording.

     example of inconsistent
      i) if target is 25% and the actual achievement is 25 percent. then this is not consistent since the format differs.
   • The APR’s reported target must match the APP’s planned target format exactly, even if numeric values differ.
      
2. Use this definition of consistency throughout the reponse and do not Deviate from it every time it is mentioned in the context
   use the definition provided only.   
3. Follow this output format for each indicator in ${programmeList[k]} format the following in a table format with the following headers No,Planned indicator per APP,Reported indicator per APR,Planned target per APP,Reported planned target per APR,Reported actual achievement per APR:
    Programme name
   i) Planned indicator per APP: [exact text from APP]
   ii) Reported indicator per APR: [exact text from APR]
   iii) Planned target per APP: [exact text from APP]
   iv) Reported planned target per APR: [exact text from APR]
   v) Reported actual achievement per APR: [exact text from APR]
  End of what to format
  
   Then answer:
      in the format below:
      Indicator Assessment(in bold)
      1.Indicator: from the table.(in bold)
       • Reported indicator is consistent with planned indicator: [Yes/No + 100-word explanation NB:Answer based on definition of consitent i provided and do not deviate from the definition i provided. The differance in values does not matter only the format matter]
       • Reported planned annual target is consistent with planned target: [Yes/No + 100-word explanation NB: Answer based on definition i provided and do not deviate from the definition i provided. The differance in values does not matter only the format matter]
       • Reported achievement(s) is consistent with planned and reported indicators/targets: [Yes/No + 100-word explanation NB: Answer based on definition i provided and do not deviate from the definition i provided. The differance in values does not matter only the format matter]
       • Conclusion: [Conclude based on the responses 1.Reported indicator is consistent with planned indicator 2.Reported planned annual target is consistent with planned target 3.Reported achievement(s) is consistent with planned and reported indicators/targets in exactly 150 words].

    Styles for generating responses.
     1. make sure the table is always generated
     2. Make the Programme title,table header, indicator Assessment,Indicatorm,Query Statement and Yes or No answers Bold.
     3. Apply this styles throughout the response.

    Examples
    Tables of indicators Targets and Actual Achievement

    Indicator assessment 
    1.Child infancy death rate.(In bold)
     • Reported indicator is consistent with planned indicator: Yes
      Explanation: ...
       • Reported planned annual target is consistent with planned target: Yes
      Explanation: ...
       • Reported achievement(s) is consistent with planned and reported indicators/targets: Yes
      Explanation: ...
       • Conclusion of about 150 words.  
      ...

    2.Rate of teenage pregnacy.(in bold)
     • Reported indicator is consistent with planned indicator: Yes
      Explanation: ...
       • Reported planned annual target is consistent with planned target: Yes
      Explanation: ...
       • Reported achievement(s) is consistent with planned and reported indicators/targets: Yes
      Explanation: ...
       • Conclusion of about 150 words.  
      ...
    
    Rules
    1. Make sure to always follow all format and examples when generating the output. 
    2. Make sure to include every indicator for this programme until all are covered. Only compare indicators where the APR text matches the APP text exactly. No extra commentary.
    3. make sure that all the indicators are listed in 1 table then assessment each indicators.
    4. Make to matches similar indicators in a table for example when i say similar i mean 
      number of sub-programme completed and number of sub programme completed this are similar even though the other does no have a (-)
    5. Make sure that the only text you extract from are ${aggregatedDoc1[k]} and ${aggregatedDoc2[k]} if the information is not in this context please do not include it and 
    ckeck if all key performance indicators in the context are included in the indicators assessment and table if not included, include it this a priority.
    6. NB: All the indicators in the table has to be assessed do not concluded without assessing each indicator.
    for example if there are 100 indicators in a table then the have to be 100 indicator assessment.  

      NB: STYLES YOU NEED TO APPLY WHEN GENERATING THE OUTPUTS RESPONSE
      1. Make Programme Name Bold.
      2. Make the following Bold:
        - Indicators Assessment
        - Indicator
        - Explanation
        - Conclusion
        - Reported indicator is consistent with planned indicator:
        - Reported planned annual target is consistent with planned target:
        - Reported achievement(s) is consistent with planned and reported indicators/targets:
      3. Don't make Yes or No bold 
      NB: MAKE SURE THAT EACH INDICATOR IN INDICATOR ASSESSMENT HAS ITS OWN CONCLUSION OF WHETHER ITS CONSISTENT AND WHY.
`;

    // 6) Send to OpenAI (with streaming / retry logic)
     const doc = await fetchChunkAnswer2(comparisonPrompt);
    // …after streaming & rendering assistantFullText…
    addToChatHistory({ role: 'assistant', content: doc});

  }

  // 8) At this point, we've collected ALL programmes’ replies in one string:
  //    Stop “thinking” animation and remove placeholder bubble:
  clearInterval(dotInterval);
  thinkingEl.remove();

  // 11) Finally, hide any other “thinking” text if present:
  const t = document.getElementById("thinkingText");
  if (t) t.style.display = "none";
  processConBtn.disabled = !true;
  processMeaBtn.disabled = !true;
  processRelBtn.disabled = !true;
  processPreBtn.disabled = !true;
}

/* ============================= */
/* === END script.js (edited) === */
/* ============================= */
async function measurability2() {
  processConBtn.disabled = true;
  processMeaBtn.disabled = true;
  processRelBtn.disabled = true;
  processPreBtn.disabled = true;

  // make sure the APP and APR have been loaded
  if (!appText || !aprText) {
    showAlert(
      "Please upload and process both the Annual Performance Plan and Report before running measurability check",
      "error"
    );
    return;
  }
// remove old messages but leave spinner in place
  document
    .querySelectorAll("#chatContent .user-msg, #chatContent .assistant-msg, #chatContent pre")
    .forEach(el => el.remove());

  // 2. placeholder *user* message
  const userMsg = document.createElement('p');
  userMsg.className = 'user-msg';
  userMsg.textContent = 'Check for measurability';
  chatContent.appendChild(userMsg);

  // Create a single wrapper for ALL assistant messages
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-msg-wrapper';

  // Host that holds ALL assistant blocks
  const blocksHost = document.createElement('div');
  blocksHost.className = 'assistant-msg-host';
  wrapper.appendChild(blocksHost);

  chatContent.appendChild(wrapper);

  const thinking = document.createElement('p');
  thinking.className = 'assistant-msg';
  thinking.textContent = 'Processing';
  const dots = document.createElement('span');
  dots.className = 'dots';
  thinking.appendChild(dots);
  blocksHost.appendChild(thinking);
  chatContent.scrollTop = chatContent.scrollHeight;

  let dotCount = 0;
  const dotInterval = setInterval(() => {
    dotCount = (dotCount + 1) % 4;
    dots.textContent = '.'.repeat(dotCount);
  }, 500);
  // now the spinner div is still in the DOM:
  //document.getElementById("loadingSpinner").style.display = "block";
  // …

  // Store all assistant responses for PDF export
  const allResponses = [];

   for (let j = 0; j < programmeList.length; j++) {
    const promptTemplateApr = `
You are an auditing assistant your given the information from the Annual Performance Plan document below to use when auditing.
Information from the Annual Performance Plan document.
${aggregatedDoc5[j]}
Your task is to extract and use information all key performance indicators including their definition,methods of calculation/assessment, means of verification and Reporting cycle from the given context.
Do not generate or infer any additional information; only use the exact text that appears in the document.
If a particular Indicator or Target is not explicitly stated, do not include it in your output.
Format your output in a table. with the following table headers: No, Indicators, Targets, Definition,Methods of calculation/assessment, Means of verification and Reporting cycle. 
Programme name [${programmeList[j]}]
start of table
1 Indicator : exact text... [NB: Make sure to insert an indicator], Target : ...[NB: Not the same as indicator], Definition : exact Text..., Method of calculation/assessment, means of verification: exact text..., Reporting cycle: exact text...
2 Indicator : exact text... [NB: Make sure to insert an indicator], Target : ...[NB: Not the same as indicator], Definition : exact Text..., Method of calculation/assessment, means of verification: exact text..., Reporting cycle: exact text... 
...
n Indicator : exact text... [NB: Make sure to insert an indicator], Target : ...[NB: Not the same as indicator], Definition : exact Text..., Method of calculation/assessment, means of verification: exact text..., Reporting cycle: exact text... 
end of the table.
 
Examples of the required Output Template:
  Example 1

  Programme Name: Programme 2,  
  table with 6 headers
  1 Indicator: number of student passed, Target: 7000, Definition: This indicator seeks to track the Department’s efficiencies in producing high numbers of student passing in a year., Method of calculation/assessment:the total number of student passed divided by the total number of student multiply by 100., means of verification: academic report on yearly basis., Reporting cycle: yearly. [Row 1]
  2 Indicator: number of student Failed, Target: 500,  Definition: This indicator seeks to track the Department’s efficiencies in producing high numbers of student failing in a year., Method of calculation/assessment:the total number of student failed divided by the total number of student multiply by 100., means of verification: academic report on yearly basis., Reporting cycle: yearly. [Row 2]
  end of table 

Rules:
1. Tabulate all key performance indicators and their corresponding information mentioned in ${aggregatedDoc5[j]} until all information are in a table and do not leave any single indicator. 
2. Make sure that the response strictly follows the format and the examples of the output.the response should not defer from the format and examples.
3. Do not lose the format above. stick to it until the end of the output/response which include indicator,target,actual achievement, variance/deviation, reason for Variances/deviations and lastly conclusion.
4. Do **not** infer, paraphrase, summarize or add any new data—use only what’s literally in {chunk}.
5. Do not Deviate from the format given which include a table and indicator Assessment.
6. ignore the text "(in bold)" do not render it in the output.
7. NB: You are only allowed to respond in a format that is given to you. do not list the response

 NB: STYLES YOU NEED TO APPLY WHEN GENERATING THE OUTPUTS RESPONSE
      1. Make Programme Name Bold.
      2. All ways present the response in a table not a List.
    `;
    const doc = await fetchChunkAnswerForMeasurability(promptTemplateApr, blocksHost);
  // 7) Remove the "Thinking…" bubble:

  // …after streaming & rendering assistantFullText…
  allResponses.push(doc);
  addToChatHistory({ role: 'assistant', content: doc});
  await new Promise(resolve => setTimeout(resolve, 5000));

const promptTemplateApr2 = `You are an auditing assistant your given the information from the Annual Performance Plan document below to use when auditing.
Information from the Annual Performance Plan document.
${doc}
Your task is to assess all the KPIs given in above context.
Use exact format given below:
Indicators Assessment:

Indicator
- The performance indicator has a clear unambiguous definition (in bold): [Check whether the each performance indicators have a clear unambigous definition. Reply with Yes or No and then give an Explanation why yes or why no in exactly (150) words while you explain start by stating the Definition and then make references to the definition from the Technical Indicator Description in the explanation.
Interpret what the definition is describing to determine so that you understand the definition and there after make a conclusion that the definition is clear and unambiguous]\n
- The performance indicator is defined so that data will be collected consistently(in bold) : [Check whether the each performance indicators is defined so that data will be collected consistently. Reply with Yes or No and then give an Explanation why yes or why no in (150) words while you explain start by stating the method of measurement/calculation/collectionand then make references to the method of measurement/calculation/collection of data from the Technical Indicator Description in the explanation.
Interprete what the Method of measurement/calculation/collection of data from the Technical Indicator Description Section to determine that you understand the methods and there after make a conclusion that the data can be collected consistently]\n]\n
- The target is specific i.e. the nature and required level of performance clearly identified (in bold): [check whether the target is specific i.e. the nature and required level of performance clearly identified. Reply with Yes or No and then give an Explanation why yes or why no in (150) words]\n
- The target is measurable(in bold): [Check whether the target is measurable. Reply with Yes or No and give an explanation of why yes or why no in (150) words]\n
- The target is time bound(in bold): [Check whether the target is time bound. Reply with Yes or No and give an explanation of why yes or why no in (150) words. If not Stated check if the indicator is possible to be achieved in a year if yes then its time bound if no then its not time bound]\n
- The performance indicator is well defined(in bold): [ check the answers of above queries. If all answers are Yes: 
  Yes, the performance indicator is well defined because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets. 
   If any answer is No: 
    No, the performance indicator is not well defined because [insert reason based on the specific query(s) that resulted in a \No\ response]. For example, if the target is not measurable, the explanation will state: \The target is not measurable, which is a critical requirement for a well-defined performance indicator.\]\n
- The performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator(in bold): [check whether the performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator. Reply with Yes or No and then give an Explanation why yes or why no in (150) words]\n
- Is the indicator (with its related targets) measurable (in bold): [check the answers of the above queries. if answers are Yes: the indicator with its related targets are measurable because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets and verifiable. 
  If any answer is No: 
    No, indicator (with its related targets) are measurable because [insert reason based on the specific query(s) that resulted in a \No\ response.] ]   
end of the output format

Examples of the required Output Template:
  Example 1
  Indicators assessment
  1.Number of student passed 
    - The performance indicator has a clear unambiguous definition (in bold): Yes  
    Explanation: the definition explicitly states that it considers the number of student paased and within a specific timeframe  per school term. This clarity allows stakeholders to understand precisely what is being measured and leaves little room for misinterpretation. Thus, the definitions serve to communicate the intent of each indicator succinctly, which is crucial for transparency and accountability in administrative processes as emphasized in the Technical Indicator Description.
    - The performance indicator is defined so that data will be collected consistently (in bold): Yes
    Explanation: the calculation method outlines that it is based on pass mark processed against total number of student, ensuring regularity in data gathering from the same source. This methodological approach establishes a systematic framework for collecting data, which allows benchmarks to be evaluated uniformly across different periods and conditions, significantly reducing variability in reports and assessments
    - The target is specific i.e. the nature and required level of performance clearly identified (in bold):Yes
    Explanation: is explicitly stated as "7000," which indicates the exact level of performance required. This clarity in objectives allows for aligned efforts within the organization to achieve these specific outcomes, making accountability straightforward and performance evaluation more transparent
    - The target is measurable(in bold):Yes
    Explanation: The targets for each performance indicator are quantitative, thus allowing for easy measurement of achievement. For example, targets such as "7000" for number of students who passed     
    - The target is time bound(in bold): Yes
    Explanation: Each target is associated with a specific timeframe, typically the fiscal year in which they are assessed, thus making them time-bound. For example, the targets for the indicators are stated for the 2022/23 financial year, which clearly specifies the duration within which these performance levels should be me.
    - The performance indicator is well defined(in bold): Yes
    Explanation:  The performance indicator is well defined because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets. This structure supports effective monitoring and evaluation, providing clarity for stakeholders regarding expected outcomes and fostering accountability.
    - The performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator(in bold): [check whether the performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator: Yes
    Explanation: Each performance indicator has associated methods of data collection and verification that enhance its verifiability.This systematic approach to data collection and processing allows independent verification by auditors, thereby affirming the integrity of the reported figures. The clear links between definitions and methods of calculation ensure that stakeholders can trace the origins and accuracy of the data presented, satisfying the requirement for verifying the processes and systems that yield these indicators
    - Is the indicator (with its related targets) measurable(in bold): Yes
    Explanation: The indicator with its related targets are measurable because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets. It provides a tangible framework for evaluation, enabling transparent performance assessments while allowing for systematic comparisons over time.

  2. Number of student Failed    
    - The performance indicator has a clear unambiguous definition(in bold) : Yes  
    Explanation: the definition explicitly states that it considers the number of student Failed and within a specific timeframe  per school term. This clarity allows stakeholders to understand precisely what is being measured and leaves little room for misinterpretation. Thus, the definitions serve to communicate the intent of each indicator succinctly, which is crucial for transparency and accountability in administrative processes as emphasized in the Technical Indicator Description.
    - The performance indicator is defined so that data will be collected consistently(in bold) : Yes
    Explanation: the calculation method outlines that it is based on failing mark processed against total number of student, ensuring regularity in data gathering from the same source. This methodological approach establishes a systematic framework for collecting data, which allows benchmarks to be evaluated uniformly across different periods and conditions, significantly reducing variability in reports and assessments
    - The target is specific i.e. the nature and required level of performance clearly identified (in bold):Yes
    Explanation: is explicitly stated as "500," which indicates the exact level of performance required. This clarity in objectives allows for aligned efforts within the organization to achieve these specific outcomes, making accountability straightforward and performance evaluation more transparent
    - The target is measurable(in bold):Yes
    Explanation: The targets for each performance indicator are quantitative, thus allowing for easy measurement of achievement. For example, targets such as "7000" for number of students who passed     
    - The target is time bound(in bold): Yes
    Explanation: Each target is associated with a specific timeframe, typically the fiscal year in which they are assessed, thus making them time-bound. For example, the targets for the indicators are stated for the 2022/23 financial year, which clearly specifies the duration within which these performance levels should be me.
    - The performance indicator is well defined(in bold): Yes
    Explanation:  The performance indicator is well defined because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets. This structure supports effective monitoring and evaluation, providing clarity for stakeholders regarding expected outcomes and fostering accountability.
    - The performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator: [check whether the performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator:(in bold) Yes
    Explanation: Each performance indicator has associated methods of data collection and verification that enhance its verifiability.This systematic approach to data collection and processing allows independent verification by auditors, thereby affirming the integrity of the reported figures. The clear links between definitions and methods of calculation ensure that stakeholders can trace the origins and accuracy of the data presented, satisfying the requirement for verifying the processes and systems that yield these indicators
    - Is the indicator (with its related targets) measurable(in bold): Yes
    Explanation: The indicator with its related targets are measurable because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets. It provides a tangible framework for evaluation, enabling transparent performance assessments while allowing for systematic comparisons over time.

  end of the output example

  whats happening in the example is that the first indicator and target are extracted in the first example the indicator is number of student passed and with a target of 7000. then the indicator is queried to check if its measurable using step 1 - 8.
  each step has its ways of checking measurability.some step require method of calculation and definition and etc.the example 2 is the continue of checking each indicators in the programme.which then use again the steps 1 - 8 again to check for measurability.
  the output followed the format until the end there was no listing indicator and targets first before queries and also the indicators.

Rules:
1. Use the Tabulated key performance indicators and their corresponding information mentioned in ${doc} until all information in a table are assessed and do not leave any single indicator. 
2. Make sure that the response strictly follows the format and the examples of the output.the response should not defer from the format and examples.
3. Do not lose the format above. stick to it until the end of the output/response which include indicator,target,actual achievement, variance/deviation, reason for Variances/deviations and lastly conclusion.
4. Do **not** infer, paraphrase, summarize or add any new data—use only what’s literally in {chunk}.
5. Do not Deviate from the format given which include a table and indicator Assessment.
6. Make sure to assess all the indicators listed in the table do not leave any indicators unassessed.
7. ignore the text "(in bold)" do not render it in the output.
8. Do not put the indicator Assessment inside a table.
9. NB: All the indicators in the table has to be assessed do not concluded without assessing each indicator.
    for example if there are 100 indicators in a table then the have to be 100 indicator assessment.
10. NB: You are not allowed to respond in a table format only the format that is given to you.

  NB: STYLES YOU NEED TO APPLY WHEN GENERATING THE OUTPUTS RESPONSE
  1. Make Programme Name Bold.
  2. Always present the response in a table not a List.
  3. Make "Indicators Assessment" Bold (not "Indicator Assesment")
  4. Make each indicator name Bold (the indicator text itself, e.g., "Number of students passed")
  5. Make the following text Bold:
     - "The performance indicator has a clear unambiguous definition:"
     - "The performance indicator is defined so that data will be collected consistently:"
     - "The target is specific i.e. the nature and required level of performance clearly identified:"
     - "The target is measurable:"
     - "The target is time bound:"
     - "The performance indicator is well defined:"
     - "The performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator:"
     - "Is the indicator (with its related targets) measurable:"
     - "Explanation"
     - "Conclusion"
  6. Don't make Yes or No bold


`;

    const doc2 = await fetchChunkAnswerForMeasurability(promptTemplateApr2, blocksHost);
    // …after streaming & rendering assistantFullText…
    allResponses.push(doc2);
    addToChatHistory2({ role: 'assistant', content: doc2});

    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  // Remove thinking indicator and add export button
  clearInterval(dotInterval);
  thinking.remove();

  // Add single export button for all messages
  const btncontainer = document.createElement('div');
  btncontainer.className = 'btncontainerDiv';
  wrapper.appendChild(btncontainer);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'export-pdf-btn remove-msg-btn';
  removeBtn.title = 'Delete message';
  removeBtn.innerHTML = `<img src="delete.png" alt="Delete" onerror="this.style.display='none'"/> Delete`;
  btncontainer.appendChild(removeBtn);
  removeBtn.addEventListener('click', () => {
    const userEl = wrapper.previousElementSibling;
    if (userEl) userEl.remove();
    wrapper.remove();
  });

  // Export button - exports ALL assistant messages in the wrapper
  const exportBtn = document.createElement('button');
  exportBtn.className = 'export-pdf-btn';
  exportBtn.title = 'Export PDF';
  exportBtn.innerHTML = `<img src="export.png" alt="PDF" onerror="this.style.display='none'"/> Export PDF`;
  
  // Add click handler for PDF export - collect ALL assistant messages
  exportBtn.addEventListener('click', async () => {
    try {
      if (allResponses.length === 0) {
        console.error('No assistant messages found for export');
        if (typeof showAlert === 'function') {
          showAlert('No messages to export', 'error');
        }
        return;
      }

      // Use stored responses instead of extracting from DOM
      const messages = allResponses.map(content => ({
        role: 'assistant',
        content: content,
        timestamp: Date.now()
      }));

      console.log('Sending', messages.length, 'assistant messages to backend for PDF generation');

      // Call backend to generate PDF
      const response = await fetch(`${API_BASE_URL}/export-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to generate PDF' }));
        throw new Error(error.error || 'Failed to generate PDF');
      }

      // Get PDF blob
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `measurability-report-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
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
  });
  
  btncontainer.appendChild(exportBtn);

  processConBtn.disabled = !true;
  processMeaBtn.disabled = !true;
  processRelBtn.disabled = !true;
  processPreBtn.disabled = !true;
}

/*
async function measurability2() {
  processConBtn.disabled = true;
  processMeaBtn.disabled = true;
  processRelBtn.disabled = true;
  processPreBtn.disabled = true;

  // make sure the APP and APR have been loaded
  if (!appText || !aprText) {
    showAlert(
      "Please upload and process both the Annual Performance Plan and Report before running measurability check",
      "error"
    );
    return;
  }
// remove old messages but leave spinner in place
  document
    .querySelectorAll("#chatContent .user-msg, #chatContent .assistant-msg, #chatContent pre")
    .forEach(el => el.remove());

  // 2. placeholder *user* message
    const userMsg = document.createElement('p');
  userMsg.className = 'user-msg';
  userMsg.textContent = 'Check for measurability 2.0...';
  chatContent.appendChild(userMsg);

  const thinking = document.createElement('p');
  thinking.className = 'assistant-msg';
  thinking.textContent = 'Processing';
  const dots = document.createElement('span');
  dots.className = 'dots';
  thinking.appendChild(dots);
  chatContent.appendChild(thinking);
  chatContent.scrollTop = chatContent.scrollHeight;

  let dotCount = 0;
  const dotInterval = setInterval(() => {
    dotCount = (dotCount + 1) % 4;
    dots.textContent = '.'.repeat(dotCount);
  }, 500);
  // now the spinner div is still in the DOM:
  //document.getElementById("loadingSpinner").style.display = "block";
  // …

   for (let j = 0; j < programmeList.length; j++) {
    const promptTemplateApr = `
You are an auditing assistant your given the information from the Annual Performance Plan document below to use when auditing.
Information from the Annual Performance Plan document.
{chunk}
Your task is to extract and use information from the 'Performance information and Technical Indicator Description' section only. from Personal Information Section on extract
the text that is explicitly presented as Output Indicators and their corresponding Annual Targets and Actual Achievements for the programme: ${programmeList[j]} 
and from Technical indicator Description section only use the text that is explicitly presented as an Indicator and its corresponding Definition, 
Method of Measurement/collection of data and lastly Method of data Collection or Verification for the ${programmeList[j]}
Do not generate or infer any additional information; only use the exact text that appears in the document.
If a particular Indicator or Target is not explicitly stated, do not include it in your output.
Format your output, exactly as follows in a table. with the headers programme name,indicators and targets. 
Programme name [NB: not an indicator]
i). Indicator : exact text... [NB: Make sure to insert an indicator] Target : ...[NB: Not the same as indicator]
ii). Indicator : exact text... [NB: Make sure to insert an indicator] Target : ...[NB: Not the same as indicator] 
end of the table.

Indicators Assessment:

indicator
1) The performance indicator has a clear unambiguous definition (in bold): [Check whether the each performance indicators have a clear unambigous definition. Reply with Yes or No and then give an Explanation why yes or why no in exactly (150) words while you explain start by stating the Definition and then make references to the definition from the Technical Indicator Description in the explanation.
Interpret what the definition is describing to determine so that you understand the definition and there after make a conclusion that the definition is clear and unambiguous]\n
2) The performance indicator is defined so that data will be collected consistently(in bold) : [Check whether the each performance indicators is defined so that data will be collected consistently. Reply with Yes or No and then give an Explanation why yes or why no in (150) words while you explain start by stating the method of measurement/calculation/collectionand then make references to the method of measurement/calculation/collection of data from the Technical Indicator Description in the explanation.
Interprete what the Method of measurement/calculation/collection of data from the Technical Indicator Description Section to determine that you understand the methods and there after make a conclusion that the data can be collected consistently]\n]\n
3) The target is specific i.e. the nature and required level of performance clearly identified (in bold): [check whether the target is specific i.e. the nature and required level of performance clearly identified. Reply with Yes or No and then give an Explanation why yes or why no in (150) words]\n
4) The target is measurable(in bold): [Check whether the target is measurable. Reply with Yes or No and give an explanation of why yes or why no in (150) words]\n
5) The target is time bound(in bold): [Check whether the target is time bound. Reply with Yes or No and give an explanation of why yes or why no in (150) words. If not Stated check if the indicator is possible to be achieved in a year if yes then its time bound if no then its not time bound]\n
6) The performance indicator is well defined(in bold): [ check the answers of above queries. If all answers are Yes: 
  Yes, the performance indicator is well defined because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets. 
   If any answer is No: 
    No, the performance indicator is not well defined because [insert reason based on the specific query(s) that resulted in a \No\ response]. For example, if the target is not measurable, the explanation will state: \The target is not measurable, which is a critical requirement for a well-defined performance indicator.\]\n
7) The performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator(in bold): [check whether the performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator. Reply with Yes or No and then give an Explanation why yes or why no in (150) words]\n
8) Is the indicator (with its related targets) measurable (in bold): [check the answers of the above queries. if answers are Yes: the indicator with its related targets are measurable because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets and verifiable. 
  If any answer is No: 
    No, indicator (with its related targets) are measurable because [insert reason based on the specific query(s) that resulted in a \No\ response.] ]   
end of the output format

Examples of the required Output Template:
  Example 1
  Programme Name: Programme 2  1.Indicator: number of student passed Target: 7000
  Programme Name: Programme 2  2.Indicator: number of student Failed Target: 500

  Indicators assessment
  1.Number of student passed 
    1.The performance indicator has a clear unambiguous definition (in bold): Yes  
    Explanation: the definition explicitly states that it considers the number of student paased and within a specific timeframe  per school term. This clarity allows stakeholders to understand precisely what is being measured and leaves little room for misinterpretation. Thus, the definitions serve to communicate the intent of each indicator succinctly, which is crucial for transparency and accountability in administrative processes as emphasized in the Technical Indicator Description.
    2) The performance indicator is defined so that data will be collected consistently (in bold): Yes
    Explanation: the calculation method outlines that it is based on pass mark processed against total number of student, ensuring regularity in data gathering from the same source. This methodological approach establishes a systematic framework for collecting data, which allows benchmarks to be evaluated uniformly across different periods and conditions, significantly reducing variability in reports and assessments
    3) The target is specific i.e. the nature and required level of performance clearly identified (in bold):Yes
    Explanation: is explicitly stated as "7000," which indicates the exact level of performance required. This clarity in objectives allows for aligned efforts within the organization to achieve these specific outcomes, making accountability straightforward and performance evaluation more transparent
    4) The target is measurable(in bold):Yes
    Explanation: The targets for each performance indicator are quantitative, thus allowing for easy measurement of achievement. For example, targets such as "7000" for number of students who passed     
    5) The target is time bound(in bold): Yes
    Explanation: Each target is associated with a specific timeframe, typically the fiscal year in which they are assessed, thus making them time-bound. For example, the targets for the indicators are stated for the 2022/23 financial year, which clearly specifies the duration within which these performance levels should be me.
    6) The performance indicator is well defined(in bold): Yes
    Explanation:  The performance indicator is well defined because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets. This structure supports effective monitoring and evaluation, providing clarity for stakeholders regarding expected outcomes and fostering accountability.
    7) The performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator(in bold): [check whether the performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator: Yes
    Explanation: Each performance indicator has associated methods of data collection and verification that enhance its verifiability.This systematic approach to data collection and processing allows independent verification by auditors, thereby affirming the integrity of the reported figures. The clear links between definitions and methods of calculation ensure that stakeholders can trace the origins and accuracy of the data presented, satisfying the requirement for verifying the processes and systems that yield these indicators
    8) Is the indicator (with its related targets) measurable(in bold): Yes
    Explanation: The indicator with its related targets are measurable because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets. It provides a tangible framework for evaluation, enabling transparent performance assessments while allowing for systematic comparisons over time.

  2. Number of student Failed    
    1.The performance indicator has a clear unambiguous definition(in bold) : Yes  
    Explanation: the definition explicitly states that it considers the number of student Failed and within a specific timeframe  per school term. This clarity allows stakeholders to understand precisely what is being measured and leaves little room for misinterpretation. Thus, the definitions serve to communicate the intent of each indicator succinctly, which is crucial for transparency and accountability in administrative processes as emphasized in the Technical Indicator Description.
    2) The performance indicator is defined so that data will be collected consistently(in bold) : Yes
    Explanation: the calculation method outlines that it is based on failing mark processed against total number of student, ensuring regularity in data gathering from the same source. This methodological approach establishes a systematic framework for collecting data, which allows benchmarks to be evaluated uniformly across different periods and conditions, significantly reducing variability in reports and assessments
    3) The target is specific i.e. the nature and required level of performance clearly identified (in bold):Yes
    Explanation: is explicitly stated as "500," which indicates the exact level of performance required. This clarity in objectives allows for aligned efforts within the organization to achieve these specific outcomes, making accountability straightforward and performance evaluation more transparent
    4) The target is measurable(in bold):Yes
    Explanation: The targets for each performance indicator are quantitative, thus allowing for easy measurement of achievement. For example, targets such as "7000" for number of students who passed     
    5) The target is time bound(in bold): Yes
    Explanation: Each target is associated with a specific timeframe, typically the fiscal year in which they are assessed, thus making them time-bound. For example, the targets for the indicators are stated for the 2022/23 financial year, which clearly specifies the duration within which these performance levels should be me.
    6) The performance indicator is well defined(in bold): Yes
    Explanation:  The performance indicator is well defined because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets. This structure supports effective monitoring and evaluation, providing clarity for stakeholders regarding expected outcomes and fostering accountability.
    7) The performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator: [check whether the performance indicator is verifiable; i.e. it is possible to verify the processes and systems that produce the indicator:(in bold) Yes
    Explanation: Each performance indicator has associated methods of data collection and verification that enhance its verifiability.This systematic approach to data collection and processing allows independent verification by auditors, thereby affirming the integrity of the reported figures. The clear links between definitions and methods of calculation ensure that stakeholders can trace the origins and accuracy of the data presented, satisfying the requirement for verifying the processes and systems that yield these indicators
    8) Is the indicator (with its related targets) measurable(in bold): Yes
    Explanation: The indicator with its related targets are measurable because it has a clear and unambiguous definition, ensures consistent data collection, and has specific, measurable, and time-bound targets. It provides a tangible framework for evaluation, enabling transparent performance assessments while allowing for systematic comparisons over time.

  end of the output example

  whats happening in the example is that the first indicator and target are extracted in the first example the indicator is number of student passed and with a target of 7000. then the indicator is queried to check if its measurable using step 1 - 8.
  each step has its ways of checking measurability.some step require method of calculation and definition and etc.the example 2 is the continue of checking each indicators in the programme.which then use again the steps 1 - 8 again to check for measurability.
  the output followed the format until the end there was no listing indicator and targets first before queries and also the indicators.

Rules:
1. Use the format given above and the example of the output,you should stick to them until you finish generating the response.
2. Do not include any additional commentary.
3. Do not summarize anything even if the pattern is similar please make sure that you write everything without summarizng it.
4. Make sure to extract and query the indicators and then move to the next indicator until all indicators are queried. 
5. Output strictly one table with all the rows of programme names,indicators and targets
6. Make sure that all the indicators and all the indicator assessment statement are bolded and also reduce the line height between the responses.
    `;
    const doc2 = await processDocumentWithChainingFixedChunks2(appText, promptTemplateApr, 3); 
      // …after streaming & rendering assistantFullText…
    addToChatHistory({ role: 'assistant', content: doc2});
  // 7) Remove the "Thinking…" bubble:
  thinking.remove();
  await new Promise(resolve => setTimeout(resolve, 10000));
  }

  processConBtn.disabled = !true;
  processMeaBtn.disabled = !true;
  processRelBtn.disabled = !true;
  processPreBtn.disabled = !true;
}
*/




async function relevance() {
  processConBtn.disabled = true;
  processMeaBtn.disabled = true;
  processRelBtn.disabled = true;
  processPreBtn.disabled = true;
 
  // make sure the APP and APR have been loaded
  if (!appText || !aprText) {
    showAlert(
      "Please upload and process both the Annual Performance Plan and Report before running relevance check",
      "error"
    );
    return;
  }
// remove old messages but leave spinner in place
  document
    .querySelectorAll("#chatContent .user-msg, #chatContent .assistant-msg, #chatContent pre")
    .forEach(el => el.remove());

  // 2. placeholder *user* message
  const userMsg = document.createElement('p');
  userMsg.className = 'user-msg';
  userMsg.textContent = 'Check for relevance';
  chatContent.appendChild(userMsg);

  // Create a single wrapper for ALL assistant messages
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-msg-wrapper';

  // Host that holds ALL assistant blocks
  const blocksHost = document.createElement('div');
  blocksHost.className = 'assistant-msg-host';
  wrapper.appendChild(blocksHost);

  chatContent.appendChild(wrapper);

  const thinking = document.createElement('p');
  thinking.className = 'assistant-msg';
  thinking.textContent = 'Processing';
  const dots = document.createElement('span');
  dots.className = 'dots';
  thinking.appendChild(dots);
  blocksHost.appendChild(thinking);
  chatContent.scrollTop = chatContent.scrollHeight;

  let dotCount = 0;
  const dotInterval = setInterval(() => {
    dotCount = (dotCount + 1) % 4;
    dots.textContent = '.'.repeat(dotCount);
  }, 500);
  // now the spinner div is still in the DOM:
  //document.getElementById("loadingSpinner").style.display = "block";
  // …

  // Store all assistant responses for PDF export
  const allResponses = [];

   for (let j = 0; j < programmeList.length; j++) {
    const promptTemplateApr = `
You are an auditing assistant your given the information from the Annual Performance Report document below to use when auditing.
Information from the Annual Performance Report document.
${aggregatedDoc4}
Your task is to extract all the key Performance indicators from the given context only.
Do not generate or infer any additional information; only use the exact text that appears in the document.
If a particular Indicator or Target is not explicitly stated, do not include it in your output.
Format this in a table only, with the No,Indicator title, Target , output and outcomes as headers of the table:
${programmeList[j]}
table start here
1). Outcomes: ..., Output :..., Indicator : exact text...,  Target : ...(Row 1)
2). Outcomes: ..., Output :..., Indicator : exact text...,  Target : ...(Row 2)
...
n). Outcomes: ..., Output :..., Indicator : exact text...,  Target : ...(Row n)
table ends here

Indicators Assessment 
1.Indicator
i). The target relates directly to the indicator: [does The target relates directly to the indicator. Reply with a Yes or No refer to the content given and also give reason why Yes and why No, the reasons must be at least 200 or more words]
ii). The target expresses a specific level of performance that the programme development priority / objective is aiming to achieve within a given time period : [does the target expresses a specific level of performance that the programme development priority/objective is aiming to achieve within a given time period. reply with Yes or No and give an Explanation. the explanation must be at least 200 or more words]
iii) The performance indicator and targets relate logically to the legislative or political mandate of the auditee; including: 
- Applicable legislation: [Reply with Yes/No and state the legislation if possible]
  Explanation: ...
- National and provincial priorities and MTSF [Reply with Yes/No and state the national and provincial priorities and MTSF if possible]
  Explanation: ...
- Specific sector plans (including standardised indicators)
  Explanation:..
iv). Conclusion: [Generate a conclusion based on the above questionaire]

Examples of the required output no exception:
Example 1
Programme 5 Skills development
Table with the following table headers Outcomes, Output, indicators,targets,and Actual Achievements
1). Outcomes : Improved success and efficiency of the PSET System, Output : students studing Engineering, Indicator : Number of studing Engineering, Target : 58699 (Row 1)
2). Outcomes :  Improved success and efficiency of the PSET System, Output : student studing business, Indicator : Number of students studing business, Target : 5869 (Row 2)
...
end of table

Indicators Assessment 
1.Number of studing Engineering (in bold)
  i). The target relates directly to the indicator (in bold): Yes
     Explanation: ...
  ii). The target expresses a specific level of performance that the programme development priority / objective is aiming to achieve within a given time period(in bold): Yes
     Explanation:...
  iii) The performance indicator and targets relate logically to the legislative or political mandate of the auditee; including: 
      - Applicable legislation
      Explanation: ... 
      - National and provincial priorities and MTSF
      Explanation: ...
      - Specific sector plans (including standardised indicators)
      Explanation: ...
  iv). Conclusion: ...


2.Number of studing business(in bold)
  i). The target relates directly to the indicator (in bold): Yes
     Explanation: ...
  ii). The target expresses a specific level of performance that the programme development priority / objective is aiming to achieve within a given time period(in bold): Yes
     Explanation:...
  iii) The performance indicator and targets relate logically to the legislative or political mandate of the auditee; including: 
      - Applicable legislation
      Explanation: ...
      - National and provincial priorities and MTSF
      Explanation: ...
      - Specific sector plans (including standardised indicators)
      Explanation: ...
  iv). Conclusion: ...

Rules:
1. Tabulate all the key performance indicators and their corresponding information mentioned in ${aggregatedDoc4[j]} until all information are in a table and do not leave any single indicator. 
2. Use the format given above and the example of the output,you should stick to them until you finish generating the response.
3. Do not include any additional commentary.
4. Do not summarize anything even if the pattern is similar please make sure that you write everything without summarizng it.
5. Make sure to extract and query the indicators and then move to the next indicator until all indicators are queried. 
6. Please do not confuse the output with the Output Indicator, they are totally different.
7. Whenever you see (in bold) make the Text Bold this is high priority do not write also (in bold).
8. NB: All the indicators in the table has to be assessed do not concluded without assessing each indicator.
   for example if there are 100 indicators in a table then the have to be 100 indicator assessment.
9. A Table is a priority please ensure that it is created.

NB: STYLES YOU NEED TO APPLY WHEN GENERATING THE OUTPUTS RESPONSE
      1. Make Programme Name Bold.
      2. All ways present the response in a table not a List.
      3. Make "Indicators Assessment" Bold
      4. Make each indicator name Bold (the indicator text itself, e.g., "Number of students studying Engineering")
      5. Make the following text Bold:
        - "The target relates directly to the indicator:"
        - "The target expresses a specific level of performance that the programme development priority / objective is aiming to achieve within a given time period:"
        - "The performance indicator and targets relate logically to the legislative or political mandate of the auditee; including:"
        - "Applicable legislation"
        - "National and provincial priorities and MTSF"
        - "Specific sector plans (including standardised indicators)"
      6. Make "Explanation" and "Conclusion" Bold
      7. Don't make Yes or No bold
    `;

   const doc = await fetchChunkAnswerForMeasurability(promptTemplateApr, blocksHost);
  // 7) Remove the "Thinking…" bubble:

  // …after streaming & rendering assistantFullText…
  allResponses.push(doc);
  addToChatHistory({ role: 'assistant', content: doc});
  
  await new Promise(resolve => setTimeout(resolve, 10000));
  }

  // Remove thinking indicator and add export button
  clearInterval(dotInterval);
  thinking.remove();

  // Add single export button for all messages
  const btncontainer = document.createElement('div');
  btncontainer.className = 'btncontainerDiv';
  wrapper.appendChild(btncontainer);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'export-pdf-btn remove-msg-btn';
  removeBtn.title = 'Delete message';
  removeBtn.innerHTML = `<img src="delete.png" alt="Delete" onerror="this.style.display='none'"/> Delete`;
  btncontainer.appendChild(removeBtn);
  removeBtn.addEventListener('click', () => {
    const userEl = wrapper.previousElementSibling;
    if (userEl) userEl.remove();
    wrapper.remove();
  });

  // Export button - exports ALL assistant messages in the wrapper
  const exportBtn = document.createElement('button');
  exportBtn.className = 'export-pdf-btn';
  exportBtn.title = 'Export PDF';
  exportBtn.innerHTML = `<img src="export.png" alt="PDF" onerror="this.style.display='none'"/> Export PDF`;
  
  // Add click handler for PDF export - use stored responses
  exportBtn.addEventListener('click', async () => {
    try {
      if (allResponses.length === 0) {
        console.error('No assistant messages found for export');
        if (typeof showAlert === 'function') {
          showAlert('No messages to export', 'error');
        }
        return;
      }

      // Use stored responses instead of extracting from DOM
      const messages = allResponses.map(content => ({
        role: 'assistant',
        content: content,
        timestamp: Date.now()
      }));

      console.log('Sending', messages.length, 'assistant messages to backend for PDF generation');

      // Call backend to generate PDF
      const response = await fetch(`${API_BASE_URL}/export-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to generate PDF' }));
        throw new Error(error.error || 'Failed to generate PDF');
      }

      // Get PDF blob
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `relevance-report-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
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
  });
  
  btncontainer.appendChild(exportBtn);

  processConBtn.disabled = !true;
  processMeaBtn.disabled = !true;
  processRelBtn.disabled = !true;
  processPreBtn.disabled = !true;
}

async function presentation() {
  processConBtn.disabled = true;
  processMeaBtn.disabled = true;
  processRelBtn.disabled = true;
  processPreBtn.disabled = true;

  // make sure the APP and APR have been loaded
  if (!appText || !aprText) {
    showAlert(
      "Please upload and process both the Annual Performance Plan and Report before running relevance check",
      "error"
    );
    return;
  }
// remove old messages but leave spinner in place
  document
    .querySelectorAll("#chatContent .user-msg, #chatContent .assistant-msg, #chatContent pre")
    .forEach(el => el.remove());

  // 2. placeholder *user* message
  const userMsg = document.createElement('p');
  userMsg.className = 'user-msg';
  userMsg.textContent = 'Check for presentation and disclosure';
  chatContent.appendChild(userMsg);

  // Create a single wrapper for ALL assistant messages
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-msg-wrapper';

  // Host that holds ALL assistant blocks
  const blocksHost = document.createElement('div');
  blocksHost.className = 'assistant-msg-host';
  wrapper.appendChild(blocksHost);

  chatContent.appendChild(wrapper);

  const thinking = document.createElement('p');
  thinking.className = 'assistant-msg';
  thinking.textContent = 'Processing';
  const dots = document.createElement('span');
  dots.className = 'dots';
  thinking.appendChild(dots);
  blocksHost.appendChild(thinking);
  chatContent.scrollTop = chatContent.scrollHeight;

  let dotCount = 0;
  const dotInterval = setInterval(() => {
    dotCount = (dotCount + 1) % 4;
    dots.textContent = '.'.repeat(dotCount);
  }, 500);

  // Store all assistant responses for PDF export
  const allResponses = [];

  for (let j = 0; j < programmeList.length; j++) {
    const promptTemplateApr = `
You are an auditing assistant your given the information from the Annual Performance Report document below to use when auditing.
Information from the Annual Performance Report document.
${aggregatedDoc3[j]}
Your task is to extract all the key performance indicators from the context above only.
Do not generate or infer any additional information; only use the exact text that appears in the document.
Format your output in a table format with 6 headers namely No,Indicators,Targets,Actual Achievements, Variances/Deviation, Reason for Deviations.:
${programmeList[j]}
start of the table
1. Indicator : exact text..., Target : ..., Actual Achievement : ..., Variances/Deviation : ..., Reason for Deviations : ...[NB: Do not confuse it with deviation, this is the reason why the is a deviation]
2. Indicator : exact text..., Target : ..., Actual Achievement : ..., Variances/Deviation : ..., Reason for Deviations : ...[NB: Do not confuse it with deviation, this is the reason why the is a deviation]
...
n. Indicator : exact text..., Target : ..., Actual Achievement : ..., Variances/Deviation : ..., Reason for Deviations : ...[NB: Do not confuse it with deviation, this is the reason why the is a deviation]
end of the table


Indicator Assesment(in bold)
1.Indicator(in bold)
  -Reason for Variances/deviation:(in bold) [fetch the reason from the context give someimes its represented as a comment]
  -Conclution(in bold): ...[conclude with at least 100 or more words high priority ]


Examples of the required output no exception:
Example 1
Table here

Indicator Assesment
1.Audit opinion received from the AG of South Africa(in bold)
  -Reason for Variances/deviation(in bold): None
  -Conclusion(in bold): The unqualified audit opinion illustrates the Department's effective financial stewardship and governance practices, signifying compliance with accounting standards and financial regulations. 
Although the target for a clean audit was not met, achieving an unqualified audit signifies that the Department is on the right track towards improving its financial practices. Continued efforts towards 
maintaining and enhancing performance in fiscal accountability are paramount, particularly as they inspire confidence among stakeholders and the public. Forthcoming efforts should focus on addressing the material finding noted by auditors, ensuring that all aspects of the audit process are transparent and thoroughly documented. 
Aiming for a clean audit in future periods will solidify the Department's integrity and operational efficacy.

2.Percentage of valid invoices received from creditors paid within 30 days(in bold)
 -Reason for Variances/deviation(in bold): Office closure during the first quarter of the 2022/23 financial year due to power cuts and administrative delays.
 -Conclusion(in bold): The high achievement rate of 99.7% for paying valid invoices within 30 days underscores the Department's commitment to timely financial transactions and demonstrates effective financial management. 
Despite a slight variance of 0.3% from the 100% target, which was influenced by external factors like power cuts, the overall performance indicates robust processes within the finance team and the desire to maintain 
strong relationships with suppliers. Continuous monitoring and to remedy identified flaws help mitigate risks associated with processing delays, thus enhancing reliability. Ensuring timely payments is not just crucial 
for maintaining supplier trust; it also reflects the Department's commitment to accountability and efficiency in municipal resource management.

end of the Examples

Here is what is happening in the example. first the indicators, their targets, their actual achievement, variance/deviation and also the reason for the deviation from the Personal information section then a conclusion is made based on the extracted information
then it moved to the next indicator of the programme given until all the indicators are checked.


Rules:
1. Tabulate all the key performance indicators and their corresponding information mentioned in ${aggregatedDoc3[j]} until all information are in a table and do not leave any single indicator. 
2. Make sure that the response strictly follows the format and the examples of the output.the response should not defer from the format and examples.
3. Do not lose the format above. stick to it until the end of the output/response which include indicator,target,actual achievement, variance/deviation, reason for Variances/deviations and lastly conclusion.
4. Do **not** infer, paraphrase, summarize or add any new data—use only what’s literally in {chunk}.
5. Do not Deviate from the format given which include a table and indicator Assessment.
6. Make sure to assess all the indicators listed in the table do not leave any indicators unassessed.
7. NB: All the indicators in the table has to be assessed do not concluded without assessing each indicator.

NB: STYLES YOU NEED TO APPLY WHEN GENERATING THE OUTPUTS RESPONSE
      1. Make Programme Name Bold.
      2. Always present the response in a table not a List.
      3. Make "Indicator Assessment" Bold
      4. Make each indicator name Bold (the indicator text itself)
      5. Make the following text Bold:
        - "Reason for Variances/deviation:"
        - "Conclusion:"
      6. Don't make Yes or No bold
`;

// 6) Send to OpenAI (with streaming / retry logic)
   const doc = await fetchChunkAnswerForMeasurability(promptTemplateApr, blocksHost);
  
      // …after streaming & rendering assistantFullText…
    allResponses.push(doc);
    addToChatHistory({ role: 'assistant', content: doc});
// 7) Remove the "Thinking…" bubble:
  await new Promise(resolve => setTimeout(resolve, 10000));
  }
  
  // Remove thinking indicator and add export button
  clearInterval(dotInterval);
  thinking.remove();

  // Add single export button for all messages
  const btncontainer = document.createElement('div');
  btncontainer.className = 'btncontainerDiv';
  wrapper.appendChild(btncontainer);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'export-pdf-btn remove-msg-btn';
  removeBtn.innerHTML = `
    <img src="delete.png" alt="Delete" onerror="this.style.display='none'"/> Delete
  `;
  btncontainer.appendChild(removeBtn);
  removeBtn.addEventListener('click', () => {
    const userEl = wrapper.previousElementSibling;
    if (userEl) userEl.remove();
    wrapper.remove();
  });

  // Export button - exports ALL assistant messages in the wrapper
  const exportBtn = document.createElement('button');
  exportBtn.className = 'export-pdf-btn';
  exportBtn.innerHTML = `
    <img src="export.png" alt="PDF" onerror="this.style.display='none'"/> Export PDF
  `;
  
  // Add click handler for PDF export - use stored responses
  exportBtn.addEventListener('click', async () => {
    try {
      if (allResponses.length === 0) {
        console.error('No assistant messages found for export');
        if (typeof showAlert === 'function') {
          showAlert('No messages to export', 'error');
        }
        return;
      }

      // Use stored responses instead of extracting from DOM
      const messages = allResponses.map(content => ({
        role: 'assistant',
        content: content,
        timestamp: Date.now()
      }));

      console.log('Sending', messages.length, 'assistant messages to backend for PDF generation');

      // Call backend to generate PDF
      const response = await fetch(`${API_BASE_URL}/export-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to generate PDF' }));
        throw new Error(error.error || 'Failed to generate PDF');
      }

      // Get PDF blob
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `presentation-report-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
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
  });
  
  btncontainer.appendChild(exportBtn);

  processConBtn.disabled = !true;
  processMeaBtn.disabled = !true;
  processRelBtn.disabled = !true;
  processPreBtn.disabled = !true;
}


async function processDocumentWithChaining(documentText, promptTemplate, chunkSize = 1000) {
  const chunks = [];
  let currentChunk = "";

  documentText.split("\n\n").forEach(paragraph => {
    if (currentChunk.length + paragraph.length < chunkSize) {
      currentChunk += paragraph + "\n\n";
    } else {
      chunks.push(currentChunk);
      currentChunk = paragraph + "\n\n";
    }
  });
  if (currentChunk) chunks.push(currentChunk);

  let responses = [];
  for (let i = 0; i < chunks.length; i++) {
    const prompt = promptTemplate.replace("{chunk}", chunks[i]);
    const result = await fetchChunkAnswer(prompt);
    responses.push(result);
  }
  return responses.join("\n\n");
}


// catch clicks on Restore/Delete in the history listing
chatContent.addEventListener("click", (e) => {
  const idx = e.target.dataset.index;
  if (e.target.matches(".restore-btn")) {
    restoreChat(+idx);
  }
  if (e.target.matches(".delete-btn")) {
    deleteChat(+idx);
  }
});

/**
 * Break a text into an array of sentences.
 */
function splitIntoSentences(text) {
  return text.match(/[^\.!\?]+[\.!\?]+/g) || [text];
}

/**
 * Chunk by accumulating sentences up to chunkSize characters,
 * then overlap the last sentence into the next chunk.
 */
async function processDocumentWithChaining2(documentText, promptTemplate, chunkSize = 1000) {
  const chunks = [];
  let currentChunk = "";

  documentText.split("\n\n").forEach(paragraph => {
    if (currentChunk.length + paragraph.length < chunkSize) {
      currentChunk += paragraph + "\n\n";
    } else {
      chunks.push(currentChunk);
      currentChunk = paragraph + "\n\n";
    }
  });
  if (currentChunk) chunks.push(currentChunk);

  let responses = [];
  for (let i = 0; i < chunks.length; i++) {
    const prompt = promptTemplate.replace("{chunk}", chunks[i]);
    const result = await fetchChunkAnswer2(prompt);
    responses.push(result);
  }
  return responses.join("\n\n");
}


async function processDocumentWithChainingFixedChunks(documentText, promptTemplate, numberOfChunks = 3) {
  const chunkSize = Math.ceil(documentText.length / numberOfChunks);
  const chunks = [];

  for (let i = 0; i < numberOfChunks; i++) {
    const start = i * chunkSize;
    const end = i === numberOfChunks - 1 ? documentText.length : start + chunkSize;
    chunks.push(documentText.slice(start, end));
  }

  let responses = [];
  for (let i = 0; i < chunks.length; i++) {
    const prompt = promptTemplate.replace("{chunk}", chunks[i]);
    const result = await fetchChunkAnswer(prompt);
    responses.push(result);
  }
  return responses.join("\n\n");
}


// catch clicks on Restore/Delete in the history listing
chatContent.addEventListener("click", (e) => {
  const idx = e.target.dataset.index;
  if (e.target.matches(".restore-btn")) {
    restoreChat(+idx);
  }
  if (e.target.matches(".delete-btn")) {
    deleteChat(+idx);
  }
});

/**
 * Split into a fixed number of sentence-based chunks,
 * each overlapping the previous chunk by exactly one sentence.
 */
//new
async function processDocumentWithChainingFixedChunks2(documentText, promptTemplate, numberOfChunks = 3) {
  const chunkSize = Math.ceil(documentText.length / numberOfChunks);
  const chunks = [];

  for (let i = 0; i < numberOfChunks; i++) {
    const start = i * chunkSize;
    const end = i === numberOfChunks - 1 ? documentText.length : start + chunkSize;
    chunks.push(documentText.slice(start, end));
  }

  let responses = [];
  for (let i = 0; i < chunks.length; i++) {
    const prompt = promptTemplate.replace("{chunk}", chunks[i]);
    const result = await fetchChunkAnswer2(prompt);
    responses.push(result);
  }
  return responses.join("\n\n");
}


/**
 * Replace the current chat window with the saved conversation at chatHistoryList[idx]
 */
/**
 * Utility: grab whatever user/assistant <p>’s are in #chatContent right now
 * and return an array of { type: "User"|"Assistant", text: string }.
 */
function getCurrentMessages() {
  return Array.from(
    document.querySelectorAll('#chatContent .user-msg, #chatContent .assistant-msg')
  ).map(p => ({
    type: p.classList.contains('user-msg') ? 'User' : 'Assistant',
    text: p.textContent
  }));
}

/**
 * Save whatever’s currently in the chat pane, if non‐empty.
 */

async function saveCurrentChat() {
  const uid = getCurrentUID() || 'guest';
  // In this local build we always have a fallback UID. If none exists we treat
  // the user as a guest. This ensures chats can still be persisted locally.


  // (A) Extract all messages currently in chatContent
  const currentMessages = Array.from(chatContent.querySelectorAll("p")).map((p) => {
    return {
      type: p.classList.contains("user-msg") ? "User" : "Assistant",
      text: p.textContent,
      timestamp: new Date().toISOString(),
    };
  });

  if (currentMessages.length === 0) {
    console.log("saveCurrentChat(): chatContent is empty; nothing to save.");
    return;
  }

  // (B) Derive a title from the first user message (max 30 chars)
  const firstUser = currentMessages.find((m) => m.type === "User");
  let title;
  if (firstUser) {
    title = firstUser.text.slice(0, 30) + (firstUser.text.length > 30 ? "…" : "");
  } else {
    title = `Chat ${chatSessions.length + 1}`;
  }

  // (C) Build the chat object to store
  const chatObj = {
    title,
    messages: currentMessages,
    // Use a simple ISO string for the timestamp when persisting locally.
    timestamp: new Date().toISOString(),
  };

  // (D) Push into the chatSessions array
  chatSessions.push(chatObj);

  // (E) Persist to localStorage under the current UID. We avoid
  // external dependencies to ensure the app functions offline. The
  // chatHistoryList array is also stored via saveStateToLocal().
  try {
    // Remove any transient Firestore metadata on the chat object
    delete chatObj.firestoreId;
    // Push to the in-memory array (already done above) and save to
    // localStorage through our state persistence helper. This will
    // serialise chatSessions.
    saveStateToLocal();
    console.log("Saved chat locally with title:", title);
  } catch (err) {
    console.error("saveCurrentChat(): Error saving chat locally:", err);
  }
}

/**
 * Restore a saved chat at index `idx`.  
 * If the pane already has messages, saves them first.
 */
async function restoreChat(index) {
  const uid = getCurrentUID() || 'guest';
  // Always allow restoring chats for a guest user as well.

  // (1) First: save any messages currently in chatContent as a “placeholder” chat
  const currentMessages = Array.from(chatContent.querySelectorAll("p")).map((p) => {
    return {
      type: p.classList.contains("user-msg") ? "User" : "Assistant",
      text: p.textContent,
      timestamp: new Date().toISOString(),
    };
  });

  if (currentMessages.length > 0) {
    // Build a fallback title
    const firstUser = currentMessages.find((m) => m.type === "User");
    let placeholderTitle;
    if (firstUser) {
      placeholderTitle = firstUser.text.slice(0, 30) + (firstUser.text.length > 30 ? "…" : "");
    } else {
      placeholderTitle = `Unsent Chat ${chatSessions.length + 1}`;
    }

    const placeholderObj = {
      title: placeholderTitle,
      messages: currentMessages,
      timestamp: new Date().toISOString(),
    };

    // Add to in-memory chatSessions
    chatSessions.push(placeholderObj);
    // Persist updated state locally
    saveStateToLocal();
  }

  // (2) Clear chatContent, then load the selected chat
  chatContent.innerHTML = "";
  const selectedChat = chatSessions[index];
  selectedChat.messages.forEach((msg) => {
    if (msg.type === "User") {
      const p = document.createElement("p");
      p.className = "user-msg";
      if (msg.timestamp) {
        const timeOnly = new Date(msg.timestamp).toLocaleTimeString();
        p.textContent = `${msg.text}  (${timeOnly})`;
      } else {
        p.textContent = msg.text;
      }
      chatContent.appendChild(p);
    } else if (msg.type === "Assistant") {
      const wrapper = buildAssistantWrapper(msg.text, msg.timestamp);
      chatContent.appendChild(wrapper);
    }
  });

  // (3) Persist updated state so that the chat is saved. We deliberately avoid
  // re-rendering the History view here; instead, the restored chat is now
  // visible in the main chat pane.
  saveStateToLocal();
}


// ───────────────────────────────────────────────────────────────────────────
// 3) “Delete” a historical chat
// ───────────────────────────────────────────────────────────────────────────

function deleteChat(index) {
  const uid = getCurrentUID() || 'guest';
  // Remove the chat from in-memory storage
  chatSessions.splice(index, 1);
  // Persist updated state locally
  saveStateToLocal();
  // Re-render the history view so the user sees the update
 // handleNavClick("History");
}


// ───────────────────────────────────────────────────────────────────────────
// 4) (No changes below) Everything else in your file (embedding logic, sendBtn, etc.)
// ───────────────────────────────────────────────────────────────────────────

// … the rest of 

// Hamburger Menu for Mobile/Tablet
const hamburgerBtn = document.getElementById('hamburgerBtn');
const sidebar = document.getElementById('sidebar');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');

// When hamburger is clicked, show sidebar and hide hamburger icon
hamburgerBtn.addEventListener('click', () => {
  sidebar.classList.add('active');
  // Hide the hamburger icon
  hamburgerBtn.style.display = 'none';
});

// When close button is clicked, hide sidebar and show hamburger icon
closeSidebarBtn.addEventListener('click', () => {
  sidebar.classList.remove('active');
  // Show the hamburger icon
  hamburgerBtn.style.display = 'block';
});

logOutBtn.addEventListener('click',logOut);

async function logOut(){
  // 🔒 Logout function (log out and destroy login state)
  // In guest/offline mode we simply clear localStorage identifiers and
  // redirect to the login page. If Firebase authentication is enabled
  // you may wish to call auth().signOut() here.
  try {
    localStorage.removeItem("currentUserUID");
    localStorage.removeItem("currentUserName");
    // Optionally persist the final state
    saveStateToLocal();
  } catch (error) {
    console.error("Logout error:", error);
  } finally {
    window.location.href = "index.html";
  }
}



async function fetchChunkAnswer2(prompt, retries = 5) {
  currentAbortController = new AbortController();  // new controller
  showStopButton();
  sendBtn.style.display="none";
  const chatContent = document.getElementById("chatContent");

   // 1) create a wrapper so our button can sit inside
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-msg-wrapper';

// 2) the actual assistant message

const assistantMsg = document.createElement("div");
  assistantMsg.className = "assistant-msg";
  // Add wrapping support
assistantMsg.style.whiteSpace = 'pre-wrap';
assistantMsg.style.wordWrap = 'break-word';
wrapper.appendChild(assistantMsg);

const btncontainer = document.createElement('div');
btncontainer.className = 'btncontainerDiv'
wrapper.appendChild(btncontainer);



// 3) add the Export PDF button
const exportBtn = document.createElement('button');
exportBtn.className = 'export-pdf-btn';
exportBtn.title = 'Export PDF';
exportBtn.innerHTML = `<img src="export.png" alt="PDF" onerror="this.style.display='none'"/> Export PDF`;


// Add click handler for PDF export
exportBtn.addEventListener('click', async () => {
  const userEl = wrapper.previousElementSibling;
  const assistantEl = wrapper.querySelector('.assistant-msg');
  
  if (userEl && assistantEl) {
    await exportToPDF(userEl, assistantEl);
  } else {
    console.error('Could not find user or assistant message for export');
    if (typeof showAlert === 'function') {
      showAlert('Could not export PDF: message not found', 'error');
    }
  }
});

// 1) Create the “Remove messages” button
const removeBtn = document.createElement('button');
removeBtn.className = 'export-pdf-btn remove-msg-btn'; // reuse styling, adding a modifier
removeBtn.title = 'Delete message';
removeBtn.innerHTML = `<img src="delete.png" alt="Delete" onerror="this.style.display='none'"/> Delete`;

// 2) Append it next to exportBtn
btncontainer.appendChild(removeBtn);
// 3) Wire up its click handler
removeBtn.addEventListener('click', () => {
  // locate the chat elements
  const userEl      = wrapper.previousElementSibling;          // <p class="user-msg">
  const assistantEl = wrapper.querySelector('.assistant-msg');  // <div class="assistant-msg">

  // remove them if they exist
  if (userEl)      userEl.remove();
  if (assistantEl) assistantEl.remove();

  // remove both buttons
  exportBtn.remove();
  removeBtn.remove();
});



btncontainer.appendChild(exportBtn);

if(assistantMsg.textContent.trim() === "N/A")
{
  assistantMsg.remove();
}
// 4) finally, stick the whole wrapper into the chat
chatContent.appendChild(wrapper);
 // Create placeholder assistant message
  
  chatContent.scrollTop = chatContent.scrollHeight;

  let backoff = 1000;

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: `You are an auditors assistant.your task is to search for answers in the given chunk to check either for consistency/measurability/Relevance and Presentation and Disclosure.
          your also responsible that the answers you fetch has all the necessary information especially when it comes to indicators and quering each indicator.please follow the responsibility on the dot. your last responsibilybis to filter out the information
           that is not needed and also to make sure you stop providing the comments. all your replies  are in Markdown format with headings, lists, bold text, lists, and tables when necessary.(no fences).Please wrap each line at ~80 characters, and use bullets instead of asterisks.` },
            { role: "user", content: prompt }
          ],
          stream: true,
          temperature: 0.0
        }),
        signal: currentAbortController.signal  // 🔑 connect controller
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(line => line.startsWith("data: "));

        for (const line of lines) {
          const jsonStr = line.replace(/^data: /, "").trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
               accumulated += content;
              const html = DOMPurify.sanitize(marked.parse(accumulated));
              assistantMsg.innerHTML = html;
              chatContent.scrollTop = chatContent.scrollHeight;
            }
          } catch (err) {
            console.error("JSON parse error:", err);
          }
        }
      }

hideStopBtn();
sendBtn.style.display="block";
      return accumulated;
    } catch (err) {
      console.warn(`Retrying... (${i + 1}/${retries})`, err);
      await new Promise(resolve => setTimeout(resolve, backoff));
      backoff *= 2;
    }
  }

  assistantMsg.textContent = "⚠️ Error: Failed to load response after retries.";

  return "";
}
async function fetchChunkAnswer3(prompt, retries = 5) {
   currentAbortController = new AbortController();
   showStopButton();
   sendBtn.style.display="none";
  const chatContent = document.getElementById("chatContent");

  // =============== UI scaffold (now with dedicated host) ===============
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-msg-wrapper';

  // Host that holds ONLY assistant blocks (so we never replace them)
  const blocksHost = document.createElement('div');
  blocksHost.className = 'assistant-msg-host';
  wrapper.appendChild(blocksHost);

  // helper to create a NEW assistant message block INSIDE blocksHost
  function createAssistantMsg() {
    const el = document.createElement("div");
    el.className = "assistant-msg";
    el.style.whiteSpace = 'pre-wrap';
    el.style.wordWrap = 'break-word';
    blocksHost.appendChild(el);       // <— important: append to host, not wrapper
    return el;
  }

  // first block
  let assistantMsg = createAssistantMsg();

  // buttons container comes AFTER blocks (so new blocks never replace it)
  const btncontainer = document.createElement('div');
  btncontainer.className = 'btncontainerDiv';
  wrapper.appendChild(btncontainer);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'export-pdf-btn remove-msg-btn';
  removeBtn.title = 'Delete message';
  removeBtn.innerHTML = `<img src="delete.png" alt="Delete" onerror="this.style.display='none'"/> Delete`;
  btncontainer.appendChild(removeBtn);
  removeBtn.addEventListener('click', () => {
    const userEl = wrapper.previousElementSibling;
    if (userEl) userEl.remove();
    // remove ONLY blocks inside the host
    blocksHost.querySelectorAll('.assistant-msg').forEach(n => n.remove());
    exportBtn.remove();
    removeBtn.remove();
  });

  // Export button
  const exportBtn = document.createElement('button');
  exportBtn.className = 'export-pdf-btn';
  exportBtn.title = 'Export PDF';
  exportBtn.innerHTML = `<img src="export.png" alt="PDF" onerror="this.style.display='none'"/> Export PDF`;
  
  // Add click handler for PDF export
  exportBtn.addEventListener('click', async () => {
    const userEl = wrapper.previousElementSibling;
    const assistantEl = blocksHost.querySelector('.assistant-msg');
    
    if (userEl && assistantEl) {
      await exportToPDF(userEl, assistantEl);
    } else {
      console.error('Could not find user or assistant message for export');
      if (typeof showAlert === 'function') {
        showAlert('Could not export PDF: message not found', 'error');
      }
    }
  });
  
  btncontainer.appendChild(exportBtn);

 

  // never auto-remove the first block
  chatContent.appendChild(wrapper);
  chatContent.scrollTop = chatContent.scrollHeight;

  // =============== Streaming + auto-continue logic ===============

  const baseMessages = [
    {
      role: "system",
      content:
        "You are an auditors assistant. your task is to search for answers in the given " +
        "chunk to check either for consistency/measurability/Relevance and Presentation and " +
        "Disclosure. your also responsible that the answers you fetch has all the necessary " +
        "information especially when it comes to indicators and quering each indicator. " +
        "please follow the responsibility on the dot. your last responsibilybis to filter " +
        "out the information that is not needed and also to make sure you stop providing " +
        "the comments. all your replies are in Markdown format with headings, lists, bold " +
        "text, lists, and tables when necessary.(no fences). Please wrap each line at ~80 " +
        "characters, and use bullets instead of asterisks."
    },
    { role: "user", content: prompt }
  ];

  // stream ONE pass into a specific target element
  async function streamOnce(messages, targetEl) {
    const res = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        temperature: 0.0,
        stream: true
      }),
      signal: currentAbortController.signal  // 🔑 connect controller
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let finishReason = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.startsWith("data:"));

      for (const line of lines) {
        const payload = line.replace(/^data:\s*/, "");
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const choice = json.choices?.[0];

          const delta = choice?.delta?.content ?? "";
          if (delta) {
            buffer += delta;
            const html = DOMPurify.sanitize(marked.parse(buffer));
            targetEl.innerHTML = html;
            chatContent.scrollTop = chatContent.scrollHeight;
          }

          if (choice?.finish_reason) {
            finishReason = choice.finish_reason; // "stop" | "length" | ...
          }
        } catch {
          // ignore partial json lines
        }
      }
    }

    return { text: buffer, finishReason };
  }

  // auto-continue across NEW blocks without touching old ones
  let backoff = 1000;
  let accumulatedFull = "";
  let messages = baseMessages.slice();

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      while (true) {
        // stream into the current (latest) assistant block
        const { text, finishReason } = await streamOnce(messages, assistantMsg);

        accumulatedFull += text;
        messages.push({ role: "assistant", content: text });

        if (finishReason === "length") {
          // Create a NEW block INSIDE the same host and continue
          assistantMsg = createAssistantMsg();
          messages.push({ role: "user", content: "continue" });
          continue;
        }

        break;
      }
      hideStopBtn();
      sendBtn.style.display="block";
      return accumulatedFull;
    } catch (err) {
      console.warn(`Retrying... (${attempt + 1}/${retries})`, err);
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 10000);
    }
  }

  const errBlock = createAssistantMsg();
  errBlock.textContent = "⚠️ Error: Failed to load response after retries.";
  return "";
}

// Simplified version for measurability that uses external blocksHost
async function fetchChunkAnswerForMeasurability(prompt, blocksHost, retries = 5) {
  currentAbortController = new AbortController();
  showStopButton();
  sendBtn.style.display="none";
  const chatContent = document.getElementById("chatContent");

  // Create assistant message block inside provided blocksHost
  function createAssistantMsg() {
    const el = document.createElement("div");
    el.className = "assistant-msg";
    el.style.whiteSpace = 'pre-wrap';
    el.style.wordWrap = 'break-word';
    blocksHost.appendChild(el);
    return el;
  }

  // First block
  let assistantMsg = createAssistantMsg();

  const baseMessages = [
    {
      role: "system",
      content:
        "You are an auditors assistant. your task is to search for answers in the given " +
        "chunk to check either for consistency/measurability/Relevance and Presentation and " +
        "Disclosure. your also responsible that the answers you fetch has all the necessary " +
        "information especially when it comes to indicators and quering each indicator. " +
        "please follow the responsibility on the dot. your last responsibilybis to filter " +
        "out the information that is not needed and also to make sure you stop providing " +
        "the comments. all your replies are in Markdown format with headings, lists, bold " +
        "text, lists, and tables when necessary.(no fences). Please wrap each line at ~80 " +
        "characters, and use bullets instead of asterisks."
    },
    { role: "user", content: prompt }
  ];

  // Stream ONE pass into a specific target element
  async function streamOnce(messages, targetEl) {
    const res = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        temperature: 0.0,
        stream: true
      }),
      signal: currentAbortController.signal
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let finishReason = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.startsWith("data:"));

      for (const line of lines) {
        const payload = line.replace(/^data:\s*/, "");
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const choice = json.choices?.[0];

          const delta = choice?.delta?.content ?? "";
          if (delta) {
            buffer += delta;
            const html = DOMPurify.sanitize(marked.parse(buffer));
            targetEl.innerHTML = html;
            chatContent.scrollTop = chatContent.scrollHeight;
          }

          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }
        } catch {
          // ignore partial json lines
        }
      }
    }

    return { text: buffer, finishReason };
  }

  // Auto-continue across NEW blocks
  let backoff = 1000;
  let accumulatedFull = "";
  let messages = baseMessages.slice();

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      while (true) {
        const { text, finishReason } = await streamOnce(messages, assistantMsg);

        accumulatedFull += text;
        messages.push({ role: "assistant", content: text });

        if (finishReason === "length") {
          // Create a NEW block INSIDE the same host and continue
          assistantMsg = createAssistantMsg();
          messages.push({ role: "user", content: "continue" });
          continue;
        }

        break;
      }
      hideStopBtn();
      sendBtn.style.display="block";
      return accumulatedFull;
    } catch (err) {
      console.warn(`Retrying... (${attempt + 1}/${retries})`, err);
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 10000);
    }
  }

  const errBlock = createAssistantMsg();
  errBlock.textContent = "⚠️ Error: Failed to load response after retries.";
  return "";
}


//////newwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww////////////
const responseDiv = document.getElementById("response");
const EMBEDDING_MODEL = "text-embedding-3-small";
let embeddedChunks = [];

/**
 * Process a single File object (PDF or Word) and extract the key programmes.
 * @param {File} file
 */
async function processFile(file) {
  if (!file) {
    responseDiv.textContent = "No file provided.";
    return;
  }

  const reader = new FileReader();

  reader.onload = async function () {
    try {
      let fullText = "";

      // 1. Read first 10 pages of PDF
      if (file.type === "application/pdf") {
        responseDiv.textContent = "Reading PDF...";
        const typedarray = new Uint8Array(reader.result);
        const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
        const totalPages = pdf.numPages;
        const maxPages = Math.min(10, totalPages);

        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          fullText += content.items.map(item => item.str).join(" ") + "\n";
        }

      // 2. Read first 10 “pages” of Word doc (approx. 300 lines)
      } else if (
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        file.type === "application/msword"
      ) {
        responseDiv.textContent = "Reading Word Document...";
        const result = await mammoth.extractRawText({ arrayBuffer: reader.result });
        const allLines = result.value.split("\n").filter(line => line.trim());
        fullText = allLines.slice(0, 300).join("\n");

      } else {
        responseDiv.textContent = "Unsupported file type.";
        return;
      }

      // 3. Embed and rank chunks
      responseDiv.textContent = "Embedding content...";
      const chunks = splitText(fullText);
      embeddedChunks = [];
      for (let chunk of chunks) {
        const vector = await getEmbedding(chunk);
        embeddedChunks.push({ chunk, vector });
      }

      responseDiv.textContent = "Extracting key programmes...";
      const queryVector = await getEmbedding("List all key Programmes");
      const ranked = embeddedChunks
        .map(o => ({ chunk: o.chunk, score: cosineSimilarity2(queryVector, o.vector) }))
        .sort((a, b) => b.score - a.score);
      const topChunks = ranked.slice(0, 3).map(o => o.chunk).join("\n---\n");

      // 4. Fetch from OpenAI
      const prompt = `
From the following extracted document chunks, list only the key Programmes mentioned in the context below in this format:
Programme 1: Administration,
Programme 2: ...

Content:
${topChunks}
`;
      const chatResponse = await fetch(`${API_BASE_URL}/chat/completions/non-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2
        })
      });
      const data = await chatResponse.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || "No response.";

      // 5. Render reply & checkboxes
      responseDiv.style.display = "none";
      const programmeCard = document.getElementById("programmeCard");
      programmeCard.innerHTML = "";
      const card = document.createElement("div");
      card.classList.add("programme-card"); // you can style via CSS
      card.innerHTML = `<h3>Select scoped-in programmes:</h3>`;
      programmeSelectionList = reply.split("\n").filter(l => l.startsWith("Programme"));
      const items = reply.split("\n").filter(l => l.startsWith("Programme"));
      items.forEach((prog, i) => {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = `
          <input type="checkbox" id="prog${i}" value="${prog}" />
          <label for="prog${i}">${prog}</label>
        `;
        card.appendChild(wrapper);
      });

      const submitBtn = document.createElement("button");
      submitBtn.textContent = "Submit";
      submitBtn.addEventListener("click", async () => {
        const selected = items
          .map((_, i) => document.getElementById(`prog${i}`))
          .filter(chx => chx.checked)
          .map(chx => chx.value);

        if (selected.length) {
          programmeList.push(...selected);
          showAlert2("Selected programmes added!", "info");
        } else {
          alert("No programmes selected.");
          return;
        }
        card.remove();
        document.getElementById("loadingSpinner2").style.display = "block";
        await extractIndicatorsAndTargets(appText, aprText, programmeList);
        document.getElementById("loadingSpinner5").style.display = "none";
        sleep(500);
        showAlert2("Extracting key Performance indicators complete","success");
        changeScopedProgramme.disabled = !true;
        processConBtn.disabled = !true;
        processMeaBtn.disabled = !true;
        processRelBtn.disabled = !true;
        processPreBtn.disabled = !true;
      });

      card.appendChild(submitBtn);
      programmeCard.appendChild(card);

    } catch (err) {
      responseDiv.textContent = "Error: " + err.message;
      console.error(err);
    }
  };

  // Kick off file read
  if (file.type === "application/pdf" || file.type.includes("word")) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file);
  }
}



function changeProgrammes(){

  programmeList = [];
  aggregatedDoc1 = [];
  aggregatedDoc2 = [];
  aggregatedDoc3 = [];
  aggregatedDoc4 = [];
  aggregatedDoc5 = [];
  processConBtn.disabled = true;
  processMeaBtn.disabled = true;
  processRelBtn.disabled = true;
  processPreBtn.disabled = true;

  const programmeCard = document.getElementById("programmeCard");
  programmeCard.innerHTML = "";
  const card = document.createElement("div");
  card.classList.add("programme-card"); // you can style via CSS
  card.innerHTML = `<h3>Select scoped-in programmes:</h3>`;
      
  const items = programmeSelectionList;
  items.forEach((prog, i) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <input type="checkbox" id="prog${i}" value="${prog}" />
      <label for="prog${i}">${prog}</label>
    `;
    card.appendChild(wrapper);
  });

  const submitBtn = document.createElement("button");
  submitBtn.textContent = "Submit";
  submitBtn.addEventListener("click", async () => {
  const selected = items
    .map((_, i) => document.getElementById(`prog${i}`))
    .filter(chx => chx.checked)
    .map(chx => chx.value);

  if (selected.length) {
          programmeList.push(...selected);
          showAlert2("Selected programmes added!", "info");} 
  else {
          alert("No programmes selected.");
          return;}

  card.remove();
  document.getElementById("loadingSpinner2").style.display = "block";
  await extractIndicatorsAndTargets(appText, aprText, programmeList);
  document.getElementById("loadingSpinner5").style.display = "none";
  sleep(500);
  showAlert2("Extracting key Performance indicators complete","success");
   
  processConBtn.disabled = !true;
  processMeaBtn.disabled = !true;
  processRelBtn.disabled = !true;
  processPreBtn.disabled = !true;

 });
   card.appendChild(submitBtn);
  programmeCard.appendChild(card);   
}
/*
////new code
 // Global variable to hold selected items

const responseDiv = document.getElementById("response");
const EMBEDDING_MODEL = "text-embedding-3-small";
let embeddedChunks = [];

fileInput.addEventListener("change", async () => {
  if (!fileInput.files.length) return;

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async function () {
    try {
      let fullText = "";

      if (file.type === "application/pdf") {
        responseDiv.textContent = "Reading PDF...";
        const typedarray = new Uint8Array(reader.result);
        const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
        const totalPages = pdf.numPages;
        const maxPages = Math.min(10, totalPages);

        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const text = content.items.map(item => item.str).join(" ");
          fullText += text + "\n";
        }

      } else if (
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        file.type === "application/msword"
      ) {
        responseDiv.textContent = "Reading Word Document...";
        const result = await mammoth.extractRawText({ arrayBuffer: reader.result });
        const allLines = result.value.split("\n").filter(line => line.trim() !== "");
        
        // Simulate first 10 pages by limiting to approximately 300 lines (~30 lines/page)
        const approxLinesPerPage = 30;
        const maxLines = 10 * approxLinesPerPage;
        fullText = allLines.slice(0, maxLines).join("\n");

      } else {
        responseDiv.textContent = "Unsupported file type.";
        return;
      }

      responseDiv.textContent = "Embedding content...";
      const chunks = splitText(fullText);
      embeddedChunks = [];

      for (let chunk of chunks) {
        const vector = await getEmbedding(chunk);
        embeddedChunks.push({ chunk, vector });
      }

      responseDiv.textContent = "Extracting key programmes...";
      const queryVector = await getEmbedding("List all key Programmes");

      const ranked = embeddedChunks
        .map(obj => ({
          chunk: obj.chunk,
          score: cosineSimilarity2(queryVector, obj.vector)
        }))
        .sort((a, b) => b.score - a.score);

      const topChunks = ranked.slice(0, 3).map(obj => obj.chunk).join("\n---\n");

      const prompt = `
From the following extracted document chunks, list only the key Programmes mentioned in the context below in this format:
Programme 1: Administration,
Programme 2: ...

Do not add extra text or summaries. Use only what's in the content.

Content:
${topChunks}
`;

      const chatResponse = await fetch(`${API_BASE_URL}/chat/completions/non-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2
        })
      });

      const data = await chatResponse.json();
      const reply = data.choices?.[0]?.message?.content?.trim();
      responseDiv.textContent = reply || "No response received.";
      document.getElementById("response").style.display = "none";

      if (reply) {
        const programmeCard = document.getElementById("programmeCard");
        programmeCard.innerHTML = "";

        const card = document.createElement("div");
        card.style.border = "1px solid #ccc";
        card.style.padding = "15px";
        card.style.borderRadius = "5px";
        card.style.backgroundColor = "#f1f1f1";

        const title = document.createElement("h3");
        title.textContent = "Select scoped in programmes:";
        title.style.marginBottom = "15px";
        card.appendChild(title);

        const programmeListItems = reply.split("\n").filter(line => line.trim().startsWith("Programme"));

        programmeListItems.forEach((prog, index) => {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.id = `prog${index}`;
          checkbox.value = prog;
          checkbox.style.marginLeft = "10px";
          checkbox.style.marginTop = "5px";

          const label = document.createElement("label");
          label.htmlFor = checkbox.id;
          label.textContent = prog;
          label.style.marginLeft = "8px";

          const wrapper = document.createElement("div");
          wrapper.style.marginBottom = "5px";
          wrapper.appendChild(checkbox);
          wrapper.appendChild(label);

          card.appendChild(wrapper);
        });

        const submitBtn = document.createElement("button");
        submitBtn.textContent = "Submit";
        submitBtn.style.marginTop = "10px";
        submitBtn.style.padding = "6px 12px";
        submitBtn.style.border = "none";
        submitBtn.style.backgroundColor = "#4CAF50";
        submitBtn.style.color = "white";
        submitBtn.style.borderRadius = "4px";
        submitBtn.style.cursor = "pointer";

        submitBtn.addEventListener("click", () => {
          const selected = [];
          programmeListItems.forEach((prog, index) => {
            const checkbox = document.getElementById(`prog${index}`);
            if (checkbox && checkbox.checked) {
              selected.push(prog);
            }
          });

          if (selected.length > 0) {
            programmeList.push(...selected);
            showAlert2("Selected programmes added!", "info");
            console.log("programmeList:", programmeList);
          } else {
            alert("No programmes selected.");
          }

          card.style.display = "none";
        });

        card.appendChild(submitBtn);
        programmeCard.appendChild(card);
      }

    } catch (error) {
      responseDiv.textContent = "Error: " + error.message;
      console.error(error);
    }
  };

  if (file.type === "application/pdf" || file.type.includes("word")) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file);
  }
});
*/
// Utility Functions
function splitText(text, maxWords = CHUNK_SIZE) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }
  return chunks;
}

async function getEmbedding(text) {
  const res = await fetch(`${API_BASE_URL}/embeddings/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL
    })
  });

  const json = await res.json();
  return json.data[0].embedding;
}

function cosineSimilarity2(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

// script.js
// Centralized spinner handling for all async operations

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');
  const uploadButton = document.getElementById('upload-button');
  const exportButton = document.getElementById('export-button');
  const deleteButton = document.getElementById('delete-button');
  const spinner = document.getElementById('spinner');
  const processingText = document.getElementById('processing-text');

  // Show spinner and processing text
  function showSpinner() {
    spinner.style.display = 'block';
    processingText.style.display = 'inline';
  }

  // Hide spinner and processing text
  function hideSpinner() {
    spinner.style.display = 'none';
    processingText.style.display = 'none';
  }

  // Wrapper to run any async function with spinner handling
  async function withSpinner(asyncFn) {
    showSpinner();
    try {
      await asyncFn();
    } catch (error) {
      console.error('Operation failed:', error);
      // TODO: optionally surface error to the user (e.g., via alert or UI message)
    } finally {
      hideSpinner();
    }
  }

  
  // Simulated async export operation
  function exportToPDF() {
    // Replace with real PDF-generation logic
    return new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Simulated async delete operation
  function deleteItem() {
    // Replace with real deletion logic
    return new Promise((resolve) => setTimeout(resolve, 1500));
  }
});


