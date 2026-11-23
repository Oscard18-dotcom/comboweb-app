// Guardia de seguridad visual: replaceChildren/append/prepend ignoran null, undefined y false (si no, el navegador escribiría la palabra "null" en pantalla)
(() => { for (const m of ['replaceChildren', 'append', 'prepend']) { const orig = Element.prototype[m]; Element.prototype[m] = function (...a) { return orig.apply(this, a.filter((x) => x != null && x !== false)); }; } })();
const $ = (s) => document.querySelector(s);
const money = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const ROL = { cliente: 'Cliente', cocina: 'Cocina', almacen: 'Almacén', admin: 'Administrador' };
const ESTC = { 'Pendiente': '#6A6141', 'En preparación': '#3F210E', 'Listo para entrega': '#3E5B3A', 'Entregado': '#7D756B' };
// Construye elementos con textContent (nunca innerHTML): lo que escribe el usuario no puede inyectar código
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...kids.flat(Infinity).filter((x) => x != null && x !== false));
  return e;
}
const chip = (estatus) => el('span', { class: 'chip', style: 'background:' + (ESTC[estatus] || '#7D756B') }, estatus);
const REFRESCO = window.__REFRESCO_MS || 15000; // cada cuánto se actualiza "Mis pedidos"
const ln = (a, b, cls = '') => el('div', { class: 'ln ' + cls }, el('span', {}, a), el('span', {}, b));

let token = null, user = null, cat = null, tab = 'armar', vistaCuenta = false;
let retorno = { checkout: null, cancelado: null }, resetToken = null;
try {
  token = sessionStorage.getItem('t'); user = JSON.parse(sessionStorage.getItem('u') || 'null');
  const P = new URLSearchParams(location.search); retorno = { checkout: P.get('checkout'), cancelado: P.get('cancelado') };
  // Enlace de recuperación de contraseña: se toma el código y se quita de la dirección para que no quede en el historial
  if (/^[0-9a-f]{64}$/.test(P.get('reset') || '')) { resetToken = P.get('reset'); token = null; user = null; sessionStorage.removeItem('t'); sessionStorage.removeItem('u'); history.replaceState(null, '', location.pathname); }
} catch (e) { /* sin almacenamiento */ }

