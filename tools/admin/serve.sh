#!/usr/bin/env bash
# Запуск редактора розкладів (macOS / Linux).
#
#   ./tools/admin/serve.sh            # порт 8000
#   ./tools/admin/serve.sh 8080       # інший порт
#
# Сервер піднімається з КОРЕНЯ репозиторію — інакше адмінка не побачить
# docs/schedules/ (вона читає їх по відносному шляху ../../docs/schedules/).
#
# Використовує serve.py — це той самий роздавач статики плюс маленький write-API,
# завдяки якому редактор пише розклади прямо в docs/schedules/, а не через
# "завантажити файл і покласти руками". Деталі й обмеження — у serve.py.

set -euo pipefail

PORT="${1:-8000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
done
if [ -z "$PY" ]; then
  echo "Не знайдено Python. Встанови python3 або відкрий tools/admin/index.html будь-яким іншим локальним сервером." >&2
  exit 1
fi

URL="http://localhost:${PORT}/tools/admin/"

# банер друкує сам serve.py — тут лише відкриваємо браузер трохи згодом,
# щоб сервер устиг піднятись
(
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) >/dev/null 2>&1 &

cd "$ROOT"
exec "$PY" "$SCRIPT_DIR/serve.py" "$PORT"
