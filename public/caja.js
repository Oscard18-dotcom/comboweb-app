// Corte de caja (administrador), en dos pasos: 1) elegir el día y ABRIR con el dinero con el que se inicia (queda guardado);
// 2) más tarde, volver a entrar y CERRAR con la cantidad final. Solo con la caja cerrada se puede imprimir.
(() => {
  const costo = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const hoyMX = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
  const fechaLarga = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const cuando = (iso) => new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

  Personal.registrar('caja', 'Corte de caja', ['admin'], 5.5, (cont, H) => {
    const { e, api } = H;
    const err = e('div', { class: 'errbox noprint', role: 'alert' }), msg = e('p', { class: 'okmsg noprint', role: 'status' });
    const inDia = e('input', { type: 'date', value: hoyMX(), max: hoyMX(), 'aria-label': 'Día del corte' });
    const aviso = e('div', { class: 'noprint' }), panel = e('div', { class: 'noprint' }), hoja = e('div', { class: 'hoja', 'aria-label': 'Hoja del corte de caja' });
    const hist = e('div', { class: 'card tw noprint' });
    let estadoDia = null;

    const fila = (c, v, clase = '') => e('tr', { class: clase }, e('td', {}, c), e('td', { class: 'n' }, v));
    function pintarHoja() {
      const { corte, resumen } = estadoDia;
      if (!corte) { hoja.replaceChildren(); return; }
      const cerrado = corte.estado === 'cerrado';
      const r = cerrado ? corte : { ...resumen, desglose: resumen.desglose };
      const saldo = cerrado ? corte.saldo_final : Math.round((corte.fondo_inicial + resumen.ventas) * 100) / 100;
      const filas = [fila('Fondo inicial (con lo que se abrió la caja)', costo(corte.fondo_inicial)),
        fila(`(+) Ventas cobradas en el día · ${r.pedidos} pedido${r.pedidos === 1 ? '' : 's'}${cerrado ? '' : ' hasta ahora'}`, costo(r.ventas)),
        ...r.desglose.map((d) => e('tr', {}, e('td', { style: 'padding-left:28px' }, `${d.metodo} (${d.pedidos})`), e('td', { class: 'n' }, costo(d.monto)))),
        fila(cerrado ? '(=) Saldo final esperado' : '(=) Saldo final esperado (al momento)', costo(saldo), 'tot')];
      if (cerrado) filas.push(fila('Cantidad final con la que se cierra', costo(corte.contado)), fila('Diferencia (cantidad final − esperado)', costo(corte.diferencia), 'tot'));
      hoja.replaceChildren(
        e('h3', {}, 'EN COMBO · Corte de caja'),
        e('p', {}, e('strong', {}, `Folio ${corte.folio} · `), fechaLarga(corte.fecha), cerrado ? null : e('em', {}, ' · Caja abierta (vista previa, aún sin cerrar)')),
        e('table', { class: 'contable', 'aria-label': 'Corte de caja' }, e('thead', {}, e('tr', {}, e('th', {}, 'Concepto'), e('th', { class: 'n' }, 'Importe (MXN)'))), e('tbody', {}, ...filas)),
        corte.notas ? e('p', {}, 'Notas: ' + corte.notas) : null,
        e('p', { class: 'mu' }, `Abrió: ${corte.abrio || '—'} · ${cuando(corte.abierto_en)}`, cerrado ? ` · Cerró: ${corte.hecho_por || '—'} · ${cuando(corte.cerrado_en)}` : ''),
        cerrado ? e('div', { class: 'firmas' }, e('div', {}, e('span', {}, 'Elaboró')), e('div', {}, e('span', {}, 'Revisó'))) : null);
    }

    function pintarPanel() {
      const { fecha, corte } = estadoDia;
      const notas = e('input', { type: 'text', maxlength: '200', placeholder: 'Opcional', 'aria-label': 'Notas del corte', style: 'min-width:220px' });
      const enviar = async (ev, ruta, body, listo) => {
        ev.preventDefault(); err.replaceChildren(); msg.textContent = '';
        const b = ev.target.querySelector('button[type=submit]'); b.disabled = true;
        try { await api(ruta, { method: 'POST', body }); msg.textContent = listo; await cargar(true); } catch (er) { err.replaceChildren(e('div', {}, er.message)); b.disabled = false; }
      };
      if (!corte) {
        const fondo = e('input', { type: 'number', min: '0', step: '0.01', placeholder: '0.00', 'aria-label': 'Con cuánto abres (fondo inicial)', style: 'width:160px' });
        panel.replaceChildren(e('form', { class: 'card', 'aria-label': 'Abrir caja', novalidate: true, onsubmit: (ev) => enviar(ev, '/caja/abrir', { fecha, fondo_inicial: fondo.value, notas: notas.value }, 'Caja abierta. Queda guardada: regresa a esta pantalla cuando vayas a cerrar.') },
          e('h3', {}, `Abrir la caja · ${fechaLarga(fecha)}`),
          e('p', { class: 'mu' }, 'Paso 1 de 2. Escribe con cuánto dinero abres el negocio. Se guarda; al terminar el día regresas aquí para cerrar la caja.'),
          e('div', { class: 'row filtros', style: 'align-items:end;flex-wrap:wrap;gap:12px' }, e('label', {}, 'Con cuánto abres (MXN)', fondo), e('label', {}, 'Notas', notas)),
          e('div', { style: 'margin-top:10px' }, e('button', { class: 'btn', type: 'submit' }, 'Abrir caja'))));
      } else if (corte.estado === 'abierto') {
        const final = e('input', { type: 'number', min: '0', step: '0.01', placeholder: '0.00', 'aria-label': 'Cantidad final con la que cierras', style: 'width:160px' });
        panel.replaceChildren(e('form', { class: 'card', 'aria-label': 'Cerrar caja', novalidate: true, onsubmit: (ev) => enviar(ev, `/caja/${corte.id}/cerrar`, { contado: final.value, notas: notas.value }, 'Caja cerrada. Ya puedes imprimir el corte.') },
          e('h3', {}, `Caja abierta · ${fechaLarga(fecha)}`),
          e('p', {}, 'Abriste con ', e('strong', {}, costo(corte.fondo_inicial)), ` (${cuando(corte.abierto_en)}).`),
          e('p', { class: 'mu' }, 'Paso 2 de 2. Al terminar el día, escribe la cantidad final con la que cierras. El sistema suma las ventas cobradas, calcula cuánto debería haber y te muestra la diferencia. Después podrás imprimir el corte.'),
          e('div', { class: 'row filtros', style: 'align-items:end;flex-wrap:wrap;gap:12px' }, e('label', {}, 'Cantidad final (MXN)', final), e('label', {}, 'Notas', notas)),
          e('div', { style: 'margin-top:10px' }, e('button', { class: 'btn', type: 'submit' }, 'Cerrar caja y calcular')),
          e('p', { class: 'mu' }, 'La impresión se habilita cuando cierres la caja.')));
      } else {
        panel.replaceChildren(e('div', { class: 'card' }, e('h3', {}, `Caja cerrada · ${fechaLarga(fecha)}`),
          e('p', { class: 'mu' }, 'El corte está completo. Puedes imprimirlo cuando quieras.'),
          e('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir corte de caja')));
      }
    }

    async function cargar(conHistorial) {
      try {
        estadoDia = await api('/caja/dia?fecha=' + encodeURIComponent(inDia.value));
        pintarPanel(); pintarHoja();
      } catch (er) { estadoDia = null; panel.replaceChildren(); hoja.replaceChildren(); err.replaceChildren(e('div', {}, er.message)); }
      if (conHistorial !== false) await historial();
    }
    async function historial() {
      try {
        const { cortes } = await api('/caja');
        const pend = cortes.filter((c) => c.estado === 'abierto' && c.fecha !== inDia.value);
        aviso.replaceChildren(...pend.map((c) => e('div', { class: 'card', role: 'status' }, `Tienes una caja abierta sin cerrar del ${fechaLarga(c.fecha)}. `, e('button', { class: 'mini', type: 'button', onclick: () => { inDia.value = c.fecha; cargar(); } }, 'Ir a ese día'))));
        hist.replaceChildren(cortes.length ? e('table', {}, e('thead', {}, e('tr', {}, ['Folio', 'Día', 'Estado', 'Abrió con', 'Ventas', 'Cerró con', 'Diferencia', ''].map((x) => e('th', {}, x)))),
          e('tbody', {}, ...cortes.map((c) => e('tr', {}, e('td', {}, c.folio), e('td', {}, fechaLarga(c.fecha)), e('td', {}, c.estado === 'abierto' ? 'Abierta' : 'Cerrada'), e('td', {}, costo(c.fondo_inicial)),
            e('td', {}, c.ventas == null ? '—' : costo(c.ventas)), e('td', {}, c.contado == null ? '—' : costo(c.contado)), e('td', {}, c.diferencia == null ? '—' : costo(c.diferencia)),
            e('td', { class: 'acc' }, e('button', { class: 'mini', type: 'button', 'aria-label': `${c.estado === 'abierto' ? 'Cerrar' : 'Ver e imprimir'} ${c.folio}`, onclick: async () => { inDia.value = c.fecha; await cargar(false); if (c.estado === 'cerrado') { hoja.scrollIntoView && hoja.scrollIntoView(); setTimeout(() => window.print(), 50); } } }, c.estado === 'abierto' ? 'Cerrar caja' : 'Ver / imprimir')))))) : e('p', { class: 'mu' }, 'Todavía no hay cortes.'));
      } catch (er) { hist.replaceChildren(e('p', { class: 'mu' }, er.message)); }
    }
    inDia.addEventListener('change', () => { err.replaceChildren(); msg.textContent = ''; cargar(false); });

    cont.append(e('p', { class: 'mu noprint' }, 'Corte de caja en dos pasos: 1) elige el día y anota con cuánto abres; 2) al terminar, regresa, escribe la cantidad final y el sistema hace las cuentas. Con la caja cerrada podrás imprimir el corte.'),
      aviso, err, msg, e('div', { class: 'card noprint' }, e('label', {}, 'Día del corte', inDia)), panel, hoja,
      e('h3', { class: 'noprint', style: 'margin-top:14px' }, 'Cortes'), hist);
    cargar();
  });
})();
