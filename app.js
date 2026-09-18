const SHEET = '1tU9nmUWE7VytROzZ7hfFBosGr688D_T6j00x1pvEHC8';
// ponytail: gid'ы листов захардкожены — если лист пересоздать, поменять тут
const GIDS = { results: 0, points: 1648388688, charters: 2087979315, drivers: 714264185, stages: 194630197, penalties: 807303105 };
const SLOTS = 8;
const NEXT = 'next';
// Цвета и короткие имена — из nascar-charters/data/teams.js
const TEAM_STYLE = {
  'Team Penske': ['Penske', '#ffd23f'], 'Roush Fenway Racing': ['Roush Fenway', '#4fb477'],
  'JTG Daugherty Racing': ['JTG', '#ff9a3c'], 'Wood Brothers Racing': ['Wood Bros', '#e8e2cf'],
  'Furniture Row': ['Furniture Row', '#d98a5b'], 'Leavine Family': ['Leavine', '#9ad0f5'],
  'Chip Ganassi Racing': ['CGR', '#ff7aa8'], 'Stewart-Haas Racing': ['Stewart-Haas', '#c3c9d1'],
  'Michael Waltrip Racing': ['MWR', '#6fe0d0'], 'Joe Gibbs Racing': ['JGR', '#34c77b'],
  'Hendrick Motorsports': ['Hendrick', '#5b8cff'], 'Richard Childress Racing': ['RCR', '#ff5a4e'],
  'Germain Racing': ['Germain', '#7fc4b8'], 'BK Racing': ['BK Racing', '#e0a05a'],
  'Front Row Motorsports': ['Front Row', '#3fa9f5'], 'HScott Motorsports': ['HScott', '#b89adb'],
  'Richard Petty Motorsports': ['Petty', '#35b6ff'],
};
const teamStyle = name => { const [short, color] = TEAM_STYLE[name] || [name.replace(/ (Racing|Motorsports)$/, ''), '#9aa3b5']; return { short, color }; };
const MAKER_VAR = { Ford: '--s1', Chevrolet: '--s2', Toyota: '--s3' };

// ---------- загрузка ----------
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function sheet(gid) {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${gid}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseCSV(await r.text());
}

const isTrue = v => String(v).trim().toUpperCase() === 'TRUE';
// ponytail: даты без года (ДД/ММ) — сортировка внутри одного года; сезон через Новый год потребует года в таблице
const dateKey = d => { const [dd, mm] = String(d).split(/[./]/).map(Number); return (mm || 0) * 100 + (dd || 0); };

// ---------- расчёт ----------
function parse({ results, points, charters, drivers, stages, penalties }) {
  const ids = {}, names = {};
  for (const [id0, disp0] of drivers.slice(1)) {
    const id = id0.trim(); if (!id) continue;
    const disp = (disp0 || id).trim();
    names[id] = disp;
    for (const a of [id, disp, disp.replace(/[()]/g, '').trim()]) ids[a.toLowerCase()] = ids[a.toLowerCase()] || id;
  }
  const resolve = n => { n = String(n || '').trim(); return n && (ids[n.toLowerCase()] || n); };

  const placePts = {}; let winBonus = 0;
  for (const [k, v] of points.slice(1)) {
    const n = Number(v) || 0, key = k.trim().toLowerCase();
    if (/^\d+$/.test(key)) placePts[+key] = n;
    else if (key.startsWith('побед')) winBonus = n;
  }

  const races = new Map();
  const mk = r => ({ id: r[0], date: r[1], no: +r[2] || 0, track: r[3], counted: isTrue(r[4]), note: '', penalties: [], rows: [] });
  for (const r of stages.slice(1)) if (r[3]) races.set(r[0], { ...mk(r), note: r[5] || '' });
  for (const r of results.slice(1)) {
    const who = resolve(r[7]);
    if (!who || !r[5]) continue;
    if (!races.has(r[0])) races.set(r[0], mk(r));
    races.get(r[0]).rows.push({ who, pos: +r[5], dnf: isTrue(r[6]), bonus: Number(String(r[8]).replace(',', '.')) || 0 });
  }
  for (const r of penalties.slice(1)) {
    const race = races.get(r[0]), n = Number(r[7]) || 0;
    if (race && r[5] && n) race.penalties.push({ who: resolve(r[5]), victim: resolve(r[6]), n, note: (r[8] || '').trim() });
  }

  // Чартеры: колонки ищутся по заголовкам (вставка новых столбцов ничего не ломает).
  // После служебных колонок: с датой = сезоны, без заголовка, но с отметками = следующий сезон
  const head = (charters[0] || []).map(h => h.trim());
  const at = (re, def) => { const i = head.findIndex(h => re.test(h)); return i >= 0 ? i : def; };
  const cMaker = at(/^постав/i, 0), cTeam = at(/^команд/i, 1), cFull = at(/^фулл|^full/i, -1), cNum = at(/^№$/, 2), cDrv = at(/^гонщ/i, 3);
  const first = Math.max(cMaker, cTeam, cFull, cNum, cDrv) + 1;
  const cols = head.map((h, i) => i >= first && (h ? h : charters.slice(1).some(r => isTrue(r[i])) ? NEXT : null));
  const entries = charters.slice(1).filter(r => r[cNum]?.trim()).map(r => ({
    maker: r[cMaker].trim(), team: r[cTeam].trim(), num: r[cNum].trim(), driver: resolve(r[cDrv]),
    full: cFull >= 0 && isTrue(r[cFull]), // фулл-тайм: на машину выдан чартер
    on: Object.fromEntries(cols.map((c, i) => c && [c, isTrue(r[i])]).filter(Boolean)),
  }));
  const charterDates = [...new Set(cols.filter(c => c && c !== NEXT))].sort((a, b) => dateKey(a) - dateKey(b));
  const hasNext = cols.includes(NEXT);

  const list = [...races.values()].filter(s => s.rows.length)
    .sort((a, b) => dateKey(a.date) - dateKey(b.date) || a.no - b.no || a.id - b.id);
  const unmatched = new Set();
  for (const s of list) {
    s.rows.sort((a, b) => a.pos - b.pos);
    for (const p of s.penalties) {
      const i = s.rows.findIndex(r => r.who === p.who);
      if (i < 0) continue;
      const [row] = s.rows.splice(i, 1);
      Object.assign(row, { origPos: row.pos, penalty: p.n, penaltyNote: p.note });
      s.rows.splice(Math.min(i + p.n, s.rows.length), 0, row);
    }
    if (s.penalties.length) s.rows.forEach((r, i) => r.pos = i + 1);
    const bonuses = s.rows.map(r => r.bonus).filter(b => b > 0);
    const maxB = Math.max(0, ...bonuses), minB = Math.min(...bonuses);
    for (const r of s.rows) {
      // ★ — наибольший бонус гонки, если он выделяется: больше чужого или больше 1 (у всех по 1 → звезды нет)
      r.lead = r.bonus > 0; r.most = r.lead && r.bonus === maxB && (maxB > minB || maxB > 1);
      r.perfect = r.pos === 1 && r.most; // идеальная гонка: победа + наибольший бонус за лидирование
      r.pts = s.counted ? (placePts[r.pos] || 0) + (r.pos === 1 ? winBonus : 0) + r.bonus : 0; // вне зачёта — без очков
      r.race = s;
      r.ch = entries.find(e => e.driver === r.who && e.on[s.date]) || null;
      if (!r.ch) unmatched.add(`${r.who} ${s.date}`);
    }
  }
  if (unmatched.size) console.warn('Без чартера:', [...unmatched]);
  return { list, entries, charterDates, hasNext, names, winBonus };
}

function statsOf(rows) {
  rows = rows.filter(r => r.race.counted);
  const best = rows.reduce((b, r) => !b || r.pos < b.pos ? r : b, null);
  return {
    starts: rows.length, pts: rows.reduce((a, r) => a + r.pts, 0),
    wins: rows.filter(r => r.pos === 1).length, podiums: rows.filter(r => r.pos <= 3).length,
    dnf: rows.filter(r => r.dnf).length,
    led: rows.filter(r => r.lead).length, most: rows.filter(r => r.most).length, perfect: rows.filter(r => r.perfect).length,
    avg: rows.length ? rows.reduce((a, r) => a + r.pos, 0) / rows.length : null, best,
    places: rows.reduce((p, r) => (p[r.pos] = (p[r.pos] || 0) + 1, p), []),
  };
}

// Очки, затем больше побед, вторых мест, третьих… Полное равенство → 0
function byStandings(a, b) {
  if (b.pts !== a.pts) return b.pts - a.pts;
  for (let p = 1, n = Math.max(a.places.length, b.places.length); p < n; p++) {
    const d = (b.places[p] || 0) - (a.places[p] || 0);
    if (d) return d;
  }
  return 0;
}
// Сортирует и проставляет rank; при полной ничьей позиция общая («1, 2, 2, 4»)
function rankAll(list, name) {
  list.sort((a, b) => byStandings(a, b) || name(a).localeCompare(name(b), 'ru'));
  list.forEach((x, i) => x.rank = i && !byStandings(list[i - 1], x) ? list[i - 1].rank : i + 1);
  return list;
}

