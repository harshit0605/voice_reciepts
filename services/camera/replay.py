"""Replay tracks or local video. Never sends footage or audio to cloud AI."""
import argparse
import json
import os
import sqlite3
import time
import uuid
import urllib.request
from pathlib import Path
from sessionizer import Sessionizer, Zone, iso

class Spool:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute('CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, body TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0)')
    def add(self, observation):
        command = {'id': observation['id'], 'occurredAt': iso(time.time()), 'operation': {'type': 'camera.observe', 'observation': observation}}
        self.db.execute('INSERT OR IGNORE INTO events VALUES(?,?,0)', (command['id'], json.dumps(command)))
        self.db.commit()
    def gap(self, source, detail):
        cmd = {'id': str(uuid.uuid4()), 'occurredAt': iso(time.time()), 'operation': {'type': 'coverage.gap', 'source': source, 'detail': detail}}
        self.db.execute('INSERT INTO events VALUES(?,?,0)', (cmd['id'], json.dumps(cmd)))
        self.db.commit()
    def flush(self, gateway, token):
        if not gateway:
            return
        for event_id, body in self.db.execute('SELECT id,body FROM events WHERE sent=0').fetchall():
            try:
                parsed = json.loads(body)
                clip_id = parsed.get('operation', {}).get('observation', {}).get('clipId')
                if clip_id:
                    from clips import register
                    if not register(gateway, token, clip_id):
                        break
                request = urllib.request.Request(gateway+'/camera/events', body.encode(), {'Content-Type':'application/json','X-Gateway-Token':token})
                with urllib.request.urlopen(request, timeout=5) as response:
                    if response.status >= 300:
                        break
                self.db.execute('UPDATE events SET sent=1 WHERE id=?', (event_id,))
                self.db.commit()
            except Exception:
                break

def main():
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--tracks', help='JSONL: {timestamp: unix_seconds, tracks:[{id,box:[normalised xyxy]}]}')
    source.add_argument('--video', help='Operator-provided local video file or authorised RTSP URL')
    parser.add_argument('--clips', default='.data/gateway/clips', help='Shared local gateway clip directory')
    parser.add_argument('--model', help='YOLOX ONNX weights; required for video')
    parser.add_argument('--decoded', action='store_true')
    parser.add_argument('--zones', required=True)
    parser.add_argument('--camera', default='camera-1')
    parser.add_argument('--start', type=float, help='Recording start timestamp; mandatory for historical video')
    parser.add_argument('--spool', default='.data/camera/events.sqlite')
    parser.add_argument('--gateway', default='')
    parser.add_argument('--output', required=True, help='Local JSONL observations')
    args = parser.parse_args()
    zones = [Zone(**z) for z in json.loads(Path(args.zones).read_text())]
    tracker = Sessionizer(args.camera, zones)
    spool = Spool(args.spool)
    token = os.environ.get('GATEWAY_TOKEN', '')
    output = open(args.output, 'a')
    clips = None
    def emit(events):
        for event in events:
            if clips:
                clip_id = clips.save(event)
                if clip_id:
                    event['clipId'] = clip_id
            output.write(json.dumps(event)+'\n'); output.flush(); spool.add(event)
        spool.flush(args.gateway, token)
    last = time.time()
    if args.tracks:
        with open(args.tracks) as file:
            for row in file:
                data = json.loads(row); last = data['timestamp']; emit(tracker.feed(last, data['tracks']))
    else:
        if not args.model:
            parser.error('--video requires --model')
        if not args.video.startswith('rtsp') and args.start is None:
            parser.error('Historical video requires --start to align with billing timestamps')
        import cv2
        from detector import Detector
        video = cv2.VideoCapture(args.video)
        if not video.isOpened():
            spool.gap(args.camera, 'Video source unavailable; no interaction coverage')
            spool.flush(args.gateway, token)
            raise RuntimeError('Video source unavailable; record a coverage gap, not an empty shop')
        fps = video.get(cv2.CAP_PROP_FPS) or 25
        skip = max(1, int(fps / 5)); detector = Detector(args.model, decoded=args.decoded)
        from clips import Clips
        clips = Clips(args.clips)
        frame_number = 0
        while True:
            ok, frame = video.read()
            if not ok:
                if args.video.startswith('rtsp'):
                    spool.gap(args.camera, 'Live stream disconnected; coverage stopped')
                    spool.flush(args.gateway, token)
                break
            frame_number += 1
            if frame_number % skip:
                continue
            last = (args.start + frame_number/fps) if args.start else time.time()
            clips.feed(last, frame)
            emit(tracker.feed(last, detector.tracks(frame)))
        video.release()
    emit(tracker.expire(last, force=True)); output.close()

if __name__ == '__main__':
    main()
