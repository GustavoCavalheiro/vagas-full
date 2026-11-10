const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hora = (t) => t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '–';
const dataHora = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const brDate = (ymd) => ymd ? ymd.slice(8, 10) + '/' + ymd.slice(5, 7) : '';
const TYPE_NAMES = { ftl: 'Veículo particular', pickup: 'Coleta', ftlp: 'Transportadora', supplier: 'Fornecedor' };
const VERSION = chrome.runtime.getManifest().version;

$('ver').textContent = `Vagas Full ${VERSION}`;
if (new URLSearchParams(location.search).has('tab')) document.body.classList.add('tab');

// ---------- aviso rápido ----------
let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
}

// ---------- alerta de confirmação ----------
function askConfirm({ title, message, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const scrim = $('alertScrim');
    const back = document.activeElement;
    $('alertTitle').textContent = title;
    $('alertMsg').textContent = message;
    $('alertOk').textContent = ok;
    $('alertOk').classList.toggle('danger', danger);
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add('show'));
    $('alertOk').focus();
    const done = (val) => {
      scrim.classList.remove('show');
      setTimeout(() => { scrim.hidden = true; }, 180);
      document.removeEventListener('keydown', key, true);
      $('alertOk').onclick = $('alertCancel').onclick = scrim.onclick = null;
      if (back && back.focus) back.focus({ preventScroll: true });
      resolve(val);
    };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      if (e.key === 'Enter') { e.preventDefault(); done(document.activeElement !== $('alertCancel')); }
      if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === $('alertOk') ? $('alertCancel') : $('alertOk')).focus(); }
    };
    document.addEventListener('keydown', key, true);
    $('alertOk').onclick = () => done(true);
    $('alertCancel').onclick = () => done(false);
    scrim.onclick = (e) => { if (e.target === scrim) done(false); };
  });
}

// ---------- barra de título ----------
$('lClose').onclick = () => window.close();
$('lMin').onclick = () => $('newSection').classList.toggle('collapsed');
$('lMax').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') }); window.close(); };
window.addEventListener('scroll', () => $('titlebar').classList.toggle('scrolled', scrollY > 4), { passive: true });

// ---------- telas deslizantes (ajuda e colaborar) ----------
let sheetOpener = null;
function openSheet(id, opener) {
  const s = $(id);
  sheetOpener = opener;
  s.classList.add('open');
  s.setAttribute('aria-hidden', 'false');
  s.scrollTop = 0;
  s.querySelector('[data-close]').focus({ preventScroll: true });
}
function closeSheets() {
  document.querySelectorAll('.sheet.open').forEach((s) => { s.classList.remove('open'); s.setAttribute('aria-hidden', 'true'); });
  if (sheetOpener) sheetOpener.focus({ preventScroll: true });
}
$('helpBtn').onclick = () => openSheet('help', $('helpBtn'));
$('donateBtn').onclick = () => openSheet('donate', $('donateBtn'));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.sheet.open')) closeSheets(); });
$('help').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-open]');
  if (a) { e.preventDefault(); chrome.tabs.create({ url: a.dataset.open }); }
});
$('copyPix').onclick = async () => {
  await navigator.clipboard.writeText($('copyPix').dataset.pix);
  $('copyPix').textContent = 'Copiado';
  toast('Código Pix copiado. Cole no app do banco.');
  setTimeout(() => { $('copyPix').textContent = 'Copiar'; }, 1800);
};

// ---------- datas vazias mostram tracinhos ----------
function syncDates() {
  document.querySelectorAll('.dt').forEach((w) => w.classList.toggle('is-empty', !w.querySelector('input').value));
}
document.querySelectorAll('.dt input').forEach((i) => ['input', 'change', 'blur'].forEach((ev) => i.addEventListener(ev, syncDates)));
// Clicar nos tracinhos abre o calendário
document.querySelectorAll('.dt').forEach((w) => w.addEventListener('click', (e) => {
  const i = w.querySelector('input');
  if (e.target !== i) { try { i.showPicker(); } catch (err) { i.focus(); } }
}));

// ---------- forma de envio ----------
const show = (el, on) => el.classList.toggle('hidden', !on);
function syncType() {
  const t = $('type').value;
  show($('rowTypeOther'), t === 'other');
  show($('rowCarrier'), t === 'ftlp');
  const manual = t === 'ftlp' && $('carrierSel').value === 'manual';
  document.querySelectorAll('.carrierManual').forEach((r) => show(r, manual));
}
$('type').onchange = syncType;
$('carrierSel').onchange = syncType;

let carrierList = [];
function fillCarriers(list) {
  carrierList = list || [];
  const cur = $('carrierSel').value;
  $('carrierSel').innerHTML = '<option value="">Escolher</option>' +
    carrierList.map((c, i) => `<option value="${i}">${esc(c.name)}</option>`).join('') +
    '<option value="manual">Digitar</option>';
  if ([...$('carrierSel').options].some((o) => o.value === cur)) $('carrierSel').value = cur;
  syncType();
}
chrome.storage.local.get('carriers').then(({ carriers }) => { if (carriers) fillCarriers(carriers); });