function summarize(list) {
  const counted = list.filter(s => s.counted);
  const names = [...new Set(list.flatMap(s => s.rows.map(r => r.who)))];
  const table = (n, races = counted) => {
    const rows = races.slice(0, n).flatMap(s => s.rows);
    return rankAll(names.map(who => ({ who, ...statsOf(rows.filter(r => r.who === who)) })), x => x.who);
  };
  const now = table(counted.length);
  const prev = counted.length > 1 ? table(counted.length - 1) : null;
  now.forEach(d => { d.change = prev ? prev.find(p => p.who === d.who).rank - d.rank : 0; });
  const progress = Object.fromEntries(names.map(n => [n, []]));
  list.forEach((_, i) => table(i + 1, list).forEach(d => progress[d.who].push(d.pts)));
  return { list, counted, standings: now, progress };
}

// Сезон = все гонки одной даты; чемпион — первый в зачёте сезона
function build(P) {
  const { list, entries } = P;
  const by = new Map();
  for (const s of list) by.has(s.date) ? by.get(s.date).push(s) : by.set(s.date, [s]);
  const today = new Date(), todayKey = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}`;
  const seasons = [...by].map(([date, stages], i) => ({ key: date, n: i + 1, date, ...summarize(stages) }));
  const titles = {}, rank = {};
  for (const s of seasons) {
    s.live = s.date === todayKey; // сегодняшний сезон может быть ещё не доигран
    s.champ = s.standings[0];
    s.champs = s.standings.filter(d => d.rank === 1).map(d => d.who);
    if (!s.live) for (const w of s.champs) titles[w] = (titles[w] || 0) + 1;
    rank[s.date] = Object.fromEntries(s.standings.map(d => [d.who, d]));
  }
  const rows = list.flatMap(s => s.rows);
  const all = { key: 'all', ...summarize(list) };

  const teams = new Map(), makers = new Map();
  for (const e of entries) {
    if (!teams.has(e.team)) teams.set(e.team, { name: e.team, makers: new Set(), entries: [], ...teamStyle(e.team) });
    teams.get(e.team).makers.add(e.maker); teams.get(e.team).entries.push(e);
    if (e.maker && !makers.has(e.maker)) makers.set(e.maker, { name: e.maker });
  }
  for (const t of teams.values()) { t.rows = rows.filter(r => r.ch?.team === t.name); t.stats = statsOf(t.rows); }
  for (const m of makers.values()) { m.rows = rows.filter(r => r.ch?.maker === m.name); m.stats = statsOf(m.rows); }
  // Командный зачёт сезона — сумма очков пилотов команды
  const teamRank = {};
  for (const s of seasons) {
    const sums = [...teams.values()].map(t => ({ team: t.name, ...statsOf(t.rows.filter(r => r.race.date === s.date)) }))
      .filter(x => x.starts);
    rankAll(sums, x => x.team);
    teamRank[s.date] = Object.fromEntries(sums.map(x => [x.team, x]));
  }
  const pilots = new Map(all.standings.map(d => [d.who, d]));
  const lastDate = seasons.at(-1)?.date;
  return { ...P, seasons, titles, rank, all, rows, teams, makers, teamRank, pilots, lastDate };
}

// ---------- помощники ----------
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const zero = n => n || '<span class="muted">0</span>';
const nm = id => DATA.names[id] || id;
const trackName = t => String(t).replace(/\s*\([^)]*\)/g, '').trim();
const raceName = s => `${trackName(s.track)} · ${s.date}`;
const tipAttr = lines => `data-tip="${esc(lines.filter(Boolean).join('\n'))}"`;
const plink = id => `<a class="lnk" href="#" data-pilot="${esc(id)}">${esc(nm(id))}</a>`;
const tlink = (team, label) => `<a class="lnk tl" href="#" data-team="${esc(team)}" style="--c:${teamStyle(team).color}">${esc(label ?? teamStyle(team).short)}</a>`;
const rlink = s => `<a class="lnk" href="#" data-race="${esc(s.id)}">${esc(trackName(s.track))}</a>`;
const carTag = e => e ? `<span class="car" style="--c:${teamStyle(e.team).color}">#${esc(e.num)}</span> ${tlink(e.team)}` : '<span class="muted">без чартера</span>';
const chOf = (who, date) => DATA.entries.find(e => e.driver === who && e.on[date]) || null;
const lastCar = who => chOf(who, DATA.lastDate) || [...DATA.entries].reverse().find(e => e.driver === who && Object.values(e.on).some(Boolean)) || null;
const penText = p => `${nm(p.who)} −${p.n} ${plural(p.n, 'позиция', 'позиции', 'позиций')}${p.victim ? ` в пользу ${nm(p.victim)}` : ''}${p.note ? ` — ${p.note}` : ''}`;
const ftBadge = e => e?.full ? '<i class="ftb" title="Фулл-тайм: чартер выдан">FT</i>' : '';
const posCls = p => p === 1 ? 'c1' : p === 2 ? 'c2' : p === 3 ? 'c3' : p <= 5 ? 'c45' : 'c6';
const medal = rank => rank <= 3 ? ` p${rank}` : '';
const seasonOf = () => DATA.seasons.find(s => s.key === cur) || null;
const scopeRows = rows => cur === 'all' ? rows : rows.filter(r => r.race.date === cur);
const scopeLabel = () => seasonOf() ? `сезон ${seasonOf().n}` : 'все сезоны';
const tile = (label, num, hint = '', lead = false) => `<div class="card tile${lead ? ' leader' : ''}"><div class="label">${label}</div><div class="num">${num}</div><div class="hint">${hint}</div></div>`;
const statTiles = (st, extra = '') => `<div class="tiles">${extra}
  ${tile('Победы', st.wins, `подиумов ${st.podiums}`)}
  ${tile('Очки', st.pts, `${st.starts} ${plural(st.starts, 'старт', 'старта', 'стартов')}`)}
  ${tile('Лучший финиш', st.best ? 'P' + st.best.pos : '—', st.best ? esc(raceName(st.best.race)) : '')}
  ${tile('Ср. место', st.avg == null ? '—' : st.avg.toFixed(1), `сходов ${st.dnf} · лидировал ${st.led}`)}
</div>`;
// Таймлайн: ряд карточек сезонов
const timeline = items => `<div class="tl-row">${items.map(i => `<div class="tl-item${i.sel ? ' sel' : ''}${i.empty ? ' empty' : ''}"${i.at && i.at !== NEXT ? ` data-at="${esc(i.at)}"` : ''} style="--c:${i.color || 'var(--line-off)'}">
  <span class="tl-top">${i.top}</span><span class="tl-main">${i.main}</span><span class="tl-sub">${i.sub || '&nbsp;'}</span></div>`).join('')}</div>`;

let DATA, V, cur = null, tab = null, charts = [], dcharts = [], picked = new Map(), hideEmpty = true, pilotsMode = 'cards';

// ---------- таблицы: сортировка и максимум колонки ----------
const cellVal = td => td ? (td.dataset.v ?? td.textContent.trim()) : '';
const cellNum = td => { if (!td) return null; if (td.dataset.v !== undefined) return td.dataset.v === '' ? null : Number(td.dataset.v); const m = td.textContent.replace('−', '-').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
function enhanceTables(root) {
  root.querySelectorAll('table.data').forEach(t => {
    const ths = [...t.tHead.rows[0].cells], rows = () => [...t.tBodies[0].rows];
    if (!t.classList.contains('nomax')) ths.forEach((th, i) => {
      const mode = th.dataset.best || 'max';
      if (mode === 'none') return;
      const cells = rows().map(r => r.cells[i]).filter(Boolean), nums = cells.map(cellNum);
      const vals = nums.filter(n => n !== null);
      if (!vals.length || new Set(vals).size < 2) return;
      const best = mode === 'min' ? Math.min(...vals) : Math.max(...vals);
      cells.forEach((c, k) => nums[k] === best && c.classList.add('best'));
    });
    ths.forEach((th, i) => {
      if (th.dataset.sort === 'off') return;
      th.classList.add('sortable');
      th.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        const numeric = rows().every(r => cellNum(r.cells[i]) !== null || !cellVal(r.cells[i]));
        const dir = th.dataset.dir === 'desc' ? 'asc' : th.dataset.dir === 'asc' ? 'desc' : (numeric && th.dataset.best !== 'min' && th.dataset.best !== 'none') ? 'desc' : 'asc';
        ths.forEach(x => delete x.dataset.dir); th.dataset.dir = dir;
        const k = dir === 'asc' ? 1 : -1;
        rows().sort((a, b) => {
          if (numeric) return k * ((cellNum(a.cells[i]) ?? (k > 0 ? Infinity : -Infinity)) - (cellNum(b.cells[i]) ?? (k > 0 ? Infinity : -Infinity)));
          return k * cellVal(a.cells[i]).localeCompare(cellVal(b.cells[i]), 'ru');
        }).forEach(r => t.tBodies[0].appendChild(r));
      });
    });
  });
}

