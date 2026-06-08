const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

// Initialize OpenAI client with error handling
let openai;
try {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
} catch (error) {
  console.error('Failed to initialize OpenAI client:', error.message);
  process.exit(1);
}

// Validation helpers
const validateEmbeddingModel = (model) => {
  const allowedModels = ['text-embedding-ada-002', 'text-embedding-3-small', 'text-embedding-3-large'];
  if (model && !allowedModels.includes(model)) {
    throw new Error(`Model '${model}' is not supported. Allowed models: ${allowedModels.join(', ')}`);
  }
};

const validateInput = (input) => {
  if (!input) {
    throw new Error('Input text is required');
  }
  
  if (typeof input !== 'string' && !Array.isArray(input)) {
    throw new Error('Input must be a string or array of strings');
  }
  
  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new Error('Input array cannot be empty');
    }
    
    if (input.length > 2048) {
      throw new Error('Input array cannot contain more than 2048 items');
    }
    
    input.forEach((item, index) => {
      if (typeof item !== 'string') {
        throw new Error(`Input at index ${index} must be a string`);
      }
      if (item.trim().length === 0) {
        throw new Error(`Input at index ${index} cannot be empty`);
      }
    });
  } else if (typeof input === 'string' && input.trim().length === 0) {
    throw new Error('Input string cannot be empty');
  }
};

/**
 * GET /api/embeddings
 * Info endpoint
 */
router.get('/', (req, res) => {
  res.json({
    message: 'Embeddings API',
    endpoints: {
      'POST /api/embeddings/generate': 'Generate embeddings for text(s)',
      'POST /api/embeddings/batch': 'Batch process multiple texts',
      'POST /api/embeddings/similarity': 'Calculate cosine similarity',
      'POST /api/embeddings/search': 'Vector similarity search'
    }
  });
});

/**
 * Cosine similarity calculation
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dot = 0;
  let magA = 0;
  let magB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * POST /api/embeddings/generate
 * Generate embeddings for text
 */
router.post('/generate', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { input, model = 'text-embedding-ada-002' } = req.body;

    // Input validation
    validateInput(input);
    validateEmbeddingModel(model);

    // Handle both single string and array of strings
    const inputArray = Array.isArray(input) ? input : [input];

    console.log('[Embeddings] Generating embeddings', {
      model,
      inputCount: inputArray.length,
      totalLength: inputArray.reduce((sum, str) => sum + str.length, 0)
    });

    const response = await openai.embeddings.create({
      model,
      input: inputArray
    });

    const duration = Date.now() - startTime;
    console.log('[Embeddings] Generated successfully', {
      duration: `${duration}ms`,
      embeddingCount: response.data.length,
      tokens: response.usage?.total_tokens
    });

    // Return OpenAI-compatible format
    res.json({
      data: response.data,
      model: response.model,
      usage: response.usage
    });

  } catch (error) {
    console.error('[Embeddings] Error:', {
      message: error.message,
      type: error.type,
      code: error.code,
      status: error.status
    });
    
    const statusCode = error.status || (error.message.includes('required') || error.message.includes('must be') ? 400 : 500);
    res.status(statusCode).json({
      error: error.type || 'embedding_error',
      message: error.message || 'Failed to generate embeddings',
      ...(error.code && { code: error.code })
    });
  }
});

/**
 * POST /api/embeddings/batch
 * Generate embeddings for multiple texts in batches
 */
router.post('/batch', async (req, res) => {
  try {
    const { texts, model = 'text-embedding-ada-002', batchSize = 20 } = req.body;

    if (!texts || !Array.isArray(texts)) {
      return res.status(400).json({ error: 'Texts array is required' });
    }

    const allEmbeddings = [];
    let totalTokens = 0;

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      const response = await openai.embeddings.create({
        model,
        input: batch
      });

      allEmbeddings.push(...response.data);
      totalTokens += response.usage.total_tokens;
    }

    // Return OpenAI-compatible format with additional metadata
    res.json({
      data: allEmbeddings,
      model,
      usage: {
        total_tokens: totalTokens
      }
    });

  } catch (error) {
    console.error('Batch embedding error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to generate batch embeddings',
      type: error.type || 'internal_error'
    });
  }
});

/**
 * POST /api/embeddings/similarity
 * Calculate similarity between two texts
 */
router.post('/similarity', async (req, res) => {
  try {
    const { text1, text2, model = 'text-embedding-ada-002' } = req.body;

    if (!text1 || !text2) {
      return res.status(400).json({ error: 'Both text1 and text2 are required' });
    }

    const response = await openai.embeddings.create({
      model,
      input: [text1, text2]
    });

    const embedding1 = response.data[0].embedding;
    const embedding2 = response.data[1].embedding;

    const similarity = cosineSimilarity(embedding1, embedding2);

    res.json({
      similarity,
      text1Length: text1.length,
      text2Length: text2.length,
      model: response.model
    });

  } catch (error) {
    console.error('Similarity calculation error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to calculate similarity',
      type: error.type || 'internal_error'
    });
  }
});

/**
 * POST /api/embeddings/search
 * Search for similar texts using embeddings
 */
router.post('/search', async (req, res) => {
  try {
    const { query, documents, topK = 3, model = 'text-embedding-ada-002' } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!documents || !Array.isArray(documents)) {
      return res.status(400).json({ error: 'Documents array is required' });
    }

    // Generate embedding for query
    const queryResponse = await openai.embeddings.create({
      model,
      input: [query]
    });
    const queryEmbedding = queryResponse.data[0].embedding;

    // Calculate similarities
    const results = documents.map((doc, index) => ({
      index,
      text: doc.text || doc,
      embedding: doc.embedding,
      score: cosineSimilarity(queryEmbedding, doc.embedding)
    }));

    // Sort by similarity and get top K
    const topResults = results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ index, text, score }) => ({ index, text, score }));

    res.json({
      query,
      results: topResults,
      model
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to perform search',
      type: error.type || 'internal_error'
    });
  }
});

module.exports = router;