async function api(path, { method = 'GET', body } = {}) {
  const usado = token; // la sesión con la que se hizo ESTA llamada
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(usado ? { Authorization: 'Bearer ' + usado } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  // Solo se cierra la sesión si el 401 es de la sesión que sigue activa (una llamada lenta hecha con la sesión anterior no debe cerrar la nueva)
  if (r.status === 401 && usado && usado === token) { setSession(null, null); throw new Error('Tu sesión expiró. Inicia sesión de nuevo.'); }
  if (!r.ok) { const er = new Error(j.error || 'Ocurrió un error.'); er.campos = j.campos; throw er; }
  return j;
}
function setSession(t, u) {
  token = t; user = u; if (!u) vistaCuenta = false;
  try {
    if (t) { sessionStorage.setItem('t', t); sessionStorage.setItem('u', JSON.stringify(u)); }
    else { sessionStorage.removeItem('t'); sessionStorage.removeItem('u'); }
  } catch (e) { /* sin almacenamiento */ }
  paint();
}

/* ---------- Combo en construcción ---------- */
const nuevoDir = () => ({ cp: '', colonia: '', calle: '', ext: '', int: '', ref: '', municipio: '', colonias: [], manual: false, estadoCP: '' });
const nuevoCombo = () => ({ tipo: null, q: {}, ded: false, text: '', fecha: '', hora: '', dir: nuevoDir() });
let d = nuevoCombo();
const cuerpo = () => ({ items: Object.entries(d.q).map(([id, c]) => ({ producto_id: Number(id), cantidad: c })), combo: d.tipo, fecha: d.fecha, hora: d.hora, dedicatoria: d.ded ? d.text : '',
  direccion: { cp: d.dir.cp, colonia: d.dir.colonia, calle: d.dir.calle, num_ext: d.dir.ext, num_int: d.dir.int, referencias: d.dir.ref, ...(d.dir.manual ? { municipio: d.dir.municipio } : {}) } });
const dirCompleta = () => { const x = d.dir; return /^\d{5}$/.test(x.cp) && !!x.colonia.trim() && x.calle.trim().length >= 2 && !!x.ext.trim() && (!x.manual || !!x.municipio.trim()) && (x.manual || x.colonias.length > 0); };
const textoDir = (x) => x ? `${x.calle} ${x.num_ext}${x.num_int ? ' int. ' + x.num_int : ''}, Col. ${x.colonia}, C.P. ${x.cp}, ${x.municipio}${x.estado ? ', ' + x.estado : ''}` : null;
const hoyLocal = () => { const x = new Date(); return [x.getFullYear(), String(x.getMonth() + 1).padStart(2, '0'), String(x.getDate()).padStart(2, '0')].join('-'); };

function buildArmar() {
  const root = $('#armar'); root.replaceChildren();
  if (!cat) return;
  const resumen = el('aside', { class: 'card', 'aria-live': 'polite' });
  const errores = el('div', { class: 'errbox', role: 'alert' });
  const pagar = el('button', { class: 'btn', type: 'button', disabled: true }, 'Pagar y confirmar');
  let seq = 0, timer = null;

  const pintar = (qt) => {
    resumen.replaceChildren(el('h3', {}, 'Resumen del combo'));
    const det = qt && qt.detalle;
    if (det) {
      det.lineas.forEach((l) => resumen.append(ln(`${l.nombre} x${l.cantidad}`, money(l.precio_unitario * l.cantidad))));
      resumen.append(ln('Total', money(det.total), 'tot'));
    } else resumen.append(el('p', { class: 'mu' }, 'Elige tu combo para ver el total.'));
    const msgs = ((qt && qt.errores) || []).filter((e) => !(e.codigo === 'sin_productos' || (e.codigo === 'fecha_invalida' && !d.fecha) || (e.codigo === 'hora_invalida' && !d.hora))).map((e) => e.mensaje);
    if (d.ded && !d.text.trim()) msgs.push('Escribe tu dedicatoria o elige “No”.');
    if (qt && qt.ok && !dirCompleta()) msgs.push('Completa tu dirección de entrega (código postal, colonia, calle y número exterior).');
    errores.replaceChildren(...msgs.map((m) => el('div', {}, m)));
    pagar.disabled = !(qt && qt.ok) || (d.ded && !d.text.trim()) || !dirCompleta();
    resumen.append(pagar);
  };
  const cotizar = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mi = ++seq;
      try { const qt = await api('/pedidos/cotizar', { method: 'POST', body: cuerpo() }); if (mi === seq) pintar(qt); }
      catch (e) { if (mi === seq) { errores.replaceChildren(el('div', {}, e.message)); pagar.disabled = true; } }
    }, 250);
  };

  const construirProds = () => el('div', { class: 'grid' }, cat.productos.map((p) => {
    const cant = el('span', {}, String(d.q[p.id] || 0));
    const caja = el('div', { class: 'item' + (d.q[p.id] ? ' on' : '') });
    const cambia = (n) => () => {
      const v = Math.max(0, Math.min(50, (d.q[p.id] || 0) + n));
      if (v) d.q[p.id] = v; else delete d.q[p.id];
      cant.textContent = String(v); caja.classList.toggle('on', v > 0); cotizar();
    };
    caja.append(el('b', {}, p.nombre), el('small', {}, p.descripcion || ''), el('span', { class: 'p' }, money(p.precio)),
      el('div', { class: 'qty' }, el('button', { type: 'button', onclick: cambia(-1), 'aria-label': 'Quitar ' + p.nombre }, '–'), cant,
        el('button', { type: 'button', onclick: cambia(1), 'aria-label': 'Agregar ' + p.nombre }, '+')));
    return caja;
  }));
  const tipos = [...(cat.combos || []), { clave: 'personalizado', nombre: (cat.combo_personalizado || {}).nombre || 'Combo personalizado', descripcion: (cat.combo_personalizado || {}).descripcion || '', items: [] }];
  const maxCombos = (t) => Math.max(1, Math.min(...t.items.map((x) => Math.floor(50 / x.cantidad))));
  const nCombos = (t) => Math.round((d.q[t.items[0].id] || t.items[0].cantidad) / t.items[0].cantidad);
  if (!d.tipo && Object.keys(d.q).length) d.tipo = 'personalizado';
  const prodsBox = el('div');
  const selector = el('div', { class: 'grid', role: 'radiogroup', 'aria-label': 'Tipo de combo' });
  const resumenItems = (t) => t.items.map((x) => `${x.cantidad} ${x.nombre}`).join(' + ');
  const pintarProds = () => {
    const t = tipos.find((x) => x.clave === d.tipo);
    if (!t) { prodsBox.replaceChildren(el('p', { class: 'mu' }, 'Elige un tipo de combo para continuar.')); return; }
    if (!t.items.length) { prodsBox.replaceChildren(construirProds()); return; }
    const cant = el('span', {}, String(nCombos(t)));
    const poner = (v) => { for (const x of t.items) d.q[x.id] = v * x.cantidad; cant.textContent = String(v); cotizar(); };
    prodsBox.replaceChildren(el('div', { class: 'item on' },
      el('b', {}, t.nombre), el('small', {}, t.descripcion), el('small', {}, resumenItems(t)), el('span', { class: 'p' }, money(t.precio) + ' por combo'),
      el('div', { class: 'qty' }, el('button', { type: 'button', onclick: () => poner(Math.max(1, nCombos(t) - 1)), 'aria-label': 'Quitar un combo' }, '–'), cant,
        el('button', { type: 'button', onclick: () => poner(Math.min(maxCombos(t), nCombos(t) + 1)), 'aria-label': 'Agregar un combo' }, '+')),
      el('small', {}, 'Cantidad de combos')));
  };
  const elegirTipo = (t) => {
    d.tipo = t.clave; d.q = {};
    for (const x of t.items) d.q[x.id] = x.cantidad;
    selector.querySelectorAll('.opt').forEach((o) => o.classList.toggle('on', o.dataset.tipo === t.clave));
    pintarProds(); cotizar();
  };
  tipos.forEach((t) => selector.append(el('label', { class: 'opt tipo' + (d.tipo === t.clave ? ' on' : ''), 'data-tipo': t.clave },
    el('input', { type: 'radio', name: 'tipo', value: t.clave, checked: d.tipo === t.clave, onchange: () => elegirTipo(t) }),
    el('span', {}, el('b', {}, t.nombre), el('br'), el('small', {}, t.items.length ? resumenItems(t) + ' · ' + money(t.precio) : t.descripcion)))));
  pintarProds();

  const area = el('textarea', { rows: 3, maxlength: 120, placeholder: 'Escribe tu mensaje…', 'aria-label': 'Dedicatoria' }, '');
  area.value = d.text;
  const cuenta = el('small', {}, `${d.text.length}/120`);
  area.addEventListener('input', () => { d.text = area.value; cuenta.textContent = `${d.text.length}/120`; cotizar(); });
  const dedBox = el('div', {}, area, cuenta); dedBox.hidden = !d.ded;
  const bSi = el('button', { type: 'button', class: d.ded ? 'on' : '' }, 'Sí'), bNo = el('button', { type: 'button', class: d.ded ? '' : 'on' }, 'No');
  const setDed = (v) => { d.ded = v; bSi.classList.toggle('on', v); bNo.classList.toggle('on', !v); dedBox.hidden = !v; cotizar(); };
  bSi.onclick = () => setDed(true); bNo.onclick = () => setDed(false);

  const hora = el('select', { 'aria-label': 'Hora de entrega', onchange: (ev) => { d.hora = ev.target.value; cotizar(); } });
  const llenarHoras = (horarios) => {
    hora.replaceChildren(el('option', { value: '' }, 'Elige una hora'), ...horarios.map((h) => el('option', { value: h.hora, disabled: !h.disponible }, h.hora + (h.disponible ? '' : ' (ocupado)'))));
    if (!horarios.some((h) => h.hora === d.hora && h.disponible)) d.hora = '';
    hora.value = d.hora;
  };
  const cargaHoras = async () => {
    if (!d.fecha) { llenarHoras([]); return; }
    try { llenarHoras((await api('/pedidos/disponibilidad?fecha=' + encodeURIComponent(d.fecha))).horarios); } catch (e) { llenarHoras([]); }
  };
  const fecha = el('input', { type: 'date', min: hoyLocal(), 'aria-label': 'Fecha de entrega', onchange: async (ev) => { d.fecha = ev.target.value; await cargaHoras(); cotizar(); } });
  fecha.value = d.fecha;

  /* ---------- Dirección de entrega: al escribir el código postal se llenan las colonias ---------- */
  const D = d.dir;
  let seqCP = 0;
  const campo = (rotulo, input, cls = '') => el('label', { class: cls }, rotulo, input);
  const inCP = el('input', { name: 'cp', inputmode: 'numeric', maxlength: 5, autocomplete: 'postal-code', placeholder: '91000', 'aria-label': 'Código postal' });
  const selCol = el('select', { 'aria-label': 'Colonia', onchange: (ev) => { D.colonia = ev.target.value; cotizar(); } });
  const inColM = el('input', { maxlength: 80, autocomplete: 'address-level3', 'aria-label': 'Colonia (escríbela)', oninput: (ev) => { D.colonia = ev.target.value; cotizar(); } });
  const inMun = el('input', { maxlength: 80, autocomplete: 'address-level2', 'aria-label': 'Municipio o ciudad', oninput: (ev) => { D.municipio = ev.target.value; cotizar(); } });
  const inCalle = el('input', { maxlength: 100, autocomplete: 'address-line1', 'aria-label': 'Calle', oninput: (ev) => { D.calle = ev.target.value; cotizar(); } });
  const inExt = el('input', { maxlength: 20, 'aria-label': 'Número exterior', placeholder: 'Ej. 12 o S/N', oninput: (ev) => { D.ext = ev.target.value; cotizar(); } });
  const inInt = el('input', { maxlength: 20, 'aria-label': 'Número interior (opcional)', oninput: (ev) => { D.int = ev.target.value; cotizar(); } });
  const inRef = el('input', { maxlength: 200, 'aria-label': 'Referencias (opcional)', placeholder: 'Ej. portón negro, frente al parque', oninput: (ev) => { D.ref = ev.target.value; cotizar(); } });
  const infoCP = el('small', { class: 'cpinfo', role: 'status' });
  const lColonia = campo('Colonia', selCol), lColM = campo('Colonia', inColM), lMun = campo('Municipio o ciudad', inMun);
  const pintarCP = () => {
    selCol.replaceChildren(el('option', { value: '' }, D.colonias.length ? 'Elige tu colonia' : 'Primero escribe el código postal'), ...D.colonias.map((c) => el('option', { value: c }, c)));
    selCol.value = D.colonias.includes(D.colonia) ? D.colonia : ''; if (selCol.value === '') D.colonia = D.manual ? D.colonia : '';
    selCol.disabled = !D.colonias.length;
    lColonia.hidden = D.manual; lColM.hidden = !D.manual; lMun.hidden = !D.manual;
    infoCP.textContent = D.estadoCP;
  };
  const buscarCP = async () => {
    const cp = D.cp, mi = ++seqCP;
    if (!/^\d{5}$/.test(cp)) { D.colonias = []; D.manual = false; D.estadoCP = ''; if (!D.manual) D.colonia = ''; pintarCP(); cotizar(); return; }
    D.estadoCP = 'Buscando colonias…'; pintarCP();
    try {
      const { codigo_postal: r } = await api('/catalogo/codigo-postal/' + cp);
      if (mi !== seqCP) return;
      if (r) {
        D.manual = false; D.colonias = r.colonias; D.municipio = r.municipio;
        if (!r.colonias.includes(D.colonia)) D.colonia = r.colonias.length === 1 ? r.colonias[0] : '';
        D.estadoCP = `${r.municipio}, ${r.estado} · ${r.colonias.length === 1 ? 'colonia llenada automáticamente' : r.colonias.length + ' colonias, elige la tuya'}`;
      } else { D.manual = true; D.colonias = []; D.estadoCP = 'No encontramos ese código postal en nuestro catálogo: escribe tu colonia y municipio.'; inColM.value = D.colonia; inMun.value = D.municipio; }
    } catch (e) { if (mi !== seqCP) return; D.colonias = []; D.estadoCP = e.message; }
    pintarCP(); selCol.value = D.colonia; cotizar();
  };
  inCP.addEventListener('input', () => { const v = inCP.value.replace(/\D/g, '').slice(0, 5); if (v !== inCP.value) inCP.value = v; D.cp = v; buscarCP(); });
  inCP.value = D.cp; inColM.value = D.manual ? D.colonia : ''; inMun.value = D.manual ? D.municipio : ''; inCalle.value = D.calle; inExt.value = D.ext; inInt.value = D.int; inRef.value = D.ref;
  pintarCP(); if (/^\d{5}$/.test(D.cp) && !D.colonias.length && !D.manual) buscarCP();
  const dirBox = el('div', { class: 'dir-grid' },
    campo('Código postal', inCP), el('div', { class: 'dir-info' }, infoCP), lColonia, lColM, lMun,
    campo('Calle', inCalle, 'wide'), campo('Número exterior', inExt), campo('Número interior (opcional)', inInt), campo('Referencias (opcional)', inRef, 'wide'));

  pagar.onclick = async () => {
    pagar.disabled = true;
    try { const r = await api('/pedidos/checkout', { method: 'POST', body: cuerpo() }); location.assign(r.url); }
    catch (e) { errores.replaceChildren(el('div', {}, e.message)); cotizar(); }
  };

  root.append(el('div', { class: 'two' },
    el('section', { class: 'card' }, el('h2', {}, '1. Elige tu combo'), selector, prodsBox,
      el('h2', {}, '2. ¿Llevará dedicatoria?'), el('div', { class: 'seg' }, bSi, bNo), dedBox,
      el('h2', {}, '3. Fecha y hora de entrega'), el('div', { class: 'seg' }, fecha, hora),
      el('h2', {}, '4. Dirección de entrega'), dirBox, errores),
    resumen));
  pintar(null); cargaHoras(); if (Object.keys(d.q).length) cotizar();
}

