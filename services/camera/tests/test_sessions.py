import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sessionizer import Sessionizer,Zone,inside
from evaluate import evaluate
class Sessions(unittest.TestCase):
    def test_dwell_and_grace(self):
        s=Sessionizer('cam',[Zone('counter-1',[[0,0],[1,0],[1,1],[0,1]])])
        track={'id':1,'box':[.1,.1,.5,.8]}
        self.assertEqual(s.feed(0,[track]),[])
        self.assertEqual(s.feed(4,[track]),[])
        self.assertEqual(s.feed(8,[]),[])
        result=s.feed(10,[])
        self.assertEqual(len(result),1)
        self.assertNotIn('employeeId',result[0])
        self.assertNotIn('sale',result[0])
    def test_short_visit_ignored(self):
        s=Sessionizer('cam',[Zone('c',[[0,0],[1,0],[1,1],[0,1]])])
        s.feed(0,[{'id':1,'box':[0,0,.2,.2]}]);self.assertEqual(s.feed(9,[]),[])
    def test_outside_zone(self):
        self.assertFalse(inside(2,2,[[0,0],[1,0],[1,1],[0,1]]))
    def test_evaluation_does_not_reuse_prediction(self):
        e={'counterId':'c','startedAt':'2026-09-23T10:00:00Z','endedAt':'2026-09-23T10:00:10Z'}
        result=evaluate([e,e],[e]);self.assertEqual(result['matched'],1);self.assertEqual(result['missed'],1)
if __name__=='__main__':unittest.main()
