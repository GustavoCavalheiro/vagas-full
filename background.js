// Vagas Full - service worker
const ALARM = 'agendador-full';
const ML_HOME = 'https://vendedores.mercadolivre.com.br/';
const DEFAULTS = { intervalMin: 5, sound: true, telegramToken: '', telegramChat: '' };

// ---------- armazenamento ----------
async function load() {
  const d = await chrome.storage.local.get(['monitors', 'settings', 'log']);
  return {
    monitors: d.monitors || [],
    settings: { ...DEFAULTS, ...(d.settings || {}) },
    log: d.log || []
  };
}
async function saveMonitors(monitors) { await chrome.storage.local.set({ monitors }); }
async function addLog(text) {
  const { log } = await load();
  log.unshift({ t: Date.now(), text });
  log.length = Math.min(log.length, 80);
  await chrome.storage.local.set({ log });
}
async function patchMonitor(id, patch) {
  const { monitors } = await load();
  const m = monitors.find((x) => x.id === id);
  if (m) Object.assign(m, patch);
  await saveMonitors(monitors);
  return m;
}

// Fila para nunca rodar duas operações ao mesmo tempo
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

// ---------- agenda ----------
async function schedule() {
  await chrome.alarms.clear(ALARM);
  const { monitors, settings } = await load();
  if (!monitors.some((m) => m.active)) { await chrome.storage.local.set({ nextCheck: null }); return; }
  const base = Math.max(1, Number(settings.intervalMin) || 5);
  const delay = base * (0.8 + Math.random() * 0.4);
  chrome.alarms.create(ALARM, { delayInMinutes: delay });
  await chrome.storage.local.set({ nextCheck: Date.now() + delay * 60000 });
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) serial(async () => { await runAll(); await schedule(); });
});
chrome.runtime.onStartup.addListener(() => serial(schedule));
chrome.runtime.onInstalled.addListener(() => serial(schedule));

// ---------- aba do Mercado Livre ----------
function waitComplete(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, timeout);
    function fn(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(t); chrome.tabs.onUpdated.removeListener(fn); resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}
async function ensureScript(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'af-ping' }); return true; } catch (e) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'af-ping' });
    return true;
  } catch (e) { return false; }
}
async function getMLTab() {
  const tabs = await chrome.tabs.query({ url: 'https://vendedores.mercadolivre.com.br/*' });
  for (const t of tabs) {
    if (t.status !== 'complete') await waitComplete(t.id, 15000);
    if (await ensureScript(t.id)) return t.id;
  }
  const t = await chrome.tabs.create({ url: ML_HOME, active: false, pinned: true });
  await waitComplete(t.id);
  if (await ensureScript(t.id)) return t.id;
  throw new Error('Não consegui abrir a Central de Vendedores do Mercado Livre');
}

// ---------- datas ----------
// O slot_id traz o horário de Brasília marcado como "Z" (ex.: 10:40:00Z = 10:40 em SP).
// A tela do ML confirma esse mesmo horário com -03:00, então só trocamos o sufixo.
function local(iso) {
  const s = String(iso).slice(0, 19);
  return { date: s.slice(0, 10), time: s.slice(11, 16), iso: s + '-03:00' };
}
const br = (ymd) => ymd.slice(8, 10) + '/' + ymd.slice(5, 7);

function parsePreferred(txt) {
  return (txt || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const [d, m] = x.split('/');
    return d && m ? `${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null;
  }).filter(Boolean);
}

function pickSlot(mon, slots) {
  const ok = slots.map((s) => ({ ...s, l: local(s.start), le: local(s.end) })).filter((s) => {
    if (mon.dateFrom && s.l.date < mon.dateFrom) return false;
    if (mon.dateTo && s.l.date > mon.dateTo) return false;
    if (mon.timeFrom && s.l.time < mon.timeFrom) return false;
    if (mon.timeTo && s.l.time > mon.timeTo) return false;
    if (mon.warehouse && s.facility !== mon.warehouse) return false;
    return true;
  }).sort((a, b) => a.start.localeCompare(b.start));
  if (!ok.length) return { candidates: ok, best: null };
  for (const p of parsePreferred(mon.preferred)) {
    const hit = ok.find((s) => s.l.date.slice(5) === p);
    if (hit) return { candidates: ok, best: hit };
  }
  return { candidates: ok, best: mon.onlyPreferred && parsePreferred(mon.preferred).length ? null : ok[0] };
}

// ---------- alertas ----------
async function beep() {
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Alerta sonoro' });
    }
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'beep' });
  } catch (e) {}
}
async function alertUser(title, message, shipment) {
  const { settings } = await load();
  chrome.notifications.create('af-' + (shipment || '') + '-' + Date.now(), {
    type: 'basic', iconUrl: 'icon128.png', title, message: message.slice(0, 250), priority: 2, requireInteraction: true
  });
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#D93025' });
  if (settings.sound) beep();
  if (settings.telegramToken && settings.telegramChat) {
    try {
      await fetch(`https://api.telegram.org/bot${settings.telegramToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: settings.telegramChat, text: `${title}\n${message}` })
      });
    } catch (e) { addLog('Falha ao enviar Telegram'); }
  }
}
chrome.notifications.onClicked.addListener((id) => {
  chrome.action.setBadgeText({ text: '' });
  const ship = id.split('-')[1];
  chrome.tabs.create({ url: ship ? `${ML_HOME}shipping/inbounds/${ship}/hub` : ML_HOME });
});

