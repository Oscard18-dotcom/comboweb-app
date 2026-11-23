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
    /* ---- Gráficas en SVG animadas (sin librerías; colores de la paleta) ---- */
    const NS = 'http://www.w3.org/2000/svg';
    const sv = (tag, at = {}, ...hijos) => { const n = document.createElementNS(NS, tag); for (const [k, val] of Object.entries(at)) n.setAttribute(k, String(val)); hijos.forEach((h) => n.append(h)); return n; };
    const txt = (at, t) => { const n = sv('text', at); n.textContent = t; return n; };
    const COL = ['#3F210E', '#6A6141', '#917A79', '#3E5B3A', '#8A4B2A', '#7D756B'];
    let nGraf = 0;
    // Contenedor con globo de información al pasar el mouse (o tocar)
    function envolver(...hijos) {
      const globo = e('div', { class: 'chart-tip', role: 'status', hidden: true }), w = e('div', { class: 'chart-w' }, ...hijos, globo);
      w.mostrar = (ev, lineas) => { globo.replaceChildren(...lineas.map((l, i) => e(i ? 'span' : 'b', {}, l))); globo.hidden = false; const r = w.getBoundingClientRect(); globo.style.left = Math.min(Math.max(ev.clientX - r.left + 12, 4), Math.max(r.width - 170, 4)) + 'px'; globo.style.top = Math.max(ev.clientY - r.top - 54, 0) + 'px'; };
      w.ocultar = () => { globo.hidden = true; };
      return w;
    }
    const conGlobo = (nodo, w, lineas, extra) => { nodo.addEventListener('mousemove', (ev) => w.mostrar(ev, lineas)); nodo.addEventListener('mouseenter', (ev) => { w.mostrar(ev, lineas); if (extra) extra(true); }); nodo.addEventListener('mouseleave', () => { w.ocultar(); if (extra) extra(false); }); nodo.addEventListener('click', (ev) => w.mostrar(ev, lineas)); };
    // Curva suave que no se pasa de los puntos (cúbica monótona)
    function suave(pts) {
      const n = pts.length; if (n < 2) return `M${pts[0][0]},${pts[0][1]}`;
      const dx = [], m = [], t = [];
      for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
      t[0] = m[0]; t[n - 1] = m[n - 2];
      for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
      for (let i = 0; i < n - 1; i++) { if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; } else { const a = t[i] / m[i], b = t[i + 1] / m[i], q = a * a + b * b; if (q > 9) { const k = 3 / Math.sqrt(q); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; } } }
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 0; i < n - 1; i++) d += ` C${pts[i][0] + dx[i] / 3},${pts[i][1] + t[i] * dx[i] / 3} ${pts[i + 1][0] - dx[i] / 3},${pts[i + 1][1] - t[i + 1] * dx[i] / 3} ${pts[i + 1][0]},${pts[i + 1][1]}`;
      return d;
    }
    // Línea con área: ventas a lo largo del periodo
    function graficaLinea(serie, unidad) {
      if (!serie.length) return e('p', { class: 'mu' }, 'Sin datos para graficar.');
      const id = 'g' + (++nGraf), W = 560, Hh = 240, L = 58, B = 34, T = 16, R = 14, max = Math.max(1, ...serie.map((x) => x.ventas)) * 1.1, alto = Hh - B - T, n = serie.length;
      const X = (i) => (n === 1 ? (L + W - R) / 2 : L + (W - L - R) * i / (n - 1)), Y = (v) => T + alto - v / max * alto;
      const pts = serie.map((x, i) => [X(i), Y(x.ventas)]);
      const g = sv('svg', { viewBox: `0 0 ${W} ${Hh}`, role: 'img', 'aria-label': 'Gráfica de línea: ventas a lo largo del periodo', class: 'grafica' });
      g.append(sv('defs', {}, (() => { const lg = sv('linearGradient', { id: id + 'f', x1: 0, y1: 0, x2: 0, y2: 1 }); lg.append(sv('stop', { offset: '0%', 'stop-color': '#6A6141', 'stop-opacity': 0.45 }), sv('stop', { offset: '100%', 'stop-color': '#6A6141', 'stop-opacity': 0.02 })); return lg; })()));
      [0, 0.5, 1].forEach((f) => { const y = T + alto - alto * f * (1 / 1.1) * 1.1; g.append(sv('line', { x1: L, x2: W - R, y1: Y(max / 1.1 * f), y2: Y(max / 1.1 * f), stroke: '#E3D5C0', 'stroke-width': 1 }), txt({ x: L - 8, y: Y(max / 1.1 * f) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#3F210E' }, mx(max / 1.1 * f).replace(/\.00$/, ''))); });
      const base = T + alto;
      if (n > 1) {
        g.append(sv('path', { d: `${suave(pts)} L${pts[n - 1][0]},${base} L${pts[0][0]},${base} Z`, fill: `url(#${id}f)`, class: 'g-area' }));
        g.append(sv('path', { d: suave(pts), fill: 'none', stroke: '#3F210E', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, class: 'g-linea' }));
      }
      const salto = Math.ceil(n / 8), w = envolver(g);
      serie.forEach((x, i) => {
        if (i % salto === 0) g.append(txt({ x: pts[i][0], y: Hh - 12, 'text-anchor': 'middle', 'font-size': 11, fill: '#3F210E' }, unidad === 'week' ? etq(x.periodo, 'day') : etq(x.periodo, unidad)));
        const punto = sv('circle', { cx: pts[i][0], cy: pts[i][1], r: n > 40 ? 2.5 : 4, fill: '#FFFDF9', stroke: '#3F210E', 'stroke-width': 2, class: 'g-punto', style: `animation-delay:${0.6 + i * 0.03}s` });
        const zona = sv('circle', { cx: pts[i][0], cy: pts[i][1], r: 12, fill: 'transparent' }, sv('title', {}));
        zona.firstChild.textContent = `${etq(x.periodo, unidad)}: ${mx(x.ventas)} · ${x.pedidos} pedido(s)`;
        g.append(punto, zona);
        conGlobo(zona, w, [etq(x.periodo, unidad), `Ventas: ${mx(x.ventas)}`, `Pedidos: ${x.pedidos}`], (on) => { punto.setAttribute('r', on ? 6 : (n > 40 ? 2.5 : 4)); punto.setAttribute('fill', on ? '#3F210E' : '#FFFDF9'); });
      });
      return w;
    }
    // Dona: ventas por combo (los pedidos sin combo ya vienen sumados a «Combo personalizado»)
    function graficaDona(items) {
      const datos = items.filter((x) => x.ventas > 0).sort((a, b) => b.ventas - a.ventas);
      if (!datos.length) return e('p', { class: 'mu' }, 'Sin ventas para graficar.');
      const top = datos.slice(0, 5), resto = datos.slice(5).reduce((a, x) => a + x.ventas, 0);
      if (resto > 0) top.push({ nombre: 'Otros', ventas: resto });
      const tot = top.reduce((a, x) => a + x.ventas, 0), r = 62, C = 2 * Math.PI * r;
      const g = sv('svg', { viewBox: '0 0 180 180', role: 'img', 'aria-label': 'Gráfica de dona: ventas por combo', class: 'grafica dona' });
      g.append(sv('circle', { cx: 90, cy: 90, r, fill: 'none', stroke: '#EEE4D0', 'stroke-width': 28 }));
      const centro1 = txt({ 'pointer-events': 'none', x: 90, y: 86, 'text-anchor': 'middle', 'font-size': 11, fill: '#6A5A4C' }, 'Ventas'), centro2 = txt({ 'pointer-events': 'none', x: 90, y: 104, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: '#3F210E' }, mx(tot).replace(/\.00$/, ''));
      const leyenda = e('ul', { class: 'leyenda' }), w = envolver(e('div', { class: 'pastel-w' }, g, leyenda));
      const segs = []; let acum = 0;
      top.forEach((x, i) => {
        const frac = x.ventas / tot, len = Math.max(frac * C - (top.length > 1 ? 2 : 0), 0.5), col = COL[i % COL.length], lineas = [x.nombre, `Ventas: ${mx(x.ventas)}`, `${Math.round(frac * 1000) / 10} % del total`];
        const c = sv('circle', { cx: 90, cy: 90, r, fill: 'none', stroke: col, 'stroke-width': 28, transform: 'rotate(-90 90 90)', 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -acum, class: 'g-seg', style: `--c:${C};--len:${len};--gap:${C - len};--i:${i}` }, sv('title', {}));
        c.firstChild.textContent = lineas.join(' · '); acum += frac * C; segs.push(c); g.append(c);
        const li = e('li', {}, e('span', { class: 'sw', style: `background:${col}` }), `${x.nombre}: ${mx(x.ventas)} (${Math.round(frac * 1000) / 10} %)`);
        leyenda.append(li);
        const resaltar = (on) => { segs.forEach((o) => o.classList.toggle('g-tenue', on && o !== c)); li.classList.toggle('g-sel', on); centro1.textContent = on ? x.nombre : 'Ventas'; centro2.textContent = on ? mx(x.ventas).replace(/\.00$/, '') : mx(tot).replace(/\.00$/, ''); };
        conGlobo(c, w, lineas, resaltar); li.addEventListener('mouseenter', () => resaltar(true)); li.addEventListener('mouseleave', () => resaltar(false));
      });
      g.append(centro1, centro2);
      return w;
    }
    // Barras horizontales (por ejemplo, pedidos por estatus)
    function graficaBarrasH(items, formato) {
      const W = 560, fila = 38, T = 8, L = 150, R = 56, Hh = T + fila * items.length + 24, max = Math.max(1, ...items.map((x) => x.valor)), ancho = W - L - R;
      const g = sv('svg', { viewBox: `0 0 ${W} ${Hh}`, role: 'img', 'aria-label': 'Gráfica de barras horizontales', class: 'grafica' }), w = envolver(g);
      [0, 0.5, 1].forEach((f) => g.append(sv('line', { x1: L + ancho * f, x2: L + ancho * f, y1: T, y2: T + fila * items.length, stroke: '#E3D5C0', 'stroke-width': 1 }), txt({ x: L + ancho * f, y: Hh - 6, 'text-anchor': 'middle', 'font-size': 11, fill: '#3F210E' }, formato(max * f))));
      items.forEach((x, i) => {
        const y = T + fila * i + 7, ww = Math.max(x.valor / max * ancho, x.valor > 0 ? 3 : 0);
        g.append(txt({ x: L - 10, y: y + 15, 'text-anchor': 'end', 'font-size': 12, fill: '#3F210E' }, x.nombre));
        const b = sv('rect', { x: L, y, width: ww, height: 22, rx: 5, fill: x.color, class: 'g-barra', style: `animation-delay:${i * 0.12}s`, tabindex: 0 }, sv('title', {}));
        b.firstChild.textContent = `${x.nombre}: ${formato(x.valor)}`;
        g.append(b, txt({ x: L + ww + 8, y: y + 16, 'font-size': 12, 'font-weight': 700, fill: '#3F210E', class: 'g-val', style: `animation-delay:${0.5 + i * 0.12}s` }, formato(x.valor)));
        conGlobo(b, w, [x.nombre, formato(x.valor)], (on) => b.classList.toggle('g-sel', on));
      });
      return w;
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
          e('p', { class: 'mu' }, `Del ${fd(v.desde)} al ${fd(v.hasta)}`),
          e('div', { class: 'kp', 'data-ventas-periodo': '1' }, kp('Ingresos totales', mx(v.ventas)), kp('Pedidos', String(v.pedidos)), kp('Gastos totales', mx(v.gastos), v.gastos ? '#B3261E' : ''), kp('Utilidad bruta', mx(v.utilidad), v.utilidad < 0 ? '#B3261E' : '#3E5B3A'), kp('Utilidad neta', mx(v.utilidad_neta), v.utilidad_neta < 0 ? '#B3261E' : '#3E5B3A'), kp('Margen', v.margen_neto_pct + ' %', v.margen_neto_pct < 0 ? '#B3261E' : '')),
          e('div', { class: 'graficas' }, e('div', {}, e('h4', {}, 'Ventas a lo largo del periodo'), graficaLinea(v.serie, v.unidad)), e('div', {}, e('h4', {}, 'Ventas por combo'), graficaDona(v.combos))),
          v.serie.length ? e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, e('th', {}, v.unidad === 'hour' ? 'Hora' : 'Periodo'), e('th', { class: 'n' }, 'Pedidos'), e('th', { class: 'n' }, 'Ventas'), e('th', {}, ''))),
            e('tbody', {}, ...v.serie.map((x) => e('tr', {}, e('td', {}, etq(x.periodo, v.unidad)), e('td', { class: 'n' }, String(x.pedidos)), mon(e, x.ventas),
              e('td', { style: 'width:30%' }, e('span', { style: `display:block;height:8px;border-radius:4px;background:var(--pri);width:${Math.max(2, Math.round(x.ventas / max * 100))}%` })))),
              e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', { class: 'n' }, String(v.pedidos)), mon(e, v.ventas), e('td', {}))))
            : e('p', { class: 'mu' }, 'No hay ventas en este periodo.'));
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
        (() => {
          const vt = Number(d.ventas_hoy || 0), cp = Number(d.gastos_hoy || 0), gan = Math.round((vt - cp) * 100) / 100;
          const imprimirGanancias = () => {
            const fila = (a, b, cls) => e('div', { class: 'tk-fila' + (cls ? ' ' + cls : '') }, e('span', {}, a), e('span', {}, b));
            const ahora = new Date();
            let caja = document.getElementById('ticket-print');
            if (!caja) { caja = document.createElement('div'); caja.id = 'ticket-print'; document.body.append(caja); }
            caja.replaceChildren(e('div', { class: 'ticket' },
              e('h2', {}, 'EN COMBO'), e('p', { class: 'tk-c' }, 'Comprobante de ganancias del día'),
              fila('Fecha', ahora.toLocaleDateString('es-MX', { dateStyle: 'long' })), fila('Impreso', ahora.toLocaleTimeString('es-MX', { timeStyle: 'short' }) + ' h'), e('hr'),
              fila('Pedidos del día', String(d.pedidos_hoy || 0)), fila('Ventas de hoy', mx(vt)),
              fila('Compras a proveedores', mx(cp)), fila('Pedidos de compra', String(d.compras_hoy || 0)), e('hr'),
              fila('GANANCIA TOTAL', mx(gan), 'tk-total'), e('p', { class: 'tk-c' }, 'Ganancia = ventas − compras a proveedores'),
              e('p', { class: 'tk-c' }, 'Generado por: ' + (H.usuario && H.usuario.nombre ? H.usuario.nombre : 'Administrador'))));
            document.body.classList.add('print-ticket');
            const quitar = () => { document.body.classList.remove('print-ticket'); window.removeEventListener('afterprint', quitar); };
            window.addEventListener('afterprint', quitar);
            window.print();
          };
          return e('section', { class: 'card ganancia', 'data-ganancias': '1' }, e('div', { class: 'row', style: 'justify-content:space-between;align-items:center;gap:8px' }, e('h3', { style: 'margin:0' }, 'Ganancias del día'), e('button', { class: 'mini', type: 'button', 'data-imprimir-ganancias': '1', onclick: imprimirGanancias }, 'Imprimir comprobante')),
            e('div', { class: 'kp' }, kp('Ventas de hoy', mx(vt)), kp('Compras a proveedores de hoy', mx(cp), cp ? '#B3261E' : ''),
              e('div', { class: 'card' }, e('small', { class: 'mu' }, 'Ganancia total del día (ventas − compras)'), e('b', { 'data-ganancia-total': '1', style: 'color:' + (gan < 0 ? '#B3261E' : '#3E5B3A') }, mx(gan)))));
        })(),
        panelV,
        e('section', { class: 'card', 'data-estatus': '1' }, e('h3', {}, 'Pedidos por estatus'), e('div', { class: 'kp', style: 'margin-bottom:0' }, ...Object.entries(d.por_estatus).map(([k, v]) => e('div', { class: 'card', style: `border-left:6px solid ${ST[k] || '#7D756B'}` }, e('small', { class: 'mu' }, k), e('b', {}, String(v)))))),
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
          resultado.replaceChildren(e('div', { class: 'card tw' }, ...titulo('Ventas por periodo', `Del ${fd(d.desde)} al ${fd(d.hasta)}`),
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
