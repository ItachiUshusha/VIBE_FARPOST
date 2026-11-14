"""Publish the reviewed release bundle; draft text is never served."""
import json
from pathlib import Path
import re
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
TITLES = {"legal": "Правовая информация", "offer": "Публичная оферта", "privacy": "Политика конфиденциальности",
          "cookies": "Политика cookie", "analytics-consent": "Согласие на аналитику"}
APPROVAL_PATH = Path(__file__).resolve().parents[1] / "data" / "legal-approved.json"


def approved_documents(cfg):
    mode = cfg.legal_publication_mode
    if mode == "disabled" or (mode == "manual" and (not cfg.legal_published or not cfg.legal_version)):
        return None
    try:
        bundle = json.loads(APPROVAL_PATH.read_text(encoding="utf-8"))
        if not isinstance(bundle, dict) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", bundle.get("version", "")):
            return None
        if mode == "manual" and bundle["version"] != cfg.legal_version:
            return None
        if not isinstance(bundle.get("approved_at"), str) or not bundle["approved_at"].strip():
            return None
        operator = bundle.get("operator")
        documents = bundle.get("documents")
        if not isinstance(operator, dict) or not isinstance(documents, dict):
            return None
        if any(not isinstance(operator.get(key), str) or not operator[key].strip() for key in ["name", "contact", "jurisdiction"]):
            return None
        if any(not isinstance(documents.get(key), str) or len(documents[key].strip()) < 100 or "[ПОДТВЕРДИТЬ" in documents[key] for key in TITLES):
            return None
        return bundle
    except (OSError, ValueError, TypeError, KeyError):
        return None


def published_version(cfg):
    bundle = approved_documents(cfg)
    return bundle["version"] if bundle else ""


@router.get("/api/legal/{slug}")
def legal_document(slug: str, request: Request):
    if slug not in TITLES:
        raise HTTPException(404, "Документ не найден")
    bundle = approved_documents(request.app.state.settings)
    if not bundle:
        return {"published": False, "title": TITLES[slug]}
    return {"published": True, "title": TITLES[slug], "version": bundle["version"], "text": bundle["documents"][slug], "operator": bundle["operator"]}
