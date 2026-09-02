/* Редактор розкладів для docs/schedules/.
   Бекенду немає — інструмент читає файли через fetch (коли відкритий з
   локального сервера) або через "Імпорт", а результат віддає завантаженням.
   Робоча копія живе в localStorage, щоб незбережені правки не пропадали. */

const SCHEDULES_URL = '../../docs/schedules/';
const CATALOG_FILE  = 'index.json';
const WORKSPACE_KEY = 'adminWorkspace_v1';

// Копія базової палітри з docs/index.html — потрібна лише щоб показати
// у пікері реальний колір предмета. У JSON пишемо тільки те, що змінили.
const BASE_SUBJECT_COLORS = {
  "Здоров'я, безпека, добробут": '#0891b2',
  'Фізика': '#7c3aed',
  'Географія': '#059669',
  'Українська література': '#dc2626',
  'Фізична культура': '#ea580c',
  'Геометрія': '#2563eb',
  'Англійська мова': '#db2777',
  'Алгебра': '#4f46e5',
  'Українська мова': '#b91c1c',
  'Хімія': '#0d9488',
  'Біологія': '#65a30d',
  'Зарубіжна література': '#c026d3',
  'Історія': '#a16207',
  'Трудове навчання': '#78716c',
  'Мистецтво': '#e11d48',
  'Інформатика': '#0284c7',
};
const FALLBACK_PALETTE = ['#0891b2','#7c3aed','#059669','#dc2626','#ea580c','#2563eb','#db2777','#4f46e5'];
function colorForSubject(name){
  if(BASE_SUBJECT_COLORS[name]) return BASE_SUBJECT_COLORS[name];
  let h = 0;
  for(let i=0;i<name.length;i++) h = (h*31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

const DOW_NAMES = {
  1:['Пон.','Понеділок'], 2:['Вівт.','Вівторок'], 3:['Сер.','Середа'],
  4:['Чет.','Четвер'],    5:["П'ят.","П'ятниця"], 6:['Суб.','Субота'], 7:['Нед.','Неділя'],
};

const DEFAULT_BELLS = [
  { start:'08:30', end:'09:15' }, { start:'09:25', end:'10:10' },
  { start:'10:20', end:'11:05' }, { start:'11:20', end:'12:05' },
  { start:'12:15', end:'13:00' }, { start:'13:10', end:'13:55' },
  { start:'14:00', end:'14:45' },
];

let state = { order: [], byId: {}, currentId: null };

/* ==================== утиліти ==================== */
function esc(s){
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function $(sel){ return document.querySelector(sel); }

function banner(text, kind){
  const el = $('#banner');
  if(!text){ el.hidden = true; return; }
  el.hidden = false;
  el.className = 'banner' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function current(){ return state.currentId ? state.byId[state.currentId] : null; }

/* ==================== робоча копія ==================== */
function saveWorkspace(){
  try{ localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ order:state.order, byId:state.byId })); }
  catch(e){ banner('Не вдалося зберегти робочу копію: ' + e.message, 'error'); }
}
function loadWorkspace(){
  try{
    const raw = JSON.parse(localStorage.getItem(WORKSPACE_KEY));
    if(raw && Array.isArray(raw.order) && raw.byId) return raw;
  }catch(e){}
  return null;
}

/* ==================== читання з диска ==================== */
function fetchJSON(url){
  return fetch(url, { cache:'no-store' }).then(r => {
    if(!r.ok) throw new Error(url + ' → HTTP ' + r.status);
    return r.json();
  });
}

function loadFromDisk(){
  banner('Читаю docs/schedules/…');
  return fetchJSON(SCHEDULES_URL + CATALOG_FILE)
    .then(cat => {
      if(!cat || !Array.isArray(cat.schedules)) throw new Error('index.json без масиву schedules');
      return Promise.all(cat.schedules.map(entry =>
        fetchJSON(SCHEDULES_URL + (entry.file || entry.id + '.json'))
          .then(data => ({ entry:entry, data:data }))
      ));
    })
    .then(list => {
      state.order = [];
      state.byId = {};
      list.forEach(({ entry, data }) => {
        const id = data.id || entry.id;
        data.id = id;
        if(entry.isDefault) data.isDefault = true;
        state.order.push(id);
        state.byId[id] = data;
      });
      state.currentId = state.order[0] || null;
      saveWorkspace();
      renderAll();
      banner('Завантажено розкладів: ' + state.order.length, null);
    })
    .catch(err => {
      banner('Не вдалося прочитати файли (' + err.message + '). Запусти через serve.sh / serve.ps1 '
           + 'або скористайся кнопкою «Імпорт».', 'error');
    });
}

/* ==================== операції над розкладами ==================== */
function uniqueId(base){
  let id = base, n = 2;
  while(state.byId[id]) id = base + '-' + (n++);
  return id;
}

function blankSchedule(){
  const id = uniqueId('new-class');
  return {
    id: id,
    name: 'Новий розклад',
    subtitle: '',
    isDefault: false,
    updated: todayISO(),
    bells: clone(DEFAULT_BELLS),
    days: [1,2,3,4,5].map(dow => ({
      dow: dow,
      short: DOW_NAMES[dow][0],
      full: DOW_NAMES[dow][1],
      lessons: DEFAULT_BELLS.map(() => ''),
    })),
    holidays: [],
  };
}

function addSchedule(sched){
  state.order.push(sched.id);
  state.byId[sched.id] = sched;
  state.currentId = sched.id;
  saveWorkspace();
  renderAll();
}

function cloneSchedule(id){
  const src = state.byId[id];
  if(!src) return;
  const copy = clone(src);
  copy.id = uniqueId(id + '-copy');
  copy.name = (src.name || id) + ' (копія)';
  copy.isDefault = false;
  copy.updated = todayISO();
  addSchedule(copy);
  banner('Створено копію: ' + copy.id, null);
}

function deleteSchedule(id){
  const s = state.byId[id];
  if(!s) return;
  if(!confirm('Видалити розклад «' + (s.name || id) + '» з робочого набору?\n\n'
            + 'Файл docs/schedules/' + id + '.json треба буде прибрати вручну:\n'
            + 'git rm docs/schedules/' + id + '.json')) return;
  delete state.byId[id];
  state.order = state.order.filter(x => x !== id);
  if(state.currentId === id) state.currentId = state.order[0] || null;
  saveWorkspace();
  renderAll();
  banner('Прибрано з набору: ' + id + '. Не забудь git rm docs/schedules/' + id + '.json', 'warn');
}

// Розклад за замовчуванням може бути лише один — вмикання знімає прапорець з решти.
function setDefault(id, on){
  state.order.forEach(x => { state.byId[x].isDefault = false; });
  if(on) state.byId[id].isDefault = true;
  saveWorkspace();
  renderAll();
}

function renameId(oldId, newId){
  newId = String(newId || '').trim();
  if(!newId || newId === oldId) return false;
  if(state.byId[newId]){ banner('Ідентифікатор «' + newId + '» уже зайнятий', 'error'); return false; }
  const sched = state.byId[oldId];
  sched.id = newId;
  state.byId[newId] = sched;
  delete state.byId[oldId];
  state.order = state.order.map(x => x === oldId ? newId : x);
  if(state.currentId === oldId) state.currentId = newId;
  saveWorkspace();
  renderAll();
  return true;
}

/* ==================== валідація ==================== */
const TIME_RE = /^\d{1,2}:\d{2}$/;

function toMinutes(t){ const p = String(t).split(':'); return Number(p[0])*60 + Number(p[1]); }

function validate(sched){
  const issues = [];
  const err  = t => issues.push({ level:'error', text:t });
  const warn = t => issues.push({ level:'warn',  text:t });

  if(!/^[a-z0-9-]+$/.test(sched.id || '')) err('Ідентифікатор може містити лише малі латинські літери, цифри й дефіс');
  if(!String(sched.name || '').trim()) err('Порожня назва розкладу');

  const dupes = state.order.filter(x => x !== sched.id && state.byId[x].id === sched.id);
  if(dupes.length) err('Такий ідентифікатор уже є в іншому розкладі');

  if(!sched.bells.length) err('Немає жодного дзвінка');
  sched.bells.forEach((b, i) => {
    if(!TIME_RE.test(b.start) || !TIME_RE.test(b.end)){ err('Урок ' + (i+1) + ': час має бути у форматі ГГ:ХХ'); return; }
    if(toMinutes(b.end) <= toMinutes(b.start)) err('Урок ' + (i+1) + ': кінець не пізніше за початок');
    if(i > 0 && TIME_RE.test(sched.bells[i-1].end) && toMinutes(b.start) < toMinutes(sched.bells[i-1].end))
      err('Урок ' + (i+1) + ' починається раніше, ніж закінчився попередній');
  });

  if(!sched.days.length) err('Немає жодного дня');
  const seen = {};
  sched.days.forEach(d => {
    if(seen[d.dow]) err('День тижня ' + (DOW_NAMES[d.dow] ? DOW_NAMES[d.dow][1] : d.dow) + ' доданий двічі');
    seen[d.dow] = true;
    if(!String(d.short || '').trim()) warn('У дня ' + d.dow + ' порожня коротка назва — у шапці таблиці буде пусто');
  });

  const totalLessons = sched.days.reduce((n, d) => n + d.lessons.filter(x => String(x || '').trim()).length, 0);
  if(!totalLessons) warn('У сітці немає жодного предмета');

  (sched.holidays || []).forEach((h, i) => {
    if(!h.start || !h.end) err('Канікули ' + (i+1) + ': заповни обидві дати');
    else if(h.end < h.start) err('Канікули ' + (i+1) + ': кінець раніше за початок');
    if(!String(h.name || '').trim()) warn('Канікули ' + (i+1) + ': без назви');
  });

  const defaults = state.order.filter(x => state.byId[x].isDefault);
  if(defaults.length === 0) warn('Жоден розклад не позначений як «за замовчуванням» — застосунок візьме перший зі списку');
  if(defaults.length > 1) err('Розкладів за замовчуванням більше одного: ' + defaults.join(', '));

  return issues;
}

/* ==================== експорт ==================== */
function cleanForExport(sched){
  const out = {
    id: sched.id,
    name: String(sched.name || '').trim(),
  };
  if(String(sched.subtitle || '').trim()) out.subtitle = sched.subtitle.trim();
  out.isDefault = !!sched.isDefault;
  if(sched.updated) out.updated = sched.updated;
  out.bells = sched.bells.map(b => ({ start:b.start, end:b.end }));
  out.days = sched.days.slice().sort((a,b) => a.dow - b.dow).map(d => ({
    dow: d.dow,
    short: d.short,
    full: d.full,
    // довжина рівно по кількості дзвінків — щоб урок не «поїхав» на чужий час
    lessons: sched.bells.map((_, i) => String(d.lessons[i] || '').trim()),
  }));
  if((sched.holidays || []).length){
    out.holidays = sched.holidays.map(h => ({ start:h.start, end:h.end, name:String(h.name || '').trim() }));
  }
  const colors = sched.subjectColors || {};
  if(Object.keys(colors).length) out.subjectColors = colors;
  return out;
}

function buildCatalog(){
  return {
    version: 1,
    schedules: state.order.map(id => {
      const s = state.byId[id];
      return { id: id, name: String(s.name || id).trim(), file: id + '.json', isDefault: !!s.isDefault };
    }),
  };
}

function download(filename, text){
  const blob = new Blob([text], { type:'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ==================== рендер списку ==================== */
function renderList(){
  const ul = $('#scheduleList');
  $('#schedCount').textContent = state.order.length ? '(' + state.order.length + ')' : '';
  if(!state.order.length){
    ul.innerHTML = '<li class="sidebar-note">Порожньо. Натисни «З диска» або «Новий розклад».</li>';
    return;
  }
  ul.innerHTML = state.order.map(id => {
    const s = state.byId[id];
    const lessons = s.days.reduce((n, d) => n + d.lessons.filter(x => String(x || '').trim()).length, 0);
    return '<li class="sched-item' + (id === state.currentId ? ' active' : '') + '" data-id="' + esc(id) + '">'
      + '<div class="sched-item-name">' + esc(s.name || id) + (s.isDefault ? ' <span title="за замовчуванням">★</span>' : '') + '</div>'
      + '<div class="sched-item-meta">' + esc(id) + '.json · ' + s.days.length + ' дн. · ' + lessons + ' уроків</div>'
      + '<div class="sched-item-actions">'
      +   '<button type="button" class="btn small" data-act="clone" data-id="' + esc(id) + '">Клонувати</button>'
      +   '<button type="button" class="btn small danger" data-act="delete" data-id="' + esc(id) + '">Видалити</button>'
      + '</div>'
      + '</li>';
  }).join('');
}

/* ==================== рендер редактора ==================== */
function allSubjects(){
  const set = {};
  state.order.forEach(id => {
    state.byId[id].days.forEach(d => d.lessons.forEach(x => {
      const v = String(x || '').trim();
      if(v) set[v] = true;
    }));
  });
  return Object.keys(set).sort();
}

function subjectsOf(sched){
  const set = {};
  sched.days.forEach(d => d.lessons.forEach(x => {
    const v = String(x || '').trim();
    if(v) set[v] = true;
  }));
  return Object.keys(set).sort();
}

function renderEditor(){
  const el = $('#editor');
  const s = current();
  if(!s){
    el.innerHTML = '<div class="editor-empty">Вибери розклад зліва або створи новий.</div>';
    return;
  }
  const days = s.days.slice().sort((a,b) => a.dow - b.dow);
  s.days = days;

  let html = '';
  html += '<h2>' + esc(s.name || s.id) + '</h2>';

  html += '<div class="field-grid">'
    + field('Ідентифікатор (ім\'я файлу)', '<input type="text" id="fId" value="' + esc(s.id) + '">', 'малі латинські літери, цифри, дефіс → ' + esc(s.id) + '.json')
    + field('Назва (заголовок сторінки)', '<input type="text" id="fName" value="' + esc(s.name || '') + '">')
    + field('Підзаголовок', '<input type="text" id="fSubtitle" value="' + esc(s.subtitle || '') + '">', 'школа, класний керівник тощо')
    + field('Дата складання', '<input type="date" id="fUpdated" value="' + esc(s.updated || '') + '">')
    + '</div>';

  html += '<div class="check-row"><input type="checkbox" id="fDefault"' + (s.isDefault ? ' checked' : '') + '>'
        + '<label for="fDefault">Розклад за замовчуванням (★) — його бачать нові користувачі</label></div>';

  // ---- сітка ----
  html += '<h3>Дзвінки й уроки</h3><div class="grid-scroll"><table class="grid"><tr><th></th><th>Час</th>';
  days.forEach((d, di) => {
    html += '<th><div class="col-head">'
      + '<div class="row"><select data-day-dow="' + di + '">'
      + [1,2,3,4,5,6,7].map(n => '<option value="' + n + '"' + (n === d.dow ? ' selected' : '') + '>' + DOW_NAMES[n][1] + '</option>').join('')
      + '</select>'
      + '<button type="button" class="btn small danger" data-act="del-day" data-i="' + di + '" title="Прибрати день">✕</button></div>'
      + '<input type="text" data-day-short="' + di + '" value="' + esc(d.short || '') + '" placeholder="Пон.">'
      + '</div></th>';
  });
  html += '</tr>';

  s.bells.forEach((b, ri) => {
    html += '<tr><td class="num">' + (ri+1) + '</td>'
      + '<td><input type="time" data-bell-start="' + ri + '" value="' + esc(b.start) + '">'
      + '<input type="time" data-bell-end="' + ri + '" value="' + esc(b.end) + '"></td>';
    days.forEach((d, di) => {
      html += '<td><input type="text" list="subjectList" data-cell-r="' + ri + '" data-cell-d="' + di + '" value="'
            + esc(d.lessons[ri] || '') + '" placeholder="—"></td>';
    });
    html += '</tr>';
  });
  html += '</table></div>';
  html += '<div class="row-actions">'
    + '<button type="button" class="btn small" data-act="add-bell">＋ Урок</button>'
    + '<button type="button" class="btn small danger" data-act="del-bell">− Останній урок</button>'
    + '<button type="button" class="btn small" data-act="add-day">＋ День</button>'
    + '</div>';

  html += '<datalist id="subjectList">' + allSubjects().map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>';

  // ---- канікули ----
  html += '<h3>Канікули та свята</h3>';
  (s.holidays || []).forEach((h, i) => {
    html += '<div class="holiday-row">'
      + '<input type="date" data-hol-start="' + i + '" value="' + esc(h.start || '') + '">'
      + '<input type="date" data-hol-end="' + i + '" value="' + esc(h.end || '') + '">'
      + '<input type="text" data-hol-name="' + i + '" value="' + esc(h.name || '') + '" placeholder="Осінні канікули">'
      + '<button type="button" class="btn small danger" data-act="del-holiday" data-i="' + i + '">✕</button>'
      + '</div>';
  });
  html += '<div class="row-actions"><button type="button" class="btn small" data-act="add-holiday">＋ Період</button></div>';

  // ---- кольори ----
  const subjects = subjectsOf(s);
  html += '<h3>Кольори предметів</h3>';
  if(!subjects.length){
    html += '<p class="field"><span class="hint">Заповни сітку — тут з\'являться предмети.</span></p>';
  } else {
    html += '<div class="color-list">' + subjects.map(name => {
      const overridden = s.subjectColors && s.subjectColors[name];
      const value = overridden || colorForSubject(name);
      return '<span class="color-chip">'
        + '<input type="color" data-color="' + esc(name) + '" value="' + esc(value) + '">'
        + esc(name)
        + (overridden ? '<button type="button" class="reset" data-act="reset-color" data-name="' + esc(name) + '" title="Повернути стандартний">↺</button>' : '')
        + '</span>';
    }).join('') + '</div>'
    + '<p class="field"><span class="hint">Змінені кольори потраплять у JSON, решта береться зі стандартної палітри сторінки.</span></p>';
  }

  // ---- валідація + експорт ----
  const issues = validate(s);
  html += '<h3>Перевірка</h3><ul class="issues">';
  html += issues.length
    ? issues.map(i => '<li class="' + i.level + '">' + esc(i.text) + '</li>').join('')
    : '<li class="ok">Помилок немає — можна експортувати</li>';
  html += '</ul>';

  const hasErrors = issues.some(i => i.level === 'error');
  html += '<div class="export-bar">'
    + '<button type="button" class="btn primary" data-act="export-schedule"' + (hasErrors ? ' disabled' : '') + '>⬇ Завантажити ' + esc(s.id) + '.json</button>'
    + '<button type="button" class="btn" data-act="export-catalog">⬇ Завантажити index.json</button>'
    + '<button type="button" class="btn" data-act="copy-json">📋 Скопіювати JSON</button>'
    + '</div>';

  el.innerHTML = html;
}

function field(label, control, hint){
  return '<div class="field"><label>' + esc(label) + '</label>' + control
       + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
}

function renderAll(){
  renderList();
  renderEditor();
}

/* ==================== події ==================== */
$('#scheduleList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if(btn){
    e.stopPropagation();
    if(btn.dataset.act === 'clone')  cloneSchedule(btn.dataset.id);
    if(btn.dataset.act === 'delete') deleteSchedule(btn.dataset.id);
    return;
  }
  const item = e.target.closest('.sched-item[data-id]');
  if(!item) return;
  state.currentId = item.dataset.id;
  renderAll();
});

// Текстові поля правлять стан без перемальовування — щоб не втрачався фокус.
$('#editor').addEventListener('input', (e) => {
  const s = current();
  if(!s) return;
  const t = e.target;
  const d = t.dataset;

  if(t.id === 'fName')     { s.name = t.value; }
  else if(t.id === 'fSubtitle'){ s.subtitle = t.value; }
  else if(t.id === 'fUpdated') { s.updated = t.value; }
  else if(d.bellStart !== undefined) { s.bells[+d.bellStart].start = t.value; }
  else if(d.bellEnd   !== undefined) { s.bells[+d.bellEnd].end = t.value; }
  else if(d.cellR     !== undefined) { s.days[+d.cellD].lessons[+d.cellR] = t.value; }
  else if(d.dayShort  !== undefined) { s.days[+d.dayShort].short = t.value; }
  else if(d.holStart  !== undefined) { s.holidays[+d.holStart].start = t.value; }
  else if(d.holEnd    !== undefined) { s.holidays[+d.holEnd].end = t.value; }
  else if(d.holName   !== undefined) { s.holidays[+d.holName].name = t.value; }
  else if(d.color     !== undefined) {
    s.subjectColors = s.subjectColors || {};
    s.subjectColors[d.color] = t.value;
  }
  else return;

  saveWorkspace();
  if(t.id === 'fName') renderList();
});

$('#editor').addEventListener('change', (e) => {
  const s = current();
  if(!s) return;
  const t = e.target;

  if(t.id === 'fId'){
    if(!renameId(s.id, t.value)) t.value = s.id;
    return;
  }
  if(t.id === 'fDefault'){ setDefault(s.id, t.checked); return; }
  if(t.dataset.dayDow !== undefined){
    const i = +t.dataset.dayDow, dow = +t.value;
    s.days[i].dow = dow;
    s.days[i].short = DOW_NAMES[dow][0];
    s.days[i].full  = DOW_NAMES[dow][1];
    saveWorkspace();
    renderAll();
    return;
  }
  if(t.dataset.color !== undefined){ renderEditor(); } // щоб з'явилась кнопка "↺"
});

$('#editor').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if(!btn) return;
  const s = current();
  if(!s) return;

  switch(btn.dataset.act){
    case 'add-bell': {
      const last = s.bells[s.bells.length-1];
      s.bells.push(last ? { start:last.end, end:last.end } : { start:'08:30', end:'09:15' });
      s.days.forEach(d => d.lessons.push(''));
      break;
    }
    case 'del-bell': {
      if(!s.bells.length) return;
      if(!confirm('Прибрати останній урок? Нотатки користувачів прив\'язані до номера уроку.')) return;
      s.bells.pop();
      s.days.forEach(d => d.lessons.pop());
      break;
    }
    case 'add-day': {
      const used = s.days.map(d => d.dow);
      const free = [1,2,3,4,5,6,7].find(n => used.indexOf(n) === -1);
      if(free === undefined){ banner('Усі сім днів уже додані', 'warn'); return; }
      s.days.push({ dow:free, short:DOW_NAMES[free][0], full:DOW_NAMES[free][1], lessons:s.bells.map(() => '') });
      break;
    }
    case 'del-day': {
      const i = +btn.dataset.i;
      if(!confirm('Прибрати день «' + (s.days[i].full || s.days[i].dow) + '» разом з уроками?')) return;
      s.days.splice(i, 1);
      break;
    }
    case 'add-holiday':
      s.holidays = s.holidays || [];
      s.holidays.push({ start:'', end:'', name:'' });
      break;
    case 'del-holiday':
      s.holidays.splice(+btn.dataset.i, 1);
      break;
    case 'reset-color':
      if(s.subjectColors){
        delete s.subjectColors[btn.dataset.name];
        if(!Object.keys(s.subjectColors).length) delete s.subjectColors;
      }
      break;
    case 'export-schedule':
      download(s.id + '.json', JSON.stringify(cleanForExport(s), null, 2) + '\n');
      banner('Поклади ' + s.id + '.json у docs/schedules/', null);
      return;
    case 'export-catalog':
      download(CATALOG_FILE, JSON.stringify(buildCatalog(), null, 2) + '\n');
      banner('Поклади index.json у docs/schedules/', null);
      return;
    case 'copy-json': {
      const text = JSON.stringify(cleanForExport(s), null, 2);
      if(navigator.clipboard) navigator.clipboard.writeText(text).then(
        () => banner('JSON скопійовано в буфер', null),
        () => banner('Не вдалося скопіювати — браузер заблокував доступ до буфера', 'error'));
      else banner('Браузер не підтримує копіювання в буфер', 'error');
      return;
    }
    default: return;
  }

  saveWorkspace();
  renderAll();
});

