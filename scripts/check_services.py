"""Launch an isolated acceptance stack; never use the application's database or a real analytics counter."""
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
from uuid import uuid4

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_ready(url):
    for attempt in range(60):
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(.5)
    raise RuntimeError("Тестовый сервер не запустился: " + url)


def main():
    backend_port, frontend_port = free_port(), free_port()
    while frontend_port == backend_port:
        frontend_port = free_port()
    base = f"http://127.0.0.1:{frontend_port}"
    api = f"http://127.0.0.1:{backend_port}"
    database = "farpost_security_qa_" + uuid4().hex
    logs = ROOT / ".local/services-qa"
    logs.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONPATH": str(ROOT / "backend"), "MONGODB_DATABASE": database, "MONGODB_URI": "mongodb://127.0.0.1:27017",
           "PUBLIC_ORIGIN": base, "CORS_ORIGINS": base, "METRICA_COUNTER_ID": "12345678", "METRICA_READ_TOKEN": "", "YANDEX_CLIENT_ID": "", "YANDEX_CLIENT_SECRET": "",
           "VK_CLIENT_ID": "", "LEGAL_PUBLISHED": "false", "LEGAL_VERSION": "", "SEO_INDEXING_ENABLED": "true", "NEXT_TELEMETRY_DISABLED": "1"}
    password = secrets.token_urlsafe(32)
    python = str(ROOT / ".venv/bin/python")
    node = str(ROOT / ".local/runtime/node/bin/node")
    processes = []
    files = []
    fixture = logs / "fixture.json"
    try:
        for name, command, cwd, process_env in [
            ("backend", [python, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(backend_port)], ROOT, env),
            ("frontend", [node, "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", str(frontend_port)], ROOT / "frontend",
             {**env, "API_PROXY_URL": api, "PUBLIC_ORIGIN": "https://app.example.test"}),
        ]:
            log = (logs / f"{name}.log").open("w")
            files.append(log)
            processes.append(subprocess.Popen(command, cwd=cwd, env=process_env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True))
        wait_ready(api + "/api/health")
        wait_ready(base + "/robots.txt")
        subprocess.run([python, "-m", "app.manage", "create-admin", "--username", "qa-admin", "--password-stdin"], cwd=ROOT, env=env,
                       input=password + "\n", text=True, capture_output=True, check=True)
        fixture.write_text(json.dumps({"base": base, "api": api, "password": password}), encoding="utf-8")
        fixture.chmod(0o600)
        result = subprocess.run([node, "scripts/accounts-browser-check.mjs", str(fixture)], cwd=ROOT, env=env)
        if result.returncode:
            raise SystemExit(result.returncode)
        for name in ["backend", "frontend"]:
            assert "DO_NOT_LOG_TEST_CODE" not in (logs / f"{name}.log").read_text(), "OAuth code leaked to " + name
        print("OAuth-коды не попали в журналы; временная база будет удалена.")
    finally:
        for process in processes:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        for file in files:
            file.close()
        fixture.unlink(missing_ok=True)
        if database.startswith("farpost_security_qa_") and len(database) == len("farpost_security_qa_") + 32:
            with MongoClient(env["MONGODB_URI"], serverSelectionTimeoutMS=3000) as client:
                client.drop_database(database)


if __name__ == "__main__":
    main()
