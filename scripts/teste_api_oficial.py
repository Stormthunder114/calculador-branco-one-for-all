"""Diagnóstico único para avaliar a API pública da Blitz; não contorna bloqueios."""
import json
import sys
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.robotparser import RobotFileParser

BASE = "https://blitz4.casino"
PATH = "/api/singleplayer-originals/originals/roulette_games/recent/history/1"
UA = "OneForAll-Statistical-Study/1.0 (+https://github.com/Stormthunder114/calculador-branco-one-for-all)"

def request(url):
    return urlopen(Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/plain,*/*"}), timeout=18)

try:
    with request(BASE + "/robots.txt") as f:
        robots = f.read(500_000).decode("utf-8","replace")
    parser = RobotFileParser()
    parser.parse(robots.splitlines())
    allowed = parser.can_fetch(UA, BASE + PATH)
    print("ROBOTS_ALLOWED", allowed, "LINES",len(robots.splitlines()))
    if not allowed:
        print("STOP: API não permitida no robots.txt"); sys.exit(0)
except HTTPError as error:
    print("ROBOTS_HTTP", error.code)
    if error.code != 404: sys.exit(0)
except Exception as error:
    print("ROBOTS_UNVERIFIED", type(error).__name__)
    sys.exit(0)

end = datetime.now(timezone.utc)
start = end - timedelta(hours=48)
query = urlencode({"startDate":start.isoformat(timespec="milliseconds").replace("+00:00","Z"),
                   "endDate":end.isoformat(timespec="milliseconds").replace("+00:00","Z"),
                   "page":1})
url = BASE + PATH + "?" + query
try:
    with request(url) as response:
        result = json.load(response)
        print("API_HTTP", response.status, "CONTENT_TYPE",response.headers.get("content-type"))
    if isinstance(result,dict):
        print("KEYS",list(result)[:15])
        records = result.get("records")
        print("RECORDS_COUNT",len(records) if isinstance(records,list) else "not_array")
        if records:
            print("RECORD_KEYS", list(records[0])[:15])
            print("FIRST_COLOR", records[0].get("color"))
            print("FIRST_TIME", records[0].get("created_at"))
            print("LAST_TIME", records[-1].get("created_at"))
    else:
        print("API_RESPONSE_TYPE", type(result).__name__)
except HTTPError as error:
    print("API_HTTP_ERROR",error.code, "RETRY_AFTER",error.headers.get("Retry-After"))
except Exception as error:
    print("API_UNAVAILABLE",type(error).__name__,str(error)[:180])