// ---------- подсказки ----------
const tipEl = document.getElementById('tip');
function showTip(el, x, y) {
  const [head, ...rest] = el.dataset.tip.split('\n');
  tipEl.innerHTML = `<b>${esc(head)}</b>${rest.map(l => `<div>${esc(l)}</div>`).join('')}`;
  (el.closest('dialog') || document.body).appendChild(tipEl);
  tipEl.hidden = false;
  if (x == null) { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.bottom; }
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  tipEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, x + 12)) + 'px';
  tipEl.style.top = (y + 16 + h > innerHeight ? y - h - 12 : y + 16) + 'px';
}
document.addEventListener('mouseover', e => { const el = e.target.closest('[data-tip]'); el ? showTip(el, e.clientX, e.clientY) : (tipEl.hidden = true); });
document.addEventListener('mousemove', e => { if (!tipEl.hidden && e.target.closest('[data-tip]')) showTip(e.target.closest('[data-tip]'), e.clientX, e.clientY); });
document.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); el ? showTip(el) : (tipEl.hidden = true); });
document.addEventListener('scroll', () => tipEl.hidden = true, true);

// ---------- навигация ----------
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { tab: h.get('tab') || 'seasons', season: h.get('season'), pilot: h.get('pilot'), team: h.get('team'), car: h.get('car'), race: h.get('race') };
}
const NO_MODAL = { pilot: null, team: null, car: null, race: null };
function go(patch) {
  const h = { ...readHash(), ...patch };
  location.hash = new URLSearchParams(Object.entries(h).filter(([, v]) => v)).toString();
}
function route() {
  if (!DATA) return;
  const h = readHash();
  const season = h.season === 'all' || DATA.seasons.some(s => s.key === h.season) ? h.season : DATA.seasons.at(-1).key;
  if (h.tab !== tab || season !== cur) { tab = h.tab; cur = season; renderSeasonBar(); renderMain(); }
  if (h.pilot && (DATA.pilots.has(h.pilot) || DATA.entries.some(e => e.driver === h.pilot))) openPilot(h.pilot);
  else if (h.team && DATA.teams.has(h.team)) openTeam(h.team);
  else if (h.car && DATA.entries.some(e => e.num === h.car)) openCar(h.car);
  else if (h.race && DATA.list.some(s => s.id === h.race)) openRace(h.race);
  else if (dlg.open) dlg.close();
}
window.addEventListener('hashchange', route);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-pilot],[data-team],[data-car],[data-race],[data-tab],[data-season]');
  if (!el) return;
  e.preventDefault();
  const d = el.dataset;
  if (d.tab) return go({ ...NO_MODAL, tab: d.tab });
  if (d.season) return go({ ...NO_MODAL, season: d.season });
  // Элемент другого сезона — переключаемся на его сезон (при «Все сезоны» остаёмся во всех)
  const at = d.race ? DATA.list.find(s => s.id === d.race)?.date : el.closest('[data-at]')?.dataset.at;
  const season = at && cur !== 'all' && at !== cur && DATA.seasons.some(s => s.key === at) ? { season: at } : {};
  const key = ['pilot', 'team', 'car', 'race'].find(k => d[k]);
  go({ ...NO_MODAL, ...season, [key]: d[key] });
});
const dlg = document.getElementById('dlg');
dlg.addEventListener('close', () => { dcharts.forEach(c => c.destroy()); dcharts = []; tipEl.hidden = true; const h = readHash(); if (h.pilot || h.team || h.car || h.race) go(NO_MODAL); });
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

