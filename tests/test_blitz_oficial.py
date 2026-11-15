import importlib.util
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path

spec = importlib.util.spec_from_file_location("blitz_api",Path("scripts/coletar_blitz_oficial.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class TestBlitzOfficial(unittest.TestCase):
    NOW = datetime(2026,11,15,6,tzinfo=timezone.utc)
    def item(self,id,roll,color,created=None):
        return {"id":id,"roll":roll,"color":color,
                "created_at":created or "2026-11-15T05:31:05.456Z"}
    def test_colours_and_numbers(self):
        self.assertEqual(mod.normalize(self.item(1,0,0),self.NOW)["color"],0)
        self.assertEqual(mod.normalize(self.item(2,5,1),self.NOW)["color"],1)
        self.assertEqual(mod.normalize(self.item(3,12,2),self.NOW)["color"],2)
        self.assertIsNone(mod.normalize(self.item(1,3,2),self.NOW))
        self.assertIsNone(mod.normalize(self.item(1,0,1),self.NOW))
        self.assertIsNone(mod.normalize(self.item(1,13,1),self.NOW))
    def test_datetime_validity(self):
        self.assertIsNone(mod.normalize(self.item(1,0,0,"2026-11-15T09:30:00Z"),self.NOW))
        self.assertIsNone(mod.normalize(self.item(1,0,0,"2026-11-14T22:00:00Z"),self.NOW))
        self.assertIsNone(mod.normalize(self.item(1,0,0,"invalid"),self.NOW))
    def test_100_results_are_parsed_and_sorted(self):
        r={"records":[self.item(i, i%15, 0 if i%15==0 else 1 if i%15<=7 else 2,
            (self.NOW - timedelta(seconds=i*30)).isoformat().replace("+00:00","Z")) for i in range(100)]}
        clean=mod.parse_records(r,self.NOW)
        self.assertEqual(len(clean),100)
        self.assertLess(clean[0]["created_at"],clean[-1]["created_at"])
        self.assertTrue(all(r["id"].startswith("blitz:") for r in clean))
    def test_incomplete_payload_fails_closed(self):
        with self.assertRaises(ValueError):
            mod.parse_records({"records":[self.item(1,0,0)]},self.NOW)
    def test_429_backoff(self):
        self.assertGreaterEqual((mod.next_retry_from_header("600",self.NOW)-self.NOW).total_seconds(),3600)
        self.assertGreaterEqual((mod.next_retry_from_header("7200",self.NOW)-self.NOW).total_seconds(),7200)
    def test_ignores_server_seed(self):
        r=self.item(5,1,1);r["server_seed"]="sensitive"
        clean=mod.normalize(r,self.NOW)
        self.assertNotIn("server_seed",clean)

if __name__=="__main__":
    unittest.main()
