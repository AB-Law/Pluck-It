import io
import json
import logging
import os
import urllib.request
import urllib.error
import uuid
from typing import Any, Dict

import azure.functions as func
from azure.storage.blob import BlobClient, BlobServiceClient
from azure.cosmos import CosmosClient, PartitionKey
from PIL import Image


app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)


def _get_env(name: str, default: str | None = None) -> str:
  value = os.getenv(name, default)
  if value is None:
    raise RuntimeError(f"Missing required environment variable: {name}")
  return value


def _remove_background(image_bytes: bytes) -> bytes:
  """
  Calls Azure Computer Vision 4.0 imageanalysis:segment (backgroundRemoval mode).
  Returns a PNG with transparent background.
  """
  endpoint = _get_env("VISION_ENDPOINT").rstrip("/")
  key = _get_env("VISION_API_KEY")
  url = f"{endpoint}/computervision/imageanalysis:segment?api-version=2023-02-01-preview&mode=backgroundRemoval"

  req = urllib.request.Request(
    url,
    data=image_bytes,
    headers={
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/octet-stream",
    },
    method="POST",
  )
  with urllib.request.urlopen(req) as resp:
    return resp.read()


def _get_blob_service() -> BlobServiceClient:
  account_name = _get_env("STORAGE_ACCOUNT_NAME")
  account_key = _get_env("STORAGE_ACCOUNT_KEY")
  connection_string = (
    f"DefaultEndpointsProtocol=https;"
    f"AccountName={account_name};"
    f"AccountKey={account_key};"
    f"EndpointSuffix=core.windows.net"
  )
  return BlobServiceClient.from_connection_string(connection_string)


def _get_cosmos_container():
  endpoint = _get_env("COSMOS_DB_ENDPOINT")
  key = _get_env("COSMOS_DB_KEY")
  database_name = _get_env("COSMOS_DB_DATABASE")
  container_name = _get_env("COSMOS_DB_CONTAINER")

  client = CosmosClient(endpoint, key)
  database = client.create_database_if_not_exists(database_name)
  container = database.create_container_if_not_exists(
    id=container_name,
    partition_key=PartitionKey(path="/id"),
  )
  return container


def _infer_basic_tags(image: Image.Image) -> Dict[str, Any]:
  """
  Very simple heuristic tags: dominant color and a generic category placeholder.
  You can replace this later with a GPT-4o or Florence call for richer tags.
  """
  small = image.resize((32, 32))
  result = small.convert("P", palette=Image.ADAPTIVE, colors=4)
  palette = result.getpalette()
  color_counts = sorted(result.getcolors(), reverse=True)
  if not color_counts:
    return {"color": "unknown", "category": "unknown"}

  dominant_color_index = color_counts[0][1]
  palette_index = dominant_color_index * 3
  r = palette[palette_index]
  g = palette[palette_index + 1]
  b = palette[palette_index + 2]

  color_hex = f"#{r:02x}{g:02x}{b:02x}"

  return {
    "color": color_hex,
    "category": "unknown",
  }


