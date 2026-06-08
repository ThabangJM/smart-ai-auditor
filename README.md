# NST Solutions - API Endpoints Documentation

## Overview
This document lists all external API endpoints used in the `script.js` file.

---

## OpenAI API Endpoints

### 1. Chat Completions API
**Endpoint:** `https://api.openai.com/v1/chat/completions`

**Purpose:** Generate text completions using OpenAI's GPT models

**Used in:**
- Line 14: Defined as `CHAT_URL` constant
- Line 1098: `fetchChunkAnswer()` function
- Line 1148: `fetchWithBackoff()` function
- Line 2415: Retry with backoff implementation
- Line 4310: Function calling implementation
- Line 4468: Streaming response handler
- Line 4645: Chat response generation
- Line 4870: Another chat completion call
- Multiple other locations throughout the file

**Request Method:** POST

**Authentication:** Bearer token using `OPENAI_KEY`

**Request Headers:**
- `Content-Type: application/json`
- `Authorization: Bearer ${OPENAI_KEY}`
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

**Request Body Parameters:**
- `model`: Model identifier (e.g., "gpt-4o", "gpt-4o-mini")
- `messages`: Array of message objects with `role` and `content`
- `temperature`: Controls randomness (typically 0.0 - 0.2)
- `stream`: Boolean for streaming responses (true/false)
- `tools`: Optional array of tool definitions for function calling

---

### 2. Embeddings API
**Endpoint:** `https://api.openai.com/v1/embeddings`

**Purpose:** Generate vector embeddings for text data

**Used in:**
- Line 13: Defined as `EMBEDDING_URL` constant
- Line 4984: `getEmbedding()` function

**Request Method:** POST

**Authentication:** Bearer token using `OPENAI_KEY`

**Request Headers:**
- `Content-Type: application/json`
- `Authorization: Bearer ${OPENAI_KEY}`
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

**Request Body Parameters:**
- `model`: "text-embedding-ada-002"
- `input`: Text or array of texts to embed

---

## CDN Endpoints

### 3. PDF.js Worker
**Endpoint:** `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.5.141/pdf.worker.min.js`

**Purpose:** Load PDF.js worker script for PDF processing in the browser

**Used in:**
- Line 5: Set as `pdfjsLib.GlobalWorkerOptions.workerSrc`

**Request Method:** GET

**Authentication:** None required (public CDN)

---

## API Configuration

### Global Variables
- `OPENAI_KEY`: API key for OpenAI authentication (defined at line 9)
- `EMBEDDING_URL`: OpenAI embeddings endpoint
- `CHAT_URL`: OpenAI chat completions endpoint

### Security Notes
⚠️ **Important:** The OpenAI API key should be stored securely and not hardcoded in production environments. Consider using:
- Environment variables
- Secure configuration files
- Server-side API proxy

---

## Usage Count Summary
- **OpenAI Chat Completions API**: 9+ usages
- **OpenAI Embeddings API**: 2 usages
- **PDF.js CDN**: 1 usage

---

## Request Features
- **Retry Logic**: Implemented with exponential backoff
- **Streaming**: Supported for real-time response rendering
- **Function Calling**: Enabled with tools parameter
- **Error Handling**: Comprehensive error catching and user feedback
- **Abort Controller**: Allows cancellation of in-progress requests

---

*Last Updated: November 10, 2025*