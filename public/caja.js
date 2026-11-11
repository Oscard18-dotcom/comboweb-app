// Corte de caja (administrador): con cuánto se inicia, lo cobrado en el periodo y con cuánto se termina. Se puede imprimir.
(() => {
  const costo = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const hoyMX = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
  const fechaLarga = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  const periodoTxt = (d, h) => (d === h ? fechaLarga(d) : `del ${fechaLarga(d)} al ${fechaLarga(h)}`);

  Personal.registrar('caja', 'Corte de caja', ['admin'], 5.5, (cont, H) => {
    const { e, api } = H;
    const err = e('div', { class: 'errbox noprint', role: 'alert' }), msg = e('p', { class: 'okmsg noprint', role: 'status' });
    const inDesde = e('input', { type: 'date', value: hoyMX(), max: hoyMX(), 'aria-label': 'Desde' });
    const inHasta = e('input', { type: 'date', value: hoyMX(), max: hoyMX(), 'aria-label': 'Hasta' });
    const inFondo = e('input', { type: 'number', min: '0', step: '0.01', value: '0', 'aria-label': 'Con cuánto inicias (fondo inicial)', style: 'width:140px' });
    const inContado = e('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Opcional', 'aria-label': 'Monto contado al cierre', style: 'width:140px' });
    const inNotas = e('input', { type: 'text', maxlength: '200', placeholder: 'Opcional', 'aria-label': 'Notas del corte', style: 'min-width:220px' });
    const hoja = e('div', { class: 'hoja', 'aria-label': 'Hoja del corte de caja' });
    const hist = e('div', { class: 'card tw noprint' });
    let res = null, guardado = null; // res: cifras calculadas del periodo; guardado: corte ya guardado que se muestra

    const fila = (c, v, clase = '') => e('tr', { class: clase }, e('td', {}, c), e('td', { class: 'n' }, v));
    function pintarHoja(c) {
      const filas = [fila('Fondo inicial (con lo que se abre la caja)', costo(c.fondo_inicial)),
        fila(`(+) Ventas cobradas en el periodo · ${c.pedidos} pedido${c.pedidos === 1 ? '' : 's'}`, costo(c.ventas)),
        ...c.desglose.map((d) => e('tr', {}, e('td', { style: 'padding-left:28px' }, `${d.metodo} (${d.pedidos})`), e('td', { class: 'n' }, costo(d.monto)))),
        fila('(=) Saldo final esperado (con lo que se cierra)', costo(c.saldo_final), 'tot')];
      if (c.contado != null) filas.push(fila('Monto contado al cierre', costo(c.contado)), fila('Diferencia (contado − esperado)', costo(c.diferencia), 'tot'));
      hoja.replaceChildren(
        e('h3', {}, 'EN COMBO · Corte de caja'),
        e('p', {}, c.folio ? e('strong', {}, 'Folio ' + c.folio + ' · ') : e('em', {}, 'Vista previa (sin guardar) · '), 'Periodo: ' + periodoTxt(c.desde, c.hasta)),
        e('table', { class: 'contable', 'aria-label': 'Corte de caja' }, e('thead', {}, e('tr', {}, e('th', {}, 'Concepto'), e('th', { class: 'n' }, 'Importe (MXN)'))), e('tbody', {}, ...filas)),
        c.notas ? e('p', {}, 'Notas: ' + c.notas) : null,
        c.folio ? e('p', { class: 'mu' }, `Elaborado por ${c.hecho_por || '—'} · ${new Date(c.creado_en).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`) : null,
        e('div', { class: 'firmas' }, e('div', {}, e('span', {}, 'Elaboró')), e('div', {}, e('span', {}, 'Revisó'))));
    }
    const num = (i) => { const v = i.value.trim(); return v === '' ? null : Number(v); };
    function vistaPrevia() {
      if (guardado || !res) return;
      const fondo = Number(inFondo.value) || 0, cnt = num(inContado), saldo = Math.round((fondo + res.ventas) * 100) / 100;
      pintarHoja({ ...res, fondo_inicial: fondo, saldo_final: saldo, contado: cnt, diferencia: cnt == null ? null : Math.round((cnt - saldo) * 100) / 100, notas: inNotas.value.trim() });
    }
    async function calcular() {
      guardado = null; err.replaceChildren();
      if (!inDesde.value || !inHasta.value) { err.replaceChildren(e('div', {}, 'Elige la fecha inicial y la final.')); return; }
      try { res = await api(`/caja/resumen?desde=${inDesde.value}&hasta=${inHasta.value}`); vistaPrevia(); } catch (er) { res = null; hoja.replaceChildren(); err.replaceChildren(e('div', {}, er.message)); }
    }
    async function historial() {
      try {
        const { cortes } = await api('/caja');
        hist.replaceChildren(cortes.length ? e('table', {}, e('thead', {}, e('tr', {}, ['Folio', 'Periodo', 'Fondo inicial', 'Ventas', 'Saldo final', 'Diferencia', ''].map((x) => e('th', {}, x)))),
          e('tbody', {}, ...cortes.map((c) => e('tr', {}, e('td', {}, c.folio), e('td', {}, periodoTxt(c.desde, c.hasta)), e('td', {}, costo(c.fondo_inicial)), e('td', {}, costo(c.ventas)), e('td', {}, costo(c.saldo_final)), e('td', {}, c.diferencia == null ? '—' : costo(c.diferencia)),
            e('td', { class: 'acc' }, e('button', { class: 'mini', type: 'button', 'aria-label': `Ver e imprimir ${c.folio}`, onclick: () => { guardado = c; pintarHoja(c); hoja.scrollIntoView && hoja.scrollIntoView(); setTimeout(() => window.print(), 50); } }, 'Ver / imprimir')))))) : e('p', { class: 'mu' }, 'Todavía no hay cortes guardados.'));
      } catch (er) { hist.replaceChildren(e('p', { class: 'mu' }, er.message)); }
    }
    const btnGuardar = e('button', { class: 'btn', type: 'submit' }, 'Guardar corte e imprimir');
    const form = e('form', { class: 'card noprint', 'aria-label': 'Datos del corte', novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault(); msg.textContent = ''; err.replaceChildren(); btnGuardar.disabled = true;
      try {
        const r = await api('/caja', { method: 'POST', body: { desde: inDesde.value, hasta: inHasta.value, fondo_inicial: inFondo.value, contado: inContado.value, notas: inNotas.value } });
        guardado = r.corte; pintarHoja(r.corte); msg.textContent = `Corte ${r.corte.folio} guardado.`; await historial();
        setTimeout(() => window.print(), 50);
      } catch (er) { err.replaceChildren(e('div', {}, er.message)); }
      btnGuardar.disabled = false;
    } },
      e('div', { class: 'row filtros', style: 'align-items:end;flex-wrap:wrap;gap:12px' },
        e('label', {}, 'Desde', inDesde), e('label', {}, 'Hasta', inHasta),
        e('label', {}, 'Con cuánto inicias (MXN)', inFondo), e('label', {}, 'Contado al cierre (MXN)', inContado), e('label', {}, 'Notas', inNotas)),
      e('div', { style: 'margin-top:10px;display:flex;gap:10px;flex-wrap:wrap' }, btnGuardar, e('button', { class: 'btn s', type: 'button', onclick: () => window.print() }, 'Imprimir vista actual')));
    [inDesde, inHasta].forEach((i) => i.addEventListener('change', calcular));
    [inFondo, inContado, inNotas].forEach((i) => i.addEventListener('input', () => { if (guardado) { guardado = null; } vistaPrevia(); }));

    cont.append(e('p', { class: 'mu noprint' }, 'Elige el periodo, escribe con cuánto dinero inicias y el sistema suma lo cobrado para mostrar con cuánto terminas. Si cuentas el dinero al cierre, escríbelo para ver la diferencia. Al guardar se genera un folio y se abre la impresión.'),
      err, msg, form, hoja, e('h3', { class: 'noprint', style: 'margin-top:14px' }, 'Cortes guardados'), hist);
    calcular(); historial();
  });
})();