$('#btnNew').addEventListener('click', () => {
  addSchedule(blankSchedule());
  banner('Створено новий розклад — заповни сітку й експортуй', null);
});

$('#btnReload').addEventListener('click', () => {
  if(state.order.length && !confirm('Перечитати файли з диска? Незбережені правки в робочій копії пропадуть.')) return;
  loadFromDisk();
});

$('#fileImport').addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []);
  if(!files.length) return;
  let added = 0, failed = [];
  Promise.all(files.map(f => f.text().then(text => {
    let data;
    try{ data = JSON.parse(text); }catch(err){ failed.push(f.name); return; }
    if(data && Array.isArray(data.schedules)) return;      // це каталог — метадані відновимо з файлів
    if(!data || !Array.isArray(data.bells) || !Array.isArray(data.days)){ failed.push(f.name); return; }
    const id = data.id || f.name.replace(/\.json$/i, '');
    data.id = id;
    if(!state.byId[id]) state.order.push(id);
    state.byId[id] = data;
    state.currentId = id;
    added++;
  }))).then(() => {
    saveWorkspace();
    renderAll();
    banner('Імпортовано: ' + added + (failed.length ? ' · не розпізнано: ' + failed.join(', ') : ''),
           failed.length ? 'warn' : null);
  });
  e.target.value = '';
});

/* ==================== старт ==================== */
const ws = loadWorkspace();
if(ws){
  state.order = ws.order;
  state.byId = ws.byId;
  state.currentId = ws.order[0] || null;
  renderAll();
  banner('Відновлено робочу копію з браузера. «↻ З диска» — перечитати файли заново.', 'warn');
} else {
  renderAll();
  loadFromDisk();
}
