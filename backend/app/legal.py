"""Reviewed legal documents are explicitly activated; draft text is never served."""
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
TITLES = {"legal": "Правовая информация", "offer": "Публичная оферта", "privacy": "Политика конфиденциальности",
          "cookies": "Политика cookie", "analytics-consent": "Согласие на аналитику"}
APPROVAL_PATH = Path(__file__).resolve().parents[1] / "data" / "legal-approved.json"


def approved_documents(cfg):
    if not cfg.legal_published or not cfg.legal_version:
        return None
    try:
        bundle = json.loads(APPROVAL_PATH.read_text(encoding="utf-8"))
        if bundle.get("version") != cfg.legal_version or not bundle.get("approved_at") or not all(bundle.get("operator", {}).get(key) for key in ["name", "contact", "jurisdiction"]):
            return None
        if any(not isinstance(bundle.get("documents", {}).get(key), str) or not bundle["documents"][key].strip() or "[ПОДТВЕРДИТЬ" in bundle["documents"][key] for key in TITLES):
            return None
        return bundle
    except (OSError, ValueError, TypeError, KeyError):
        return None


@router.get("/api/legal/{slug}")
def legal_document(slug: str, request: Request):
    if slug not in TITLES:
        raise HTTPException(404, "Документ не найден")
    bundle = approved_documents(request.app.state.settings)
    if not bundle:
        return {"published": False, "title": TITLES[slug]}
    return {"published": True, "title": TITLES[slug], "version": bundle["version"], "text": bundle["documents"][slug], "operator": bundle["operator"]}
