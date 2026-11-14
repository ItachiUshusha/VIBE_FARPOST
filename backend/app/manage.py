"""Local maintenance commands. No credentials or bootstrap endpoints are exposed over HTTP."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import sys
from uuid import uuid4

from .accounts import migrate, password_hash, stamp
from .config import Settings
from .legal import APPROVAL_PATH, TITLES
from .repository import connect


def password(args):
    value = sys.stdin.readline().rstrip("\n") if args.password_stdin else getpass.getpass("Новый пароль (от 12 символов): ")
    if not 12 <= len(value) <= 128:
        raise ValueError("Пароль должен содержать от 12 до 128 символов")
    if not args.password_stdin and value != getpass.getpass("Повторите пароль: "):
        raise ValueError("Пароли не совпали")
    return password_hash(value)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate")
    commands.add_parser("callbacks")
    create = commands.add_parser("create-admin")
    create.add_argument("--username", required=True)
    create.add_argument("--password-stdin", action="store_true")
    role = commands.add_parser("set-role")
    role.add_argument("--user-id", required=True)
    role.add_argument("--confirm-user-id", required=True)
    role.add_argument("--role", choices=["admin", "user"], required=True)
    reset = commands.add_parser("reset-password")
    reset.add_argument("--user-id", required=True)
    reset.add_argument("--confirm-user-id", required=True)
    reset.add_argument("--password-stdin", action="store_true")
    template = commands.add_parser("legal-template")
    template.add_argument("--output", required=True)
    approve = commands.add_parser("approve-legal")
    approve.add_argument("--file", required=True)
    approve.add_argument("--version", required=True)
    approve.add_argument("--confirm-reviewed", action="store_true", required=True)
    args = parser.parse_args()
    cfg = Settings()
    if args.command == "callbacks":
        print(json.dumps({provider: cfg.public_origin + f"/api/auth/oauth/{provider}/callback" for provider in ["yandex", "vk"]}, ensure_ascii=False, indent=2))
        return
    if args.command == "legal-template":
        source = Path(__file__).resolve().parents[1] / "legal/drafts"
        operator = json.loads((source.parent / "operator.json").read_text(encoding="utf-8"))
        template_data = {"operator": operator, "documents": {slug: (source / (slug + ".txt")).read_text(encoding="utf-8") for slug in TITLES}}
        destination = Path(args.output)
        if destination.exists():
            raise ValueError("Файл уже существует. Он не будет перезаписан.")
        destination.write_text(json.dumps(template_data, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Создан файл для проверки владельцем: " + str(destination))
        return
    if args.command == "approve-legal":
        bundle = json.loads(Path(args.file).read_text(encoding="utf-8"))
        if not all(isinstance(bundle.get("operator", {}).get(key), str) and bundle["operator"][key].strip() for key in ["name", "contact", "jurisdiction"]):
            raise ValueError("Заполните реквизиты и юрисдикцию оператора")
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", args.version):
            raise ValueError("Некорректная версия документов")
        if any(not isinstance(bundle.get("documents", {}).get(slug), str) or len(bundle["documents"][slug].strip()) < 100 or "[ПОДТВЕРДИТЬ" in bundle["documents"][slug] for slug in TITLES):
            raise ValueError("Заполните и утвердите все документы, удалите незаполненные поля")
        bundle.update(version=args.version, approved_at=stamp())
        temporary = APPROVAL_PATH.with_suffix(".tmp")
        temporary.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, APPROVAL_PATH)
        print("Утверждённый комплект сохранён. Для публикации задайте LEGAL_PUBLISHED=true и LEGAL_VERSION=" + args.version)
        return
    client, db = connect(cfg)
    try:
        db.command("ping")
        migrate(db)
        if args.command == "migrate":
            print("Миграция accounts-v1 применена; дорожные данные и расчёты сохранены")
            return
        if args.command == "create-admin":
            username = args.username.lower()
            if not re.fullmatch(r"[a-z0-9_-]{3,40}", username):
                raise ValueError("Логин: 3–40 латинских букв, цифр, _ или -")
            if db.users.find_one({"username": username}):
                raise ValueError("Аккаунт уже существует. Используйте set-role с подтверждением ID.")
            user = {"_id": str(uuid4()), "username": username, "display_name": username, "password_hash": password(args), "role": "admin", "status": "active", "version": 1,
                    "registration_method": "local", "created_at": stamp(), "created_via": "local-cli"}
            event = {"_id": str(uuid4()), "actor_id": "local-cli", "action": "admin.bootstrap", "target_id": user["_id"], "status": "pending", "created_at": stamp()}
            db.audit_log.insert_one(event)
            db.users.insert_one(user)
            db.audit_log.update_one({"_id": event["_id"]}, {"$set": {"status": "applied"}})
            print(json.dumps({"id": user["_id"], "username": username, "role": "admin"}))
            return
        if args.user_id != args.confirm_user_id:
            raise ValueError("Подтверждение ID не совпало")
        user = db.users.find_one({"_id": args.user_id})
        if not user:
            raise ValueError("Пользователь не найден")
        if args.command == "set-role":
            if args.role == "user" and user["role"] == "admin" and db.users.count_documents({"role": "admin", "status": "active"}) <= 1:
                raise ValueError("Нельзя снять права последнего администратора. Сначала назначьте другого.")
            update = {"role": args.role, "status": "active"}
        else:
            update = {"password_hash": password(args)}
        event = {"_id": str(uuid4()), "actor_id": "local-cli", "action": args.command, "target_id": user["_id"], "created_at": stamp(), "status": "pending"}
        db.audit_log.insert_one(event)
        db.users.update_one({"_id": user["_id"]}, {"$set": update, "$inc": {"version": 1}})
        db.sessions.delete_many({"user_id": user["_id"]})
        db.audit_log.update_one({"_id": event["_id"]}, {"$set": {"status": "applied"}})
        print("Аккаунт обновлён, сессии завершены: " + user["_id"])
    finally:
        client.close()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
