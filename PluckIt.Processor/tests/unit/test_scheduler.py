from types import SimpleNamespace

from unittest.mock import MagicMock, patch

from function_app import pluck_it_scraper, pluck_it_weekly_digest, _run_scraper_job, _run_weekly_digest_job


import pytest


@pytest.mark.unit
def test_weekly_digest_timer_continues_when_user_fails():
    users = [{"id": "user-1"}, {"id": "user-2"}]
    container = MagicMock()
    container.read_all_items.return_value = users

    def _run_digest(user_id: str, force: bool = False):
        if user_id == "user-1":
            raise RuntimeError("user failure")
        return {"summary": "ok"}, "generated"

    with (
        patch("agents.db.get_user_profiles_container_sync", return_value=container),
        patch("agents.digest_agent.run_digest_for_user_with_status", side_effect=_run_digest) as mock_run,
    ):
        pluck_it_weekly_digest(SimpleNamespace(past_due=False))
        assert mock_run.call_count == len(users)


@pytest.mark.unit
def test_scraper_timer_continues_when_source_fails():
    sources = [{"id": "source-1"}, {"id": "source-2"}]
    container = MagicMock()
    container.query_items.return_value = sources

    def _run_source(source_id: str):
        if source_id == "source-1":
            return 4
        raise RuntimeError("scraper failure")

    with (
        patch("agents.db.get_scraper_sources_container_sync", return_value=container),
        patch("agents.scraper_runner.run_for_source", side_effect=_run_source) as mock_run,
    ):
        pluck_it_scraper(SimpleNamespace(past_due=False))
        assert mock_run.call_count == len(sources)


@pytest.mark.unit
def test_weekly_digest_job_continues_when_worker_raises():
    users = [{"id": "user-1"}, {"id": "user-2"}, {"id": "user-3"}]
    container = MagicMock()
    container.read_all_items.return_value = users

    outcomes = iter(["skipped_by_hash", RuntimeError("boom"), "generated"])

    def _run_digest(user_id: str, force: bool = False):
        outcome = next(outcomes)
        if isinstance(outcome, Exception):
            raise outcome
        return None, outcome

    with (
        patch("agents.db.get_user_profiles_container_sync", return_value=container),
        patch("agents.digest_agent.run_digest_for_user_with_status", side_effect=_run_digest) as mock_run,
    ):
        _run_weekly_digest_job()
        assert mock_run.call_count == len(users)


@pytest.mark.unit
def test_scraper_job_continues_when_worker_raises():
    sources = [{"id": "source-1"}, {"id": "source-2"}, {"id": "source-3"}]
    container = MagicMock()
    container.query_items.return_value = sources

    outcomes = iter([1, RuntimeError("boom"), 0])

    def _run_source(source_id: str):
        result = next(outcomes)
        if isinstance(result, Exception):
            raise result
        return result

    with (
        patch("agents.db.get_scraper_sources_container_sync", return_value=container),
        patch("agents.scraper_runner.run_for_source", side_effect=_run_source) as mock_run,
    ):
        _run_scraper_job()
        assert mock_run.call_count == len(sources)
