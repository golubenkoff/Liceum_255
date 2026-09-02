#!/usr/bin/env python3
"""Локальний сервер для редактора розкладів.

Роздає репозиторій статикою (як python3 -m http.server) плюс дає редактору
маленький write-API, щоб він писав розклади прямо в docs/schedules/ і не
змушував качати файли руками:

    GET    /__admin/ping                     -> {"write": true, "root": "..."}
    PUT    /docs/schedules/<id>.json         -> записати файл
    DELETE /docs/schedules/<id>.json         -> видалити файл

Обмеження навмисне жорсткі — це інструмент розробника, який приймає запис:

  * слухає ТІЛЬКИ 127.0.0.1, у локальну мережу не світиться;
  * писати можна ТІЛЬКИ в docs/schedules/, ТІЛЬКИ файли [A-Za-z0-9_-]+.json
    (без крапок і слешів — тому вийти з теки шаблоном неможливо);
  * тіло має бути валідним JSON і не більшим за 512 КБ;
  * жодних інших методів немає.

Запуск (з будь-якої директорії):
    python3 tools/admin/serve.py [порт]
"""

import functools
import http.server
import json
import os
import re
import subprocess
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))

def find_root():
    try:
        out = subprocess.run(['git', '-C', HERE, 'rev-parse', '--show-toplevel'],
                             capture_output=True, text=True, timeout=5)
        if out.returncode == 0 and out.stdout.strip():
            return os.path.abspath(out.stdout.strip())
    except Exception:
        pass
    return os.path.abspath(os.path.join(HERE, '..', '..'))

ROOT = find_root()
SCHEDULES_REL = os.path.join('docs', 'schedules')
SCHEDULES_DIR = os.path.join(ROOT, SCHEDULES_REL)

NAME_RE = re.compile(r'^[A-Za-z0-9_-]+\.json$')
URL_RE = re.compile(r'^/docs/schedules/([^/]+)$')
MAX_BODY = 512 * 1024


class AdminHandler(http.server.SimpleHTTPRequestHandler):

    # ---------- допоміжне ----------

    def send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # сторінка й розклади мають бути завжди свіжі, інакше редактор
        # побачить закешовану версію того, що сам щойно записав
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def target_path(self):
        """Шлях на диску для write-запиту або None, якщо запит не дозволений."""
        path = urllib.parse.urlparse(self.path).path
        m = URL_RE.match(path)
        if not m:
            return None
        name = urllib.parse.unquote(m.group(1))
        if not NAME_RE.match(name):
            return None
        full = os.path.abspath(os.path.join(SCHEDULES_DIR, name))
        # подвійна перевірка: результат мусить лишитись усередині docs/schedules/
        if os.path.dirname(full) != os.path.abspath(SCHEDULES_DIR):
            return None
        return full

    def read_body(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        return self.rfile.read(length)

    # ---------- методи ----------

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path == '/__admin/ping':
            self.send_json(200, {'write': True, 'root': ROOT, 'dir': SCHEDULES_REL})
            return
        super().do_GET()

    def do_PUT(self):
        full = self.target_path()
        if not full:
            self.send_json(403, {'error': 'писати можна лише в docs/schedules/<id>.json'})
            return
        raw = self.read_body()
        if raw is None:
            self.send_json(413, {'error': 'порожнє або завелике тіло запиту'})
            return
        try:
            text = raw.decode('utf-8')
            json.loads(text)  # тільки перевірка; форматування лишаємо клієнтське
        except Exception as e:
            self.send_json(400, {'error': 'невалідний JSON: %s' % e})
            return
        try:
            os.makedirs(SCHEDULES_DIR, exist_ok=True)
            # пишемо через тимчасовий файл — щоб обрив не лишив покалічений розклад
            tmp = full + '.tmp'
            with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
                f.write(text)
            os.replace(tmp, full)
        except OSError as e:
            self.send_json(500, {'error': str(e)})
            return
        sys.stderr.write('  записано %s\n' % os.path.relpath(full, ROOT))
        self.send_json(200, {'ok': True, 'file': os.path.relpath(full, ROOT)})

    def do_DELETE(self):
        full = self.target_path()
        if not full:
            self.send_json(403, {'error': 'видаляти можна лише docs/schedules/<id>.json'})
            return
        if not os.path.isfile(full):
            self.send_json(404, {'error': 'файла немає'})
            return
        try:
            os.remove(full)
        except OSError as e:
            self.send_json(500, {'error': str(e)})
            return
        sys.stderr.write('  видалено %s\n' % os.path.relpath(full, ROOT))
        self.send_json(200, {'ok': True})

    def log_message(self, fmt, *args):
        # тихіше за стандартний лог: цікавлять лише записи/видалення (їх пишемо вище)
        pass


def main():
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            sys.exit('Порт має бути числом, отримано: %s' % sys.argv[1])

    handler = functools.partial(AdminHandler, directory=ROOT)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)

    print('Корінь:  %s' % ROOT)
    print('Адмінка: http://localhost:%d/tools/admin/' % port)
    print('Розклад: http://localhost:%d/docs/' % port)
    print('Запис у %s увімкнено' % SCHEDULES_REL)
    print('Ctrl+C — зупинити')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()


if __name__ == '__main__':
    main()
