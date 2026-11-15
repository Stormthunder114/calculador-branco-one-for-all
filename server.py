"""Servidor local One For All. Python 3.10+, sem depend�ncias externas."""
import argparse
import json
import math
import threading
import time
import webbrowser
from datetime import datetime
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

API = "https://blitz4.casino/api/singleplayer-originals/originals/roulette_games/recent/history/1"
ROOT = Path(__file__).resolve().parent
POLL_SECONDS = 15
ASSETS = {"/": ("index.html", "text/html; charset=utf-8"),
          "/index.html": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8")}


def validate_records(body, now):
    records = body.get("records") if isinstance(body, dict) else None
    if not isinstance(records, list) or not records:
        raise ValueError("Lista de resultados ausente.")
    valid = {}
    for row in records[:100]:
        try:
            roll, color = row["roll"], row["color"]
            timestamp = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                continue
            t = timestamp.timestamp()
            if type(roll) is not int or not 0 <= roll <= 14:
                continue
            if type(color) is not int or color != (0 if roll == 0 else 1 if roll <= 7 else 2):
                continue
            if row.get("id") is None or not now - 86520 <= t <= now + 120:
                continue
            valid[str(row["id"])] = {"id": str(row["id"]), "roll": roll,
                                     "color": color, "created_at": row["created_at"]}
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
    if len(valid) < max(1, (min(len(records), 100) * 8 + 9) // 10):
        raise ValueError("Resposta incompleta ou inv�lida.")
    result = sorted(valid.values(), key=lambda r: datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")).timestamp())
    if now - datetime.fromisoformat(result[-1]["created_at"].replace("Z", "+00:00")).timestamp() > 600:
        raise ValueError("A API devolveu resultados antigos.")
    return result


def retry_seconds(value, now):
    try:
        delay = float(value)
    except (TypeError, ValueError):
        try:
            delay = parsedate_to_datetime(value).timestamp() - now
        except (TypeError, ValueError, AttributeError, OverflowError):
            delay = 1800
    return max(1800, delay) if math.isfinite(delay) else 1800


class Feed:
    def __init__(self):
        self.condition = threading.Condition()
        self.version = 0
        self.snapshot = {"status": "loading", "message": "Conectando � Blitz pelo Python...",
                         "records": [], "checked_at": 0, "next_check": 0}

    def publish(self, **changes):
        with self.condition:
            self.snapshot = {**self.snapshot, **changes}
            self.version += 1
            self.condition.notify_all()

    def wait(self, previous):
        with self.condition:
            self.condition.wait_for(lambda: self.version != previous, timeout=15)
            return self.version, dict(self.snapshot)


def collect_once(feed, opener=urlopen, clock=time.time):
    now = clock()
    status, message, delay = "live", "Conectado � Blitz � atualiza��o autom�tica pelo Python.", POLL_SECONDS
    changes = {}
    try:
        request = Request(API, headers={"Accept": "application/json", "User-Agent": "OneForAllLocal/1.0"})
        with opener(request, timeout=12) as response:
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise ValueError("Resposta muito grande.")
            changes["records"] = validate_records(json.loads(body), clock())
    except HTTPError as error:
        if error.code == 429:
            status, message = "rate-limited", "A Blitz limitou as consultas. Aguardando o intervalo de libera��o."
            delay = retry_seconds(error.headers.get("Retry-After"), clock())
        elif error.code in (401, 403, 451):
            status, message, delay = "denied", f"A Blitz respondeu HTTP {error.code}. Coleta suspensa.", None
        else:
            status, message, delay = "unavailable", f"Resposta HTTP {error.code}. Nova tentativa em 60 segundos.", 60
    except (ValueError, UnicodeError):
        status, message, delay = "delayed", "Resposta inv�lida ou antiga. Hist�rico preservado; nova consulta em 60 segundos.", 60
    except (OSError, TimeoutError):
        status, message, delay = "unavailable", "Falha de conex�o com a Blitz. Nova tentativa em 60 segundos.", 60
    feed.publish(status=status, message=message, checked_at=int(now * 1000),
                 next_check=int((clock() + delay) * 1000) if delay is not None else 0, **changes)
    return delay


def collector(feed, stop):
    while not stop.is_set():
        delay = collect_once(feed)
        if delay is None or stop.wait(delay):
            return


def handler_for(feed):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/events":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache, no-store")
                self.send_header("X-Accel-Buffering", "no")
                self.end_headers()
                self.connection.settimeout(20)
                previous = -1
                try:
                    self.wfile.write(b"retry: 3000\n\n")
                    self.wfile.flush()
                    while True:
                        version, snapshot = feed.wait(previous)
                        packet = ("event: snapshot\ndata: " + json.dumps(snapshot, ensure_ascii=False) + "\n\n") if version != previous else ": heartbeat\n\n"
                        self.wfile.write(packet.encode("utf-8"))
                        self.wfile.flush()
                        previous = version
                except (OSError, ConnectionError):
                    pass
                return
            asset = ASSETS.get(path)
            if not asset:
                self.send_error(404)
                return
            try:
                content = (ROOT / asset[0]).read_bytes()
            except OSError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", asset[1])
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, *_args):
            pass
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    feed, stop = Feed(), threading.Event()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(feed))
    except OSError as error:
        raise SystemExit(f"N�o foi poss�vel abrir a porta {args.port}: {error}. Feche outra inst�ncia ou use --port 8766.")
    server.daemon_threads = True
    threading.Thread(target=collector, args=(feed, stop), daemon=True).start()
    url = f"http://127.0.0.1:{args.port}"
    print(f"One For All: {url}\nMantenha esta janela aberta. Ctrl+C para encerrar.")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
