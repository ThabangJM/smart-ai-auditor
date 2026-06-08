require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const axios = require('axios'); // Added axios import
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Route imports
const chatRoutes = require('./routes/chat');
const embeddingsRoutes = require('./routes/embeddings');
const fileRoutes = require('./routes/files');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3000;
const PDF_SERVICE_URL = process.env.PDF_SERVICE_URL || 'https://www.nstsolutions.co.za/testdemo/generate-pdf';
const PYTHON_EXECUTABLE = process.env.PYTHON_EXECUTABLE || 'python';
const LOCAL_PDF_GENERATOR_PATH = process.env.LOCAL_PDF_GENERATOR_PATH
  || path.join(__dirname, '..', 'python', 'pdf_generator.py');

function isPdfContentType(contentType) {
  if (!contentType) return false;
  const normalized = String(contentType).toLowerCase();
  return normalized.includes('application/pdf') || normalized.includes('application/octet-stream');
}

async function generatePdfLocally(messages, logger) {
  if (!fs.existsSync(LOCAL_PDF_GENERATOR_PATH)) {
    throw new Error(`Local PDF generator not found at ${LOCAL_PDF_GENERATOR_PATH}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nst-pdf-'));
  const outputPath = path.join(tempDir, 'output.pdf');

  try {
    const stderrChunks = [];

    await new Promise((resolve, reject) => {
      const child = spawn(PYTHON_EXECUTABLE, [LOCAL_PDF_GENERATOR_PATH], { cwd: tempDir });

      child.on('error', (err) => {
        reject(new Error(`Failed to start python process: ${err.message}`));
      });

      child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

      child.stdin.write(JSON.stringify(messages));
      child.stdin.end();

      child.on('close', (code) => {
        if (code !== 0) {
          const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();
          reject(new Error(`Python PDF generator exited with code ${code}${stderrText ? `: ${stderrText}` : ''}`));
          return;
        }
        resolve();
      });
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error('Python PDF generator did not produce output.pdf');
    }

    return fs.readFileSync(outputPath);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      logger.warn('Failed to clean temporary PDF directory', {
        error: cleanupError.message,
        tempDir
      });
    }
  }
}

// Validate required environment variables
const requiredEnvVars = ['OPENAI_API_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please check your .env file');
  process.exit(1);
}

// Logging helper
const logger = {
  info: (msg, meta = {}) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, meta),
  error: (msg, meta = {}) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, meta),
  warn: (msg, meta = {}) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, meta),
  debug: (msg, meta = {}) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`, meta);
    }
  }
};

// Export logger for use in routes
app.locals.logger = logger;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://www.gstatic.com",
        "https://apis.google.com",
        "https://*.firebaseapp.com",
        "https://*.firebase.google.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: [
        "'self'",
        "https://*.googleapis.com",
        "https://*.firebaseio.com",
        "https://*.firebase.google.com",
        "wss://*.firebaseio.com",
        "https://api.openai.com",
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      frameSrc: ["'self'", "https://*.firebaseapp.com"],
    },
  },
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'https://nstsolutions.co.za',
      'http://nstsolutions.co.za',
      'https://www.nstsolutions.co.za',
      'http://www.nstsolutions.co.za'
    ];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser middleware
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf, encoding) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      logger.error('Invalid JSON in request body', { error: e.message });
      throw new Error('Invalid JSON');
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression({
  filter: (req, res) => {
    if (res.getHeader('Content-Type') === 'text/event-stream') {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });
  next();
});

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/embeddings', embeddingsRoutes);
app.use('/api/files', fileRoutes);

// AI-Generated PDF Export endpoint
app.post('/api/export-pdf', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    let pdfBuffer = null;
    let contentDisposition = null;
    let externalError = null;

    // Try external service first for compatibility with existing deployments.
    try {
      logger.info('Attempting external PDF generation', {
        messageCount: messages.length,
        serviceUrl: PDF_SERVICE_URL
      });

      const upstreamResponse = await axios.post(PDF_SERVICE_URL, { messages }, {
        headers: { 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const upstreamContentType = upstreamResponse.headers['content-type'];
      const upstreamBuffer = Buffer.from(upstreamResponse.data);

      if (!isPdfContentType(upstreamContentType)) {
        throw new Error(`External service returned non-PDF content-type: ${upstreamContentType || 'unknown'}`);
      }

      pdfBuffer = upstreamBuffer;
      contentDisposition = upstreamResponse.headers['content-disposition'] || null;
      logger.info('External PDF generation succeeded', { bytes: pdfBuffer.length });
    } catch (err) {
      externalError = err;
      logger.warn('External PDF generation failed, trying local fallback', {
        error: err.message
      });
    }

    // Fallback to local python generator.
    if (!pdfBuffer) {
      try {
        pdfBuffer = await generatePdfLocally(messages, logger);
        logger.info('Local PDF generation succeeded', { bytes: pdfBuffer.length });
      } catch (localErr) {
        logger.error('Both external and local PDF generation failed', {
          externalError: externalError ? externalError.message : null,
          localError: localErr.message
        });

        return res.status(502).json({
          error: 'PDF generation failed',
          message: `External: ${externalError ? externalError.message : 'not attempted'} | Local: ${localErr.message}`
        });
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      contentDisposition || `attachment; filename="chat-export-${new Date().toISOString().split('T')[0]}.pdf"`
    );

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    logger.error('Failed to forward PDF generation request', {
      error: error.message,
      stack: error.stack,
    });

    if (error.response) {
      return res.status(error.response.status).json({
        error: 'Failed to forward PDF generation request',
        message: Buffer.isBuffer(error.response.data)
          ? error.response.data.toString('utf8')
          : error.response.data || 'Error from external service',
      });
    }

    return res.status(500).json({
      error: 'Failed to forward PDF generation request',
      message: error.message,
    });
  }
});

// Serve static frontend files from project root
app.use(express.static(path.join(__dirname, '..')));

// Root route — serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  logger.warn('Route not found', { path: req.path, method: req.method });
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.url} not found`,
    availableEndpoints: ['/api/health', '/api/chat', '/api/embeddings', '/api/files', '/api/export-pdf']
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body
  });

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message,
      details: err.details || {}
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication'
    });
  }

  if (err.message === 'Invalid JSON') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid JSON in request body'
    });
  }

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'CORS policy does not allow access from this origin'
    });
  }

  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      details: err.details 
    })
  });
});

// Start server
const server = app.listen(PORT, () => {
  logger.info('Server started successfully', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    openAIConfigured: !!process.env.OPENAI_API_KEY,
    allowedOrigins: allowedOrigins.length
  });

  console.log(`
╔═══════════════════════════════════════════════════════╗
║     NST Solutions Backend Server                      ║
║                                                       ║
║     Environment: ${process.env.NODE_ENV || 'development'}                           ║
║     Port: ${PORT}                                          ║
║     OpenAI: ${process.env.OPENAI_API_KEY ? '✓ Configured' : '✗ Not configured'}                   ║
║                                                       ║
║     API Endpoints:                                    ║
║     - Health: http://localhost:${PORT}/api/health      ║
║     - Chat: http://localhost:${PORT}/api/chat          ║
║     - Embeddings: http://localhost:${PORT}/api/embeddings ║
║     - Files: http://localhost:${PORT}/api/files        ║
║     - Export PDF: http://localhost:${PORT}/api/export-pdf ║
╚═══════════════════════════════════════════════════════╝
  `);
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    logger.error('Server error', { error: error.message });
    throw error;
  }
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`${signal} signal received: closing HTTP server`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forcing server close after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;