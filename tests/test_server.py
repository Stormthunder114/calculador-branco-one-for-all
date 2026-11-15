import io
import json
import threading
import unittest
from datetime import datetime, timezone
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError

from server import Feed, collect_once, handler_for, retry_seconds


NOW = 1794750000


def sample(identifier="a", roll=0):
    return {"id": identifier, "roll": roll,
            "color": 0 if roll == 0 else 1 if roll <= 7 else 2,
            "created_at": datetime.fromtimestamp(NOW - 10, timezone.utc).isoformat()}


def opener_for(records):
    def open_response(*args, **kwargs):
        return io.BytesIO(json.dumps({"records": records}).encode())
    return open_response


class CollectorTests(unittest.TestCase):
    def test_valid_response_deduplicates_and_publishes(self):
        feed = Feed()
        delay = collect_once(feed, opener_for([sample(), sample()]), lambda: NOW)
        # Duplicate-heavy responses are rejected as incomplete.
        self.assertEqual(delay, 60)
        delay = collect_once(feed, opener_for([sample()]), lambda: NOW)
        self.assertEqual(delay, 15)
        self.assertEqual(feed.snapshot["status"], "live")
        self.assertEqual(len(feed.snapshot["records"]), 1)
        self.assertEqual(feed.snapshot["next_check"], (NOW + 15) * 1000)

    def test_invalid_response_preserves_previous_results(self):
        feed = Feed()
        collect_once(feed, opener_for([sample()]), lambda: NOW)
        bad = {**sample("bad"), "color": 2}
        collect_once(feed, opener_for([bad]), lambda: NOW)
        self.assertEqual(feed.snapshot["status"], "delayed")
        self.assertEqual(feed.snapshot["records"][0]["id"], "a")

    def test_http_limits(self):
        for code, delay in [(429, 7200), (403, None), (451, None), (500, 60)]:
            with self.subTest(code=code):
                def fail(*args, **kwargs):
                    raise HTTPError("https://example.invalid", code, "test", {"Retry-After": "7200"}, None)
                self.assertEqual(collect_once(Feed(), fail, lambda: NOW), delay)
        self.assertEqual(retry_seconds("30", NOW), 1800)
        self.assertEqual(retry_seconds("bad", NOW), 1800)

    def test_network_failure_is_retryable(self):
        def fail(*args, **kwargs):
            raise OSError("offline")
        feed = Feed()
        self.assertEqual(collect_once(feed, fail, lambda: NOW), 60)
        self.assertEqual(feed.snapshot["status"], "unavailable")


class StreamTests(unittest.TestCase):
    def setUp(self):
        self.feed = Feed()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.feed))
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]
        self.connections = []

    def tearDown(self):
        for connection in self.connections:
            connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def connect(self, path):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=3)
        self.connections.append(connection)
        connection.request("GET", path)
        return connection.getresponse()

    def read_snapshot(self, response):
        while True:
            line = response.readline().decode()
            if line.startswith("data: "):
                return json.loads(line[6:])
            if not line:
                self.fail("SSE fechou antes da mensagem")

    def test_new_result_reaches_two_tabs_and_reconnect(self):
        self.feed.publish(status="live", records=[sample()])
        first, second = self.connect("/events"), self.connect("/events")
        self.assertEqual(first.getheader("Content-Type"), "text/event-stream; charset=utf-8")
        self.assertEqual(self.read_snapshot(first)["records"][0]["id"], "a")
        self.assertEqual(self.read_snapshot(second)["records"][0]["id"], "a")
        self.feed.publish(records=[sample("b", 8)])
        self.assertEqual(self.read_snapshot(first)["records"][0]["id"], "b")
        self.assertEqual(self.read_snapshot(second)["records"][0]["id"], "b")
        self.assertEqual(self.read_snapshot(self.connect("/events"))["records"][0]["id"], "b")

    def test_only_public_assets_are_served(self):
        self.assertEqual(self.connect("/").status, 200)
        self.assertEqual(self.connect("/app.js?v=1").status, 200)
        self.assertEqual(self.connect("/server.py").status, 404)
        self.assertEqual(self.connect("/../server.py").status, 404)


if __name__ == "__main__":
    unittest.main()
