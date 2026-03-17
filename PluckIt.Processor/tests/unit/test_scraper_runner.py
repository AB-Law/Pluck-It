from unittest.mock import MagicMock, patch

import pytest

from agents.scraper_runner import run_global_scrapers


@pytest.mark.unit
def test_run_global_scrapers_runs_all_active_sources() -> None:
    sources = [{"id": "source-1"}, {"id": "source-2"}]
    container = MagicMock()
    container.query_items.return_value = sources

    with (
        patch("agents.scraper_runner.get_scraper_sources_container_sync", return_value=container),
        patch("agents.scraper_runner._run_source") as mock_run_source,
    ):
        run_global_scrapers()

        assert mock_run_source.call_count == len(sources)


@pytest.mark.unit
def test_run_global_scrapers_raises_on_source_load_failure() -> None:
    container = MagicMock()
    container.query_items.side_effect = RuntimeError("cosmos query failed")

    with (
        patch("agents.scraper_runner.get_scraper_sources_container_sync", return_value=container),
        patch("agents.scraper_runner.logger.exception") as mock_logger_exception,
    ):
        with pytest.raises(RuntimeError, match="cosmos query failed"):
            run_global_scrapers()

    mock_logger_exception.assert_called_once()
