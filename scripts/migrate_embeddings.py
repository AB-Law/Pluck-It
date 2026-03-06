import asyncio
import base64
import json
import logging
import os
import sys
import httpx
from urllib.parse import urlparse

from azure.cosmos.aio import CosmosClient
from azure.storage.blob.aio import BlobServiceClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

async def load_config() -> dict:
    processor_dir = os.path.join(os.path.dirname(__file__), "..", "PluckIt.Processor")
    settings_path = os.path.join(processor_dir, "local.settings.json")
    
    config = {}
    if os.path.exists(settings_path):
        with open(settings_path, "r") as f:
            data = json.load(f)
            config.update(data.get("Values", {}))
    
    # Also override with env vars if present
    for k, v in os.environ.items():
        config[k] = v
        
    return config

def get_blob_details(image_url: str):
    parsed = urlparse(image_url)
    path_parts = parsed.path.lstrip("/").split("/")
    if len(path_parts) >= 2:
        return path_parts[0], "/".join(path_parts[1:])
    return None, None

async def main():
    config = await load_config()

    cosmos_endpoint = config.get("COSMOS_DB_ENDPOINT")
    cosmos_key = config.get("COSMOS_DB_KEY")
    cosmos_db = config.get("COSMOS_DB_DATABASE", "PluckIt")
    cosmos_container = config.get("COSMOS_DB_CONTAINER", "Wardrobe")
    
    storage_account = config.get("STORAGE_ACCOUNT_NAME")
    storage_key = config.get("STORAGE_ACCOUNT_KEY")
    
    cohere_endpoint = config.get("COHERE_ENDPOINT") or config.get("Cohere__Endpoint")
    cohere_key = config.get("COHERE_API_KEY") or config.get("Cohere__ApiKey")

    if not all([cosmos_endpoint, cosmos_key, storage_account, storage_key, cohere_endpoint, cohere_key]):
        logger.error("Missing required configuration (Cosmos, Storage, or Cohere).")
        logger.error("Make sure COHERE_ENDPOINT and COHERE_API_KEY are set in your env or local.settings.json.")
        sys.exit(1)

    blob_conn_str = f"DefaultEndpointsProtocol=https;AccountName={storage_account};AccountKey={storage_key};EndpointSuffix=core.windows.net"

    async with CosmosClient(cosmos_endpoint, credential=cosmos_key) as cosmos_client, \
               BlobServiceClient.from_connection_string(blob_conn_str) as blob_service:

        db = cosmos_client.get_database_client(cosmos_db)
        container = db.get_container_client(cosmos_container)

        query = """
            SELECT * FROM c 
            WHERE NOT IS_DEFINED(c.imageEmbedding) 
               OR IS_NULL(c.imageEmbedding)
        """
        
        items_to_process = []
        async for item in container.query_items(query=query):
            # Only process finalised items or items with an image URL
            if item.get("imageUrl"):
                items_to_process.append(item)

        logger.info(f"Found {len(items_to_process)} items missing image embeddings.")

        async with httpx.AsyncClient() as http_client:
            for item in items_to_process:
                item_id = item["id"]
                user_id = item["userId"]
                image_url = item["imageUrl"]
                
                logger.info(f"Processing item {item_id} (User: {user_id})")

                container_name, blob_name = get_blob_details(image_url)
                if not container_name or not blob_name:
                    logger.warning(f"  Skipping {item_id}: invalid image URL format ({image_url})")
                    continue
                
                # Strip SAS tokens off blob name
                blob_name = blob_name.split("?")[0]

                try:
                    # Download Blob
                    blob_client = blob_service.get_blob_client(container=container_name, blob=blob_name)
                    download_stream = await blob_client.download_blob()
                    image_bytes = await download_stream.readall()
                    
                    if not image_bytes:
                        logger.warning(f"  Skipping {item_id}: empty blob")
                        continue
                        
                    ext = blob_name.split(".")[-1].lower() if "." in blob_name else "jpeg"
                    mime = f"image/{ext}" if ext in ["jpeg", "jpg", "png", "webp", "gif"] else "image/jpeg"
                    
                    b64 = base64.b64encode(image_bytes).decode("utf-8")
                    data_uri = f"data:{mime};base64,{b64}"

                    # Call Cohere
                    resp = await http_client.post(
                        f"{cohere_endpoint.rstrip('/')}/v1/embed",
                        headers={"Authorization": f"Bearer {cohere_key}"},
                        json={
                            "input_type": "image",
                            "embedding_types": ["float"],
                            "images": [data_uri]
                        },
                        timeout=30.0
                    )
                    resp.raise_for_status()
                    embed_result = resp.json()
                    
                    float_embeds = embed_result.get("embeddings", {}).get("float", [])
                    if not float_embeds or len(float_embeds) == 0:
                        logger.error(f"  Cohere did not return an embedding array for {item_id}.")
                        continue
                        
                    embedding = float_embeds[0]

                    # Update Cosmos Document
                    item["imageEmbedding"] = embedding
                    await container.replace_item(item=item_id, body=item)
                    logger.info(f"  Successfully updated {item_id} with {len(embedding)}-dim embedding.")

                except httpx.HTTPStatusError as e:
                    logger.error(f"  Cohere API Error on {item_id}: {e.response.text}")
                except Exception as e:
                    logger.error(f"  Error processing {item_id}: {e}")

        logger.info("Migration complete.")

if __name__ == "__main__":
    asyncio.run(main())
