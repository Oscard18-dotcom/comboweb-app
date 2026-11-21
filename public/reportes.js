// Dashboard y reportes del administrador (Sprint 5)
(() => {
  const fd = (f) => f.split('-').reverse().join('/');
  const mx = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const iso = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  const mas = (f, n) => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };

  /* ---------- Dashboard ---------- */
  Personal.registrar('dash', 'Dashboard', ['admin'], 1, (cont, H) => {
    const { e, api, chipC } = H;
    const raiz = e('div'); cont.append(raiz);
    const kp = (t, v, color) => e('div', { class: 'card' }, e('small', { class: 'mu' }, t), e('b', { style: color ? 'color:' + color : '' }, v));
    const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const etq = (p, u) => { const [f, h] = p.split(' '), [y, m, d] = f.split('-'); return u === 'hour' ? h : u === 'day' ? `${d}/${m}` : u === 'week' ? `Semana del ${d}/${m}` : u === 'month' ? `${MES[Number(m) - 1]} ${y}` : y; };
    /* ---- Gráficas en SVG (sin librerías; colores de la paleta) ---- */
    const NS = 'http://www.w3.org/2000/svg';
    const sv = (tag, at = {}, ...hijos) => { const n = document.createElementNS(NS, tag); for (const [k, val] of Object.entries(at)) n.setAttribute(k, String(val)); hijos.forEach((h) => n.append(h)); return n; };
    const txt = (at, t) => { const n = sv('text', at); n.textContent = t; return n; };
    const COL = ['#3F210E', '#6A6141', '#917A79', '#3E5B3A', '#8A4B2A', '#7D756B'];
    function graficaBarras(serie, unidad) {
      if (!serie.length) return e('p', { class: 'mu' }, 'Sin datos para graficar.');
      const W = 560, Hh = 230, L = 52, B = 34, T = 14, R = 8, max = Math.max(1, ...serie.map((x) => x.ventas));
      const ancho = (W - L - R) / serie.length, bw = Math.max(4, Math.min(46, ancho * 0.62)), alto = Hh - B - T;
      const salto = Math.ceil(serie.length / 8);
      const g = sv('svg', { viewBox: `0 0 ${W} ${Hh}`, role: 'img', 'aria-label': 'Gráfica de barras de ventas por periodo', class: 'grafica' }, sv('title', {}));
      g.firstChild.textContent = 'Ventas por periodo (MXN)';
      [0, 0.5, 1].forEach((f) => {
        const y = T + alto - alto * f;
        g.append(sv('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: '#E3D5C0', 'stroke-width': 1 }), txt({ x: L - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#3F210E' }, mx(max * f).replace(/\.00$/, '')));
      });
      serie.forEach((x, i) => {
        const h = x.ventas / max * alto, cx = L + ancho * i + ancho / 2;
        const r = sv('rect', { x: cx - bw / 2, y: T + alto - h, width: bw, height: Math.max(h, x.ventas > 0 ? 2 : 0), rx: 3, fill: '#3F210E' }, sv('title', {}));
        r.firstChild.textContent = `${etq(x.periodo, unidad)}: ${mx(x.ventas)} · ${x.pedidos} pedido(s)`;
        g.append(r);
        if (i % salto === 0) g.append(txt({ x: cx, y: Hh - 12, 'text-anchor': 'middle', 'font-size': 11, fill: '#3F210E' }, unidad === 'week' ? etq(x.periodo, 'day') : etq(x.periodo, unidad)));
      });
      return g;
    }
    function graficaPastel(items) {
      const datos = items.filter((x) => x.ventas > 0).sort((a, b) => b.ventas - a.ventas);
      if (!datos.length) return e('p', { class: 'mu' }, 'Sin ventas para graficar.');
      const top = datos.slice(0, 5), resto = datos.slice(5).reduce((a, x) => a + x.ventas, 0);
      if (resto > 0) top.push({ nombre: 'Otros', ventas: resto });
      const tot = top.reduce((a, x) => a + x.ventas, 0), R0 = 80, c = 90;
      const g = sv('svg', { viewBox: '0 0 180 180', role: 'img', 'aria-label': 'Gráfica de pastel de ventas por combo', class: 'grafica pastel' });
      let ang = -Math.PI / 2;
      top.forEach((x, i) => {
        const frac = x.ventas / tot, fin = ang + frac * 2 * Math.PI, col = COL[i % COL.length];
        const t = sv('title', {}); t.textContent = `${x.nombre}: ${mx(x.ventas)} (${Math.round(frac * 1000) / 10} %)`;
        if (top.length === 1) g.append(sv('circle', { cx: c, cy: c, r: R0, fill: col }, t));
        else {
          const x1 = c + R0 * Math.cos(ang), y1 = c + R0 * Math.sin(ang), x2 = c + R0 * Math.cos(fin), y2 = c + R0 * Math.sin(fin);
          g.append(sv('path', { d: `M${c},${c} L${x1},${y1} A${R0},${R0} 0 ${frac > 0.5 ? 1 : 0} 1 ${x2},${y2} Z`, fill: col, stroke: '#FFFDF9', 'stroke-width': 2 }, t));
        }
        ang = fin;
      });
      const leyenda = e('ul', { class: 'leyenda' }, ...top.map((x, i) => e('li', {}, e('span', { class: 'sw', style: `background:${COL[i % COL.length]}` }), `${x.nombre}: ${mx(x.ventas)} (${Math.round(x.ventas / tot * 1000) / 10} %)`)));
      return e('div', { class: 'pastel-w' }, g, leyenda);
    }
    const sel = H.menuPeriodo({ inicial: 'hoy', etiqueta: 'Periodo de ventas' }, () => cargarVentas());
    const contenido = e('div');
    const panelV = e('section', { class: 'card tw' }, e('h3', {}, 'Ventas por periodo'), sel.el, contenido);
    let seqV = 0;
    async function cargarVentas() {
      const mi = ++seqV;
      try {
        if (!sel.listo()) return;
        const v = await api('/reportes/ventas-periodo?' + sel.consulta());
        if (mi !== seqV) return;
        const max = Math.max(1, ...v.serie.map((x) => x.ventas));
        contenido.replaceChildren(
          e('p', { class: 'mu' }, `Del ${fd(v.desde)} al ${fd(v.hasta)} · cifras en pesos mexicanos (MXN)`),
          e('div', { class: 'kp', 'data-ventas-periodo': '1' }, kp('Ventas', mx(v.ventas)), kp('Pedidos', String(v.pedidos)), kp('Gastos de compras', mx(v.gastos), v.gastos ? '#B3261E' : '')),
          e('div', { class: 'graficas' }, e('div', {}, e('h4', {}, 'Ventas por periodo (barras)'), graficaBarras(v.serie, v.unidad)), e('div', {}, e('h4', {}, 'Ventas por combo (pastel)'), graficaPastel(v.combos))),
          v.gastos_detalle && v.gastos_detalle.length ? e('p', { class: 'mu', 'data-gastos': '1' }, 'Compras a proveedores: ' + v.gastos_detalle.map((g) => `${g.folio} ${g.proveedor} ${mx(g.total)}`).join(' · ')) : null,
          v.serie.length ? e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, e('th', {}, v.unidad === 'hour' ? 'Hora' : 'Periodo'), e('th', { class: 'n' }, 'Pedidos'), e('th', { class: 'n' }, 'Ventas'), e('th', {}, ''))),
            e('tbody', {}, ...v.serie.map((x) => e('tr', {}, e('td', {}, etq(x.periodo, v.unidad)), e('td', { class: 'n' }, String(x.pedidos)), mon(e, x.ventas),
              e('td', { style: 'width:30%' }, e('span', { style: `display:block;height:8px;border-radius:4px;background:var(--pri);width:${Math.max(2, Math.round(x.ventas / max * 100))}%` })))),
              e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', { class: 'n' }, String(v.pedidos)), mon(e, v.ventas), e('td', {}))))
            : e('p', { class: 'mu' }, 'No hay ventas en este periodo.'),
          v.combos.length ? e('p', { class: 'mu' }, 'Por combo: ' + v.combos.map((x) => `${x.nombre} ${mx(x.ventas)} (${x.pedidos})`).join(' · ')) : null);
      } catch (er) { if (mi === seqV) contenido.replaceChildren(e('p', { class: 'err' }, er.message)); }
    }
    async function cargar() {
      try {
        const d = await api('/reportes/dashboard');
        const fallos = d.notificaciones.fallidas + d.notificaciones.con_error > 0
          ? [...(await api('/notificaciones?estado=fallida')).notificaciones, ...(await api('/notificaciones?estado=error')).notificaciones] : [];
        pintar(d, fallos);
      } catch (er) { raiz.replaceChildren(e('p', { class: 'err' }, er.message)); }
    }
    function pintar(d, fallos) {
      const ST = { Pendiente: '#6A6141', 'En preparación': '#3F210E', 'Listo para entrega': '#3E5B3A', Entregado: '#7D756B' };
      const total = d.ventas_7_dias.reduce((a, x) => ({ p: a.p + x.pedidos, v: a.v + x.ventas }), { p: 0, v: 0 });
      raiz.replaceChildren(
        e('div', { class: 'kp' }, kp('Ventas de hoy', mx(d.ventas_hoy)), kp('Pedidos de hoy', String(d.pedidos_hoy)), kp('Entregas pendientes hoy', String(d.entregas_pendientes_hoy), d.entregas_pendientes_hoy ? '#6A6141' : ''),
          kp('Insumos en reorden', String(d.insumos_en_reorden), d.insumos_en_reorden ? '#B3261E' : ''), kp('Pedidos a proveedor por recibir', String(d.pedidos_proveedor_por_recibir || 0)), kp('Gastos de hoy (compras)', mx(d.gastos_hoy || 0), d.gastos_hoy ? '#B3261E' : ''), kp('Solicitudes por aprobar', String(d.solicitudes_pendientes || 0), d.solicitudes_pendientes ? '#6A6141' : '')),
        (() => {
          const vt = Number(d.ventas_hoy || 0), cp = Number(d.gastos_hoy || 0), gan = Math.round((vt - cp) * 100) / 100;
          return e('section', { class: 'card ganancia', 'data-ganancias': '1' }, e('h3', {}, 'Ganancias del día'),
            e('div', { class: 'kp' }, kp('Ventas de hoy', mx(vt)), kp('Compras a proveedores de hoy', mx(cp), cp ? '#B3261E' : ''),
              e('div', { class: 'card' }, e('small', { class: 'mu' }, 'Ganancia total del día (ventas − compras)'), e('b', { 'data-ganancia-total': '1', style: 'color:' + (gan < 0 ? '#B3261E' : '#3E5B3A') }, mx(gan)))));
        })(),
        panelV,
        e('div', { class: 'card' }, e('h3', {}, 'Pedidos por estatus'), e('div', { class: 'row', style: 'margin:0' }, ...Object.entries(d.por_estatus).map(([k, v]) => e('span', {}, chipC(k, ST[k]), ` ${v}`)))),
        d.pagos_en_revision ? e('div', { class: 'alerta', role: 'alert' }, e('b', {}, `⚠ ${d.pagos_en_revision} pago(s) cobrado(s) sin pedido: requieren reembolso o atención manual desde el panel de la pasarela de pago.`),
          ...d.pagos_revision.map((x) => e('div', {}, `${x.cliente} · ${mx(x.total)} · ${x.proveedor} · ref. ${x.referencia || '—'} · ${new Date(x.creado_en).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}`))) : null,
        fallos.length ? e('div', { class: 'alerta', role: 'alert' }, e('b', {}, `⚠ ${fallos.length} aviso(s) por correo no se han podido enviar`),
          ...fallos.map((n) => e('div', { class: 'row', style: 'margin:4px 0;align-items:center' }, e('span', {}, `${n.folio} → ${n.destinatario} (${n.estado}, ${n.intentos} intentos): ${n.ultimo_error || ''}`),
            e('button', { class: 'mini', type: 'button', onclick: async (ev) => { ev.target.disabled = true; try { await api(`/notificaciones/${n.id}/reintentar`, { method: 'POST' }); } catch (er) { /* se vuelve a mostrar abajo */ } await cargar(); } }, 'Reintentar')))) : null,
        e('div', { class: 'grid2' },
          e('section', { class: 'card' }, e('h3', {}, 'Alertas de reorden'), ...(d.alertas_reorden.length ? d.alertas_reorden.map((i) => e('div', { class: 'ln' }, e('span', {}, i.nombre), e('span', { class: 'bajo' }, `${H.num(i.stock)} de ${H.num(i.stock_minimo)} ${i.unidad}`))) : [e('p', { class: 'mu' }, 'Sin alertas.')])),
          e('section', { class: 'card' }, e('h3', {}, 'Próximas entregas'), ...(d.proximas_entregas.length ? d.proximas_entregas.map((x) => e('div', { class: 'ln' }, e('span', {}, `${x.folio} · ${fd(x.fecha)} ${x.hora}`), chipC(x.estatus, ST[x.estatus]))) : [e('p', { class: 'mu' }, 'Sin entregas pendientes.')]))),
        e('section', { class: 'card tw' }, e('h3', {}, 'Ventas de los últimos 7 días'),
          e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, e('th', {}, 'Fecha'), e('th', { class: 'n' }, 'Pedidos'), e('th', { class: 'n' }, 'Ventas'))),
            e('tbody', {}, ...d.ventas_7_dias.map((x) => e('tr', {}, e('td', {}, fd(x.fecha)), e('td', { class: 'n' }, String(x.pedidos)), mon(e, x.ventas))),
              e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', { class: 'n' }, String(total.p)), mon(e, total.v))))));
    }
    cargar(); cargarVentas(); H.cada(30000, () => { cargar(); cargarVentas(); });
  });

  // Celda de importe: "$" a la izquierda de la celda y la cifra a la derecha; negativos entre paréntesis
  function mon(e, n) {
    const v = Number(n), t = Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return e('td', { class: 'mon' + (v < 0 ? ' neg' : '') }, e('span', {}, '$'), e('span', {}, v < 0 ? `(${t})` : t));
  }

  /* ---------- Reportes ---------- */
  Personal.registrar('rep', 'Reportes', ['admin'], 5, (cont, H) => {
    const { e, api } = H;
    const hoy = iso(new Date());
    let tipo = 'ventas';
    const sel = H.menuPeriodo({ inicial: 'ultimos30', etiqueta: 'Periodo' }, () => generar());
    const resultado = e('div', { class: 'imprimible' }), err = e('div', { class: 'errbox', role: 'alert' });
    const tabs = e('div', { class: 'seg noprint' });
    const bGen = e('button', { class: 'btn', type: 'submit' }, 'Generar');
    const NOMBRES = { ventas: 'Ventas por periodo', estatus: 'Pedidos por estatus', existencias: 'Existencias de inventario' };
    const url = (extra = '') => tipo === 'existencias' ? '/reportes/existencias' + (extra ? '?' + extra : '')
      : `/reportes/${tipo}?${sel.consulta()}` + (extra ? '&' + extra : '');
    const form = e('form', { class: 'row filtros noprint', style: 'align-items:end', onsubmit: (ev) => { ev.preventDefault(); generar(); } }, bGen,
      e('button', { class: 'btn s', type: 'button', onclick: async () => { err.replaceChildren(); try { await H.descargar(url('formato=csv'), `${tipo}-${hoy}.csv`); } catch (er) { err.replaceChildren(e('div', {}, er.message)); } } }, 'Descargar para Excel (CSV)'),
      e('button', { class: 'btn s', type: 'button', onclick: () => window.print() }, 'Imprimir / guardar PDF'));
    const pestanas = () => tabs.replaceChildren(...Object.entries(NOMBRES).map(([k, n]) => e('button', { type: 'button', class: k === tipo ? 'on' : '', onclick: () => { tipo = k; pestanas(); sel.el.parentNode.hidden = k === 'existencias'; generar(); } }, n)));
    pestanas();
    cont.append(tabs, e('div', { class: 'noprint' }, sel.el), form, err, resultado);

    const th = (t, n) => e('th', { class: n ? 'n' : '' }, t);
    let agrActual = 'dia';
    const etiqueta = (p) => agrActual === 'mes' ? new Date(p + 'T12:00:00').toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }) : agrActual === 'semana' ? 'Semana del ' + fd(p) : fd(p);
    const titulo = (t, sub) => [e('h3', { class: 'reporte-tit' }, 'EN COMBO · ' + t), e('p', { class: 'reporte-tit mu' }, sub)];
    async function generar() {
      err.replaceChildren(); resultado.replaceChildren(e('p', { class: 'mu' }, 'Generando…'));
      try {
        if (tipo !== 'existencias' && !sel.listo()) { resultado.replaceChildren(e('p', { class: 'mu' }, 'Elige las fechas y pulsa Aplicar.')); return; }
        const d = await api(url());
        if (tipo === 'ventas') {
          agrActual = d.agrupar;
          resultado.replaceChildren(e('div', { class: 'card tw' }, ...titulo('Ventas por periodo', `Del ${fd(d.desde)} al ${fd(d.hasta)} · cifras en pesos mexicanos (MXN)`),
            d.periodos.length ? e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, th('Periodo'), th('Pedidos', 1), th('Ventas', 1), th('Costo de insumos', 1), th('Utilidad bruta', 1))),
              e('tbody', {}, ...d.periodos.map((x) => e('tr', {}, e('td', {}, etiqueta(x.periodo)), e('td', { class: 'n' }, String(x.pedidos)), mon(e, x.ventas), mon(e, x.costo), mon(e, x.utilidad))),
                e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', { class: 'n' }, String(d.totales.pedidos)), mon(e, d.totales.ventas), mon(e, d.totales.costo), mon(e, d.totales.utilidad))))
              : e('p', { class: 'mu' }, 'No hay ventas en este periodo.'),
            d.periodos.length ? e('table', { class: 'contable', 'data-gastos-reporte': '1' }, e('tbody', {},
              e('tr', {}, e('td', {}, 'Utilidad bruta'), mon(e, d.totales.utilidad)),
              ...d.gastos_compras.detalle.map((g) => e('tr', {}, e('td', {}, `Compra ${g.folio} · ${g.proveedor} · ${fd(g.fecha)}`), mon(e, -g.total))),
              e('tr', { class: 'total' }, e('td', {}, 'Resultado (utilidad bruta − gastos de compras)'), mon(e, d.totales.resultado)))) : null,
            d.periodos.length ? e('p', { class: 'mu' }, `Margen de utilidad bruta: ${d.totales.margen_pct} %. El costo usa los costos unitarios vigentes de los insumos.`) : null),
            d.combos && d.totales.pedidos ? e('div', { class: 'card tw' }, e('h3', {}, 'Ventas por combo'), e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, th('Combo'), th('Contenido'), th('Pedidos', 1), th('Piezas', 1), th('Ventas', 1))),
              e('tbody', {}, ...d.combos.map((x) => e('tr', {}, e('td', {}, x.nombre), e('td', {}, x.contenido), e('td', { class: 'n' }, String(x.pedidos)), e('td', { class: 'n' }, String(x.piezas)), mon(e, x.ventas)))))) : null,
            d.top_productos.length ? e('div', { class: 'card tw' }, e('h3', {}, 'Productos más vendidos'), e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, th('Producto'), th('Piezas', 1), th('Ventas', 1))),
              e('tbody', {}, ...d.top_productos.map((x) => e('tr', {}, e('td', {}, x.nombre), e('td', { class: 'n' }, String(x.piezas)), mon(e, x.ventas)))))) : null);
        } else if (tipo === 'estatus') {
          resultado.replaceChildren(e('div', { class: 'card tw' }, ...titulo('Pedidos por estatus', `Pedidos hechos del ${fd(d.desde)} al ${fd(d.hasta)}`),
            e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, th('Estatus'), th('Pedidos', 1))), e('tbody', {}, ...d.estatus.map((x) => e('tr', {}, e('td', {}, x.estatus), e('td', { class: 'n' }, String(x.pedidos)))),
              e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', { class: 'n' }, String(d.total)))))));
        } else {
          resultado.replaceChildren(e('div', { class: 'card tw' }, ...titulo('Existencias de inventario', `Al ${fd(hoy)} · valuadas al costo unitario vigente`),
            e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, th('Insumo'), th('Unidad'), th('Existencia', 1), th('Mínimo', 1), th('Costo unitario', 1), th('Valor', 1), th('Estado'))),
              e('tbody', {}, ...d.insumos.map((x) => e('tr', {}, e('td', {}, x.nombre), e('td', {}, x.unidad), e('td', { class: 'n' }, H.num(x.stock)), e('td', { class: 'n' }, H.num(x.stock_minimo)), mon(e, x.costo_unitario), mon(e, x.valor), e('td', { class: x.estado === 'Reorden' ? 'bajo' : '' }, x.estado))),
                e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', {}), e('td', {}), e('td', {}), e('td', {}), mon(e, d.totales.valor), e('td', {}, `${d.totales.en_reorden} en reorden`))))));
        }
      } catch (er) { resultado.replaceChildren(); err.replaceChildren(e('div', {}, er.message)); }
    }
    generar();
  });
})();
