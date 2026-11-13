# Проверка редизайна

**Исторический отчёт:** результаты ниже относятся к редизайну до добавления своих дорог, обновления сноса домов и новых подписей метрик. Последующие изменения от 14 ноября 2026 года по запросу пользователя пересобраны и запущены в Docker (frontend и backend); TypeScript внутри production-сборки прошёл. Тесты после этих изменений не запускались. Прежние измерения CLS и браузерные результаты ниже к новой версии не относятся.

Проверена production-сборка приложения на http://localhost:3000, 13–14 ноября 2026 года. Изменён интерфейс; API, дорожный набор и транспортная модель сохранены. Обновлённая версия запущена в Docker Compose.

## Выполнено

- Полный backend-набор: **46 passed**. Есть одно предупреждение Starlette о будущем переходе с httpx на httpx2.
- Production-сборка Next.js с Framework7 React и Motion проходит, включая проверку TypeScript.
- **13 основных и 17 расширенных браузерных сценариев** проходят. Ошибок JavaScript и гидратации не зарегистрировано. Отчёты: [основные](artifacts/browser-check.json), [расширенные](artifacts/extension-browser-check.json).
- **15 адаптивных проверок, 24 измерения CLS**, 12 размеров окна; горизонтального переполнения не обнаружено. [Измерения и условия](artifacts/design/responsive-report.json).
- **16 сочетаний текстовых и фоновых токенов** светлой и тёмной темы имеют контраст не ниже **4,65:1**. Проверены основные роли текста и статусов; это не полный аудит соответствия WCAG.
- На 320×568, 390×844 и 820×1180 проверены компактное положение нативным сенсорным свайпом, раскрытие касанием, основная кнопка в рабочем и полном раскрытии, доступность нижней навигации. [Отчёт панелей](artifacts/design/panel-report.json).
- На телефоне, планшете и компьютере сохранены семь состояний: загрузка, старт, сценарий, расчёт, результат, предупреждение о парковке, редактор дома. [Отчёт состояний](artifacts/design/states-report.json).
- Повторно прочитаны прежний MVP-расчёт `68cc1c1a-bbac-46bc-8957-4c4a0bff2968` и составной расчёт `4e085d1e-9a5b-437b-8c36-61e25712d61a`: сохранённые снимки совпадают, объяснение доступно. Том MongoDB сохранён.

Функциональные проверки включают изменение количества авто, сочетание дорожного сценария и погоды, А / Через / Б, ручной и автоматический выбор реальной парковки, заполненную парковку с сохранением автомобильного маршрута, дом одним кликом и 40 жителей → 40 авто, повторное редактирование и перенос, сохранение карты при смене темы и повороте, экспорт и объяснение. Проверены ошибка API с повтором, локальная карта без внешней сети и SVG-режим без WebGL.

## Измерения CLS

| Конфигурация | Измерений | Максимальный CLS |
| --- | ---: | ---: |
| Холодный запуск, 12 размеров и повторные прогоны | 20 | 0,000682 |
| Задержанные данные и появление результата, 390×844 | 1 | 0,000682 |
| Тёмная тема и reduced motion, 390 и 1440 px | 2 | 0,001218 |
| Ошибка подключения и повтор, 390×844 | 1 | 0 |

Максимум **0,001218** ниже цели **0,05**. Значения `web-vitals` и независимого наблюдателя согласуются. Область спиннера в кнопке фиксирована, контейнер результата изолирует отступы, геометрия нижней навигации задана до инициализации Framework7. Это лабораторные результаты перечисленных прогонов.

## Скриншоты

Изображения просмотрены; проверены перенос текста, положение основных действий, прокрутка, читаемость карты и предупреждений. Снимки панелей делаются после завершения перехода.