/* ---------- Seguimiento ---------- */
const ORDEN = ['Pendiente', 'En preparación', 'Listo para entrega', 'Entregado'];
function linea(estatus, historial) {
  const hist = new Map((historial || []).map((h) => [h.estatus, h.creado_en]));
  const actual = ORDEN.indexOf(estatus);
  return el('div', { class: 'tl', role: 'list', 'aria-label': 'Seguimiento del pedido' }, ORDEN.map((s, i) => el('div', { role: 'listitem', class: i <= actual ? 'd' : '' },
    el('i', { style: i <= actual ? 'background:' + ESTC[s] : '' }, i <= actual ? '✓' : ''), s,
    el('small', {}, hist.has(s) ? new Date(hist.get(s)).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : ''))));
}

/* ---------- Comprobante, pedidos y regreso de la pasarela ---------- */
function comprobante(p) {
  return el('div', { class: 'ok' },
    el('h2', {}, `Comprobante ${p.folio}`), el('p', {}, chip(p.estatus)),
    ...p.items.map((i) => ln(`${i.nombre} x${i.cantidad}`, money(i.subtotal))),
    p.combo ? ln('Combo', p.combo.nombre) : null, ln('Total pagado', money(p.total), 'tot'),
    p.historial ? [el('h3', {}, 'Seguimiento'), linea(p.estatus, p.historial)] : null,
    el('p', {}, `Cliente: ${p.cliente.nombre}`, el('br'), `Entrega: ${p.entrega.fecha} a las ${p.entrega.hora} h`,
      p.entrega.direccion ? [el('br'), `Dirección: ${p.entrega.direccion.texto}`, p.entrega.direccion.referencias ? [el('br'), `Referencias: ${p.entrega.direccion.referencias}`] : null] : null,
      p.dedicatoria ? [el('br'), `Dedicatoria: “${p.dedicatoria}”`] : null, el('br'), `Pago: ${p.pago ? p.pago.estado + ' (' + p.pago.proveedor + ')' : '—'}`),
    el('div', { class: 'row noprint' }, el('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir comprobante'),
      el('button', { class: 'btn s', type: 'button', onclick: () => { $('#msg').hidden = true; d = nuevoCombo(); tab = 'armar'; paint(); } }, 'Armar otro combo')));
}
function mostrar(nodo) { const m = $('#msg'); m.replaceChildren(nodo); m.hidden = false; }
const aviso = (titulo, texto) => el('div', { class: 'card' }, el('h2', {}, titulo), el('p', {}, texto));

