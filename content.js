// Roda em vendedores.mercadolivre.com.br e faz as chamadas usando o login da própria aba.
(() => {
  if (window.__vagasFull) return;
  window.__vagasFull = true;

  const BASE = 'https://vendedores.mercadolivre.com.br/api/shipping/inbounds/';

  function headers(json) {
    const h = { Accept: 'application/json, text/plain, */*' };
    if (json) h['Content-Type'] = 'application/json';
    const meta = document.querySelector('meta[name="csrf-token"], meta[name="_csrf"], meta[name="x-csrf-token"]');
    if (meta && meta.content) h['x-csrf-token'] = meta.content;
    return h;
  }

  function b64urlJson(part) {
    try {
      const s = part.replace(/-/g, '+').replace(/_/g, '/');
      const pad = s + '='.repeat((4 - (s.length % 4)) % 4);
      const txt = decodeURIComponent(escape(atob(pad)));
      return JSON.parse(txt);
    } catch (e) { return null; }
  }

  // Aceita "2026-11-12T08:00:00..." ou "2026-11-12" + "08:00"
  function isoOf(v) {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? (v.length >= 16 ? v : v.slice(0, 10) + 'T00:00:00') : null;
  }
  function joinDate(d, t) {
    if (typeof d !== 'string' || typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d) || !/^\d{1,2}:\d{2}/.test(t)) return null;
    return d.slice(0, 10) + 'T' + t.padStart(5, '0').slice(0, 5) + ':00';
  }

  // Varre a resposta inteira procurando os slot_id (JWT) e o step_token
  function walk(node, found, depth = 0, cd = null) {
    if (depth > 40 || node == null) return;
    if (typeof node === 'string') {
      // Códigos de CD do ML (BRSP01, BRSC02...) para quando a vaga não diz o CD
      if (found.cds && /^BR[A-Z]{2,4}\d{1,2}$/.test(node)) found.cds.add(node);
      if (/^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/.test(node) && !found.slots.has(node)) {
        const p = b64urlJson(node.split('.')[1]);
        if (p && p.date_start) found.slots.set(node, { p, obj: null, cd });
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((n) => walk(n, found, depth + 1, cd)); return; }
    if (typeof node === 'object') {
      // Guarda o CD do bloco atual (availability[].node.id) para vagas que não trazem facility_id
      if (node.node && typeof node.node === 'object' && node.node.id) cd = node.node.id;
      // Vaga completa como o ML devolve (slot_id, slot_date, from, to, resource_id...)
      // (na Coleta o slot_id pode não ser JWT ou não trazer date_start: usa from/to/slot_date)
      if (node.slot_id != null && !found.slots.has(String(node.slot_id))) {
        const id = String(node.slot_id);
        const jwt = /^eyJ/.test(id) ? b64urlJson(id.split('.')[1] || '') : null;
        const p = { ...(jwt || {}) };
        if (!p.date_start) p.date_start = joinDate(node.slot_date, node.from) || joinDate(node.date, node.from) || isoOf(node.from) || isoOf(node.date_from) || isoOf(node.start) || isoOf(node.slot_date);
        if (!p.date_end) p.date_end = joinDate(node.slot_date, node.to) || isoOf(node.to) || isoOf(node.date_to) || isoOf(node.end) || p.date_start;
        if (p.date_start) found.slots.set(id, { p, obj: { ...node }, cd });
      }
      for (const [k, v] of Object.entries(node)) {
        // O token da confirmação vem como "availability_ref_id" na consulta de vagas
        if (/step_?token|availability_ref_id/i.test(k) && typeof v === 'string' && v.length >= 16 && !found.stepToken) found.stepToken = v;
        walk(v, found, depth + 1, cd);
      }
    }
  }

  // Procura o step_token em um texto qualquer (JSON ou HTML da página)
  function tokenFromText(text) {
    if (!text) return null;
    try {
      const found = { slots: new Map(), stepToken: null };
      walk(JSON.parse(text), found);
      if (found.stepToken) return found.stepToken;
    } catch (e) {}
    const t = text.replace(/&quot;/g, '"').replace(/\\u0022/g, '"');
    const m = t.match(/step_?token\\?["']?\s*[:=]\s*\\?["']([A-Za-z0-9_\-]{16,})/i);
    return m ? m[1] : null;
  }

  async function getText(url) {
    try {
      const r = await fetch(url, { credentials: 'include', headers: headers(false) });
      return { status: r.status, text: await r.text() };
    } catch (e) { return { status: 0, text: '', error: String(e) }; }
  }

  // Mesma ordem da tela do ML: lock-status, inventories-segment e, por último, a página
  async function getStepToken(shipment, ownerId, debug) {
    const sources = [];
    if (ownerId) sources.push(['lock-status', `${BASE}${shipment}/appointment-v2/${ownerId}/lock-status`]);
    sources.push(['inventories-segment', `${BASE}${shipment}/appointment-v2/inventories-segment`]);
    sources.push(['pagina', `https://vendedores.mercadolivre.com.br/shipping/inbounds/${shipment}/appointment-v2`]);
    for (const [name, url] of sources) {
      const r = await getText(url);
      const token = tokenFromText(r.text);
      debug[name] = { status: r.status, achouToken: !!token, trecho: r.text.slice(0, name === 'pagina' ? 300 : 1500) };
      if (token) return { token, source: name };
    }
    return { token: null, source: null };
  }

  async function check(mon) {
    // "Envio pelo fornecedor" consulta a agenda como ftlp e confirma como supplier (visto na tela do ML)
    const AVAIL_TYPE = { supplier: 'ftlp' };
    const t = mon.type || 'ftl';
    const url = `${BASE}${mon.shipment}/appointment-v2/schedule-availability?shipment_type=${encodeURIComponent(AVAIL_TYPE[t] || t)}`;
    const r = await fetch(url, { credentials: 'include', headers: headers(false) });
    const text = await r.text();
    if (r.status === 401 || r.status === 403 || /\/login|\/jms\//.test(r.url)) {
      return { ok: false, login: true, status: r.status, raw: text.slice(0, 1500) };
    }
    let data;
    try { data = JSON.parse(text); } catch (e) {
      return { ok: false, status: r.status, error: 'Resposta não é JSON', raw: text.slice(0, 1500) };
    }
    const found = { slots: new Map(), stepToken: null, cds: new Set() };
    walk(data, found);
    const slots = [...found.slots.entries()].map(([slot_id, { p, obj, cd }]) => ({
      slot_id,
      appointment: obj,
      start: p.date_start,
      end: p.date_end,
      facility: p.facility_id || cd || (obj && (obj.facility_id || obj.warehouse_id || obj.node_id)) || null,
      resource_id: p.resource_id,
      owner_id: p.owner_id,
      entity_id: p.entity_id
    }));
    // Centros de distribuição oferecidos para o envio (availability[].node)
    const warehouses = [];
    (Array.isArray(data.availability) ? data.availability : []).forEach((a) => {
      const n = a && a.node;
      if (n && n.id && !warehouses.some((w) => w.id === n.id)) {
        warehouses.push({ id: n.id, title: n.title || n.id, city: n.city_name || '', state: n.state_name || '' });
      }
    });
    const cdFallback = warehouses.length === 1 ? warehouses[0].id : (found.cds.size === 1 ? [...found.cds][0] : null);
    slots.forEach((s) => { if (!s.facility && cdFallback) s.facility = cdFallback; });
    slots.forEach((s) => {
      if (s.facility && !warehouses.some((w) => w.id === s.facility)) warehouses.push({ id: s.facility, title: s.facility });
    });
    return { ok: r.ok, status: r.status, slots, warehouses, stepToken: found.stepToken, raw: text.slice(0, 4000) };
  }

  async function confirm(job) {
    const out = { debug: {} };
    if (!job.body.step_token) {
      const { token, source } = await getStepToken(job.shipment, job.ownerId, out.debug);
      out.tokenSource = source;
      if (!token) { out.ok = false; out.noToken = true; return out; }
      job.body.step_token = token;
    } else {
      out.tokenSource = 'schedule-availability';
    }
    const r = await fetch(`${BASE}${job.shipment}/appointment-v2/confirm`, {
      method: 'POST',
      credentials: 'include',
      headers: headers(true),
      body: JSON.stringify(job.body)
    });
    out.status = r.status;
    out.ok = r.ok;
    out.body = (await r.text()).slice(0, 2000);
    return out;
  }

  // Lista de transportadoras cadastradas (a tela do ML chama um endpoint "carriers")
  function findCarrierArray(node, depth = 0) {
    if (!node || depth > 8) return null;
    if (Array.isArray(node) && node.length && node.every((x) => x && typeof x === 'object' && 'cnpj' in x && 'id' in x)) return node;
    if (typeof node === 'object') {
      for (const v of Object.values(node)) { const r = findCarrierArray(v, depth + 1); if (r) return r; }
    }
    return null;
  }
  async function carriers(shipment) {
    const urls = [
      `${BASE}${shipment}/appointment-v2/carriers`,
      `${BASE}${shipment}/carriers`,
      `${BASE}appointment-v2/carriers`,
      `${BASE}carriers`
    ];
    const tried = [];
    for (const url of urls) {
      const r = await getText(url);
      tried.push(`${r.status} ${url.replace(BASE, '')}`);
      if (r.status !== 200) continue;
      try {
        const arr = findCarrierArray(JSON.parse(r.text));
        if (arr) return { ok: true, carriers: arr, url };
      } catch (e) {}
    }
    return { ok: false, tried };
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'af-ping') { sendResponse({ ok: true }); return; }
    if (msg.type === 'af-carriers') {
      carriers(msg.shipment).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg.type === 'af-check') {
      check(msg.monitor).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg.type === 'af-confirm') {
      confirm(msg.job).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
  });
})();
