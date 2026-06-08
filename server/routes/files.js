const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');
const fs = require('fs').promises;

/**
 * GET /api/files
 * Info endpoint
 */
router.get('/', (req, res) => {
  res.json({
    message: 'Files API',
    endpoints: {
      'POST /api/files/upload': 'Upload and extract text from files',
      'POST /api/files/extract-text': 'Extract text from a single file',
      'POST /api/files/chunk': 'Chunk text into smaller pieces',
      'POST /api/files/process-and-embed': 'Full pipeline: upload → extract → chunk → embed'
    }
  });
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB default
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`));
    }
  }
});

/**
 * Helper function to chunk text
 */
function chunkText(text, chunkSize = 5000) {
  if (typeof text !== 'string') {
    throw new Error('Text must be a string');
  }
  
  if (typeof chunkSize !== 'number' || chunkSize <= 0) {
    throw new Error('Chunk size must be a positive number');
  }
  
  if (text.length === 0) {
    return [];
  }
  
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Helper function to extract text from PDF
 */
async function extractPdfText(buffer, filename) {
  const startTime = Date.now();
  
  try {
    console.log('[PDF Extract] Starting extraction', { filename, size: buffer.length });
    
    const data = await pdfParse(buffer);
    
    const duration = Date.now() - startTime;
    console.log('[PDF Extract] Completed', {
      filename,
      duration: `${duration}ms`,
      pages: data.numpages,
      textLength: data.text.length
    });
    
    return {
      text: data.text,
      pages: data.numpages,
      info: data.info
    };
  } catch (error) {
    console.error('[PDF Extract] Error:', { filename, error: error.message });
    throw new Error(`PDF extraction failed for ${filename}: ${error.message}`);
  }
}

/**
 * Helper function to extract text from DOCX
 */
async function extractDocxText(buffer, filename) {
  const startTime = Date.now();
  
  try {
    console.log('[DOCX Extract] Starting extraction', { filename, size: buffer.length });
    
    const result = await mammoth.extractRawText({ buffer });
    
    const duration = Date.now() - startTime;
    console.log('[DOCX Extract] Completed', {
      filename,
      duration: `${duration}ms`,
      textLength: result.value.length
    });
    
    return {
      text: result.value,
      pages: 1 // Approximate, as DOCX doesn't have page numbers
    };
  } catch (error) {
    console.error('[DOCX Extract] Error:', { filename, error: error.message });
    throw new Error(`DOCX extraction failed for ${filename}: ${error.message}`);
  }
}

/**
 * POST /api/files/upload
 * Upload and process files (PDF, DOC, DOCX)
 */
router.post('/upload', upload.array('files', 10), async (req, res) => {
  const startTime = Date.now();
  
  try {
    if (!req.files || req.files.length === 0) {
      console.warn('[Files Upload] No files provided');
      return res.status(400).json({ 
        error: 'Validation Error',
        message: 'No files uploaded. Please provide at least one file.' 
      });
    }

    console.log('[Files Upload] Processing files', {
      fileCount: req.files.length,
      files: req.files.map(f => ({ name: f.originalname, size: f.size }))
    });

    const results = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const ext = path.extname(file.originalname).toLowerCase();
        let extractedData;

        if (ext === '.pdf') {
          extractedData = await extractPdfText(file.buffer, file.originalname);
        } else if (ext === '.docx' || ext === '.doc') {
          extractedData = await extractDocxText(file.buffer, file.originalname);
        } else {
          throw new Error(`Unsupported file type: ${ext}`);
        }

        // Chunk the text
        const chunks = chunkText(extractedData.text);

        results.push({
          filename: file.originalname,
          size: file.size,
          type: file.mimetype,
          pages: extractedData.pages,
          textLength: extractedData.text.length,
          chunks: chunks,
          chunkCount: chunks.length
        });
      } catch (fileError) {
        console.error('[Files Upload] File processing error:', {
          filename: file.originalname,
          error: fileError.message
        });
        
        errors.push({
          filename: file.originalname,
          error: fileError.message
        });
      }
    }

    const duration = Date.now() - startTime;
    console.log('[Files Upload] Processing completed', {
      duration: `${duration}ms`,
      successCount: results.length,
      errorCount: errors.length
    });

    res.json({
      message: 'Files processed',
      filesCount: results.length,
      files: results,
      ...(errors.length > 0 && { errors })
    });

  } catch (error) {
    console.error('[Files Upload] Error:', error.message);
    res.status(500).json({
      error: 'Processing Error',
      message: error.message || 'Failed to process files'
    });
  }
});

/**
 * POST /api/files/extract-text
 * Extract text from uploaded file
 */
router.post('/extract-text', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let extractedData;

    if (ext === '.pdf') {
      extractedData = await extractPdfText(req.file.buffer);
    } else if (ext === '.docx' || ext === '.doc') {
      extractedData = await extractDocxText(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    res.json({
      filename: req.file.originalname,
      text: extractedData.text,
      pages: extractedData.pages,
      textLength: extractedData.text.length,
      info: extractedData.info || {}
    });

  } catch (error) {
    console.error('Text extraction error:', error);
    res.status(500).json({
      error: error.message || 'Failed to extract text'
    });
  }
});

/**
 * POST /api/files/chunk
 * Chunk text into smaller pieces
 */
router.post('/chunk', (req, res) => {
  try {
    const { text, chunkSize = 5000 } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const chunks = chunkText(text, chunkSize);

    res.json({
      originalLength: text.length,
      chunkSize,
      chunkCount: chunks.length,
      chunks
    });

  } catch (error) {
    console.error('Chunking error:', error);
    res.status(500).json({
      error: error.message || 'Failed to chunk text'
    });
  }
});

/**
 * POST /api/files/process-and-embed
 * Upload files, extract text, chunk, and generate embeddings
 */
router.post('/process-and-embed', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const vectorStore = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      let extractedData;

      if (ext === '.pdf') {
        extractedData = await extractPdfText(file.buffer);
      } else if (ext === '.docx' || ext === '.doc') {
        extractedData = await extractDocxText(file.buffer);
      } else {
        continue;
      }

      const chunks = chunkText(extractedData.text);

      // Generate embeddings in batches of 20
      for (let i = 0; i < chunks.length; i += 20) {
        const batch = chunks.slice(i, i + 20);
        
        const response = await openai.embeddings.create({
          model: 'text-embedding-ada-002',
          input: batch
        });

        response.data.forEach((item, idx) => {
          vectorStore.push({
            embedding: item.embedding,
            text: batch[idx],
            metadata: {
              source: file.originalname,
              type: file.mimetype,
              chunkIndex: i + idx,
              pages: extractedData.pages
            }
          });
        });
      }
    }

    res.json({
      message: 'Files processed and embedded successfully',
      filesCount: req.files.length,
      vectorCount: vectorStore.length,
      vectorStore
    });

  } catch (error) {
    console.error('Process and embed error:', error);
    res.status(500).json({
      error: error.message || 'Failed to process and embed files'
    });
  }
});

module.exports = router;
