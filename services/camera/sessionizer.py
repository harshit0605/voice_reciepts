"""Anonymous counter interactions, without purchase or employee-identity claims."""
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256

@dataclass
class Zone:
    id: str
    polygon: list[list[float]]

def inside(x, y, polygon):
    result = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            result = not result
        j = i
    return result

def iso(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

class Sessionizer:
    def __init__(self, camera_id, zones, dwell_seconds=3.0, lost_seconds=5.0):
        self.camera_id = camera_id
        self.zones = zones
        self.dwell = dwell_seconds
        self.lost = lost_seconds
        self.active = {}

    def feed(self, timestamp, tracks):
        for track in tracks:
            # Normalised foot point; zones mark customer standing areas, not staff areas.
            x1, y1, x2, y2 = track['box']
            for zone in self.zones:
                if inside((x1+x2)/2, y2, zone.polygon):
                    key = (zone.id, str(track['id']))
                    entry = self.active.setdefault(key, {'start': timestamp, 'last': timestamp})
                    entry['last'] = timestamp
        return self.expire(timestamp)

    def expire(self, timestamp, force=False):
        events = []
        for key, entry in list(self.active.items()):
            if force or timestamp - entry['last'] >= self.lost:
                del self.active[key]
                if entry['last'] - entry['start'] < self.dwell:
                    continue
                counter, track = key
                event_id = sha256(f'{self.camera_id}:{counter}:{track}:{entry["start"]}'.encode()).hexdigest()[:32]
                events.append({'id': event_id, 'counterId': counter,
                               'trackId': f'{self.camera_id}:{track}',
                               'startedAt': iso(entry['start']), 'endedAt': iso(entry['last']),
                               'visible': True})
        return events