@app.function_name(name="PluckItBlobProcessor")
@app.blob_trigger(
  arg_name="input_blob",
  path="%UPLOADS_CONTAINER_NAME%/{name}",
  connection="AzureWebJobsStorage",
)
def pluck_it_blob_processor(input_blob: func.InputStream) -> None:
  logging.info(
    "PluckItBlobProcessor: Processing blob %s (%d bytes)",
    input_blob.name,
    input_blob.length,
  )

  blob_bytes = input_blob.read()

  # Use Azure Computer Vision 4.0 Segment API for background removal.
  try:
    transparent_png = _remove_background(blob_bytes)
  except urllib.error.HTTPError as ex:
    logging.exception("Vision API error removing background: %s %s", ex.code, ex.reason)
    return
  except Exception as ex:
    logging.exception("Error removing background: %s", ex)
    return

  # Upload transparent PNG to archive container.
  archive_container_name = _get_env("ARCHIVE_CONTAINER_NAME")
  storage_account_name = _get_env("STORAGE_ACCOUNT_NAME")
  blob_service = _get_blob_service()

  # Derive output blob name from input (e.g. "item.png" -> "item-transparent.png").
  original_name = input_blob.name.split("/")[-1]
  if "." in original_name:
    base, _ext = original_name.rsplit(".", 1)
  else:
    base = original_name
  output_blob_name = f"{base}-transparent.png"

  archive_blob: BlobClient = blob_service.get_blob_client(
    container=archive_container_name,
    blob=output_blob_name,
  )
  archive_blob.upload_blob(transparent_png, overwrite=True, content_type="image/png")

  archive_url = archive_blob.url

  # Very basic tags from the transparent image.
  try:
    img = Image.open(io.BytesIO(transparent_png))
    tags = _infer_basic_tags(img)
  except Exception:
    logging.exception("Failed to infer basic tags; defaulting.")
    tags = {"color": "unknown", "category": "unknown"}

  # Upsert ClothingItem into Cosmos DB.
  container = _get_cosmos_container()
  item_id = base
  clothing_item = {
    "id": item_id,
    "imageUrl": archive_url,
    "tags": [tags.get("color"), tags.get("category")],
    "brand": None,
    "category": tags.get("category"),
    "dateAdded": input_blob.properties.get("last_modified").isoformat()
    if hasattr(input_blob, "properties") and input_blob.properties.get("last_modified")
    else None,
  }

  container.upsert_item(clothing_item)
  logging.info(
    "PluckItBlobProcessor: Wrote ClothingItem %s to Cosmos with imageUrl=%s",
    item_id,
    archive_url,
  )


@app.function_name(name="PluckItProcessImage")
@app.route(route="process-image", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def pluck_it_process_image(req: func.HttpRequest) -> func.HttpResponse:
  """
  HTTP POST /api/process-image
  Accepts an image as multipart/form-data (field "image") or raw bytes in the body.
  Removes the background via Azure Computer Vision, archives the result, and upserts a ClothingItem in Cosmos.
  Returns: JSON with the ClothingItem.
  """
  logging.info("PluckItProcessImage: received request")

  # Try multipart first, then fall back to raw body.
  image_bytes: bytes | None = None
  filename: str = f"{uuid.uuid4()}.png"

  if req.files and "image" in req.files:
    file = req.files["image"]
    image_bytes = file.read()
    filename = file.filename or filename
  elif req.get_body():
    image_bytes = req.get_body()
  
  if not image_bytes:
    return func.HttpResponse("No image provided. Send a multipart/form-data request with an 'image' field, or a raw image body.", status_code=400)

  # Remove background via Azure Computer Vision 4.0 Segment API.
  try:
    transparent_png = _remove_background(image_bytes)
  except urllib.error.HTTPError as ex:
    body = ex.read().decode(errors="replace")
    logging.exception("Vision API returned %s: %s", ex.code, body)
    return func.HttpResponse(f"Background removal failed: {ex.code} {ex.reason}", status_code=500)
  except Exception as ex:
    logging.exception("Error removing background: %s", ex)
    return func.HttpResponse(f"Failed to process image: {ex}", status_code=500)

  # Derive item ID from filename.
  base = filename.rsplit(".", 1)[0] if "." in filename else filename
  item_id = f"{base}-{uuid.uuid4().hex[:8]}"
  output_blob_name = f"{item_id}-transparent.png"

  # Upload to archive container.
  try:
    blob_service = _get_blob_service()
    archive_container_name = _get_env("ARCHIVE_CONTAINER_NAME")
    archive_blob: BlobClient = blob_service.get_blob_client(
      container=archive_container_name,
      blob=output_blob_name,
    )
    archive_blob.upload_blob(transparent_png, overwrite=True, content_type="image/png")
    archive_url = archive_blob.url
  except Exception as ex:
    logging.exception("Error uploading to blob storage: %s", ex)
    return func.HttpResponse(f"Failed to upload processed image: {ex}", status_code=500)

  logging.info("PluckItProcessImage: processed image %s, blob at %s", item_id, archive_url)
  return func.HttpResponse(
    json.dumps({"id": item_id, "imageUrl": archive_url}),
    status_code=201,
    mimetype="application/json",
  )

