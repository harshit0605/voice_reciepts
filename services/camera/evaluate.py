"""Compare labelled intervals with generated service sessions; no theft accuracy claims."""
import argparse,json
from datetime import datetime

def seconds(value): return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
def evaluate(truth,predictions):
    matched=set(); true_positive=0
    for event in truth:
        options=[]
        for i,pred in enumerate(predictions):
            if i in matched or pred['counterId']!=event['counterId']: continue
            overlap=max(0,min(seconds(pred['endedAt']),seconds(event['endedAt']))-max(seconds(pred['startedAt']),seconds(event['startedAt'])))
            duration=max(1,seconds(event['endedAt'])-seconds(event['startedAt']))
            if overlap/duration>=0.5:options.append((overlap,i))
        if options:
            _,index=max(options);matched.add(index);true_positive+=1
    return {'labelled':len(truth),'detected':len(predictions),'matched':true_positive,'missed':len(truth)-true_positive,'extra':len(predictions)-true_positive,'precision':true_positive/max(1,len(predictions)),'recall':true_positive/max(1,len(truth))}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--truth',required=True);p.add_argument('--predictions',required=True);args=p.parse_args()
    print(json.dumps(evaluate([json.loads(x) for x in open(args.truth)],[json.loads(x) for x in open(args.predictions)]),indent=2))
