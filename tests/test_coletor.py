import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("coletor", Path("scripts/coletar_historicos.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TestPublicHistory(unittest.TestCase):
    def record(self, uuid, number, color, date="2026-11-15T04:50:30.027+00:00"):
        return f'{{id:"{uuid}",platform_id:"22222222-2222-2222-2222-222222222222",type:"double",number:{number},color:"{color}",parity:"even",hour:1,minute:50,first_minute:5,last_minute:0,financial:null,classes:null,created_at:"{date}",updated_at:"{date}"}}'

    def test_whites_reds_blacks_have_correct_normalized_colors(self):
        html = "".join([
            self.record("11111111-1111-1111-1111-111111111111", 0, "white"),
            self.record("33333333-3333-3333-3333-333333333333", 5, "red"),
            self.record("44444444-4444-4444-4444-444444444444", 12, "black")
        ])
        result=module.parse_records(html)
        self.assertEqual(len(result),3)
        self.assertEqual([x["color"] for x in result],[0,1,2])
        self.assertTrue(all(x["created_at"].endswith("Z") for x in result))

    def test_mismatch_color_number_rejected(self):
        html = self.record("11111111-1111-1111-1111-111111111111", 12, "red")
        self.assertEqual(module.parse_records(html),[])

    def test_duplicate_identifier_is_deduplicated(self):
        row=self.record("11111111-1111-1111-1111-111111111111", 0, "white")
        self.assertEqual(len(module.parse_records(row+row)),1)

    def test_non_double_and_missing_timestamp_ignored(self):
        row=self.record("11111111-1111-1111-1111-111111111111", 0, "white")
        self.assertEqual(module.parse_records(row.replace('type:"double"', 'type:"crash"')),[])
        self.assertEqual(module.parse_records(row.replace("created_at", "random_at")),[])

if __name__=="__main__":
    unittest.main()
