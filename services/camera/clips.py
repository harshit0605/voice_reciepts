"""Bounded, silent, local review clips. No raw audio or video leaves the shop."""
from collections import deque
from datetime import datetime
from pathlib import Path
import json
import urllib.request

class Clips:
    def __init__(self, directory, fps=5):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.frames = deque(maxlen=60*fps)
        self.fps = fps
    def feed(self, at, frame):
        import cv2
        h, w = frame.shape[:2]
        self.frames.append((at, cv2.resize(frame, (640, int(h*640/w)//2*2))))
    def save(self, observation):
        import cv2
        start = datetime.fromisoformat(observation['startedAt'].replace('Z', '+00:00')).timestamp()
        end = datetime.fromisoformat(observation['endedAt'].replace('Z', '+00:00')).timestamp()
        frames = [f for at, f in self.frames if max(start-2, end-20) <= at <= end+2]
        if not frames:
            return None
        filename = self.directory/(observation['id']+'.mp4')
        h, w = frames[0].shape[:2]
        writer = cv2.VideoWriter(str(filename), cv2.VideoWriter_fourcc(*'mp4v'), self.fps, (w, h))
        if not writer.isOpened():
            return None
        for frame in frames:
            writer.write(frame)
        writer.release()
        filename.chmod(0o600)
        return observation['id']

def register(gateway, token, clip_id):
    if not gateway or not clip_id:
        return False
    req = urllib.request.Request(gateway+'/camera/clips', json.dumps({'id':clip_id}).encode(), {'Content-Type':'application/json','X-Gateway-Token':token})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status < 300
    except Exception:
        return False