async function verComprobante(id) {
  try { mostrar(comprobante((await api('/pedidos/' + id)).pedido)); window.scrollTo(0, 0); } catch (e) { mostrar(aviso('No se pudo abrir', e.message)); }
}
async function atenderRetorno() {
  const { checkout, cancelado } = retorno;
  if (!checkout && !cancelado) return;
  retorno = { checkout: null, cancelado: null };
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ok */ }
  if (cancelado) { mostrar(aviso('Pago cancelado', 'No se hizo ningún cobro y tu combo no se guardó. Puedes armarlo de nuevo cuando quieras.')); return; }
  mostrar(aviso('Confirmando tu pago…', 'Esto tarda unos segundos.'));
  for (let i = 0; i < 20; i++) {
    try {
      const { checkout: c } = await api('/pedidos/checkout/' + encodeURIComponent(checkout));
      if (c.estado === 'pagado') { d = nuevoCombo(); return verComprobante(c.pedido_id); }
      if (c.estado === 'revision') return mostrar(aviso('Tu pago está en revisión', 'Recibimos tu pago pero no pudimos reservar tu pedido (por disponibilidad). Nos pondremos en contacto contigo para resolverlo o reembolsarte.'));
      if (c.estado === 'rechazado' || c.estado === 'expirado') return mostrar(aviso('El pago no se completó', 'No se hizo ningún cobro. Puedes intentar de nuevo.'));
    } catch (e) { return mostrar(aviso('No se pudo confirmar', e.message)); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  mostrar(aviso('Seguimos esperando la confirmación', 'Tu banco aún no confirma el pago. Revisa “Mis pedidos” en unos minutos.'));
}
async function cargarMis(silencioso = false) {
  const root = $('#mis');
  if (!silencioso) root.replaceChildren(el('p', { class: 'mu' }, 'Cargando…'));
  try {
    const { pedidos } = await api('/pedidos');
    root.replaceChildren(el('h2', {}, 'Mis pedidos'), el('p', { class: 'mu' }, 'El estatus se actualiza solo y también te avisamos por correo.'),
      ...(pedidos.length ? pedidos.map((p) => el('div', { class: 'card' },
        el('b', {}, p.folio + ' '), chip(p.estatus),
        el('p', {}, (p.items || []).map((i) => `${i.nombre} x${i.cantidad}`).join(', '), p.combo ? ` · ${p.combo.nombre}` : '', p.dedicatoria ? [el('br'), `Dedicatoria: “${p.dedicatoria}”`] : null,
          el('br'), `Entrega: ${p.fecha} ${p.hora} h · ${money(p.total)}`, p.direccion ? [el('br'), `Dirección: ${p.direccion.texto}`] : null),
        linea(p.estatus, p.historial),
        el('button', { class: 'btn s', type: 'button', style: 'width:auto', onclick: () => verComprobante(p.id) }, 'Ver comprobante'))) : [el('p', { class: 'mu' }, 'Aún no tienes pedidos.')]));
  } catch (e) { if (!silencioso) root.replaceChildren(el('p', { class: 'err' }, e.message)); }
}
/* ---------- Notificaciones del cliente ---------- */
const fechaHora = (f) => new Date(f).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
function pintarBadge(n) { const b = $('#badge'); if (!b) return; b.textContent = n > 99 ? '99+' : String(n); b.hidden = !(n > 0); b.setAttribute('aria-label', n + ' sin leer'); }
async function cargarContador() {
  if (!user || user.rol !== 'cliente') return;
  try { pintarBadge((await api('/avisos/contador')).no_leidas); } catch (e) { /* sin conexión: se reintenta */ }
}
async function cargarAvisos(silencioso = false) {
  const root = $('#avisos');
  if (!silencioso) root.replaceChildren(el('p', { class: 'mu' }, 'Cargando…'));
  try {
    const { avisos, no_leidas } = await api('/avisos');
    pintarBadge(no_leidas);
    const abrir = async (a) => {
      if (!a.leida) { try { await api(`/avisos/${a.id}/leida`, { method: 'POST' }); } catch (e) { /* ok */ } }
      tab = 'mis'; paint(); verComprobante(a.pedido_id);
    };
    root.replaceChildren(el('div', { class: 'row filtros' }, el('h2', { style: 'margin:0' }, 'Notificaciones'),
        el('button', { class: 'mini', type: 'button', disabled: no_leidas === 0, onclick: async () => { try { await api('/avisos/leer-todas', { method: 'POST' }); } catch (e) { /* ok */ } cargarAvisos(true); } }, 'Marcar todas como leídas')),
      el('p', { class: 'mu' }, 'Aquí te avisamos cuando tu pedido se confirma y cada vez que cambia de estatus. Se actualiza solo.'),
      ...(avisos.length ? avisos.map((a) => el('div', { class: 'card aviso-n' + (a.leida ? '' : ' nueva') },
        el('div', { class: 'row', style: 'margin:0;justify-content:space-between;align-items:baseline' }, el('b', {}, (a.leida ? '' : '● ') + a.titulo), el('small', {}, fechaHora(a.creado_en))),
        el('p', { style: 'margin:6px 0' }, a.mensaje || ''),
        el('button', { class: 'btn s', type: 'button', style: 'width:auto', onclick: () => abrir(a) }, 'Ver pedido ' + a.folio))) : [el('p', { class: 'mu' }, 'Aún no tienes notificaciones.')]));
  } catch (e) { if (!silencioso) root.replaceChildren(el('p', { class: 'err' }, e.message)); }
}
let timerAvisos = null;
function cicloAvisos() {
  clearInterval(timerAvisos); timerAvisos = null;
  if (user && user.rol === 'cliente') timerAvisos = setInterval(() => { if (tab === 'avis') cargarAvisos(true); else cargarContador(); }, REFRESCO);
}
let timerMis = null;
function cicloMis() {
  clearInterval(timerMis); timerMis = null;
  if (user && user.rol === 'cliente' && tab === 'mis') timerMis = setInterval(() => cargarMis(true), REFRESCO);
}

async function descargar(path, nombre) {
  const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'No se pudo descargar el archivo.'); }
  const url = URL.createObjectURL(await r.blob());
  const a = el('a', { href: url, download: nombre }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Pantalla ---------- */
function card(parent, nombre, detalle, precio) {
  parent.append(el('div', { class: 'item' }, el('b', {}, nombre), el('small', {}, detalle || ''), precio == null ? null : el('span', { class: 'p' }, money(precio))));
}
/* Aviso de privacidad: quien ya tenía cuenta (o si el aviso cambió) debe aceptarlo antes de usar la tienda */
function pedirPrivacidad() {
  let m = document.getElementById('privacidad-modal');
  if (!user || !user.privacidad_pendiente) { if (m) m.remove(); return; }
  if (m) return;
  const err = el('p', { class: 'err', role: 'alert' }), ck = el('input', { type: 'checkbox', id: 'acepto-priv' });
  const ok = el('button', { class: 'btn', type: 'button', 'data-aceptar-privacidad': '1', onclick: async () => {
    err.textContent = '';
    if (!ck.checked) { err.textContent = 'Marca la casilla para aceptar el Aviso de privacidad.'; return; }
    try { const j = await api('/auth/aceptar-privacidad', { method: 'POST', body: { acepto: true } }); user = j.usuario; try { sessionStorage.setItem('u', JSON.stringify(user)); } catch (e2) { /* sin almacenamiento */ } pedirPrivacidad(); }
    catch (e) { err.textContent = e.message; }
  } }, 'Aceptar y continuar');
  m = el('div', { id: 'privacidad-modal', class: 'modal-fondo', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'priv-t' },
    el('div', { class: 'card modal' }, el('h3', { id: 'priv-t' }, 'Aviso de privacidad'),
      el('p', {}, 'Para seguir usando EN COMBO necesitamos que leas y aceptes cómo cuidamos tus datos personales (nombre, correo, teléfono y dirección de entrega).'),
      el('p', {}, el('a', { href: 'privacidad.html', target: '_blank', rel: 'noopener' }, 'Leer el Aviso de privacidad completo')),
      el('label', { class: 'chk acepto' }, ck, el('span', {}, 'He leído y acepto el Aviso de privacidad')), err,
      el('div', { class: 'row' }, ok, el('button', { class: 'btn s', type: 'button', onclick: () => { m.remove(); setSession(null, null); } }, 'No acepto (cerrar sesión)'))));
  document.body.append(m);
}
function paint() {
  pedirPrivacidad();
  const cli = !!user && user.rol === 'cliente', staff = !!user && !cli;
  $('#who').textContent = user ? user.nombre + ' · ' + ROL[user.rol] : '';
  $('#out').hidden = !user; $('#btn-cuenta').hidden = !user; $('#cuenta').hidden = !(user && vistaCuenta); $('#auth').hidden = !!user; $('#nav').hidden = !cli || vistaCuenta; $('#staff').hidden = !staff || vistaCuenta;
  if (user && vistaCuenta) {
    // «Mi cuenta» es una pantalla aparte: se oculta todo lo demás hasta que la persona regrese
    for (const id of ['#armar', '#mis', '#avisos', '#catalogo', '#msg']) $(id).hidden = true;
    return;
  }
  $('#armar').hidden = !(cli && tab === 'armar'); $('#mis').hidden = !(cli && tab === 'mis'); $('#avisos').hidden = !(cli && tab === 'avis'); $('#catalogo').hidden = cli || staff;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (!user) $('#msg').hidden = true;
  if (cat && !cli) {
    $('#cat').replaceChildren();
    (cat.combos || []).forEach((c) => card($('#cat'), c.nombre, c.items.map((x) => `${x.cantidad} ${x.nombre}`).join(' + '), c.precio));
    card($('#cat'), (cat.combo_personalizado || {}).nombre || 'Combo personalizado', (cat.combo_personalizado || {}).descripcion || '', null);
    cat.productos.forEach((p) => card($('#cat'), p.nombre, p.descripcion, p.precio));
  }
  if (cli) { if (tab === 'armar') buildArmar(); else if (tab === 'avis') cargarAvisos(); else cargarMis(); if (tab !== 'avis') cargarContador(); atenderRetorno(); }
  if (staff) Personal.iniciar({ api, el, money, usuario: user, descargar }); else Personal.detener();
  cicloMis(); cicloAvisos();
}

for (const f of [$('#f-login'), $('#f-reg')]) {
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); $('#err').textContent = '';
    try { const body = Object.fromEntries(new FormData(f)); if (f.id === 'f-reg') body.acepta_privacidad = f.elements.acepta_privacidad.checked; const j = await api(f.dataset.path, { method: 'POST', body }); f.reset(); setSession(j.token, j.usuario); }
    catch (err) { $('#err').textContent = err.message; }
  });
}
const VISTAS_AUTH = { login: '#f-login', reg: '#f-reg', olvide: '#f-olvide', reset: '#f-reset' };
function vistaAuth(v, mensaje = '') {
  for (const [k, sel] of Object.entries(VISTAS_AUTH)) $(sel).hidden = k !== v;
  $('#tab-login').classList.toggle('on', v === 'login' || v === 'olvide' || v === 'reset'); $('#tab-reg').classList.toggle('on', v === 'reg');
  $('#err').textContent = ''; $('#okauth').textContent = mensaje;
}
const tabAuth = (login) => vistaAuth(login ? 'login' : 'reg');
$('#tab-login').onclick = () => tabAuth(true);
$('#tab-reg').onclick = () => tabAuth(false);
$('#ir-olvide').onclick = () => vistaAuth('olvide');
$('#f-olvide [data-volver]').onclick = () => vistaAuth('login');
$('#f-olvide').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#err').textContent = ''; $('#okauth').textContent = '';
  try { const j = await api('/auth/olvide', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); $('#okauth').textContent = j.mensaje; e.target.reset(); }
  catch (err) { $('#err').textContent = err.message; }
});
$('#f-reset').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#err').textContent = '';
  const v = new FormData(e.target), nueva = v.get('nueva');
  if (nueva.length < 8) { $('#err').textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; return; }
  if (nueva !== v.get('repetir')) { $('#err').textContent = 'La nueva contraseña y su confirmación no coinciden.'; return; }
  try { await api('/auth/restablecer', { method: 'POST', body: { token: resetToken, nueva } }); resetToken = null; e.target.reset(); vistaAuth('login', 'Contraseña actualizada. Ya puedes iniciar sesión con la nueva.'); }
  catch (err) { $('#err').textContent = err.message; }
});
if (resetToken) vistaAuth('reset');
/* Mi cuenta = derechos ARCO del Aviso de privacidad:
   Acceder (ver tus datos) · Rectificar (cambiar nombre, correo y contraseña) · Cancelar y Oponerte (eliminar la cuenta) · y tus tarjetas guardadas */
