#!/usr/bin/env python3
"""Uma consulta autorizada à API pública da Blitz por execução.

Armazena apenas campos necessários à análise, sem seeds/segredos.
Limite: primeira página, 100 resultados. Backoff em HTTP 429.
Não usa proxies, autenticação, captcha nem contorna bloqueios.
"""
from __future__ import annotations
import json
import sys
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

API_ORIGIN = "https://blitz4.casino"
API_PATH = "/api/singleplayer-originals/originals/roulette_games/recent/history/1"
API_URL = API_ORIGIN + API_PATH
UA = "OneForAll-Statistical-Study/1.0 (+https://github.com/Stormthunder114/calculador-branco-one-for-all)"
FEED_FILE = Path("data/blitz-oficial-100.json")
STATUS_FILE = Path("data/blitz-oficial-status.json")
CUTOFF = datetime(2026, 11, 15, 4, tzinfo=timezone.utc)
MAX_ARCHIVE = 3000

def utc_now():
    return datetime.now(timezone.utc)

def iso(t):
    return t.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def dtparse(s):
    if not isinstance(s, str):
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z","+00:00"))
        return d.astimezone(timezone.utc) if d.tzinfo is not None else None
    except (ValueError, TypeError, OverflowError):
        return None

def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return default

def write_json(path, obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",",":")) + "\n", encoding="utf-8")

def normalize(raw, now):
    if not isinstance(raw, dict) or raw.get("id") is None:
        return None
    value = raw.get("roll")
    color = raw.get("color")
    if type(value) is not int or type(color) is not int:
        return None
    if value not in range(15) or color not in (0,1,2):
        return None
    if (value == 0 and color != 0) or (1 <= value <= 7 and color != 1) or (8 <= value <= 14 and color != 2):
        return None
    t = dtparse(raw.get("created_at"))
    if t is None or t < CUTOFF or t > now + timedelta(minutes=2):
        return None
    return {"id": "blitz:" + str(raw["id"]), "created_at": iso(t),
            "color": color, "roll": value}

def parse_records(response, now):
    rows = response.get("records") if isinstance(response,dict) else None
    if not isinstance(rows,list):
        raise ValueError("Campo records indisponível")
    clean = {}
    for raw in rows[:100]:
        obj = normalize(raw,now)
        if obj:
            clean[obj["id"]] = obj
    if len(clean) < 70:
        raise ValueError(f"Apenas {len(clean)} de até 100 resultados válidos; não alterar histórico")
    return sorted(clean.values(),key=lambda r:(r["created_at"],r["id"]))

def next_retry_from_header(value, now):
    min_pause = now + timedelta(minutes=60)
    if not value:
        return min_pause
    try:
        secs = int(value)
        return max(min_pause, now + timedelta(seconds=min(secs, 86400)))
    except ValueError:
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is not None:
                return max(min_pause, min(date.astimezone(timezone.utc),now+timedelta(days=1)))
        except (ValueError, TypeError, OverflowError):
            pass
    return min_pause

def set_status(state, detail, now, pause_until=None, http=None):
    obj = {"source":"Blitz API oficial", "checked_at":iso(now),
           "state":state, "message":detail}
    if pause_until:
        obj["retry_after"] = iso(pause_until)
    if http is not None:
        obj["http_status"] = http
    previous = read_json(STATUS_FILE,{})
    # Evita mudanças de status por repetição em período de bloqueio.
    if (previous.get("state") == obj["state"] and
        previous.get("retry_after") == obj.get("retry_after") and
        previous.get("http_status") == obj.get("http_status") and
        previous.get("message") == obj.get("message")):
        return
    write_json(STATUS_FILE,obj)

def api_request(now):
    start = now - timedelta(hours=48)
    query = urlencode({"startDate":iso(start), "endDate":iso(now), "page":1})
    req = Request(API_URL + "?" + query,headers={"User-Agent":UA,"Accept":"application/json"})
    with urlopen(req,timeout=18) as resp:
        if resp.status != 200:
            raise RuntimeError("Resposta HTTP "+str(resp.status))
        return json.loads(resp.read(2_000_000).decode("utf-8"))

def permitted():
    req=Request(API_ORIGIN+"/robots.txt",headers={"User-Agent":UA})
    try:
        with urlopen(req,timeout=12) as resp:
            content=resp.read(500_000).decode("utf-8","replace")
    except HTTPError as e:
        if e.code == 404:
            return True
        raise
    robots=RobotFileParser()
    robots.parse(content.splitlines())
    return robots.can_fetch(UA,API_URL)

def run():
    now=utc_now()
    prev=read_json(STATUS_FILE,{})
    backoff=dtparse(prev.get("retry_after"))
    if backoff and now < backoff:
        print("Pausado por limite anterior até",iso(backoff))
        return
    try:
        if not permitted():
            set_status("blocked","Consulta não permitida por robots.txt",now)
            print("Fonte não permite a consulta neste momento")
            return
        raw=api_request(now)
        new=parse_records(raw,now)
        previous=read_json(FEED_FILE,{})
        previous_records = previous.get("records",[]) if isinstance(previous,dict) else []
        map_by_id={}
        for record in previous_records:
            if not isinstance(record,dict):
                continue
            # Revalidar registros anteriores, incluindo timestamps.
            id_value=record.get("id")
            if not isinstance(id_value,str) or not id_value.startswith("blitz:"):
                continue
            obj=normalize({**record,"id":id_value[len("blitz:"):]},now)
            if obj:map_by_id[obj["id"]]=obj
        old_ids=set(map_by_id)
        for record in new:
            map_by_id[record["id"]]=record
        archive=sorted(map_by_id.values(),key=lambda r:(r["created_at"],r["id"]))[-MAX_ARCHIVE:]
        last_100=sorted(new,key=lambda r:(r["created_at"],r["id"]))[-100:]
        if not archive or not last_100: raise ValueError("Lista vazia")
        payload={"source":"Blitz API oficial","source_url":API_URL,
                 "fetched_at":iso(now),"last_result_at":last_100[-1]["created_at"],
                 "latest_100":last_100,"records":archive,
                 "coverage":"1ª página de 100 resultados; coleta periódica, possíveis lacunas"}
        write_json(FEED_FILE,payload)
        set_status("ok","Consulta concluída",now)
        print("API HTTP 200: resultados da página",len(new),"novos no arquivo",sum(r["id"] not in old_ids for r in new),
              "último",last_100[-1]["created_at"])
    except HTTPError as exc:
        if exc.code == 429:
            until=next_retry_from_header(exc.headers.get("Retry-After"),now)
            set_status("rate_limited","A Blitz pediu intervalo entre consultas",now,until,429)
            print("HTTP 429: pausa programada até",iso(until))
        elif exc.code in (401,403):
            until=now+timedelta(hours=6)
            set_status("blocked","A Blitz negou acesso à API",now,until,exc.code)
            print("HTTP",exc.code,"sem novas tentativas antes de",iso(until))
        else:
            set_status("error","Erro HTTP da API",now,None,exc.code)
            print("Erro HTTP",exc.code,"histórico preservado")
    except (ValueError,RuntimeError,URLError,OSError,TimeoutError) as exc:
        set_status("error","Falha na consulta ou resposta inesperada",now)
        print("Consulta indisponível",type(exc).__name__,str(exc)[:150])

if __name__=="__main__":
    run()
