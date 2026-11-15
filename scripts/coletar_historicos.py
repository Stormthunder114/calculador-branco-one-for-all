#!/usr/bin/env python3
"""Coleta controlada da amostra pública de Double Blitz no Históricos Blaze.

Uma página pública por execução; não usa login, token de outro site,
nem ignora respostas de bloqueio. Extração somente de fatos (id, número,
cor e horário), com crédito da fonte. Falhas preservam o último arquivo.
"""
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

SOURCE_URL = "https://historicosblaze.com/results/blitz/double"
ROOT = "https://historicosblaze.com"
OUTPUT = Path("data/blitz-historico-publico.json")
UA = "OneForAllObservatorio/1.0 (+https://github.com/Stormthunder114/calculador-branco-one-for-all)"
MIN_RECORDS = 90
MAX_ARCHIVE = 5000  # Não reproduz a base integral do serviço de origem.
CUTOFF = datetime(2026, 11, 15, 4, tzinfo=timezone.utc)
PATTERN = re.compile(
    r'\{id:"([0-9a-f-]{36})",platform_id:"[0-9a-f-]{36}",'
    r'type:"double",number:(\d{1,2}),color:"(white|red|black)"'
    r'[^{}]{0,400}?created_at:"([^"]+)"', re.IGNORECASE
)
COLORS = {"white": 0, "red": 1, "black": 2}

def parse_records(page):
    """Leia somente resultados estruturados embutidos no HTML público."""
    parsed = {}
    for match in PATTERN.finditer(page):
        id_value, number_text, color, timestamp = match.groups()
        number = int(number_text)
        color_value = COLORS[color.lower()]
        if (number == 0 and color_value != 0 or
            1 <= number <= 7 and color_value != 1 or
            8 <= number <= 14 and color_value != 2 or
            number not in range(15)):
            continue
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                continue
            dt = dt.astimezone(timezone.utc)
        except ValueError:
            continue
        if dt < CUTOFF or dt.timestamp() > time.time() + 120:
            continue
        key = "hb:" + id_value.lower()
        parsed[key] = {
            "id": key,
            "created_at": dt.isoformat(timespec="milliseconds").replace("+00:00","Z"),
            "roll": number,
            "color": color_value,
        }
    return sorted(parsed.values(), key=lambda x: (x["created_at"], x["id"]))

def request_once(url):
    req = Request(url, headers={"User-Agent": UA, "Accept": "text/html,text/plain"})
    with urlopen(req, timeout=18) as response:
        if response.status != 200:
            raise RuntimeError(f"Fonte respondeu HTTP {response.status}")
        return response.read(3_000_000).decode("utf-8", "replace")

def robots_allows():
    robot_text = request_once(ROOT + "/robots.txt")
    robots = RobotFileParser()
    robots.parse(robot_text.splitlines())
    return robots.can_fetch(UA, SOURCE_URL)

def old_records():
    if not OUTPUT.exists():
        return []
    try:
        saved = json.loads(OUTPUT.read_text(encoding="utf-8"))
        return saved.get("records", []) if isinstance(saved, dict) else []
    except (ValueError, OSError):
        return []

def main():
    # Verifica limites do publicador antes da coleta.
    if not robots_allows():
        print("Históricos Blaze não permite esta coleta segundo robots.txt. Nenhum dado alterado.")
        return 0
    page = request_once(SOURCE_URL)
    recent = parse_records(page)
    print(f"Registros públicos com data completa: {len(recent)}")
    if len(recent) < MIN_RECORDS:
        print("Formato mudou ou a amostra está incompleta. Mantendo histórico anterior.")
        return 0
    saved = {
        str(rec["id"]): rec
        for rec in old_records()
        if isinstance(rec,dict) and "id" in rec
    }
    old_ids = set(saved)
    for item in recent:
        saved[item["id"]] = item
    merged = sorted(saved.values(), key=lambda x: (x["created_at"], x["id"]))[-MAX_ARCHIVE:]
    new_size = sum(1 for x in recent if x["id"] not in old_ids)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")
    result = {
        "source": "Históricos Blaze",
        "source_url": SOURCE_URL,
        "fetched_at": now,
        "coverage": "Amostras públicas periódicas; pode haver atrasos e lacunas",
        "records": merged,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    print(f"Salvos {len(merged)} resultados; {new_size} novos; último em {merged[-1]['created_at'] if merged else '-'}")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except HTTPError as exc:
        print(f"Coleta interrompida: servidor respondeu HTTP {exc.code}; nenhuma tentativa de contornar a restrição.")
        sys.exit(0) if exc.code in (403, 429, 401) else sys.exit(1)
    except (URLError, OSError, TimeoutError, RuntimeError) as exc:
        print(f"Fonte indisponível: {type(exc).__name__}; arquivo anterior preservado.")
        sys.exit(1)