$('loadCarriers').onclick = async () => {
  const shipment = $('shipment').value.replace(/\D/g, '');
  if (!shipment) { toast('Informe o número do envio'); $('shipment').focus(); return; }
  $('loadCarriers').disabled = true;
  await send({ type: 'carriers', shipment });
  $('loadCarriers').disabled = false;
  const { carriers, carriersResult } = await chrome.storage.local.get(['carriers', 'carriersResult']);
  if (carriersResult && carriersResult.ok) {
    fillCarriers(carriers);
    toast(`${carriers.length} transportadora(s)`);
  } else {
    $('carrierSel').value = 'manual'; syncType();
    toast('Não foi possível carregar. Preencha manualmente.');
  }
};

// ---------- centro de distribuição ----------
const whLabel = (w) => `${w.id}${w.title && w.title !== w.id ? ' · ' + w.title.replace(/^Centro log[ií]stico\s*/i, '') : ''}`;
function fillWarehouses(list, placeholder = 'Padrão') {
  const cur = $('warehouse').value;
  list = list || [];
  // Com um CD só, ele já aparece selecionado; com vários, "Padrão" aceita qualquer um deles
  $('warehouse').innerHTML = (list.length === 1 ? '' : `<option value="">${esc(placeholder)}</option>`) +
    list.map((w) => `<option value="${esc(w.id)}">${esc(whLabel(w))}</option>`).join('');
  if ([...$('warehouse').options].some((o) => o.value === cur)) $('warehouse').value = cur;
}
let whKey = '';
async function loadWarehouses(manual = false) {
  const shipment = $('shipment').value.replace(/\D/g, '');
  if (!shipment) { if (manual) { toast('Informe o número do envio'); $('shipment').focus(); } return; }
  const type = ($('type').value === 'other' ? $('typeOther').value.trim() : $('type').value) || 'ftl';
  const key = shipment + '|' + type;
  if (!manual && key === whKey) return;
  whKey = key;
  $('loadWh').disabled = true;
  fillWarehouses([], 'Buscando…');
  await send({ type: 'warehouses', shipment, shipmentType: type });
  $('loadWh').disabled = false;
  if (whKey !== key) return; // o usuário mudou o envio enquanto buscava
  const { warehousesResult: r } = await chrome.storage.local.get('warehousesResult');
  if (r && r.ok && r.list.length) {
    fillWarehouses(r.list);
    if (r.list.length > 1) toast(`${r.list.length} CDs disponíveis para este envio`);
  } else {
    fillWarehouses([]);
    if (manual || (r && r.login)) toast(r && r.login ? 'Entre na Central de Vendedores' : 'Nenhum CD encontrado para este envio');
  }
}
$('loadWh').onclick = () => loadWarehouses(true);
let whTimer;
$('shipment').addEventListener('input', () => {
  clearTimeout(whTimer);
  if ($('shipment').value.replace(/\D/g, '').length >= 8) whTimer = setTimeout(() => loadWarehouses(), 700);
});
$('shipment').addEventListener('change', () => loadWarehouses());
$('type').addEventListener('change', () => loadWarehouses());

function selectedCarrier() {
  const v = $('carrierSel').value;
  if (v === 'manual') {
    const id = Number($('carrierId').value.replace(/\D/g, ''));
    const cnpj = $('carrierCnpj').value.replace(/\D/g, '');
    if (!id || !cnpj) return null;
    return { id, cnpj, cpf: $('carrierIe').value.replace(/\D/g, ''), name: $('carrierName').value.trim() };
  }
  return v !== '' && carrierList[Number(v)] ? { ...carrierList[Number(v)] } : null;
}

// ---------- cadastro ----------
$('useTab').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = tab && tab.url && tab.url.match(/inbounds\/(\d+)/);
  if (m) { $('shipment').value = m[1]; toast(`Envio ${m[1]}`); loadWarehouses(); }
  else toast('Abra a página do envio no Mercado Livre');
};

$('add').onclick = async () => {
  const shipment = $('shipment').value.replace(/\D/g, '');
  if (!shipment) { toast('Informe o número do envio'); $('shipment').focus(); return; }
  const type = $('type').value === 'other' ? $('typeOther').value.trim() : $('type').value;
  if (!type) { toast('Informe o código da forma de envio'); return; }
  const carrier = type === 'ftlp' ? selectedCarrier() : null;
  if (type === 'ftlp' && !carrier) { toast('Escolha a transportadora'); return; }
  if ($('dateFrom').value && $('dateTo').value && $('dateFrom').value > $('dateTo').value) { toast('Período inválido'); return; }
  const autoBook = $('autoBook').checked;
  if (autoBook && !(await askConfirm({
    title: 'Agendar automaticamente?',
    message: `O envio ${shipment} será agendado na primeira vaga que atender ao filtro.`,
    ok: 'Agendar'
  }))) return;

  $('add').disabled = true; $('add').textContent = 'Verificando…';
  await send({
    type: 'add',
    monitor: {
      shipment, type, autoBook, carrier, warehouse: $('warehouse').value,
      dateFrom: $('dateFrom').value, dateTo: $('dateTo').value,
      preferred: $('preferred').value.trim(), onlyPreferred: $('onlyPreferred').checked,
      timeFrom: $('timeFrom').value, timeTo: $('timeTo').value
    }
  });
  $('add').disabled = false; $('add').textContent = 'Adicionar';
  $('shipment').value = '';
  whKey = ''; fillWarehouses([]);
  toast('Monitoramento adicionado');
};

