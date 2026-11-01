"""A stand-in for cloud-api.near.ai, for testing the runner offline.

It records every request it receives, answers one chat completion, and
reports the signature as not-yet-recorded on the first lookup so the
runner's retry path runs.
"""
import hashlib
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

LOG = sys.argv[2]
COMPLETION = json.dumps({
    "id": "chatcmpl-mock-1",
    "model": "Qwen/Qwen3.8-27B",
    "choices": [{
        "index": 0,
        "message": {"role": "assistant", "content": "{\"answer\":\"APPROVE\",\"reason\":\"ok\"}"},
        "finish_reason": "stop",
    }],
}, separators=(",", ":")).encode()
lookups = 0


def record(entry):
    with open(LOG, "a") as handle:
        handle.write(json.dumps(entry) + "\n")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        if self.headers.get("Content-Length"):
            return self.rfile.read(int(self.headers["Content-Length"]))
        body = b""
        while True:
            size = int(self.rfile.readline().strip(), 16)
            if size == 0:
                self.rfile.readline()
                return body
            body += self.rfile.read(size)
            self.rfile.readline()

    def do_POST(self):
        body = self.read_body()
        record({
            "path": self.path,
            "sha256": hashlib.sha256(body).hexdigest(),
            "auth": self.headers.get("Authorization"),
            "no_aliasing": self.headers.get("x-no-aliasing"),
            "encoding": self.headers.get("Accept-Encoding"),
            "length": self.headers.get("Content-Length"),
        })
        self.reply(200, COMPLETION)

    def do_GET(self):
        global lookups
        lookups += 1
        record({"path": self.path})
        if lookups == 1:
            self.reply(404, b'{"error":"not found"}')
            return
        request_hash = "00" * 32
        response_hash = hashlib.sha256(COMPLETION).hexdigest()
        self.reply(200, json.dumps({
            "text": f"Qwen/Qwen3.8-27B:{request_hash}:{response_hash}",
            "signature": "0x" + "11" * 65,
            "signing_address": "0x" + "22" * 20,
            "signing_algo": "ecdsa",
            "signature_kind": "provider_tee",
        }).encode())


HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