function showDialog(html) {
  dcharts.forEach(c => c.destroy()); dcharts = [];
  const body = document.getElementById('dlg-body');
  delete body.dataset.at;
  body.innerHTML = html;
  enhanceTables(body);
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

// ---------- каркас ----------
function renderSeasonBar() {
  document.querySelectorAll('#nav button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === tab));
  const items = [{ key: 'all', label: 'Все сезоны' }, ...[...DATA.seasons].reverse().map(s => ({ key: s.key, label: `Сезон ${s.n} · ${s.date}` }))];
  document.getElementById('seasonbar').innerHTML = items.map(i => `<button data-season="${esc(i.key)}" aria-pressed="${i.key === cur}">${esc(i.label)}</button>`).join('');
}

function renderMain() {
  charts.forEach(c => c.destroy()); charts = [];
  V = seasonOf() || DATA.all;
  const app = document.getElementById('app');
  const views = { seasons: viewSeasons, pilots: viewPilots, teams: viewTeams, makers: viewMakers, charters: viewCharters };
  if (!views[tab]) tab = 'seasons';
  app.innerHTML = views[tab]();
  enhanceTables(app);
  after[tab]?.();
}
const after = {};

// ---------- сезоны ----------
function viewSeasons() {
  const { seasons, titles } = DATA;
  const season = seasonOf(), isAll = !season;
  const { list, counted, standings: st } = V;
  const tally = Object.entries(titles).sort((a, b) => b[1] - a[1]);
  const carDate = isAll ? DATA.lastDate : season.date;
  const leader = st[0], second = st.find(d => d.rank > 1);
  const tops = key => { const m = Math.max(...st.map(d => d[key])); return { n: m, who: m ? st.filter(d => d[key] === m).map(d => d.who) : [] }; };
  const names = t => `<div class="num${t.who.length > 1 ? ' many' : ''}">${t.who.map(w => esc(nm(w))).join(', ')}</div>`;
  const wins = tops('wins'), most = tops('most');
  const titleLeader = tally[0];
  const maxPts = Math.max(1, ...st.map(d => d.pts));
  const head = s => `${rlink(s)}${s.fn ? `<sup>${s.fn}</sup>` : ''}${isAll ? `<small>${esc(s.date)}</small>` : ''}${s.counted ? '' : '<small>вне зачёта</small>'}`;

  const notes = [];
  for (const s of list) {
    const lines = [...s.penalties.map(p => 'Штраф: ' + penText(p)), ...(s.note ? [s.note] : []), ...(!s.counted && !s.note ? ['Гонка вне зачёта'] : [])];
    if (lines.length) { s.fn = notes.length + 1; notes.push({ s, lines }); } else s.fn = 0;
  }

  return `${isAll ? `
  <section class="first">
    <h2>Чемпионы</h2>
    <div class="hall">${[...seasons].reverse().map(s => {
      const r = s.standings.find(d => d.rank > 1);
      return `<button class="card champ${s.key === cur ? ' sel' : ''}" data-season="${esc(s.key)}">
        <span class="top"><span>Сезон ${s.n} · ${esc(s.date)}</span><span>${s.counted.length} ${plural(s.counted.length, 'гонка', 'гонки', 'гонок')}</span></span>
        <span class="label">${s.live ? 'Лидирует (сезон идёт)' : '🏆 Чемпион'}</span>
        <span class="num">${s.champs.map(w => esc(nm(w))).join(', ') || '—'}</span>
        <span class="hint">${s.champ ? `${s.champ.pts} очк.` : ''}${r ? ` · +${s.champ.pts - r.pts} к ${esc(nm(r.who))}` : ''}</span>
      </button>`;
    }).join('')}</div>
  </section>` : ''}

  <section class="${isAll ? '' : 'first'}">
  <div class="tiles">
    ${isAll ? tile('Больше всех титулов', esc(nm(titleLeader?.[0] ?? '—')), titleLeader ? `${titleLeader[1]} ${plural(titleLeader[1], 'титул', 'титула', 'титулов')}` : 'пока нет завершённых сезонов', true)
      : tile(season.live ? 'Лидер сезона' : 'Чемпион сезона', season.champs.map(w => esc(nm(w))).join(', '), `${leader.pts} очк.${second ? ` · +${leader.pts - second.pts} к ${esc(nm(second.who))}` : ''}`, true)}
    ${wins.n > 1 ? `<div class="card tile"><div class="label">Больше всех побед</div>${names(wins)}<div class="hint">${wins.n} ${plural(wins.n, 'победа', 'победы', 'побед')}${wins.who.length > 1 ? ' у каждого' : ''}</div></div>` : ''}
    ${most.n > 1 ? `<div class="card tile"><div class="label">Король лидирования</div>${names(most)}<div class="hint">наиб. лидирование в ${most.n} ${plural(most.n, 'гонке', 'гонках', 'гонках')}</div></div>` : ''}
    ${tile('Разных победителей', new Set(counted.map(s => s.rows[0]?.who)).size, `за ${counted.length} ${plural(counted.length, 'гонку', 'гонки', 'гонок')}`)}
  </div>
  </section>

  <section>
    <h2>Личный зачёт</h2>
    <div class="card scroll"><table class="data">
      <thead><tr><th data-best="none">#</th><th data-best="none">Гонщик</th><th data-best="none">Машина</th>${isAll ? '<th class="r" data-best="none">Титулы</th>' : ''}<th class="r" data-best="none">Очки</th><th data-sort="off" data-best="none"></th><th class="r" data-best="none">Отст.</th><th class="r">Старты</th>
        <th class="r">Победы</th><th class="r">Подиумы</th><th class="r" data-best="min">Ср. место</th><th class="r">Лидировал</th><th class="r">DNF</th></tr></thead>
      <tbody>${st.map(d => `<tr>
        <td class="pos${medal(d.rank)}" data-v="${d.rank}">${d.rank}</td>
        <td class="drv" data-v="${esc(nm(d.who))}"><span class="swatch" data-sw="${esc(d.who)}"></span>${plink(d.who)}${d.change ? `<span class="delta ${d.change > 0 ? 'up' : 'down'}">${d.change > 0 ? '▲' : '▼'}${Math.abs(d.change)}</span>` : ''}</td>
        <td data-v="${esc(chOf(d.who, carDate)?.num ?? '')}">${carTag(chOf(d.who, carDate))}</td>
        ${isAll ? `<td class="r" data-v="${titles[d.who] || 0}">${titles[d.who] ? '🏆'.repeat(Math.min(titles[d.who], 3)) + (titles[d.who] > 3 ? '×' + titles[d.who] : '') : '<span class="muted">—</span>'}</td>` : ''}
        <td class="r pts">${d.pts}</td>
        <td class="barcell"><div class="bar" style="width:${d.pts / maxPts * 100}%"></div></td>
        <td class="r muted" data-v="${leader.pts - d.pts}">${d.rank === 1 ? '—' : '−' + (leader.pts - d.pts)}</td>
        <td class="r">${d.starts}</td><td class="r">${zero(d.wins)}</td>
        <td class="r">${zero(d.podiums)}</td>
        <td class="r" data-v="${d.avg ?? ''}">${d.avg == null ? '—' : d.avg.toFixed(1)}</td>
        <td class="r" data-v="${d.led}" ${tipAttr([`Лидировал в ${d.led} ${plural(d.led, 'гонке', 'гонках', 'гонках')}`, `Наибольшее лидирование — ${d.most}`])}>${d.led}</td>
        <td class="r">${zero(d.dnf)}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>

  <section>
    <h2>Очки по ${isAll ? 'сезонам' : 'гонкам'}</h2>
    <div class="card scroll"><table class="data ptable">
      <thead><tr><th data-best="none">#</th><th data-best="none">Пилот</th>${(isAll ? seasons : list).map(c => `<th class="r${!isAll && !c.counted ? ' off' : ''}"${!isAll && !c.counted ? ' data-best="none"' : ''}>${isAll ? `Сезон ${c.n}<small>${esc(c.date)}</small>` : rlink(c) + (c.counted ? '' : '<small>вне зачёта</small>')}</th>`).join('')}<th class="r" data-best="none">Очки</th></tr></thead>
      <tbody>${st.map(d => `<tr><td class="pos${medal(d.rank)}" data-v="${d.rank}">${d.rank}</td><td data-v="${esc(nm(d.who))}">${plink(d.who)}</td>${(isAll ? seasons : list).map(c => {
        const x = isAll ? DATA.rank[c.date][d.who] : c.rows.find(r => r.who === d.who);
        if (!isAll && !c.counted) return `<td class="r off" data-v="${x ? x.pos : ''}" ${x ? tipAttr([raceName(c), `P${x.pos}`, 'Гонка вне зачёта — очки не начисляются']) : ''}>${x ? `<span class="muted">P${x.pos}</span>` : '<span class="muted">—</span>'}</td>`;
        return `<td class="r" data-v="${x ? x.pts : 0}">${x ? x.pts : '<span class="muted">0</span>'}</td>`;
      }).join('')}<td class="r pts">${d.pts}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>

  <section>
    <h2>Гонка за титул</h2>
    <div class="card" style="padding:16px 16px 0">
      <div class="chips">${st.map(d => `<button class="chip" data-who="${esc(d.who)}"><span class="swatch" data-sw="${esc(d.who)}"></span>${esc(nm(d.who))}</button>`).join('')}</div>
      <div class="chart-box" style="padding:0 0 16px"><canvas id="chart" role="img" aria-label="График суммы очков по гонкам"></canvas></div>
    </div>
  </section>

  <section>
    <h2>Результаты по гонкам</h2>
    <div class="card scroll"><table class="data nomax matrix">
      <thead><tr><th data-best="none">Гонщик</th>${list.map(s => `<th class="${s.counted ? '' : 'off'}">${head(s)}</th>`).join('')}</tr></thead>
      <tbody>${st.map(d => `<tr><td class="drv" data-v="${esc(nm(d.who))}">${plink(d.who)}</td>${list.map(s => {
        const r = s.rows.find(x => x.who === d.who);
        if (!r) return '<td class="muted" data-v="">·</td>';
        const tip = [raceName(s), s.counted ? `P${r.pos} · +${r.pts} очк.` : `P${r.pos} · очки не начисляются`, r.lead && `Лидирование +${r.bonus}${r.most ? ' — наибольшее' : ''}`, r.perfect && 'Идеальная гонка', r.dnf && 'Сход',
          r.penalty && `Штраф −${r.penalty}${r.penaltyNote ? ': ' + r.penaltyNote : ''} (финиш ${r.origPos} → ${r.pos})`, !s.counted && 'Гонка вне зачёта'];
        return `<td data-v="${r.pos}"><span class="cell ${posCls(r.pos)}${s.counted ? '' : ' off'}" tabindex="0" ${tipAttr(tip)}>${r.pos}<small>${s.counted ? '+' + r.pts : 'вне з.'}</small>${r.perfect ? '<i class="mk tr perfect">✦</i>' : r.most ? '<i class="mk tr star">★</i>' : r.lead ? '<i class="mk tr led">★</i>' : ''}${r.dnf ? '<i class="mk bl dnf">✕</i>' : ''}${r.penalty ? `<i class="mk br pen">−${r.penalty}</i>` : ''}</span></td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div class="legend-row">
      <span><span class="cell c1">1</span><span class="cell c2">2</span><span class="cell c3">3</span> подиум</span>
      <span><span class="cell c45">4</span> 4–5</span>
      <span><span class="cell c6">6</span> 6 и ниже</span>
      <span><i class="mk led static">★</i> лидировал</span>
      <span><i class="mk star static">★</i> наиб. лидирование</span>
      <span><i class="mk perfect static">✦</i> идеальная гонка</span>
      <span><i class="mk dnf static">✕</i> сход</span>
      <span><i class="mk pen static">−1</i> штраф</span>
    </div>
    ${notes.length ? `<ol class="notes">${notes.map(({ s, lines }) => `<li value="${s.fn}"><b>${esc(raceName(s))}</b>${s.counted ? '' : ' <span class="badge off">вне зачёта</span>'} — ${lines.map(esc).join('; ')}</li>`).join('')}</ol>` : ''}
  </section>

  <section>
    <h2>Гонки</h2>
    ${(isAll ? seasons.map(se => ({ se, races: se.list })) : [{ races: list }]).map(({ se, races }) => `${se ? `<div class="season-group"><div class="season-head"><span class="sh-title">Сезон ${se.n} · ${esc(se.date)}</span><span class="sh-meta">${se.counted.length} ${plural(se.counted.length, 'гонка', 'гонки', 'гонок')}${se.champs.length ? ` · ${se.live ? 'лидирует' : '🏆'} ${se.champs.map(plink).join(', ')}` : ''}</span></div>` : ''}
    <div class="stages">${races.map(s => {
      const most = s.rows.filter(r => r.most), perfect = s.rows.find(r => r.perfect);
      return `<div class="card stage" data-at="${esc(s.date)}">
        <div class="top"><span>${esc(s.date)}</span><span class="badge ${s.counted ? '' : 'off'}">${s.counted ? `${s.rows.length} ${plural(s.rows.length, 'участник', 'участника', 'участников')}` : 'вне зачёта'}</span></div>
        <h3><a href="#" class="racelink" data-race="${esc(s.id)}">${esc(trackName(s.track))} ›</a></h3>
        <ol>${s.rows.slice(0, 3).map(r => `<li><span><b class="p${r.pos}">${r.pos}</b>${plink(r.who)}${r.dnf ? ' <i class="mk dnf static">✕</i>' : ''}</span><span class="muted">+${r.pts}</span></li>`).join('')}</ol>
        ${perfect ? `<div class="note perfect-note">✦ Идеальная гонка — ${plink(perfect.who)}</div>` : ''}
        ${most.filter(r => !r.perfect).map(r => `<div class="note">★ ${plink(r.who)}</div>`).join('')}
        ${s.penalties.map(p => `<div class="note">⚖ ${esc(penText(p))}</div>`).join('')}
        ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
      </div>`;
    }).join('')}</div>${se ? '</div>' : ''}`).join('')}
  </section>`;
}
after.seasons = () => {
  const st = V.standings;
  for (const w of [...picked.keys()]) if (!st.some(d => d.who === w)) picked.delete(w);
  if (!picked.size) st.slice(0, 3).forEach(d => toggle(d.who, true));
  document.querySelectorAll('.chip[data-who]').forEach(el => el.addEventListener('click', () => toggle(el.dataset.who)));
  drawChart();
};

// ---------- рекорды ----------
function records() {
  const st = V.standings;
  const done = (seasonOf() ? [seasonOf()] : DATA.seasons).filter(s => !s.live);
  const countBy = f => { const m = {}; done.forEach(s => s.standings.filter(f).forEach(d => m[d.who] = (m[d.who] || 0) + 1)); return Object.entries(m); };
  const stat = k => st.map(d => [d.who, d[k]]);
  const firstWin = st.map(d => [d.who, V.counted.flatMap(s => s.rows.filter(r => r.who === d.who)).findIndex(r => r.pos === 1) + 1]).filter(([, n]) => n > 0);
  const top3 = st.map(d => [d.who, V.list.flatMap(s => s.rows).filter(r => r.who === d.who && r.pos <= 3).length]);
  const makers = [...DATA.makers.values()].map(m => [m.name, statsOf(scopeRows(m.rows)).wins]);
  return [
    { title: 'Титулы', icon: '🏆', rows: countBy(d => d.rank === 1), all: true },
    { title: 'Вице-чемпион', icon: '🥈', rows: countBy(d => d.rank === 2), all: true },
    { title: 'Победы', icon: '🏁', rows: stat('wins') },
    { title: 'Топ-3', icon: '🥉', rows: top3 },
    { title: 'Идеальные гонки', icon: '✦', rows: stat('perfect') },
    { title: 'Лидер кругов', icon: '★', rows: stat('most'), hint: 'гонок с наибольшим лидированием' },
    { title: 'Победы марок', icon: '🏭', rows: makers, maker: true },
    { title: 'Первая победа', icon: '⏱', rows: firstWin, asc: true, all: true, wide: true, unit: n => `${n}-я гонка` },
  ];
}
function viewRecords() {
  const LIMIT = 5;
  return `<div class="lbgrid">${records().filter(b => !b.all || !seasonOf()).map(b => {
    const rows = b.rows.filter(([, v]) => b.zero ? v >= 0 : v > 0).sort((x, y) => (b.asc ? x[1] - y[1] : y[1] - x[1]) || nm(x[0]).localeCompare(nm(y[0]), 'ru'));
    rows.forEach((r, i) => r.rank = i && rows[i - 1][1] === r[1] ? rows[i - 1].rank : i + 1);
    const li = ([w, v, ...rest], i, arr) => `<li><span class="lb-rank${medal(arr[i].rank)}">${arr[i].rank}</span><span class="lb-name">${b.maker ? `<span class="swatch" style="background:${makerColor(w)}"></span>${esc(w)}` : plink(w)}</span><b>${b.unit ? b.unit(v) : v}</b></li>`;
    return `<div class="card lb${b.wide ? ' wide' : ''}"><div class="lb-head"><span class="lb-icon">${b.icon}</span>${b.title}</div>
      ${rows.length ? `<ol>${rows.slice(0, LIMIT).map(li).join('')}</ol>${rows.length > LIMIT ? `<details><summary>ещё ${rows.length - LIMIT}</summary><ol>${rows.slice(LIMIT).map((r, i) => li(r, i + LIMIT, rows)).join('')}</ol></details>` : ''}` : '<p class="muted lb-empty">пока нет</p>'}
    </div>`;
  }).join('')}</div>`;
}

// ---------- пилоты ----------
function viewPilots() {
  const { titles, entries } = DATA;
  const season = seasonOf();
  const st = V.standings;
  const carDate = season ? season.date : DATA.lastDate;
  const carFor = who => (season ? chOf(who, carDate) : lastCar(who));
  const extra = season ? [] : [...new Set(entries.filter(e => e.driver && !DATA.pilots.has(e.driver)).map(e => e.driver))];
  const R = records(), rec = { t: Object.fromEntries(R[0].rows), v: Object.fromEntries(R[1].rows), fw: Object.fromEntries(R[7].rows) };
  return `<section class="first">
    <h2>Рекорды · ${scopeLabel()}</h2>
    ${viewRecords()}
  </section>
  <section>
    <div class="head-row"><h2>Пилоты · ${scopeLabel()}</h2>
      <div class="seg"><button data-mode="cards" aria-pressed="${pilotsMode === 'cards'}">Карточки</button><button data-mode="table" aria-pressed="${pilotsMode === 'table'}">Таблица</button></div></div>
    ${pilotsMode === 'cards' ? `<div class="grid pgrid">${st.map(d => {
      const e = carFor(d.who), color = e ? teamStyle(e.team).color : 'var(--line-off)';
      return `<a href="#" class="card pc" data-pilot="${esc(d.who)}" style="--c:${color}">
        <span class="pc-num">${e ? esc(e.num) : '—'}</span>
        <span class="pc-mid"><span class="pc-name">${esc(nm(d.who))}${titles[d.who] ? ` <span class="pc-t">🏆${titles[d.who] > 1 ? '×' + titles[d.who] : ''}</span>` : ''}</span><span class="pc-team">${e ? esc(teamStyle(e.team).short) : 'без чартера'}</span></span>
        <span class="pc-right"><span class="pc-rank${medal(d.rank)}">P${d.rank}</span><span class="pc-pts">${d.pts} очк.</span></span>
      </a>`;
    }).join('')}${extra.map(w => `<a href="#" class="card pc dim" data-pilot="${esc(w)}"><span class="pc-num">—</span><span class="pc-mid"><span class="pc-name">${esc(nm(w))}</span><span class="pc-team">ещё не выступал</span></span></a>`).join('')}</div>`
    : `<div class="card scroll"><table class="data">
      <thead><tr><th data-best="none">#</th><th data-best="none">Пилот</th><th data-best="none">Машина</th>${season ? '' : '<th class="r">Титулы</th><th class="r">Вице</th>'}<th class="r" data-best="none">Очки</th><th class="r">Старты</th><th class="r">Победы</th><th class="r">Подиумы</th><th class="r" data-best="min">Ср. место</th><th class="r">Лидировал</th><th class="r">Лидер кругов</th><th class="r">Идеальные</th>${season ? '' : '<th class="r" data-best="min">1-я победа</th>'}<th class="r" data-best="none">DNF</th></tr></thead>
      <tbody>${st.map(d => `<tr><td class="pos${medal(d.rank)}" data-v="${d.rank}">${d.rank}</td><td data-v="${esc(nm(d.who))}">${plink(d.who)}</td><td data-v="${esc(carFor(d.who)?.num ?? '')}">${carTag(carFor(d.who))}</td>
        ${season ? '' : `<td class="r" data-v="${rec.t[d.who] || 0}">${zero(rec.t[d.who])}</td><td class="r" data-v="${rec.v[d.who] || 0}">${zero(rec.v[d.who])}</td>`}<td class="r pts">${d.pts}</td><td class="r">${d.starts}</td><td class="r">${zero(d.wins)}</td><td class="r">${zero(d.podiums)}</td>
        <td class="r" data-v="${d.avg ?? ''}">${d.avg == null ? '—' : d.avg.toFixed(1)}</td><td class="r">${d.led}</td><td class="r">${zero(d.most)}</td><td class="r">${zero(d.perfect)}</td>${season ? '' : `<td class="r" data-v="${rec.fw[d.who] ?? ''}">${rec.fw[d.who] ?? '<span class="muted">—</span>'}</td>`}<td class="r">${zero(d.dnf)}</td></tr>`).join('')}</tbody>
    </table></div>`}
  </section>`;
}
after.pilots = () => document.querySelectorAll('.seg [data-mode]').forEach(b => b.addEventListener('click', () => { pilotsMode = b.dataset.mode; renderMain(); }));

// ---------- команды ----------
function teamScope() {
  const list = [...DATA.teams.values()].map(t => ({ t, team: t.name, ...statsOf(scopeRows(t.rows)) })).filter(x => x.starts);
  return rankAll(list, x => x.team);
}
function viewTeams() {
  const list = teamScope();
  const season = seasonOf();
  const now = t => t.entries.filter(e => e.driver && (season ? e.on[season.date] : e.on[DATA.lastDate] || e.on[NEXT]));
  return `<section class="first">
    <h2>Командный зачёт · ${scopeLabel()}</h2>
    <div class="card" style="padding:16px"><div class="chart-box" style="height:${list.length * 30 + 40}px;padding:0"><canvas id="teamchart" role="img" aria-label="Очки команд по пилотам"></canvas></div></div>
  </section>
  <section>
    <h2>Команды</h2>
    <div class="grid tgrid">${list.map(({ t, rank, pts, wins, best }) => `<a href="#" class="card tc" data-team="${esc(t.name)}" style="--c:${t.color}">
      <span class="tc-head"><span class="tc-rank${medal(rank)}">P${rank}</span><span class="tc-name">${esc(t.name)}</span><span class="tc-maker">${esc([...t.makers].join(', '))}</span></span>
      <span class="tc-nums">${[...new Set(t.entries.filter(e => e.driver).map(e => e.num))].map(n => `<span class="car" style="--c:${t.color}">#${esc(n)}</span>`).join(' ')}</span>
      <span class="tc-pilots">${now(t).map(e => `<span class="pchip">${esc(nm(e.driver))}</span>`).join('')}</span>
      <span class="tc-stats"><span><b>${pts}</b>очки</span><span><b>${wins}</b>победы</span><span><b>${best ? 'P' + best.pos : '—'}</b>лучший</span></span>
    </a>`).join('')}</div>
  </section>
  <section>
    <div class="card scroll"><table class="data">
      <thead><tr><th data-best="none">#</th><th data-best="none">Команда</th><th data-best="none">Марка</th><th class="r" data-best="none">Очки</th><th class="r">Старты</th><th class="r">Победы</th><th class="r">Подиумы</th><th class="r" data-best="min">Ср. место</th><th class="r">Лидировал</th></tr></thead>
      <tbody>${list.map(x => `<tr><td class="pos${medal(x.rank)}" data-v="${x.rank}">${x.rank}</td><td data-v="${esc(x.team)}">${tlink(x.team, x.team)}</td><td>${esc([...x.t.makers].join(', '))}</td><td class="r pts">${x.pts}</td><td class="r">${x.starts}</td><td class="r">${zero(x.wins)}</td><td class="r">${zero(x.podiums)}</td><td class="r" data-v="${x.avg ?? ''}">${x.avg == null ? '—' : x.avg.toFixed(1)}</td><td class="r">${x.led}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}
after.teams = () => {
  const list = teamScope();
  const pilots = [...new Set(list.flatMap(x => scopeRows(x.t.rows).map(r => r.who)))];
  const ptsOf = (x, w) => statsOf(scopeRows(x.t.rows).filter(r => r.who === w)).pts;
  charts.push(new Chart(document.getElementById('teamchart'), {
    type: 'bar',
    data: {
      labels: list.map(x => `${teamStyle(x.team).short} · ${x.pts}`),
      datasets: pilots.map(w => ({ label: w, data: list.map(x => ptsOf(x, w) || null), backgroundColor: list.map(x => x.t.color), borderColor: css('--surface'), borderWidth: { right: 2 }, borderSkipped: false, borderRadius: 2 })),
    },
    options: {
      indexAxis: 'y', maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { filter: i => i.raw, callbacks: { title: i => list[i[0].dataIndex].team, label: i => ` ${nm(i.dataset.label)}: ${i.raw} очк.` } } },
      scales: { x: { stacked: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted') } }, y: { stacked: true, grid: { display: false }, ticks: { color: css('--text') } } },
      onClick: (e, els) => els[0] && go({ ...NO_MODAL, team: list[els[0].index].team }),
    },
  }));
};

function openTeam(name) {
  const t = DATA.teams.get(name);
  const { seasons, lastDate, rank } = DATA;
  const rows = scopeRows(t.rows);
  const nums = [...new Set(t.entries.map(e => e.num))].filter(n => t.entries.some(e => e.num === n && e.driver));
  const who = [...new Set([...t.rows.map(r => r.who), ...t.entries.filter(e => e.driver).map(e => e.driver)])];
  const nowSet = new Set(t.entries.filter(e => e.on[lastDate] || e.on[NEXT]).map(e => e.driver).filter(Boolean));
  const chip = w => { const s = statsOf(rows.filter(r => r.who === w)); return `<a href="#" class="pchip big${nowSet.has(w) ? '' : ' past'}" data-pilot="${esc(w)}">${esc(nm(w))}<small>${s.starts ? `${s.pts} очк. · ${s.wins} поб.` : 'нет стартов'}</small></a>`; };
  const titles = seasons.filter(s => !s.live && s.champs.some(w => chOf(w, s.date)?.team === name));
  const cols = [...DATA.charterDates, ...(DATA.hasNext ? [NEXT] : [])];
  showDialog(`
    <div class="dhead" style="--c:${t.color}"><p class="eyebrow">Команда · ${esc([...t.makers].join(', '))} · ${scopeLabel()}</p><h2 class="dtitle">${esc(t.name)}</h2></div>
    ${statTiles(statsOf(rows), tile('Титулы пилотов', titles.length, titles.map(s => `${s.champs.filter(w => chOf(w, s.date)?.team === name).map(w => esc(nm(w))).join(', ')} (${esc(s.date)})`).join(', ') || 'пока нет', true))}
    <h3>Пилоты</h3>
    <div class="chiprow">${[...nowSet].map(chip).join('')}</div>
    ${who.some(w => !nowSet.has(w)) ? `<p class="mini-label">Раньше</p><div class="chiprow">${who.filter(w => !nowSet.has(w)).map(chip).join('')}</div>` : ''}
    <h3>Машины</h3>
    <div class="cars">${nums.map(n => {
      const s = statsOf(scopeRows(t.rows.filter(r => r.ch.num === n)));
      return `<div class="carcard" style="--c:${t.color}"><a href="#" class="carnum" data-car="${esc(n)}">#${esc(n)}${ftBadge(t.entries.find(x => x.num === n && x.full))}</a>
        <div class="mini-tl">${cols.map(c => { const e = t.entries.find(x => x.num === n && x.on[c]); const d = e?.driver && rank[c]?.[e.driver];
          return `<span class="mt${c === cur ? ' sel' : ''}${e?.driver ? '' : ' empty'}"${c !== NEXT ? ` data-at="${esc(c)}"` : ''}${e?.driver ? ` data-pilot="${esc(e.driver)}"` : ''} ${tipAttr([c === NEXT ? 'След. сезон' : `Сезон ${seasons.find(x => x.date === c)?.n ?? ''} · ${c}`, e?.driver ? nm(e.driver) : 'свободен', d && `P${d.rank} · ${d.pts} очк.`])}><small>${c === NEXT ? 'след.' : 'С' + (seasons.find(x => x.date === c)?.n ?? '')}</small> ${e?.driver ? esc(nm(e.driver)) : '—'}</span>`; }).join('')}</div>
        <div class="carbest">${s.best ? `Лучший финиш: <b>P${s.best.pos}</b> — ${plink(s.best.who)}, ${esc(raceName(s.best.race))}` : '<span class="muted">Нет стартов</span>'}</div></div>`;
    }).join('')}</div>
    <h3>Командный зачёт по сезонам</h3>
    <div class="scroll"><table class="data"><thead><tr><th data-best="none">Сезон</th><th class="r" data-best="none">Место</th><th class="r" data-best="none">Очки</th><th class="r">Победы</th><th data-best="none">Пилоты</th></tr></thead><tbody>
    ${seasons.map(s => { const x = DATA.teamRank[s.date][name]; return x ? `<tr class="${s.key === cur ? 'sel' : ''}" data-at="${esc(s.date)}"><td data-v="${s.n}">Сезон ${s.n} · ${esc(s.date)}</td><td class="r pos${medal(x.rank)}" data-v="${x.rank}">${x.rank}</td><td class="r">${x.pts}</td><td class="r">${zero(x.wins)}</td>
      <td>${[...new Set(t.rows.filter(r => r.race.date === s.date).map(r => r.who))].map(plink).join(', ')}</td></tr>` : ''; }).join('')}</tbody></table></div>
  `);
}

// ---------- производители ----------
const makerColor = m => `var(${MAKER_VAR[m] || '--line-off'})`;
function viewMakers() {
  const { makers, teams } = DATA;
  const list = [...makers.values()].map(m => ({ m, ...statsOf(scopeRows(m.rows)) })).sort((a, b) => b.wins - a.wins || b.pts - a.pts);
  const topPilots = m => { const by = {}; scopeRows(m.rows).filter(r => r.race.counted).forEach(r => by[r.who] = (by[r.who] || 0) + r.pts); return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3); };
  const teamsOf = m => [...teams.values()].filter(t => t.makers.has(m.name) && scopeRows(t.rows).some(r => r.ch.maker === m.name));
  return `<section class="first">
    <h2>Производители · ${scopeLabel()}</h2>
    <div class="grid mgrid">${list.map(x => {
      // лучшее значение среди марок — золотом (если оно одно не у всех)
      const gold = (k, better = Math.max) => { const vals = list.map(k).filter(v => v != null); const b = better(...vals); return vals.length && new Set(vals).size > 1 && k(x) === b ? ' class="gold"' : ''; };
      return `<div class="card mc" style="--c:${makerColor(x.m.name)}">
        <div class="mc-head"><span class="mc-name">${esc(x.m.name)}</span></div>
        <div class="tc-stats"><span${gold(y => y.wins)}><b>${x.wins}</b>победы</span><span${gold(y => y.pts)}><b>${x.pts}</b>очки</span><span${gold(y => y.podiums)}><b>${x.podiums}</b>подиумы</span><span${gold(y => y.best?.pos, Math.min)}><b>${x.best ? 'P' + x.best.pos : '—'}</b>лучший</span></div>
        <p class="mini-label">Лучшие пилоты</p>
        <ol class="toplist">${topPilots(x.m).map(([w, p]) => `<li>${plink(w)}<span class="muted">${p}</span></li>`).join('') || '<li class="muted">нет стартов</li>'}</ol>
        <p class="mini-label">Команды</p>
        <div class="chiprow">${teamsOf(x.m).map(t => tlink(t.name)).join(' ') || '<span class="muted">—</span>'}</div>
      </div>`;
    }).join('')}</div>
  </section>
  <section>
    <h2>Доля очков по сезонам</h2>
    <div class="card" style="padding:16px"><div class="chart-box" style="height:260px;padding:0"><canvas id="mkshare" role="img" aria-label="Доля очков производителей по сезонам"></canvas></div></div>
  </section>
  <section>
    <h2>Победы по сезонам</h2>
    <div class="card" style="padding:16px"><div class="chart-box" style="height:260px;padding:0"><canvas id="mkwins" role="img" aria-label="Победы производителей по сезонам"></canvas></div></div>
  </section>`;
}
after.makers = () => {
  const { seasons, makers } = DATA;
  const ms = [...makers.values()];
  const per = (m, s) => statsOf(m.rows.filter(r => r.race.date === s.date));
  const totals = seasons.map(s => ms.reduce((a, m) => a + per(m, s).pts, 0));
  const alpha = (c, i) => cur === 'all' || seasons[i].key === cur ? c : c + '55';
  const common = (title, extra) => ({
    maintainAspectRatio: false, animation: false,
    plugins: { legend: { position: 'top', align: 'start', labels: { color: css('--text-2'), boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3, generateLabels: ch => ch.data.datasets.map((d, i) => ({ text: d.label, fillStyle: css(MAKER_VAR[d.label] || '--line-off'), strokeStyle: 'transparent', lineWidth: 0, datasetIndex: i, hidden: !ch.isDatasetVisible(i), fontColor: css('--text-2'), borderRadius: 3 })) } }, tooltip: extra },
    scales: { x: { grid: { display: false }, ticks: { color: i => seasons[i.index]?.key === cur ? css('--text') : css('--text-2'), font: i => ({ weight: seasons[i.index]?.key === cur ? '700' : '400' }) } },
      y: { grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), precision: 0, callback: title } } },
  });
  const labels = seasons.map(s => `Сезон ${s.n} · ${s.date}`);
  charts.push(new Chart(document.getElementById('mkshare'), {
    type: 'bar',
    data: { labels, datasets: ms.map(m => ({ label: m.name, data: seasons.map((s, i) => totals[i] ? +(per(m, s).pts / totals[i] * 100).toFixed(1) : 0), backgroundColor: seasons.map((_, i) => alpha(css(MAKER_VAR[m.name] || '--line-off'), i)), borderColor: css('--surface'), borderWidth: 2, borderSkipped: false, stack: 's' })) },
    options: { ...common(v => v + '%', { callbacks: { label: i => ` ${i.dataset.label}: ${i.raw}% (${per(ms[i.datasetIndex], seasons[i.dataIndex]).pts} очк.)` } }), scales: { ...common(v => v + '%').scales, x: { ...common().scales.x, stacked: true }, y: { ...common(v => v + '%').scales.y, stacked: true, max: 100 } } },
  }));
  charts.push(new Chart(document.getElementById('mkwins'), {
    type: 'bar',
    data: { labels, datasets: ms.map(m => ({ label: m.name, data: seasons.map(s => per(m, s).wins), backgroundColor: seasons.map((_, i) => alpha(css(MAKER_VAR[m.name] || '--line-off'), i)), borderRadius: 4, borderSkipped: 'bottom' })) },
    options: common(v => v, { callbacks: { label: i => ` ${i.dataset.label}: ${i.raw} ${plural(i.raw, 'победа', 'победы', 'побед')}` } }),
  }));
};

// ---------- чартеры ----------
function viewCharters() {
  const { entries, charterDates, hasNext, rank, seasons } = DATA;
  const cols = [...charterDates, ...(hasNext ? [NEXT] : [])];
  const nums = [...new Set(entries.map(e => e.num))].sort((a, b) => a - b);
  const rows = nums.map(n => ({ n, es: entries.filter(e => e.num === n) }))
    .filter(r => !hideEmpty || r.es.some(e => e.driver && cols.some(c => e.on[c])));
  const champs = Object.fromEntries(seasons.filter(s => !s.live).map(s => [s.date, s.champs]));
  const cls = c => cur === 'all' ? '' : c === cur ? 'sel' : 'dim';
  return `<section class="first">
    <h2>Чартеры</h2>
    <div class="head-row"><label class="check"><input type="checkbox" id="hide-empty" ${hideEmpty ? 'checked' : ''}> Скрыть номера без пилотов</label><span class="legend-row" style="margin:0 0 12px"><span><i class="ftb" title="Фулл-тайм: чартер выдан">FT</i> фулл-тайм — на машину выдан чартер</span></span></div>
    <div class="card scroll"><table class="cm">
      <thead><tr><th>№</th>${cols.map(c => `<th class="${cls(c)}">${c === NEXT ? 'След. сезон<small>план</small>' : `${esc(c)}<small>сезон ${(seasons.find(s => s.date === c)?.n) ?? '—'}</small>`}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(({ n, es }) => `<tr><th scope="row">№${esc(n)}</th>${cols.map(c => {
        const e = es.find(x => x.on[c] && x.driver) || es.find(x => x.on[c]);
        const any = e || es[0];
        if (!e?.driver) return `<td class="${cls(c)}"${c !== NEXT ? ` data-at="${esc(c)}"` : ''}><div class="cc empty" style="--c:${teamStyle(any.team).color}" data-car="${esc(n)}"><span class="num">${esc(n)}</span>${ftBadge(e)}<span class="abbr">${esc(teamStyle(any.team).short)}</span><span class="res">свободен</span></div></td>`;
        const d = rank[c]?.[e.driver];
        return `<td class="${cls(c)}"${c !== NEXT ? ` data-at="${esc(c)}"` : ''}><div class="cc" style="--c:${teamStyle(e.team).color}" data-car="${esc(n)}" ${tipAttr([`#${e.num} · ${e.team}`, e.maker, e.full ? 'Фулл-тайм — чартер выдан' : 'Без чартера', nm(e.driver), d && `P${d.rank} · ${d.pts} очк.`])}>
          <span class="num">${esc(e.num)}</span>${ftBadge(e)}<span class="abbr">${esc(teamStyle(e.team).short)}</span>
          <span class="drvname">${plink(e.driver)}</span>
          <span class="res">${d ? `P${d.rank} · ${d.pts}` : c === NEXT ? 'заявлен' : '&nbsp;'}${champs[c]?.includes(e.driver) ? ' 🏆' : ''}</span>
        </div></td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}
after.charters = () => document.getElementById('hide-empty').addEventListener('change', e => { hideEmpty = e.target.checked; renderMain(); });

function openCar(num) {
  const { seasons, rank, charterDates, hasNext } = DATA;
  const es = DATA.entries.filter(e => e.num === num);
  const curE = es.find(e => e.on[DATA.lastDate]) || es.find(e => e.driver) || es[0];
  const all = DATA.rows.filter(r => r.ch?.num === num);
  const rows = scopeRows(all);
  const champs = Object.fromEntries(seasons.filter(s => !s.live).map(s => [s.date, s.champs]));
  const cols = [...charterDates, ...(hasNext ? [NEXT] : [])];
  showDialog(`
    <div class="dhead" style="--c:${teamStyle(curE.team).color}"><p class="eyebrow">Машина · ${esc(curE.maker)} · ${curE.full ? 'фулл-тайм' : 'без чартера'} · ${scopeLabel()}</p><h2 class="dtitle"><span class="bignum">#${esc(num)}</span> ${tlink(curE.team, curE.team)}</h2></div>
    ${statTiles(statsOf(rows))}
    <h3>По сезонам</h3>
    ${timeline(cols.map(c => {
      const e = es.find(x => x.on[c] && x.driver) || es.find(x => x.on[c]);
      const d = e?.driver && rank[c]?.[e.driver];
      return { at: c, color: e ? teamStyle(e.team).color : '', sel: c === cur, empty: !e?.driver,
        top: c === NEXT ? 'След. сезон' : `Сезон ${seasons.find(s => s.date === c)?.n ?? ''} · ${esc(c)}`,
        main: e?.driver ? plink(e.driver) : '<span class="muted">свободен</span>',
        sub: e ? `${ftBadge(e)}${esc(teamStyle(e.team).short)}${d ? ` · P${d.rank} · ${d.pts}` : ''}${champs[c]?.includes(e.driver) ? ' 🏆' : ''}` : '' };
    }))}
    <h3>Гонки</h3>
    ${rows.length ? `<div class="scroll"><table class="data"><thead><tr><th data-best="none">Дата</th><th data-best="none">Трасса</th><th data-best="none">Пилот</th><th class="c" data-best="none">Место</th><th class="r" data-best="none">Очки</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.race.counted ? '' : 'off'}" data-at="${esc(r.race.date)}"><td data-v="${r.race.id}">${esc(r.race.date)}</td><td data-v="${esc(trackName(r.race.track))}">${rlink(r.race)}</td><td data-v="${esc(nm(r.who))}">${plink(r.who)}</td><td class="c" data-v="${r.pos}"><span class="cell sm ${posCls(r.pos)}">${r.pos}</span></td><td class="r" data-v="${r.pts}">${r.race.counted ? r.pts : '<span class="muted">вне зачёта</span>'}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Нет стартов</p>'}
  `);
}

// ---------- пилот ----------
function openPilot(who) {
  const { titles, seasons, rank, names, charterDates, hasNext } = DATA;
  const all = DATA.rows.filter(r => r.who === who);
  const my = scopeRows(all);
  const st = statsOf(my);
  const pens = my.filter(r => r.penalty);
  const cols = [...charterDates, ...(hasNext ? [NEXT] : [])];
  showDialog(`
    <div class="dhead" style="--c:${lastCar(who) ? teamStyle(lastCar(who).team).color : 'var(--line-off)'}"><p class="eyebrow">Пилот${names[who] && names[who] !== who ? ` · «${esc(who)}»` : ''} · ${scopeLabel()}</p>
      <h2 class="dtitle">${esc(nm(who))} ${titles[who] ? '🏆'.repeat(titles[who]) : ''}</h2></div>
    ${statTiles(st, tile('Титулы', titles[who] || 0, `идеальных гонок: ${st.perfect}`, true))}
    <h3>Карьера</h3>
    ${timeline(cols.map(c => {
      const e = chOf(who, c), d = rank[c]?.[who], s = seasons.find(x => x.date === c);
      return { at: c, color: e ? teamStyle(e.team).color : '', sel: c === cur, empty: !e && !d,
        top: c === NEXT ? 'След. сезон' : `Сезон ${s?.n ?? ''} · ${esc(c)}`,
        main: d ? `<span class="tl-rank${medal(d.rank)}">P${d.rank}</span> ${d.pts} очк.${s?.champs.includes(who) && !s.live ? ' 🏆' : ''}` : c === NEXT && e ? 'заявлен' : '<span class="muted">—</span>',
        sub: e ? `#${esc(e.num)} ${tlink(e.team)} · ${esc(e.maker)}` : d ? 'без чартера' : '' };
    }).filter(i => !i.empty))}
    ${st.starts ? `<h3>Места по гонкам</h3><div class="chart-box small"><canvas id="dchart" role="img" aria-label="Места пилота по гонкам"></canvas></div>` : ''}
    ${pens.length ? `<h3>Штрафы</h3><ul class="plain">${pens.map(r => `<li>${rlink(r.race)} ${esc(r.race.date)}: −${r.penalty} (финиш ${r.origPos} → ${r.pos})${r.penaltyNote ? ` — ${esc(r.penaltyNote)}` : ''}</li>`).join('')}</ul>` : ''}
  `);
  if (st.starts) {
    const cr = my;
    dcharts.push(new Chart(document.getElementById('dchart'), {
      type: 'line',
      data: { labels: cr.map(r => raceName(r.race)), datasets: [{ data: cr.map(r => r.pos), borderColor: css('--s1'), backgroundColor: cr.map(r => r.race.counted ? css('--s1') : css('--surface')), pointRadius: 4, pointBorderColor: cr.map(r => r.race.counted ? css('--surface') : css('--s1')), pointBorderWidth: 2, borderWidth: 2 }] },
      options: {
        maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => i[0].label, label: i => cr[i.dataIndex].race.counted ? ` P${i.parsed.y} · +${cr[i.dataIndex].pts} очк.` : ` P${i.parsed.y} · вне зачёта` } } },
        scales: { x: { grid: { display: false }, ticks: { color: css('--text-2'), maxRotation: 0, autoSkip: true, autoSkipPadding: 16, callback(v) { return this.getLabelForValue(v).split(' · ')[0]; } } },
          y: { reverse: true, min: 1, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), precision: 0 } } },
      },
    }));
  }
}

// ---------- протокол гонки ----------
function openRace(id) {
  const s = DATA.list.find(x => x.id === id);
  showDialog(`
    <div class="dhead"><p class="eyebrow">Протокол · ${esc(s.date)}</p><h2 class="dtitle">${esc(trackName(s.track))}</h2></div>
    <div class="badges">${s.counted ? '' : '<span class="badge off">вне зачёта</span>'}<span class="badge">${s.rows.length} ${plural(s.rows.length, 'участник', 'участника', 'участников')}</span></div>
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
    ${s.penalties.map(p => `<p class="note">⚖ ${esc(penText(p))}</p>`).join('')}
    <div class="scroll" style="margin-top:12px"><table class="data">
      <thead><tr><th class="c" data-best="none">Место</th><th data-best="none">Пилот</th><th data-best="none">Машина</th><th data-best="none">Марка</th><th class="r" data-best="none">Очки</th><th class="r">Лидирование</th><th data-best="none">Отметки</th></tr></thead>
      <tbody>${s.rows.map(r => `<tr><td class="c" data-v="${r.pos}"><span class="cell sm ${posCls(r.pos)}">${r.pos}</span></td><td data-v="${esc(nm(r.who))}">${r.perfect ? `<i class="mk perfect static" ${tipAttr(['Идеальная гонка', 'Победа и наибольшее лидирование'])}>✦</i> ` : ''}${plink(r.who)}</td><td data-v="${esc(r.ch?.num ?? '')}">${carTag(r.ch)}</td><td>${esc(r.ch?.maker ?? '—')}</td>
        <td class="r pts">${s.counted ? r.pts : '<span class="muted">0</span>'}</td><td class="r" data-v="${r.bonus}">${r.bonus ? `+${r.bonus}${r.most ? ' ★' : ''}` : '<span class="muted">—</span>'}</td>
        <td>${[r.dnf && '<span class="badge off">сход</span>', r.penalty && `<span class="badge off" ${tipAttr([`Штраф −${r.penalty}`, r.penaltyNote, `финиш ${r.origPos} → ${r.pos}`])}>штраф −${r.penalty}</span>`].filter(Boolean).join(' ')}</td></tr>`).join('')}</tbody>
    </table></div>
  `);
  document.getElementById('dlg-body').dataset.at = s.date; // ссылки из протокола ведут в сезон гонки
}

// ---------- график сезона ----------
function colorOf(who) { return picked.has(who) ? `var(--s${picked.get(who) + 1})` : 'var(--line-off)'; }
function toggle(who, quiet) {
  if (picked.has(who)) picked.delete(who);
  else {
    const used = new Set(picked.values());
    const free = [...Array(SLOTS).keys()].find(i => !used.has(i));
    if (free === undefined) return;
    picked.set(who, free);
  }
  if (!quiet) paintSelection();
}
let chart;
function drawChart() {
  const { list, standings, progress } = V;
  chart = new Chart(document.getElementById('chart'), {
    type: 'line',
    data: {
      labels: list.map(s => (cur === 'all' ? raceName(s) : trackName(s.track)) + (s.counted ? '' : ' · вне зачёта')),
      datasets: [...standings].reverse().map(d => ({ label: d.who, data: progress[d.who], borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0 })),
    },
    options: {
      maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { itemSort: (a, b) => b.parsed.y - a.parsed.y, filter: i => !picked.size || picked.has(i.dataset.label), callbacks: { label: i => ` ${nm(i.dataset.label)}: ${i.parsed.y}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: css('--text-2'), maxRotation: 0, autoSkip: true, autoSkipPadding: 12, callback(v) { return this.getLabelForValue(v).split(' · ')[0]; } } },
        y: { beginAtZero: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), precision: 0 } },
      },
    },
  });
  charts.push(chart);
  paintSelection();
}
function paintSelection() {
  document.querySelectorAll('[data-sw]').forEach(el => el.style.background = colorOf(el.dataset.sw));
  document.querySelectorAll('.chip[data-who]').forEach(el => el.setAttribute('aria-pressed', picked.has(el.dataset.who)));
  if (!chart || !chart.canvas?.isConnected) return;
  for (const ds of chart.data.datasets) {
    const on = picked.has(ds.label);
    const c = on ? css(`--s${picked.get(ds.label) + 1}`) : css('--line-off');
    Object.assign(ds, { borderColor: c, pointBackgroundColor: c, pointBorderColor: css('--surface'), pointBorderWidth: 2, order: on ? 0 : 1, borderWidth: on ? 2.5 : 1.5 });
  }
  chart.update();
}

