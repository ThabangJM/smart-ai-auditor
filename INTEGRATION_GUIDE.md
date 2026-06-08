# Backend Integration Guide

## Setup Instructions

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Configure Environment Variables
```bash
# Copy the example environment file
cp .env.example .env
```

Edit `.env` and add your configuration:
```env
# Server Configuration
PORT=3000
NODE_ENV=development

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500

# Firebase Configuration (Optional)
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_client_email
FIREBASE_PRIVATE_KEY=your_private_key

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# File Upload
MAX_FILE_SIZE=10485760
MAX_FILES=10
```

### 3. Start the Server
```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

The server will run on `http://localhost:3000`

---

## Frontend Integration

### Update script.js to Use Backend Endpoints

Replace direct OpenAI API calls with backend endpoints. Here are the key changes:

#### 1. Update the API Base URL

Add this constant at the top of `script.js`:
```javascript
const API_BASE_URL = 'http://localhost:3000/api';
```

#### 2. Chat Completions (Streaming)

**Before (Direct OpenAI):**
```javascript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({
        model: 'gpt-4o',
        messages: messages,
        stream: true
    })
});
```

**After (Backend):**
```javascript
const response = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        model: 'gpt-4o',
        messages: messages,
        stream: true
    })
});
```

#### 3. Chat Completions (Non-Streaming with Function Calling)

**Before:**
```javascript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({
        model: 'gpt-4o',
        messages: messages,
        tools: tools,
        tool_choice: 'auto'
    })
});
```

**After:**
```javascript
const response = await fetch(`${API_BASE_URL}/chat/completions/non-stream`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        model: 'gpt-4o',
        messages: messages,
        tools: tools,
        tool_choice: 'auto'
    })
});
```

#### 4. Embeddings Generation

**Before:**
```javascript
const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text
    })
});
```

**After:**
```javascript
const response = await fetch(`${API_BASE_URL}/embeddings/generate`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text // Can be single string or array
    })
});
```

#### 5. File Upload and Processing

**New Functionality - Upload and Process Files:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch(`${API_BASE_URL}/files/process-and-embed`, {
    method: 'POST',
    body: formData
});

const result = await response.json();
console.log('Extracted text:', result.text);
console.log('Embeddings:', result.embeddings);
console.log('Chunks:', result.chunks);
```

#### 6. Batch Embeddings

**New Functionality - Process Multiple Texts:**
```javascript
const response = await fetch(`${API_BASE_URL}/embeddings/batch`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        texts: ['text1', 'text2', 'text3'],
        model: 'text-embedding-3-small',
        batchSize: 20
    })
});

const result = await response.json();
console.log('Batch embeddings:', result.embeddings);
```

#### 7. Similarity Search

**New Functionality - Find Similar Content:**
```javascript
const response = await fetch(`${API_BASE_URL}/embeddings/search`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        query: 'user question here',
        documents: ['doc1', 'doc2', 'doc3'],
        topK: 3,
        model: 'text-embedding-3-small'
    })
});

const result = await response.json();
console.log('Most relevant:', result.results);
```

---

## API Endpoints Reference

### Health Check
- **GET** `/api/health` - Basic health status
- **GET** `/api/health/detailed` - Detailed system information

### Chat Endpoints
- **POST** `/api/chat/completions` - Streaming chat (SSE)
- **POST** `/api/chat/completions/non-stream` - Non-streaming chat with function calling
- **POST** `/api/chat/context` - Chat with embeddings-based context injection

### Embeddings Endpoints
- **POST** `/api/embeddings/generate` - Generate embeddings for text(s)
- **POST** `/api/embeddings/batch` - Batch process multiple texts
- **POST** `/api/embeddings/similarity` - Calculate cosine similarity between two texts
- **POST** `/api/embeddings/search` - Vector similarity search

### File Endpoints
- **POST** `/api/files/upload` - Upload and extract text from files
- **POST** `/api/files/extract-text` - Extract text from a single file
- **POST** `/api/files/chunk` - Chunk text into smaller pieces
- **POST** `/api/files/process-and-embed` - Complete pipeline: upload → extract → chunk → embed

---

## Testing

### Test Health Endpoint
```bash
curl http://localhost:3000/api/health
```

### Test Chat Endpoint
```bash
curl -X POST http://localhost:3000/api/chat/completions/non-stream \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Test Embeddings Endpoint
```bash
curl -X POST http://localhost:3000/api/embeddings/generate \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Test text for embeddings",
    "model": "text-embedding-3-small"
  }'
```

---

## Security Notes

1. **Never commit `.env` file** - It contains sensitive API keys
2. **Update CORS origins** - Only allow trusted frontend domains
3. **Rate limiting** - Default: 100 requests per 15 minutes per IP
4. **File size limits** - Default: 10MB per file, max 10 files
5. **Use HTTPS in production** - Never send API keys over HTTP

---

## Deployment

### Production Checklist
- [ ] Set `NODE_ENV=production` in environment
- [ ] Use a process manager (PM2, systemd)
- [ ] Set up reverse proxy (Nginx, Apache)
- [ ] Enable HTTPS with SSL certificates
- [ ] Configure firewall rules
- [ ] Set up monitoring and logging
- [ ] Use environment-specific CORS origins
- [ ] Secure Firebase credentials

### Example PM2 Configuration
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'nst-backend',
    script: 'server.js',
    cwd: './server',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

Start with PM2:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## Troubleshooting

### Server won't start
- Check if port 3000 is available
- Verify `.env` file exists and is properly formatted
- Ensure all dependencies are installed (`npm install`)

### CORS errors
- Add your frontend URL to `ALLOWED_ORIGINS` in `.env`
- Check browser console for exact origin being blocked

### OpenAI API errors
- Verify `OPENAI_API_KEY` in `.env` is correct
- Check OpenAI API status and account credits
- Review rate limits in OpenAI dashboard

### File upload errors
- Ensure file size is under `MAX_FILE_SIZE` (default 10MB)
- Verify file type is PDF, DOC, or DOCX
- Check server logs for detailed error messages

---

## Next Steps

1. Start the backend server: `cd server && npm run dev`
2. Update `script.js` with backend URLs (see examples above)
3. Test each endpoint individually
4. Update frontend error handling to work with backend responses
5. Consider implementing authentication for production use
