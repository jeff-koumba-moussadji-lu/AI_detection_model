"""Local gallery launcher, results importer and static website exporter (Python 3.10+)."""
from __future__ import annotations
import argparse
import io
import json
import mimetypes
import secrets
import sys
import threading
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from gallery_io import export_hosting, load_gallery, static_paths, update_gallery

ROOT = Path(__file__).resolve().parent


def make_server(folder=ROOT, port=0):
    folder = Path(folder).resolve()
    load_gallery(folder)
    allowed = {name: path for path, name in static_paths(folder)}
    nonce = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def local_request(self):
            expected = '127.0.0.1:' + str(self.server.server_port)
            if self.headers.get('Host') != expected:
                self.reply(403, {'error': 'Use the local gallery address printed in the console'})
                return False
            origin = self.headers.get('Origin')
            if origin and origin != 'http://' + expected:
                self.reply(403, {'error': 'This request did not come from the local gallery'})
                return False
            return True

        def reply(self, status, data, content_type='application/json; charset=utf-8', filename=None):
            raw = json.dumps(data, ensure_ascii=False, allow_nan=False).encode() if isinstance(data, (dict, list)) else data
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if filename:
                self.send_header('Content-Disposition', 'attachment; filename="' + filename + '"')
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if not self.local_request():
                return
            path = unquote(urlsplit(self.path).path)
            if path == '/api/session':
                return self.reply(200, {'local': True, 'token': nonce})
            if path == '/api/gallery':
                return self.reply(200, load_gallery(folder))
            if path == '/download/Orbit_Gallery_Website.zip':
                memory = io.BytesIO()
                with zipfile.ZipFile(memory, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                    for asset, name in static_paths(folder):
                        archive.write(asset, name)
                return self.reply(200, memory.getvalue(), 'application/zip', 'Orbit_Gallery_Website.zip')
            key = 'index.html' if path == '/' else path.lstrip('/')
            if key not in allowed:
                return self.reply(404, {'error': 'Not found'})
            source = allowed[key]
            kind = mimetypes.guess_type(source.name)[0] or 'application/octet-stream'
            if source.suffix == '.js':
                kind = 'text/javascript; charset=utf-8'
            return self.reply(200, source.read_bytes(), kind)

        def do_POST(self):
            if not self.local_request():
                return
            if self.path != '/api/results':
                return self.reply(404, {'error': 'Not found'})
            if not secrets.compare_digest(self.headers.get('X-Orbit-Token', ''), nonce):
                return self.reply(403, {'error': 'Reload the local gallery before updating'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size < 1 or size > 8 * 1024 * 1024:
                    raise ValueError('Choose a JSON results file smaller than 8 MB')
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('Expected a JSON results file')
                raw = self.rfile.read(size)
                payload = json.loads(raw.decode('utf-8-sig'))
                info = update_gallery(folder, payload)
            except (ValueError, OSError, TypeError, AttributeError, KeyError) as exc:
                return self.reply(400, {'error': str(exc)[:400]})
            return self.reply(200, info)

    return HTTPServer(('127.0.0.1', port), Handler)


def main(argv=None):
    p = argparse.ArgumentParser(description='View, update or export your local Orbit gallery.')
    p.add_argument('command', choices=['serve', 'update', 'export'], nargs='?', default='serve')
    p.add_argument('file', nargs='?', type=Path, help='gallery_update.json for update, or destination ZIP for export')
    p.add_argument('--port', type=int, default=0, help='Local port; default chooses a free port')
    p.add_argument('--no-browser', action='store_true')
    args = p.parse_args(argv)
    try:
        if args.command == 'update':
            if not args.file:
                raise ValueError('Supply the path to gallery_update.json')
            result = update_gallery(ROOT, json.loads(args.file.read_text(encoding='utf-8-sig')))
            print(f"Saved {result['updated']} photos. Skipped {result['skipped_not_run']} unattempted and {result['older']} older results.")
            return 0
        if args.command == 'export':
            result = export_hosting(ROOT, args.file or ROOT / 'Orbit_Gallery_Website.zip')
            print('Website ZIP:', result['path'], '|', result['files'], 'files')
            return 0
        server = make_server(ROOT, args.port)
        url = 'http://127.0.0.1:' + str(server.server_port)
        print('Local Orbit gallery:', url, flush=True)
        print('Keep this window open to import results. No Qwen or dashboard server is needed.', flush=True)
        print('Close with Ctrl+C. You can also open index.html directly to view the gallery offline.', flush=True)
        if not args.no_browser:
            threading.Timer(.3, lambda: webbrowser.open(url)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nGallery closed.')
        finally:
            server.server_close()
        return 0
    except (ValueError, OSError) as exc:
        print('Cannot open gallery:', exc, file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