// ---------- старт ----------
async function load() {
  document.getElementById('reload').disabled = true;
  try {
    const keys = Object.keys(GIDS);
    const sheets = Object.fromEntries((await Promise.all(keys.map(k => sheet(GIDS[k])))).map((s, i) => [keys[i], s]));
    DATA = build(parse(sheets));
    if (!DATA.seasons.length) throw new Error('в таблице пока нет результатов');
    const { seasons, all } = DATA;
    document.getElementById('subtitle').textContent =
      `${seasons.length} ${plural(seasons.length, 'сезон', 'сезона', 'сезонов')} · ${all.counted.length} ${plural(all.counted.length, 'зачётная гонка', 'зачётные гонки', 'зачётных гонок')} · ${all.standings.length} ${plural(all.standings.length, 'пилот', 'пилота', 'пилотов')} · ${DATA.teams.size} ${plural(DATA.teams.size, 'команда', 'команды', 'команд')}`;
    tab = null; route();
    document.getElementById('updated').textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    console.error(e);
    document.getElementById('app').innerHTML = `<div class="status">Не удалось загрузить таблицу: ${esc(e.message)}</div>`;
  } finally {
    document.getElementById('reload').disabled = false;
  }
}
document.getElementById('reload').addEventListener('click', load);
// ---------- тема ----------
const themeBtn = document.getElementById('theme');
function applyTheme(t, save) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
  themeBtn.setAttribute('aria-label', t === 'dark' ? 'Светлая тема' : 'Тёмная тема');
  themeBtn.title = themeBtn.getAttribute('aria-label');
  if (save) try { localStorage.setItem('theme', t); } catch {}
  if (DATA) { renderMain(); if (dlg.open) route(); } // графики берут цвета из токенов — перерисовать
}
applyTheme(document.documentElement.dataset.theme || 'light');
themeBtn.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  let saved; try { saved = localStorage.getItem('theme'); } catch {}
  if (!saved) applyTheme(e.matches ? 'dark' : 'light');
});
load();
