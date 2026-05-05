from unittest.mock import AsyncMock

import pytest

from agents.wishlist_profile import aggregate_wishlist_profile, recompute_wishlist_profile


@pytest.mark.unit
def test_aggregate_wishlist_profile_counts_top_terms() -> None:
    result = aggregate_wishlist_profile(
        [
            {
                "id": "wish-1",
                "tags": ["quiet luxury", "tailored"],
                "aestheticTags": ["minimalist"],
                "colours": [{"name": "Camel"}],
                "brand": "COS",
                "category": "Outerwear",
                "notes": "Soft blazer for travel",
            },
            {
                "id": "wish-2",
                "tags": ["quiet luxury", "weekend"],
                "colours": [{"name": "Camel"}],
                "brand": "COS",
                "category": "Tops",
                "notes": "Relaxed knit and blazer",
            },
        ],
        analyses={},
    )

    assert result["wishlistStyleKeywords"][0] == "Quiet Luxury"
    assert result["wishlistPreferredColours"] == ["Camel"]
    assert result["wishlistFavoriteBrands"] == ["COS"]
    assert "Blazer" in result["wishlistGarmentInterests"]
    assert result["wishlistProfileUpdatedAt"] is not None


@pytest.mark.unit
async def test_recompute_wishlist_profile_clears_empty_state() -> None:
    async def _query_items(**_kwargs):
        if False:
            yield {}

    wardrobe = AsyncMock()
    wardrobe.query_items = _query_items
    profiles = AsyncMock()
    profiles.read_item = AsyncMock(side_effect=Exception("missing"))
    profiles.upsert_item = AsyncMock()

    result = await recompute_wishlist_profile(
        "user-1",
        wardrobe_container=wardrobe,
        profiles_container=profiles,
    )

    assert result["wishlistStyleKeywords"] == []
    assert result["wishlistPreferredColours"] == []
    assert result["wishlistFavoriteBrands"] == []
    assert result["wishlistGarmentInterests"] == []
    assert result["wishlistProfileUpdatedAt"] is None
    profiles.upsert_item.assert_awaited_once()
