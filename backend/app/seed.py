"""python -m app.seed — идемпотентный импорт активной версии."""
from .config import get_settings
from .repository import connect, seed_database


def main():
    settings = get_settings()
    client, db = connect(settings)
    try:
        data = seed_database(db, settings.dataset_path)
        print(f"Импортирована версия {data['version']}: {len(data['edges'])} рёбер, {len(data['trips'])} поездок.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
