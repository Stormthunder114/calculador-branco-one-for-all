"""Diagnóstico pontual de acesso público, sem autenticação, de Históricos Blaze."""
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.robotparser import RobotFileParser
import re
import sys

SITE = "https://historicosblaze.com"
PAGE = SITE + "/results/blitz/double"
UA = "OneForAllObservatorio/1.0 (+https://github.com/Stormthunder114/calculador-branco-one-for-all)"

def get(url):
    request=Request(url,headers={"User-Agent":UA,"Accept":"text/html,application/xhtml+xml"})
    with urlopen(request,timeout=15) as response:
        return response.status,response.headers, response.read(3_000_000).decode("utf-8","replace")

try:
    status, headers, robots = get(SITE+"/robots.txt")
    rp=RobotFileParser()
    rp.parse(robots.splitlines())
    print("ROBOTS",status,"CAN_FETCH",rp.can_fetch(UA,PAGE),"RULES",len(robots.splitlines()))
    if not rp.can_fetch(UA,PAGE):
        print("PUBLIC_PAGE_BLOCKED_BY_ROBOTS - STOP")
        sys.exit(0)
except Exception as exc:
    print("ROBOTS_UNVERIFIED",type(exc).__name__,str(exc)[:200])
    sys.exit(0)

try:
    status, headers, html = get(PAGE)
    print("PUBLIC_PAGE",status,"BYTES",len(html),"CONTENT_TYPE",headers.get("content-type"),"CORS",headers.get("access-control-allow-origin"))
    print("HAS_NEXT_DATA", '__NEXT_DATA__' in html, "HAS_SERVER_STATE", 'self.__next_f.push' in html)
    print("HAS_HISTORY", '200 Resultados' in html, "HAS_BRANCO", 'Branco' in html)
    for needle in ["200 Resultados","Image: Branco","Double","07:43"]:
        pos=html.find(needle)
        if pos >= 0: print("EXCERPT",needle,repr(html[max(0,pos-160):pos+200])[:450])
    for marker in ['created_at','"roll"','\\"roll\\"','datetime=','data-time','data-result']:
        print("FIELD", marker,html.count(marker))
    print("BODY_NUMBERS",len(re.findall(r'>\\s*(?:0|[1-9]|1[0-4])\\s*<',html)))
    for needle in ["data-result", "created_at", "data-roll", "data-roulette"]:
        pos=html.find(needle)
        if pos>=0: print("TAG_SAMPLE",needle,repr(html[max(0,pos-230):pos+340])[:610])
    for marker in ['data-result=', 'data-created-at=', 'data-result-id=', 'data-record-id=']:
        print("ATTRIBUTE", marker, html.count(marker))
    for needle in ['created_at', 'data-result']:
        offsets=[m.start() for m in re.finditer(needle,html)]
        for idx in [3,20,50,150]:
            if len(offsets)>idx:
                pos=offsets[idx]
                print("REPEATED_SAMPLE",needle,idx,repr(html[max(0,pos-110):pos+200])[:360])
    for needle in ['data-sveltekit', 'results?_','rest/v1/results', 'result_number', 'round_id', 'value', 'roll', 'created_on', 'data-hash']:
        print("MARKER",needle,html.count(needle))

except Exception as exc:
    print("PUBLIC_PAGE_UNAVAILABLE",type(exc).__name__,str(exc)[:200])
