#!/usr/bin/env python3
"""Lightweight GitHub webhook listener for Lyrica auto-deploy."""

import hashlib
import hmac
import json
import subprocess
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

SECRET = "c49751e6596aff5a0ebf45cc48ea2a568569a57e"
DEPLOY_SCRIPT = "/opt/lyrica/deploy.sh"
PORT = 9876


class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/webhook":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        # Validate GitHub signature
        signature = self.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(
            SECRET.encode(), body, hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(signature, expected):
            print(f"[WARN] Invalid signature from {self.client_address[0]}")
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"Invalid signature")
            return

        # Parse payload
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return

        # Only deploy on push to main
        ref = payload.get("ref", "")
        if ref != "refs/heads/main":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(f"Ignored ref: {ref}".encode())
            return

        pusher = payload.get("pusher", {}).get("name", "unknown")
        commits = len(payload.get("commits", []))
        print(f"[DEPLOY] Push to main by {pusher} ({commits} commits) — deploying…")

        # Run deploy script in background (don't block the webhook response)
        subprocess.Popen(
            ["/bin/bash", DEPLOY_SCRIPT],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Deploy started")

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), WebhookHandler)
    print(f"Lyrica webhook listener on port {PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        server.server_close()
