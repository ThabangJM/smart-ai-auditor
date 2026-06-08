const express = require('express');
const router = express.Router();
const axios = require('axios');

const PDF_SERVICE_URL='http://localhost:5000/generate-pdf';

/**
 * POST /api/export-pdf
 * Forward PDF generation request to external service
 */
router.post('/', async (req, res) => {
  const logger = req.app.locals.logger;

  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    logger.info('Forwarding PDF generation request', {
      messageCount: messages.length,
      serviceUrl: PDF_SERVICE_URL
    });

    const upstreamResponse = await axios.post(PDF_SERVICE_URL, { messages }, {
      headers: { 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 30000
    });

    const contentType = (upstreamResponse.headers['content-type'] || '').toLowerCase();
    const pdfBuffer = Buffer.from(upstreamResponse.data);

    res.setHeader('Content-Type', contentType || 'application/pdf');
    const disposition = upstreamResponse.headers['content-disposition']
      || `attachment; filename="chat-export-${new Date().toISOString().split('T')[0]}.pdf"`;
    res.setHeader('Content-Disposition', disposition);
    res.status(200).send(pdfBuffer);

  } catch (error) {
    logger.error('PDF generation request failed', {
      error: error.message,
      status: error.response?.status,
    });

    const status = error.response?.status || 500;
    res.status(status).json({
      error: 'PDF generation failed',
      message: error.response?.data?.toString('utf8') || error.message,
    });
  }
});

module.exports = router;
