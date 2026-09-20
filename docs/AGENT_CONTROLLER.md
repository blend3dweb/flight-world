# Flight World Agent Controller

Agent Controller удерживает WebGPU-сцену и браузер запущенными между отдельными обращениями к нейромодели. Он управляет `window.flight.agent`, выполняет маршруты, сохраняет структурированную память осмотра и позволяет повторить те же точки после изменения сцены.

Контроллер слушает только `127.0.0.1`. Сенсорные RGB, depth, normal и object-ID данные используются во время наблюдения, но в постоянную память не записываются.

## Запуск

Из корня проекта:

```powershell
node agent-controller.cjs
```

По умолчанию:

- сцена: `http://127.0.0.1:8765/webgpu/index.html`;
- API контроллера: `http://127.0.0.1:8766`;
- браузер работает без видимого окна;
- если сервер сцены не запущен, контроллер запускает его самостоятельно;
- память находится в `tmp/agent-bridge/memory.json`.

Для наблюдения за действиями агента в видимом Chrome:

```powershell
node agent-controller.cjs --visible
```

Другой локальный порт:

```powershell
node agent-controller.cjs --port=8770
```

Остановка: `Ctrl+C`. Запущенный контроллер закрывает принадлежащий ему браузер и сервер сцены.

## Локальный API

| Метод и адрес | Назначение |
| --- | --- |
| `GET /health` | Готовность и версия Agent Bridge |
| `GET /state` | Текущее состояние контроллера и маршрута |
| `GET /memory` | Сохранённые сессии, маршруты и сравнения |
| `GET /model` | Доступность выбранной локальной модели Ollama |
| `POST /command` | Одна команда протокола Agent Bridge |
| `POST /observe` | Наблюдение текущего состояния |
| `POST /model/analyze` | Новый кадр текущего наблюдателя и структурированный анализ vision-модели |
| `POST /inspection/start` | Поиск объекта и осмотр с 3–8 сторон, при необходимости через vision-модель |
| `POST /inspection/stop` | Мягкая остановка многопозиционной инспекции |
| `POST /route/start` | Запуск маршрута |
| `POST /route/recheck` | Повтор маршрута со сравнением с последним завершённым проходом |
| `POST /route/stop` | Мягкая остановка маршрута после текущей точки |

