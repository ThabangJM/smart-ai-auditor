# NST Solutions Backend Server

Node.js backend server for the NST Solutions AI Auditor application. Provides secure API endpoints for OpenAI integration, file processing, and embeddings management.

## Features

- ✅ **OpenAI Integration** - Chat completions and embeddings
- ✅ **File Processing** - PDF and DOCX text extraction
- ✅ **Streaming Support** - Server-Sent Events for real-time chat
- ✅ **Security** - Helmet, CORS, rate limiting
- ✅ **Performance** - Compression, efficient batch processing
- ✅ **Monitoring** - Health checks and request logging

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` and add your configuration (minimum required):
```env
OPENAI_API_KEY=your_openai_api_key_here
ALLOWED_ORIGINS=http://localhost:5500
```

### 3. Start Server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:3000`

## API Endpoints

### Health
- `GET /api/health` - Server status
- `GET /api/health/detailed` - Detailed system info

### Chat
- `POST /api/chat/completions` - Streaming chat
- `POST /api/chat/completions/non-stream` - Standard chat
- `POST /api/chat/context` - Chat with context injection

### Embeddings
- `POST /api/embeddings/generate` - Generate embeddings
- `POST /api/embeddings/batch` - Batch processing
- `POST /api/embeddings/similarity` - Similarity calculation
- `POST /api/embeddings/search` - Vector search

### Files
- `POST /api/files/upload` - Multi-file upload
- `POST /api/files/extract-text` - Text extraction
- `POST /api/files/chunk` - Text chunking
- `POST /api/files/process-and-embed` - Full pipeline

## Project Structure

```
server/
├── routes/
│   ├── health.js       # Health check endpoints
│   ├── chat.js         # OpenAI chat endpoints
│   ├── embeddings.js   # Embeddings generation
│   └── files.js        # File upload/processing
├── server.js           # Express app entry point
├── package.json        # Dependencies
├── .env.example        # Environment template
└── README.md          # This file
```

## Dependencies

### Production
- **express** - Web framework
- **openai** - OpenAI SDK
- **cors** - Cross-origin requests
- **helmet** - Security headers
- **express-rate-limit** - Rate limiting
- **multer** - File uploads
- **pdf-parse** - PDF text extraction
- **mammoth** - DOCX text extraction
- **firebase-admin** - Firebase integration
- **compression** - Response compression
- **morgan** - HTTP logging
- **dotenv** - Environment management

### Development
- **nodemon** - Auto-reload on changes

## Configuration

### Environment Variables

```env
# Server
PORT=3000                    # Server port
NODE_ENV=development         # Environment (development/production)

# OpenAI
OPENAI_API_KEY=sk-...       # Your OpenAI API key

# CORS
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500

# Firebase (Optional)
FIREBASE_PROJECT_ID=your-project
FIREBASE_CLIENT_EMAIL=your-email
FIREBASE_PRIVATE_KEY=your-key

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100  # Max requests per window

# File Upload
MAX_FILE_SIZE=10485760       # 10MB in bytes
MAX_FILES=10                 # Max files per request
```

## Usage Examples

### Chat Completion
```javascript
const response = await fetch('http://localhost:3000/api/chat/completions/non-stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'user', content: 'Hello!' }
    ]
  })
});
const data = await response.json();
```

### Generate Embeddings
```javascript
const response = await fetch('http://localhost:3000/api/embeddings/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    input: 'Text to embed',
    model: 'text-embedding-3-small'
  })
});
const data = await response.json();
```

### Upload and Process File
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch('http://localhost:3000/api/files/process-and-embed', {
  method: 'POST',
  body: formData
});
const data = await response.json();
```

## Security

- **Helmet** - Sets secure HTTP headers
- **CORS** - Restricts cross-origin access
- **Rate Limiting** - Prevents abuse (100 req/15min)
- **File Validation** - Type and size checks
- **Environment Variables** - No hardcoded secrets

## Development

### File Watch Mode
```bash
npm run dev
```
Uses nodemon to restart on file changes.

### Testing Endpoints
```bash
# Health check
curl http://localhost:3000/api/health

# Chat
curl -X POST http://localhost:3000/api/chat/completions/non-stream \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"test"}]}'
```

## Deployment

### Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Use process manager (PM2)
- [ ] Enable HTTPS
- [ ] Configure firewall
- [ ] Set up monitoring
- [ ] Backup environment variables

### PM2 Example
```bash
pm2 start server.js --name nst-backend
pm2 save
pm2 startup
```

## Troubleshooting

**Port already in use:**
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill -9
```

**CORS errors:**
- Add frontend URL to `ALLOWED_ORIGINS` in `.env`

**OpenAI errors:**
- Verify API key is correct
- Check account credits
- Review API status page

## License

See LICENSE file in root directory.

## Support

For integration with the frontend, see `INTEGRATION_GUIDE.md` in the parent directory.
