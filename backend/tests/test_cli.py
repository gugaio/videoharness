"""Testes da CLI: mesmo caso de uso do HTTP, sem duplicar regras."""

import json

import pytest

from stream_lens.adapters.inbound.cli.main import main
from tests.conftest import FIXTURES_ROOT


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("STREAM_LENS_WORKSPACE", str(tmp_path / "workspace"))
    monkeypatch.setenv("STREAM_LENS_FIXTURES", str(tmp_path / "fixtures"))
    return tmp_path


def _copy_fixtures(tmp_path):
    import shutil

    shutil.copytree(FIXTURES_ROOT, tmp_path / "fixtures")


class TestCliInspect:
    def test_inspect_grava_snapshot(self, env, capsys):
        _copy_fixtures(env)
        output = env / "snapshot.json"
        code = main(["inspect", "fixture://hls-ts/master.m3u8", "--output", str(output)])
        assert code == 0
        payload = json.loads(output.read_text(encoding="utf-8"))
        assert payload["schema_version"] == "1.4"
        assert payload["manifest"]["kind"] == "hls_master_playlist"
        assert "concluída" in capsys.readouterr().out

    def test_inspect_imprime_json_sem_output(self, env, capsys):
        _copy_fixtures(env)
        code = main(["inspect", "fixture://dash-mpd/stream.mpd"])
        assert code == 0
        payload = json.loads(capsys.readouterr().out)
        assert payload["source"]["protocol"] == "DASH"

    def test_url_remota_falha_com_codigo_1(self, env, capsys):
        _copy_fixtures(env)
        code = main(["inspect", "https://example.com/master.m3u8"])
        assert code == 1
        assert "erro" in capsys.readouterr().err


class TestCliPurge:
    def test_purge_expired(self, env, capsys):
        _copy_fixtures(env)
        output = env / "s.json"
        assert main(["inspect", "fixture://hls-ts/master.m3u8", "--output", str(output)]) == 0
        code = main(["purge-expired"])
        assert code == 0
        assert "0 inspeções" in capsys.readouterr().out