Примеры PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8766/health
```

```powershell
Invoke-RestMethod http://127.0.0.1:8766/route/start -Method Post -ContentType 'application/json' -Body '{"name":"oceania-inspection"}'
```

Маршрут с анализом каждой точки через `qwen2.5vl:3b`:

```powershell
Invoke-RestMethod http://127.0.0.1:8766/route/start -Method Post -ContentType 'application/json' -Body '{"name":"oceania-inspection","analyze":true}'
```

Разовый анализ текущего вида:

```powershell
Invoke-RestMethod http://127.0.0.1:8766/model/analyze -Method Post -ContentType 'application/json' -Body '{"source":"manual"}'
```

```powershell
Invoke-RestMethod http://127.0.0.1:8766/route/recheck -Method Post -ContentType 'application/json' -Body '{"name":"oceania-inspection"}'
```

API не публикуется во внешний интернет и не имеет удалённой аутентификации. Поэтому адрес прослушивания намеренно зафиксирован на loopback-интерфейсе.

Многопозиционный осмотр моста с четырёх сторон:

```powershell
Invoke-RestMethod http://127.0.0.1:8766/inspection/start -Method Post -ContentType 'application/json' -Body '{"semantic":"bridge","views":4,"analyze":true}'
```

Контроллер выбирает самый крупный объект подходящей категории, сохраняет текущую позицию наблюдателя, строит 3–8 равномерных ракурсов вокруг bounding box, получает RGB/depth/normal/object-ID и при `analyze: true` передаёт каждый вид в `qwen2.5vl:3b`. В память попадают только технический паспорт, позиции, сенсорные метрики и структурированные ответы. После завершения или ошибки наблюдатель возвращается в исходную точку.

## Маршруты

Маршруты находятся в [agent-routes.json](../agent-routes.json). Реализованы:

- `smoke` — город и мост для короткой автоматической проверки;
- `oceania-inspection` — город днём, город ночью, мост под дождём, аэропорт, острова со снегом и океан на закате.

Для каждой точки задаются положение наблюдателя, цель взгляда, время суток, погода и ожидаемые категории объектов. Контроллер ставит симуляцию на паузу, воспроизводит условия и получает RGB/depth/normal/object-ID наблюдение одного состояния.

## Память и повторная проверка

В память записываются:

- координаты наблюдателя и состояние окружения;
- центральный объект, его semantic ID и модуль кода;
- видимые объекты;
- телеметрия;
- размер и статистика яркости каждого сенсорного прохода;
- связь повторного маршрута с базовым проходом;
- изменение центральной категории, модуля, средней яркости RGB и глубины.

Base64, JPEG и PNG в память маршрута не попадают. Запись выполняется через временный файл с последующим атомарным переименованием.

При `analyze: true` к точке добавляются визуальное описание `perception`, детерминированная структурированная находка, результат проверки схемы, требование проверки Codex и метрики Ollama. Локальная модель не получает команд изменения файлов и не может обращаться к Git или публикации сборки. Анализ выполняется последовательно и только в режиме инспекции; обычный полёт не вызывает модель.

Если контроллер получает эталонные RGB-метрики, он независимо сравнивает среднюю яркость и её стандартное отклонение. Значительное расхождение запрещает принять ответ модели `pass`: решение меняется на `reinspect`, а в доказательства записываются числовые дельты. Исходное решение модели сохраняется отдельно в `modelFinding`.

## Проверка

```powershell
node agent-controller-audit.cjs
```

Аудит запускает локальный контроллер на свободном порту, проходит короткий маршрут, повторяет его для сравнения и затем выполняет полный маршрут из шести точек. Результат: [verification/agent-controller-smoke.json](verification/agent-controller-smoke.json).

Проверка интеграции с Ollama на шести одинаковых контрольных точках:

```powershell
node ollama-dispatcher-audit.cjs
```

Результат основной модели: [verification/ollama-dispatcher-audit-qwen2.5vl-3b.json](verification/ollama-dispatcher-audit-qwen2.5vl-3b.json). Проверка от 20.09.2026 после добавления активного наблюдателя завершилась без ошибок: шесть состояний получили `pass`, сырые изображения не сохранились, среднее время всех ответов составило 1,74 секунды, пяти горячих — 1,87 секунды. Старый результат 4B сохранён в [verification/ollama-dispatcher-audit.json](verification/ollama-dispatcher-audit.json).

Проверка обратимого дефекта:

```powershell
node ollama-defect-sensitivity-audit.cjs
```

Результат основной модели: [verification/ollama-defect-sensitivity-audit-qwen2.5vl-3b.json](verification/ollama-defect-sensitivity-audit-qwen2.5vl-3b.json). `qwen2.5vl:3b` сама обнаружила временно опустошённую сцену, сенсорный барьер независимо подтвердил расхождение, а после восстановления модель снова вернула `pass`. Старый результат 4B сохранён в [verification/ollama-defect-sensitivity-audit.json](verification/ollama-defect-sensitivity-audit.json). Отдельная попытка 9B сохранена в [verification/ollama-reserve-expert-attempt.json](verification/ollama-reserve-expert-attempt.json): модель не дошла до инференса из-за ошибки инициализации CUDA.

Проверка активного наблюдателя:

```powershell
node agent-active-observer-audit.cjs
```

Она находит мост по семантической категории, проверяет его геометрию и материалы, выполняет четыре анализа Qwen2.5-VL, возвращает камеру в исходную точку и подтверждает отсутствие изображений в постоянной памяти. Проверка от 20.09.2026 получила четыре `pass`; горячие ответы заняли 0,97–1,03 секунды. Результат: [verification/agent-active-observer-audit.json](verification/agent-active-observer-audit.json).
