import io
import os
import json
import tempfile
from flask import Flask, request, send_file, jsonify
from pdf_generator import generate_chat_pdf

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

@app.route('/generate-pdf', methods=['POST'])
def generate():
    # 1. Parse incoming JSON body
    body = request.get_json(silent=True)
    if not body or 'messages' not in body:
        return jsonify({"error": "Request body must contain a 'messages' array"}), 400

    messages = body['messages']
    if not isinstance(messages, list):
        return jsonify({"error": "'messages' must be an array"}), 400

    # 2. Write PDF to a temporary file (reportlab needs a file path)
    tmp_file = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
    tmp_path = tmp_file.name
    tmp_file.close()

    try:
        # 3. Call pdf_generator directly — same function used by CLI
        generate_chat_pdf(messages, tmp_path)

        # 4. Read the file bytes into memory and delete the temp file
        with open(tmp_path, 'rb') as f:
            pdf_bytes = f.read()

        # 5. Return the PDF as a downloadable response
        return send_file(
            io.BytesIO(pdf_bytes),
            mimetype='application/pdf',
            as_attachment=True,
            download_name='report.pdf'
        )
    except Exception as e:
        return jsonify({"error": "PDF generation failed", "detail": str(e)}), 500
    finally:
        # Always clean up the temp file
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


if __name__ == '__main__':
    port = int(os.environ.get('PDF_SERVICE_PORT', 5000))
    # debug=False for production; host='0.0.0.0' makes it reachable on the network
    app.run(host='0.0.0.0', port=port, debug=False)