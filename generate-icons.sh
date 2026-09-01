#!/usr/bin/env bash
# Перегенерувати іконки застосунку (icon-192.png, icon-512.png, apple-touch-icon.png)
# у docs/ і "підняти" версію кешу service worker, щоб уже встановлені телефони
# підхопили нову іконку/розклад автоматично (без ручного перевстановлення).
#
# Використання:
#   ./generate-icons.sh                       # за замовчуванням "7Б", зелено-синій градієнт
#   ./generate-icons.sh "8А"                   # інший текст на іконці (клас змінився)
#   ./generate-icons.sh "8А" "#2563eb" "#0f172a"   # + свої кольори градієнта (верх/низ)
#
# Вимагає ImageMagick (`convert`).

set -euo pipefail

TEXT="${1:-7Б}"
COLOR_TOP="${2:-#16a34a}"
COLOR_BOTTOM="${3:-#0f172a}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$SCRIPT_DIR/docs"
FONT="/System/Library/Fonts/Supplemental/Verdana Bold.ttf"

if ! command -v convert >/dev/null 2>&1; then
  echo "Помилка: не знайдено ImageMagick (команда 'convert')." >&2
  echo "Встанови: brew install imagemagick" >&2
  exit 1
fi

if [ ! -f "$FONT" ]; then
  # запасний варіант шрифту, якщо Verdana Bold відсутній у системі
  FONT=""
fi

echo "Генерую іконки для '$TEXT' ($COLOR_TOP → $COLOR_BOTTOM) у $DOCS_DIR ..."

FONT_ARGS=()
if [ -n "$FONT" ]; then
  FONT_ARGS=(-font "$FONT")
fi

convert -size 512x512 "gradient:${COLOR_TOP}-${COLOR_BOTTOM}" \
  -gravity center -fill white "${FONT_ARGS[@]}" -pointsize 200 \
  -annotate 0 "$TEXT" \
  "$DOCS_DIR/icon-512.png"

convert "$DOCS_DIR/icon-512.png" -resize 192x192 "$DOCS_DIR/icon-192.png"
convert "$DOCS_DIR/icon-512.png" -resize 180x180 "$DOCS_DIR/apple-touch-icon.png"

echo "Іконки готові: icon-512.png, icon-192.png, apple-touch-icon.png"

# ---- підняти версію кешу service worker ----
SW_FILE="$DOCS_DIR/sw.js"
if [ -f "$SW_FILE" ]; then
  NEW_VERSION="rozklad-7b-v$(date +%Y%m%d%H%M%S)"
  # macOS/BSD sed вимагає '' після -i, GNU sed — ні; обробляємо обидва варіанти
  if sed --version >/dev/null 2>&1; then
    sed -i "s/const CACHE_NAME = '[^']*';/const CACHE_NAME = '${NEW_VERSION}';/" "$SW_FILE"
  else
    sed -i '' "s/const CACHE_NAME = '[^']*';/const CACHE_NAME = '${NEW_VERSION}';/" "$SW_FILE"
  fi
  echo "Версію кешу service worker піднято: $NEW_VERSION"
  echo "(усі встановлені застосунки самі оновлять іконку/розклад при наступному відкритті з інтернетом)"
else
  echo "Увага: $SW_FILE не знайдено, версію кешу не оновлено." >&2
fi

echo "Готово. Не забудь закомітити та запушити зміни в docs/."