// ---------- verificação ----------
async function runAll() {
  const { monitors } = await load();
  const active = monitors.filter((m) => m.active);
  if (!active.length) return;
  let tabId;
  try { tabId = await getMLTab(); } catch (e) { await addLog(String(e.message || e)); return; }
  for (const m of active) {
    await checkOne(tabId, m);
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
  }
}

async function checkOne(tabId, mon) {
  const now = Date.now();
  let res;
  try { res = await chrome.tabs.sendMessage(tabId, { type: 'af-check', monitor: mon }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  await chrome.storage.local.set({ lastRaw: { t: now, shipment: mon.shipment, res } });

  if (!res || res.login) {
    if (!mon.loginWarned) await alertUser('⚠️ Login do Mercado Livre expirou', 'Entre de novo na Central de Vendedores para o agendador continuar.');
    await patchMonitor(mon.id, { status: 'Sessão expirada – faça login', lastCheck: now, loginWarned: true });
    return;
  }
  if (!res.ok) {
    await patchMonitor(mon.id, { status: `Erro ${res.status || ''} ${res.error || ''}`.trim(), lastCheck: now });
    await addLog(`Envio ${mon.shipment}: erro ao consultar (${res.status || res.error})`);
    return;
  }

  // Descarta vagas de outro envio, mas só se o JWT trouxer o envio (na Coleta o entity_id pode ser outro id)
  const all = res.slots || [];
  const same = all.filter((s) => !s.entity_id || String(s.entity_id) === String(mon.shipment));
  const slots = same.length ? same : all;
  const { candidates, best } = pickSlot(mon, slots);
  const checks = (mon.checks || 0) + 1;
  const base = { lastCheck: now, loginWarned: false, checks, totalSlots: slots.length, matching: candidates.length };

  if (!best) {
    await patchMonitor(mon.id, { ...base, status: `Sem vaga no filtro (${slots.length} vagas no total)` });
    return;
  }
  const label = `${br(best.l.date)} às ${best.le.time}` + (best.facility ? ` (${best.facility})` : '');

  if (!mon.autoBook) {
    const alerted = mon.alerted || [];
    await patchMonitor(mon.id, { ...base, status: `Vaga encontrada: ${label}`, alerted: [...new Set([best.slot_id, ...alerted])].slice(0, 200) });
    if (!alerted.includes(best.slot_id)) {
      await addLog(`Envio ${mon.shipment}: vaga ${label} (${candidates.length} no filtro)`);
      await alertUser(`🚚 Vaga Full – envio ${mon.shipment}`, `Vaga disponível: ${label}. Clique para agendar.`, mon.shipment);
    }
    return;
  }

  // ---- agendar automaticamente ----
  await addLog(`Envio ${mon.shipment}: confirmando ${label} no Mercado Livre`);
  // Coleta: o endereço vem no próprio slot_id ("crm:{endereço}_{data}") e entra como selected_address
  const addressId = mon.type === 'pickup'
    ? Number((String(best.slot_id).match(/^crm:(\d+)_/) || [])[1]) || (best.appointment && (best.appointment.address_id || best.appointment.addressId)) || null
    : null;
  const actions = ['CHANGE_SHIPMENT_TYPE', 'CHANGE_APPOINTMENT_DATE'];
  if (mon.carrier) actions.push('CHANGE_CARRIER_DATA_CNPJ');
  if (addressId) actions.push('CHANGE_ADDRESS');
  const body = {
    step_token: res.stepToken || null, // se vier vazio, a aba busca em lock-status / inventories-segment / página
    selected_shipment_type: mon.type || 'ftl',
    actions_attempted: actions,
    ...(mon.carrier ? { selected_carrier: mon.carrier } : {}),
    ...(addressId ? { selected_address: { id: addressId } } : {}),
    selected_warehouse: best.facility || null,
    // Usa a vaga exatamente como o ML devolveu; só monta na mão se ela não vier completa
    selected_appointment: best.appointment && best.appointment.from ? { ...best.appointment } : {
      slot_id: best.slot_id,
      slot_date: best.le.iso,
      from: best.l.iso,
      to: best.le.iso,
      resource_id: best.resource_id,
      recurrence: {},
      quotation_option: null,
      charges: null
    }
  };
  let conf;
  try { conf = await chrome.tabs.sendMessage(tabId, { type: 'af-confirm', job: { shipment: mon.shipment, ownerId: best.owner_id, body } }); }
  catch (e) { conf = { ok: false, error: String(e) }; }
  await chrome.storage.local.set({ lastConfirm: { t: Date.now(), shipment: mon.shipment, body, conf } });

  if (conf && conf.noToken) {
    const alerted = mon.alerted || [];
    await patchMonitor(mon.id, { ...base, status: `Vaga ${label}, mas faltou o step_token – agende manualmente`, alerted: [...new Set([best.slot_id, ...alerted])].slice(0, 200) });
    await addLog(`Envio ${mon.shipment}: não achei o step_token (lock-status, inventories-segment e página). Copie o registro técnico e mande para ajuste.`);
    if (!alerted.includes(best.slot_id)) {
      await alertUser(`🚚 Vaga Full – envio ${mon.shipment}`, `Vaga ${label}. Não consegui confirmar sozinho: agende manualmente.`, mon.shipment);
    }
    return;
  }
  if (conf && conf.ok) {
    if (conf.tokenSource) await addLog(`Envio ${mon.shipment}: step_token obtido de ${conf.tokenSource}`);
    await patchMonitor(mon.id, { ...base, active: false, booked: label, status: `✅ Agendado: ${label}` });
    await addLog(`✅ Agendamento confirmado – envio ${mon.shipment}: ${label}. Verifiquei a agenda ${checks} vez(es).`);
    await alertUser(`✅ Agendado! Envio ${mon.shipment}`, `Confirmado para ${label}.`, mon.shipment);
  } else {
    await patchMonitor(mon.id, { ...base, status: `Falha ao confirmar ${label} (HTTP ${conf && conf.status})` });
    await addLog(`Envio ${mon.shipment}: falha ao confirmar ${label} – HTTP ${conf && conf.status} ${(conf && (conf.body || conf.error) || '').slice(0, 150)}`);
    await alertUser(`⚠️ Vaga ${label} – envio ${mon.shipment}`, 'Tentei confirmar e o Mercado Livre recusou. Agende manualmente.', mon.shipment);
  }
}

// ---------- mensagens do popup ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target === 'offscreen') return;
  const handlers = {
    async add() {
      const { monitors } = await load();
      monitors.unshift({ ...msg.monitor, id: Date.now().toString(36), active: true, checks: 0, status: 'Aguardando 1ª verificação', alerted: [] });
      await saveMonitors(monitors);
      await addLog(`Envio ${msg.monitor.shipment} cadastrado${msg.monitor.autoBook ? ' (agendamento automático)' : ' (só aviso)'}`);
      await runAll(); await schedule();
    },
    async remove() {
      const { monitors } = await load();
      await saveMonitors(monitors.filter((m) => m.id !== msg.id)); await schedule();
    },
    async toggle() {
      const { monitors } = await load();
      const m = monitors.find((x) => x.id === msg.id);
      if (m) { m.active = !m.active; m.status = m.active ? 'Reativado' : 'Pausado'; }
      await saveMonitors(monitors); await schedule();
    },
    async checkNow() { await runAll(); await schedule(); },
    async warehouses() {
      const tabId = await getMLTab();
      const r = await chrome.tabs.sendMessage(tabId, { type: 'af-check', monitor: { shipment: msg.shipment, type: msg.shipmentType } });
      await chrome.storage.local.set({ warehousesResult: { ok: !!(r && r.ok), list: (r && r.warehouses) || [], login: !!(r && r.login) } });
    },
    async carriers() {
      const tabId = await getMLTab();
      const r = await chrome.tabs.sendMessage(tabId, { type: 'af-carriers', shipment: msg.shipment });
      if (r && r.ok) await chrome.storage.local.set({ carriers: r.carriers });
      await chrome.storage.local.set({ carriersResult: r });
    },
    async settings() { await chrome.storage.local.set({ settings: msg.settings }); await schedule(); },
    async clearLog() { await chrome.storage.local.set({ log: [] }); },
    async test() { await alertUser('🔔 Teste do Vagas Full', 'Se você viu e ouviu isto, os alertas estão funcionando.'); }
  };
  const h = handlers[msg.type];
  if (!h) return;
  serial(h).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
