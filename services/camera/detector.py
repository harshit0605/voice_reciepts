"""YOLOX ONNX inference followed by ByteTrack. Weights are provided by the operator."""
import cv2
import numpy as np
import onnxruntime as ort
import supervision as sv

class Detector:
    def __init__(self, model_path, fps=5, decoded=False):
        self.session = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
        self.input = self.session.get_inputs()[0]
        self.size = int(self.input.shape[-1])
        self.decoded = decoded
        self.tracker = sv.ByteTrack(frame_rate=fps, track_activation_threshold=0.35)

    def tracks(self, frame):
        height, width = frame.shape[:2]
        ratio = min(self.size / height, self.size / width)
        resized = cv2.resize(frame, (int(width*ratio), int(height*ratio)))
        image = np.full((self.size, self.size, 3), 114, dtype=np.uint8)
        image[:resized.shape[0], :resized.shape[1]] = resized
        tensor = np.ascontiguousarray(image.transpose(2, 0, 1), dtype=np.float32)[None]
        output = self.session.run(None, {self.input.name: tensor})[0][0]
        if not self.decoded:
            grids, strides = [], []
            for stride in (8, 16, 32):
                y, x = np.meshgrid(np.arange(self.size//stride), np.arange(self.size//stride), indexing='ij')
                grids.append(np.stack((x, y), -1).reshape(-1, 2))
                strides.append(np.full((x.size, 1), stride))
            grid, stride = np.concatenate(grids), np.concatenate(strides)
            if output.shape[0] != grid.shape[0]:
                raise ValueError('YOLOX output shape mismatch; verify export settings')
            output[:, :2] = (output[:, :2] + grid) * stride
            output[:, 2:4] = np.exp(output[:, 2:4]) * stride
        scores = output[:, 4] * output[:, 5]  # COCO class 0 = person
        selected = scores >= 0.15
        xywh = output[selected, :4] / ratio
        boxes = np.column_stack((xywh[:, :2]-xywh[:, 2:]/2, xywh[:, :2]+xywh[:, 2:]/2))
        detections = sv.Detections(xyxy=boxes, confidence=scores[selected], class_id=np.zeros(len(boxes), dtype=int)).with_nms(threshold=0.5)
        tracked = self.tracker.update_with_detections(detections)
        if tracked.tracker_id is None:
            return []
        return [{'id': int(i), 'box': (b/np.array([width,height,width,height])).tolist()} for b, i in zip(tracked.xyxy, tracked.tracker_id)]