function abrirCuenta() {
  if (!user) return;
  if (vistaCuenta) { volverDeCuenta(); return; }
  vistaCuenta = true; paint(); renderCuenta(); window.scrollTo(0, 0);
}
function volverDeCuenta() {
  vistaCuenta = false; if (user && user.rol === 'cliente') tab = 'armar';
  $('#cuenta').replaceChildren(); paint(); window.scrollTo(0, 0);
}
async function renderCuenta() {
  const c = $('#cuenta'), esCliente = user.rol === 'cliente', esAdmin = user.rol === 'admin';
  const guardarSesion = (t, u) => { if (t) token = t; user = u; try { sessionStorage.setItem('t', token); sessionStorage.setItem('u', JSON.stringify(u)); } catch (e) { /* ok */ } paint(); };
  const msg = () => ({ err: el('p', { class: 'err', role: 'alert' }), ok: el('p', { class: 'okmsg', role: 'status' }) });
  const pw = (rotulo, nombre, auto) => el('label', {}, rotulo, el('input', { type: 'password', name: nombre, autocomplete: auto, required: true, maxlength: 72 }));
  let perfil = { nombre: user.nombre, correo: user.correo };
  try { perfil = (await api('/auth/perfil')).perfil; } catch (e) { /* se usa lo que ya sabemos */ }

  // 1) Mis datos (Acceder y Rectificar)
  const m1 = msg();
  const fd = el('form', { 'data-form': 'datos', onsubmit: async (ev) => {
    ev.preventDefault(); m1.err.textContent = ''; m1.ok.textContent = '';
    const v = new FormData(fd), cambia = v.get('correo').trim().toLowerCase() !== perfil.correo.toLowerCase();
    try {
      const j = await api('/auth/perfil', { method: 'PUT', body: { ...(esCliente ? { nombre: v.get('nombre') } : {}), correo: v.get('correo'), ...(cambia ? { password: v.get('password') } : {}) } });
      guardarSesion(j.token, j.usuario); perfil.nombre = j.usuario.nombre; perfil.correo = j.usuario.correo; fd.elements.password.value = ''; m1.ok.textContent = 'Datos actualizados.';
    } catch (e) { m1.err.textContent = e.message; }
  } },
    esCliente ? el('label', {}, 'Nombre', el('input', { name: 'nombre', value: perfil.nombre, required: true, minlength: 2, maxlength: 80, autocomplete: 'name' })) : null,
    el('label', {}, 'Correo', el('input', { name: 'correo', type: 'email', value: perfil.correo, required: true, maxlength: 120, autocomplete: 'email' })),
    el('label', {}, esCliente ? 'Contraseña actual (solo si cambias el correo)' : 'Contraseña actual (necesaria para cambiar tu correo)', el('input', { type: 'password', name: 'password', autocomplete: 'current-password', maxlength: 72 })),
    m1.err, m1.ok, el('button', { class: 'btn', type: 'submit' }, esCliente ? 'Guardar mis datos' : 'Guardar correo'));

  // 2) Cambiar contraseña (cierra las demás sesiones y conserva esta)
  const m2 = msg();
  const f = el('form', { 'data-form': 'password', onsubmit: async (ev) => {
    ev.preventDefault(); m2.err.textContent = ''; m2.ok.textContent = '';
    const v = new FormData(f), actual = v.get('actual'), nueva = v.get('nueva');
    if (nueva.length < 8) { m2.err.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; return; }
    if (nueva !== v.get('repetir')) { m2.err.textContent = 'La nueva contraseña y su confirmación no coinciden.'; return; }
    try { const j = await api('/auth/cambiar-password', { method: 'POST', body: { actual, nueva } }); token = j.token; try { sessionStorage.setItem('t', j.token); } catch (e) { /* ok */ } f.reset(); m2.ok.textContent = 'Contraseña actualizada. Las demás sesiones abiertas se cerraron.'; }
    catch (e) { m2.err.textContent = e.message; }
  } }, pw('Contraseña actual', 'actual', 'current-password'), pw('Nueva contraseña (mínimo 8 caracteres)', 'nueva', 'new-password'), pw('Repite la nueva contraseña', 'repetir', 'new-password'),
    m2.err, m2.ok, el('button', { class: 'btn', type: 'submit' }, 'Cambiar contraseña'));

  const volver = (txt) => el('button', { class: 'btn s', type: 'button', 'data-volver-cuenta': '1', onclick: volverDeCuenta }, txt);
  const txtVolver = esCliente ? '← Volver a hacer un nuevo pedido' : '← Volver al panel';
  const partes = [el('div', { class: 'row' }, volver(txtVolver)), el('h2', {}, 'Mi cuenta')];
  if (esCliente) partes.push(el('h3', {}, 'Mis datos'), fd);
  else {
    partes.push(el('p', { class: 'mu' }, `${perfil.nombre} · ${ROL[user.rol]}`));
    if (esAdmin) partes.push(el('h3', {}, 'Correo de la cuenta'), fd);
    else partes.push(el('p', { class: 'mu' }, `Correo de acceso: ${perfil.correo}. Si necesitas cambiarlo, pídeselo al administrador.`));
  }
  partes.push(el('h3', {}, 'Contraseña'), f);

  if (esCliente) {
    // 3) Mis tarjetas
    const m3 = msg(), lista = el('div', { 'data-tarjetas': '1' }), formT = el('div');
    const cargarT = async () => {
      try {
        const { tarjetas } = await api('/tarjetas');
        lista.replaceChildren(...(tarjetas.length ? tarjetas.map((t) => el('div', { class: 'tarjeta-g' }, el('span', {}, el('b', {}, t.etiqueta), ` · ${t.titular} · vence ${t.vence}`),
          el('button', { class: 'mini', type: 'button', 'data-quitar-tarjeta': t.id, onclick: async () => { m3.err.textContent = ''; try { await api('/tarjetas/' + t.id, { method: 'DELETE' }); await cargarT(); } catch (e) { m3.err.textContent = e.message; } } }, 'Eliminar')))
          : [el('p', { class: 'mu' }, 'Todavía no tienes tarjetas guardadas.')]));
      } catch (e) { lista.replaceChildren(el('p', { class: 'err' }, e.message)); }
    };
    const agregar = () => {
      const mm = msg(), inp = (n, ph, ml, extra) => el('input', { name: n, placeholder: ph, maxlength: ml, required: true, autocomplete: 'off', ...(extra || {}) });
      const ft = el('form', { 'data-form': 'tarjeta', novalidate: true, onsubmit: async (ev) => {
        ev.preventDefault(); mm.err.textContent = '';
        const v = new FormData(ft);
        try { await api('/tarjetas', { method: 'POST', body: { tarjeta: { titular: v.get('titular'), numero: v.get('numero'), vence: v.get('vence'), cvv: v.get('cvv') } } }); formT.replaceChildren(); await cargarT(); }
        catch (e) { mm.err.textContent = e.campos ? Object.values(e.campos).join(' ') : e.message; }
        ft.elements.cvv.value = '';
      } }, el('label', {}, 'Nombre del titular', inp('titular', 'Como aparece en la tarjeta', 60)), el('label', {}, 'Número de tarjeta', inp('numero', '0000 0000 0000 0000', 23, { inputmode: 'numeric' })),
        el('div', { class: 'row' }, el('label', { style: 'flex:1' }, 'Vencimiento', inp('vence', 'MM/AA', 7)), el('label', { style: 'flex:1' }, 'CVV (solo para validar)', el('input', { name: 'cvv', type: 'password', inputmode: 'numeric', maxlength: 4, required: true, autocomplete: 'off' }))),
        el('p', { class: 'mu' }, 'No guardamos tu número completo ni el CVV: solo la marca, los últimos 4 dígitos, el titular y el vencimiento. Para pagar con una tarjeta guardada se te pedirá el CVV.'),
        mm.err, el('div', { class: 'row' }, el('button', { class: 'btn', type: 'submit' }, 'Guardar tarjeta'), el('button', { class: 'btn s', type: 'button', onclick: () => formT.replaceChildren() }, 'Cancelar')));
      formT.replaceChildren(ft);
    };
    partes.push(el('h3', {}, 'Mis tarjetas'), lista, m3.err, formT, el('button', { class: 'btn s', type: 'button', 'data-agregar-tarjeta': '1', onclick: agregar }, '+ Agregar tarjeta'));
    cargarT();

    // 4) Privacidad y eliminar cuenta (Cancelación / Oposición)
    const m4 = msg(), zona = el('div');
    const pedirBaja = () => {
      const ff = el('form', { 'data-form': 'eliminar', onsubmit: async (ev) => {
        ev.preventDefault(); m4.err.textContent = '';
        try { await api('/auth/eliminar-cuenta', { method: 'POST', body: { password: ff.elements.password.value, confirmar: true } }); alert_ok(); }
        catch (e) { m4.err.textContent = e.message; }
      } }, el('p', {}, 'Se borrarán tus datos personales y tus tarjetas guardadas. Se conserva únicamente el registro de ventas, sin datos que te identifiquen. Esta acción no se puede deshacer.'),
        pw('Escribe tu contraseña para confirmar', 'password', 'current-password'), m4.err,
        el('div', { class: 'row' }, el('button', { class: 'btn peligro', type: 'submit', 'data-confirmar-eliminar': '1' }, 'Sí, eliminar mi cuenta'), el('button', { class: 'btn s', type: 'button', onclick: () => zona.replaceChildren() }, 'No, conservarla')));
      zona.replaceChildren(ff);
    };
    const alert_ok = () => { c.hidden = true; setSession(null, null); const m = $('#msg'); m.textContent = 'Tu cuenta fue eliminada. Gracias por haber usado EN COMBO.'; m.hidden = false; };
    partes.push(el('h3', {}, 'Privacidad'),
      el('p', { class: 'mu' }, perfil.privacidad_aceptada_en ? `Aceptaste el Aviso de privacidad (versión ${perfil.privacidad_version}) el ${new Date(perfil.privacidad_aceptada_en).toLocaleDateString('es-MX')}.` : 'Aún no has aceptado el Aviso de privacidad.'),
      el('button', { class: 'btn s peligro-s', type: 'button', 'data-eliminar-cuenta': '1', onclick: pedirBaja }, 'Eliminar mi cuenta'), zona);
  }
  partes.push(el('div', { class: 'row' }, volver(txtVolver)));
  c.replaceChildren(...partes);
}
$('#btn-cuenta').onclick = abrirCuenta;
$('#out').onclick = () => { d = nuevoCombo(); setSession(null, null); };
document.querySelectorAll('#nav button').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; $('#msg').hidden = true; paint(); }; });

(async () => {
  // Si el servidor tarda en responder (por ejemplo, está despertando), se reintenta unas veces antes de rendirse
  for (let i = 0; i < 6 && !cat; i++) {
    try { cat = await api('/catalogo'); $('#err').textContent = ''; }
    catch (e) {
      if (i === 5) { $('#err').textContent = 'No se pudo cargar el catálogo. Recarga la página en un momento.'; break; }
      $('#err').textContent = 'El servidor está tardando en responder. Reintentando…';
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  paint();
})();