$('checkNow').onclick = async () => {
  $('checkNow').textContent = 'Verificando…';
  await send({ type: 'checkNow' });
  $('checkNow').textContent = 'Verificar agora';
};

// ---------- ajustes ----------
let interval = 5;
$('interval').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  interval = Number(b.dataset.v); paintInterval(); saveSettings();
});
function paintInterval() {
  document.querySelectorAll('#interval button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === interval));
}
async function saveSettings() {
  await send({
    type: 'settings',
    settings: {
      intervalMin: interval, sound: $('sound').checked,
      telegramToken: $('telegramToken').value.trim(), telegramChat: $('telegramChat').value.trim()
    }
  });
}
['sound', 'telegramToken', 'telegramChat'].forEach((k) => $(k).addEventListener('change', saveSettings));
$('test').onclick = () => { send({ type: 'test' }); toast('Notificação enviada'); };

// ---------- registro ----------
const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
$('clearLog').onclick = stop(() => send({ type: 'clearLog' }));
$('copyTech').onclick = stop(async () => {
  const d = await chrome.storage.local.get(['lastRaw', 'lastConfirm', 'log', 'monitors']);
  const txt = `VAGAS FULL - REGISTRO TÉCNICO v${VERSION}\n` + JSON.stringify({
    ultimaConsulta: d.lastRaw, ultimaConfirmacao: d.lastConfirm,
    monitores: (d.monitors || []).map(({ alerted, ...m }) => m), registro: (d.log || []).slice(0, 20)
  }, null, 2);
  await navigator.clipboard.writeText(txt);
  toast('Registro técnico copiado');
});

// ---------- lista ----------
$('list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  if (b.dataset.act === 'remove' && !(await askConfirm({
    title: 'Remover monitoramento?',
    message: 'Este envio deixará de ser verificado.',
    ok: 'Remover',
    danger: true
  }))) return;
  await send({ type: b.dataset.act, id: b.dataset.id });
});

async function render() {
  const d = await chrome.storage.local.get(['monitors', 'settings', 'log', 'nextCheck']);
  const s = { intervalMin: 5, sound: true, telegramToken: '', telegramChat: '', ...(d.settings || {}) };
  interval = Number(s.intervalMin) || 5;
  if (![1, 2, 3, 5, 10].includes(interval)) { interval = 10; saveSettings(); } // quem tinha 15 passa para 10
  paintInterval();
  $('sound').checked = s.sound !== false;
  ['telegramToken', 'telegramChat'].forEach((k) => { if (document.activeElement !== $(k)) $(k).value = s[k] || ''; });

  const mons = d.monitors || [];
  $('next').textContent = mons.some((m) => m.active) && d.nextCheck ? `· próxima ${hora(d.nextCheck)}` : '';
  $('list').innerHTML = mons.length ? mons.map((m) => {
    const periodo = m.dateFrom || m.dateTo ? `${brDate(m.dateFrom) || '…'}–${brDate(m.dateTo) || '…'}` : 'qualquer data';
    const forma = TYPE_NAMES[m.type] || m.type;
    const dot = m.booked ? 'done' : m.active ? 'on' : '';
    return `<div class="mon">
      <span class="dot ${dot}"></span>
      <span class="name">${esc(m.shipment)}</span>
      <span class="acts">
        ${m.booked ? '' : `<button class="link" data-act="toggle" data-id="${m.id}">${m.active ? 'Pausar' : 'Ativar'}</button>`}
        <button class="link danger" data-act="remove" data-id="${m.id}">Remover</button>
      </span>
      <span class="sub">${esc(m.status || '')}</span>
      <span class="sub">${esc(forma)}${m.carrier ? ' · ' + esc(m.carrier.name || m.carrier.cnpj) : ''}${m.warehouse ? ' · ' + esc(m.warehouse) : ''} · ${esc(periodo)} · ${m.autoBook ? 'automático' : 'só aviso'} · ${hora(m.lastCheck)}</span>
    </div>`;
  }).join('') : '<div class="empty">Nenhum envio</div>';

  const log = d.log || [];
  $('log').innerHTML = log.length
    ? log.map((l) => `<div class="row"><time>${dataHora(l.t)}</time>${esc(l.text)}</div>`).join('')
    : '<div class="empty">Vazio</div>';
}

chrome.storage.onChanged.addListener(render);
chrome.action.setBadgeText({ text: '' });
syncType();
render();
