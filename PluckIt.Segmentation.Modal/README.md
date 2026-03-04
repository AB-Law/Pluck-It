# PluckIt Segmentation on Modal (Phase 1)

Serverless clothing/accessory segmentation service using BiRefNet on Modal.

## Cost defaults

The service is intentionally configured for minimum spend:

- GPU: `T4`
- No explicit `region` or `cloud` pinning (lowest-cost default routing)
- `allow_concurrent_inputs=1` (single in-flight request per warm container)
- `scaledown_window=120s` to reduce idle warm billing
- Persistent Volume-backed Hugging Face cache to avoid repeated model downloads

## Folder structure

- `modal_app.py` — Modal entrypoint + HTTP endpoint (`POST /segment`)
- `inference.py` — BiRefNet loading and mask inference
- `preprocess.py` — image decoding and normalization
- `postprocess.py` — alpha compositing and PNG output
- `tests/` — lightweight unit tests
- `scripts/bench.py` — latency benchmark helper

## Environment variables

Use `.env.example` as template.

- `SEGMENTATION_SHARED_TOKEN` (required)
- `BIREFNET_MODEL_ID` (default: `ZhengPeng7/BiRefNet`)
- `MAX_IMAGE_MB` (default: `10`)
- `MASK_THRESHOLD` (default: `0.5`)
- `SCALEDOWN_WINDOW_SECONDS` (default: `120`)
- `MODEL_CACHE_VOLUME_NAME` (default: `pluckit-birefnet-cache`)
- `MODEL_CACHE_DIR` (default: `/cache`)
- `SEGMENTATION_SECRET_NAME` (default: `pluckit-segmentation`)

## Deploy

```bash
cd PluckIt.Segmentation.Modal
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Authenticate once
modal token new

# Create/update secret used by the endpoint auth check
modal secret create pluckit-segmentation \
  SEGMENTATION_SHARED_TOKEN="$(openssl rand -hex 32)"

# Deploy endpoint
modal deploy modal_app.py
```

Modal will print a public URL for the `segment` web endpoint.

## API contract

### `POST /segment`

Auth header:

```text
Authorization: Bearer <SEGMENTATION_SHARED_TOKEN>
```

Request body:

- `multipart/form-data` with file field `image`, or
- raw image bytes with `Content-Type: image/*`

Response:

- `200 image/png` (transparent background PNG)
- headers:
  - `X-Model`
  - `X-Process-Ms`

## Example request

```bash
curl -X POST "https://<modal-endpoint>/segment" \
  -H "Authorization: Bearer $SEGMENTATION_SHARED_TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@/path/to/input.jpg" \
  --output segmented.png
```

## Run tests

```bash
cd PluckIt.Segmentation.Modal
pytest -q
```

## True local test (no Modal)

Run segmentation directly on your machine (CPU/GPU depending on local PyTorch):

```bash
cd PluckIt.Segmentation.Modal
python local_test.py \
  --input /path/to/input.jpg \
  --output /path/to/segmented.png
```

Optional flags:

- `--model-id` (default `ZhengPeng7/BiRefNet`)
- `--threshold` (default `0.5`)
- `--blur-radius` (default `1.0`)

The requirements include BiRefNet runtime deps (`timm`, `einops`, `kornia`) so local and Modal runs use the same dependency set.

## Benchmark

```bash
cd PluckIt.Segmentation.Modal
python scripts/bench.py \
  --endpoint "https://<modal-endpoint>/segment" \
  --token "$SEGMENTATION_SHARED_TOKEN" \
  --image /path/to/input.jpg \
  --warmups 1 \
  --runs 10
```
