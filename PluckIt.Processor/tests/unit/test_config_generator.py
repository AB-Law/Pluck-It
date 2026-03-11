import json
import pytest
from unittest.mock import patch, MagicMock
from httpx import HTTPStatusError, Request, Response

from agents.scrapers.config_generator import _parse_llm_json, generate_selector_config, _fetch_html

def test_parse_llm_json_clean_json() -> None:
    text = '{"productContainer": ".card"}'
    assert _parse_llm_json(text) == {"productContainer": ".card"}

def test_parse_llm_json_with_markdown() -> None:
    text = '''```json
{
    "productContainer": ".card"
}
```'''
    assert _parse_llm_json(text) == {"productContainer": ".card"}

def test_parse_llm_json_with_stray_ticks() -> None:
    text = '```{"productContainer": ".card"}```'
    assert _parse_llm_json(text) == {"productContainer": ".card"}

@patch("agents.scrapers.config_generator.httpx.get")
def test_fetch_html_strips_noisy_tags(mock_get) -> None:
    mock_resp = MagicMock()
    mock_resp.text = """
    <html>
      <head>
        <script>alert(1);</script>
        <style>body { color: red; }</style>
      </head>
      <body>
        <svg><path d="M1 1"/></svg>
        <noscript>Turn on JS</noscript>
        <iframe src="ads.html"></iframe>
        <div class="product">Item 1</div>
      </body>
    </html>
    """
    mock_get.return_value = mock_resp
    
    html = _fetch_html("https://example.com/shop")
    
    # Assert tags are stripped
    assert "<script" not in html
    assert "<style" not in html
    assert "<svg" not in html
    assert "<noscript" not in html
    assert "<iframe" not in html
    
    # Assert actual content remains and whitespace is collapsed
    assert "<html> <head> </head> <body> <div class=\"product\">Item 1</div> </body> </html>" in html

@patch("agents.scrapers.config_generator.httpx.get")
def test_fetch_html_raises_on_http_error(mock_get) -> None:
    mock_resp = MagicMock()
    mock_resp.raise_for_status.side_effect = HTTPStatusError("404", request=Request("GET", "https://test"), response=Response(404))
    mock_get.return_value = mock_resp
    
    with pytest.raises(RuntimeError, match="Could not fetch"):
        _fetch_html("https://example.com/shop")

@patch("agents.scrapers.config_generator._build_llm")
@patch("agents.scrapers.config_generator._fetch_html")
def test_generate_selector_config_happy_path(mock_fetch, mock_build_llm) -> None:
    mock_fetch.return_value = "<html>product grid</html>"
    
    # Mock LLM Response
    mock_llm = MagicMock()
    mock_llm_response = MagicMock()
    mock_llm_response.content = '{"productContainer": ".card"}'
    mock_llm.invoke.return_value = mock_llm_response
    mock_build_llm.return_value = mock_llm
    
    # Call
    config = generate_selector_config("https://example.com", "TestBrand")
    
    # Asserts
    assert config["productContainer"] == ".card"
    assert config["sourceUrl"] == "https://example.com"
    assert config["generatedByLLM"] is True
    
    # Verify LLM was invoked with appropriate context
    mock_llm.invoke.assert_called_once()
    args = mock_llm.invoke.call_args[0][0]
    assert len(args) == 2
    assert "TestBrand" in args[1].content
    assert "https://example.com" in args[1].content
    assert "product grid" in args[1].content

@patch("agents.scrapers.config_generator._build_llm")
@patch("agents.scrapers.config_generator._fetch_html")
def test_generate_selector_config_llm_fails(mock_fetch, mock_build_llm) -> None:
    mock_fetch.return_value = "<html>product grid</html>"
    
    mock_llm = MagicMock()
    mock_llm.invoke.side_effect = Exception("OpenAI outage")
    mock_build_llm.return_value = mock_llm
    
    with pytest.raises(RuntimeError, match="LLM call failed for TestBrand: OpenAI outage"):
        generate_selector_config("https://example.com", "TestBrand")

@patch("agents.scrapers.config_generator._build_llm")
@patch("agents.scrapers.config_generator._fetch_html")
def test_generate_selector_config_bad_json(mock_fetch, mock_build_llm) -> None:
    mock_fetch.return_value = "<html></html>"
    
    mock_llm = MagicMock()
    mock_response = MagicMock()
    mock_response.content = "I couldn't find any products in the HTML."
    mock_llm.invoke.return_value = mock_response
    mock_build_llm.return_value = mock_llm
    
    with pytest.raises(RuntimeError, match="Could not parse LLM response as JSON"):
        generate_selector_config("https://example.com", "TestBrand")