| Состояние | Телефон 390×844 | Планшет 820×1180 | Компьютер 1440×900 |
| --- | --- | --- | --- |
| Загрузка | [PNG](artifacts/design/states-phone-loading.png) | [PNG](artifacts/design/states-tablet-loading.png) | [PNG](artifacts/design/states-desktop-loading.png) |
| Старт | [PNG](artifacts/design/states-phone-initial.png) | [PNG](artifacts/design/states-tablet-initial.png) | [PNG](artifacts/design/states-desktop-initial.png) |
| Сценарий | [PNG](artifacts/design/states-phone-scenario.png) | [PNG](artifacts/design/states-tablet-scenario.png) | [PNG](artifacts/design/states-desktop-scenario.png) |
| Расчёт | [PNG](artifacts/design/states-phone-calculating.png) | [PNG](artifacts/design/states-tablet-calculating.png) | [PNG](artifacts/design/states-desktop-calculating.png) |
| Результат | [PNG](artifacts/design/states-phone-result.png) | [PNG](artifacts/design/states-tablet-result.png) | [PNG](artifacts/design/states-desktop-result.png) |
| Парковка заполнена | [PNG](artifacts/design/states-phone-parking-warning.png) | [PNG](artifacts/design/states-tablet-parking-warning.png) | [PNG](artifacts/design/states-desktop-parking-warning.png) |
| Дом | [PNG](artifacts/design/states-phone-house.png) | [PNG](artifacts/design/states-tablet-house.png) | [PNG](artifacts/design/states-desktop-house.png) |

Дополнительно: [экран 320 px](artifacts/design/states-small-phone-scenario.png), [рабочая панель](artifacts/design/panel-phone-partial.png), [компактная панель](artifacts/design/panel-phone-compact.png), [тёмная тема](artifacts/design/dark-result-390.png), [ручная смена темы](artifacts/design/manual-dark-phone.png), [низкое окно при вводе](artifacts/design/mobile-house-short-viewport.png), [альбомная ориентация](artifacts/design/mobile-landscape.png), [SVG без WebGL](artifacts/design/no-webgl.png).

## Методика

Используется установленный Chrome, отдельный временный профиль, headless-режим и ANGLE SwiftShader. Размеры проверяются последовательно, чтобы одновременно не создавать несколько активных WebGL-карт.

Матрица: 320×568, 360×800, 375×667, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1280×800, 1440×900, 1920×1080 и мобильная альбомная ориентация 844×390. Для 320, 390, 768 и 1440 px предусмотрено по три холодных запуска. Дополнительно проверяются тёмная тема, reduced motion, задержка API 750 мс, замедление CPU в четыре раза, ошибка подключения и повтор.

CLS измеряется двумя способами: установленным `web-vitals` и независимым PerformanceObserver по Layout Shift entries с максимальным сессионным окном 5 секунд и разрывом между событиями 1 секунда. События после недавнего пользовательского ввода исключаются из CLS, но визуальная оценка интерфейса выполняется отдельно. Итоговый JSON: `artifacts/design/responsive-report.json`.

Уменьшенная высота окна моделирует ограниченное пространство при вводе. Reflow для масштаба 200% проверяется CSS viewport 720×450 при DPR 2. Эти проверки не подменяют тест физической клавиатуры, реального телефона и Mobile Safari.

## Команды

Нужны Node.js 22+, Python-окружение проекта, установленный Chrome и работающий Docker Compose. Playwright для сценариев установлен в `.local/qa`.

```powershell
docker compose build frontend
docker compose up -d --no-deps frontend
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm run typecheck --prefix frontend
node scripts/browser-check.mjs
node scripts/extension-browser-check.mjs
node scripts/design-responsive-check.mjs
node scripts/design-states-check.mjs
node scripts/design-panel-check.mjs
.\.venv\Scripts\python.exe scripts/verify_extended_persistence.py after
.\.venv\Scripts\python.exe scripts/verify_stack.py after
```

Браузерные сценарии запускаются последовательно. В этой среде использовался локальный Node.js 22.23.5 из `.local/node-runtime/node_modules/node/bin/node.exe`. Production build выполнен в образе Node 22. Последние две команды сравнивают снимки, ранее сохранённые в `.local`, и предназначены для проверки существующего окружения.

## Ограничения

Физические iPhone / Android и Safari в этой среде не проверяются. Полевые Core Web Vitals реальных пользователей не измерены. Карта и парковки имеют координаты OSM; потоки, занятость, количество жителей и пропускная способность остаются условными. Пешая часть оценивается по прямой.
