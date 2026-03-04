from __future__ import annotations

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForImageSegmentation


class BiRefNetSegmenter:
    def __init__(self, model_id: str, revision: str | None = None):
        self.model_id = model_id
        self.revision = revision
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = self._load_processor(model_id, revision)
        self.model = AutoModelForImageSegmentation.from_pretrained(
            model_id,
            trust_remote_code=True,
            revision=revision,
        )
        self.model.to(self.device)
        self.model.eval()

    @staticmethod
    def _load_processor(model_id: str, revision: str | None):
        try:
            return AutoImageProcessor.from_pretrained(
                model_id,
                trust_remote_code=True,
                revision=revision,
            )
        except Exception:
            return None

    @staticmethod
    def _manual_pixel_values(image: Image.Image) -> torch.Tensor:
        arr = np.asarray(image, dtype=np.float32) / 255.0  # [H, W, C], RGB in [0,1]
        if arr.ndim != 3 or arr.shape[2] != 3:
            raise RuntimeError("Expected RGB image tensor with 3 channels.")

        x = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)  # [1, 3, H, W]

        # Match typical segmentation backbone normalization.
        mean = torch.tensor([0.485, 0.456, 0.406], dtype=x.dtype).view(1, 3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225], dtype=x.dtype).view(1, 3, 1, 1)
        x = (x - mean) / std

        _, _, h, w = x.shape
        max_side = max(h, w)
        if max_side != 1024:
            scale = 1024.0 / float(max_side)
            nh = max(32, int(round(h * scale)))
            nw = max(32, int(round(w * scale)))
            x = torch.nn.functional.interpolate(
                x, size=(nh, nw), mode="bilinear", align_corners=False
            )

        return x

    @staticmethod
    def _extract_logits(outputs) -> torch.Tensor:
        if hasattr(outputs, "logits"):
            return outputs.logits

        if isinstance(outputs, dict):
            for key in ("logits", "pred", "preds", "masks"):
                if key in outputs:
                    return outputs[key]

        if isinstance(outputs, (tuple, list)) and outputs:
            return outputs[0]

        raise RuntimeError("Could not extract segmentation logits from model output.")

    def predict_mask(self, image: Image.Image) -> np.ndarray:
        orig_h, orig_w = image.height, image.width
        if self.processor is not None:
            inputs = self.processor(images=image, return_tensors="pt")
            inputs = {
                k: (v.to(self.device) if hasattr(v, "to") else v)
                for k, v in inputs.items()
            }
        else:
            inputs = {"pixel_values": self._manual_pixel_values(image).to(self.device)}

        with torch.no_grad():
            try:
                outputs = self.model(**inputs)
            except TypeError as exc:
                if "pixel_values" not in str(exc):
                    raise
                pixel_values = inputs.get("pixel_values")
                if pixel_values is None:
                    raise RuntimeError("Model rejected kwargs and pixel_values tensor was missing.") from exc
                try:
                    outputs = self.model(pixel_values)
                except TypeError:
                    outputs = self.model(x=pixel_values)

        logits = self._extract_logits(outputs)

        if logits.ndim == 4:
            # [B, C, H, W] -> first channel foreground mask
            logits = logits[:, 0, :, :]
        elif logits.ndim == 3:
            # [B, H, W]
            pass
        else:
            raise RuntimeError(f"Unexpected logits shape: {tuple(logits.shape)}")

        probs = torch.sigmoid(logits).unsqueeze(1)  # [B, 1, H, W]
        probs = torch.nn.functional.interpolate(
            probs,
            size=(orig_h, orig_w),
            mode="bilinear",
            align_corners=False,
        )

        mask = probs[0, 0].detach().float().cpu().numpy()
        return np.clip(mask, 0.0, 1.0)
