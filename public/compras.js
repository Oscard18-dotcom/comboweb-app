// Pedidos a proveedor y proveedores (Sprint 7). Solo administración.
(() => {
  // Los precios de los proveedores se capturan y se muestran por kilo (g), por litro (ml) o por pieza; en la base se guardan por gramo / ml / pieza
  const FAC = (u) => (u === 'g' || u === 'ml' ? 1000 : 1);
  const UP = (u) => (u === 'g' ? 'kg' : u === 'ml' ? 'L' : u);
  const aCompra = (precioBase, u) => Math.round(Number(precioBase) * FAC(u) * 1e4) / 1e4;   // por gramo → por kg
  const aBase = (precioCompra, u) => Math.round(Number(precioCompra) / FAC(u) * 1e6) / 1e6;   // por kg → por gramo
  const fd = (f) => (f ? f.split('-').reverse().join('/') : '—');

  Personal.registrar('compras', 'Pedidos a proveedor', ['almacen', 'admin'], 3.5, (cont, H) => {
    const { e, api, num, fecha, campo, chipC, enviar, usuario } = H;
    const esAdmin = usuario.rol === 'admin';
    const mx = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    const caja = () => e('div', { class: 'errbox', role: 'alert' });
    const ok = (t) => e('p', { class: 'okmsg', role: 'status' }, t);
    const nav = e('div', { class: 'seg noprint' }), panel = e('div');
    const SUBS = esAdmin ? [['pedidos', 'Pedidos y solicitudes'], ['nuevo', 'Nuevo pedido'], ['prov', 'Proveedores']] : [['pedidos', 'Mis solicitudes'], ['nuevo', 'Solicitar reabastecimiento']];
    const ir = (k) => {
      nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === k));
      panel.replaceChildren(); ({ pedidos, nuevo, prov })[k]();
    };
    SUBS.forEach(([k, n]) => nav.append(e('button', { type: 'button', 'data-s': k, onclick: () => ir(k) }, n)));
    cont.append(e('h2', {}, esAdmin ? 'Pedidos a proveedor' : 'Reabastecimiento'), esAdmin ? null : e('p', { class: 'mu' }, 'Aquí pides insumos al proveedor. Tu solicitud llega a administración, que decide si se aprueba la compra.'), nav, panel);

    // Confirmación en pantalla (sin ventanas emergentes): devuelve una tarjeta con Sí / No
    const confirmar = (mensaje, etiqueta, fn, cancelar) => {
      const err = caja(), si = e('button', { class: 'btn', type: 'button' }, etiqueta), no = e('button', { class: 'btn s', type: 'button', onclick: cancelar }, 'No, volver');
      si.onclick = enviar(si, err, fn);
      return e('div', { class: 'card', role: 'alertdialog' }, e('p', {}, mensaje), err, e('div', { class: 'row' }, si, no));
    };

    /* ===================== PEDIDOS ENVIADOS ===================== */
    async function pedidos() {
      let filtro = '', lista = [];
      const detalle = e('div'), tabla = e('div'), msg = e('div');
      const sel = e('select', { 'aria-label': 'Filtrar por estado', onchange: () => { filtro = sel.value; cargar(); } },
        e('option', { value: '' }, 'Todos'), e('option', { value: 'solicitado' }, 'Solicitudes por aprobar'), e('option', { value: 'rechazado' }, 'Rechazadas'), e('option', { value: 'enviado' }, 'Enviados (por recibir)'), e('option', { value: 'recibido' }, 'Recibidos'), e('option', { value: 'cancelado' }, 'Cancelados'));
      const chipEstado = (p) => chipC({ solicitado: 'Por aprobar', rechazado: 'Rechazada', enviado: 'Enviado', recibido: 'Recibido', cancelado: 'Cancelado' }[p.estado], { solicitado: '#6A6141', rechazado: '#B3261E', enviado: '#3F210E', recibido: '#6A6141', cancelado: '#7D756B' }[p.estado]);
      const chipCorreo = (s) => (!s ? '—' : s === 'enviada' ? chipC('Correo enviado', '#6A6141') : s === 'error' || s === 'fallida' ? chipC('Correo con error', '#B3261E') : chipC('Enviando…', '#3F210E'));
      async function cargar() {
        try {
          lista = (await api('/pedidos-proveedor' + (filtro ? '?estado=' + filtro : ''))).pedidos;
          tabla.replaceChildren(e('div', { class: 'card tw' }, lista.length ? e('table', {}, e('thead', {}, e('tr', {}, ['Folio', 'Fecha', 'Proveedor', 'Insumos', 'Total', 'Estado', 'Stock', 'Correo', ''].map((x) => e('th', {}, x)))),
            e('tbody', {}, lista.map((p) => e('tr', {}, e('td', {}, e('b', {}, p.folio)), e('td', {}, fecha(p.creado_en)), e('td', {}, p.proveedor),
              e('td', {}, p.items.map((i) => `${i.nombre} ${num(i.cantidad)} ${i.unidad}`).join(', ')), e('td', { class: 'n' }, mx(p.total)), e('td', {}, chipEstado(p)),
              e('td', {}, ['cancelado', 'solicitado', 'rechazado'].includes(p.estado) ? '—' : p.stock_aplicado ? 'Sumado' : 'Falta sumar'), e('td', {}, chipCorreo(p.correo_estado)),
              e('td', { class: 'acc' }, e('button', { class: 'mini', type: 'button', onclick: () => ver(p.id) }, 'Ver'),
                esAdmin && p.estado === 'solicitado' ? e('button', { class: 'mini', type: 'button', 'data-aprobar': p.id, onclick: () => preguntarAprobar(p) }, 'Aprobar compra') : null,
                esAdmin && p.estado === 'solicitado' ? e('button', { class: 'mini', type: 'button', 'data-rechazar': p.id, onclick: () => preguntarRechazar(p) }, 'Rechazar') : null,
                esAdmin && p.estado === 'enviado' ? e('button', { class: 'mini', type: 'button', onclick: () => preguntarRecibir(p) }, 'Marcar recibido') : null,
                esAdmin && p.estado === 'enviado' && !p.stock_aplicado ? e('button', { class: 'mini', type: 'button', onclick: () => preguntarCancelar(p) }, 'Cancelar') : null)))))
            : e('p', { class: 'mu' }, esAdmin ? 'Todavía no hay pedidos. Crea el primero en “Nuevo pedido”.' : 'Todavía no has hecho solicitudes. Crea la primera en “Solicitar reabastecimiento”.')));
        } catch (er) { tabla.replaceChildren(e('p', { class: 'err' }, er.message)); }
      }
      function ver(id) {
        const p = lista.find((x) => x.id === id); if (!p) return;
        const cerrar = e('button', { class: 'btn s', type: 'button', onclick: () => detalle.replaceChildren() }, 'Cerrar');
        detalle.replaceChildren(e('div', { class: 'card' }, e('h3', {}, `Pedido ${p.folio}`),
          e('dl', { class: 'ficha-dl' }, e('dt', {}, 'Proveedor'), e('dd', {}, `${p.proveedor} (${p.proveedor_correo})`), e('dt', {}, p.estado === 'solicitado' || p.estado === 'rechazado' ? 'Solicitado' : 'Enviado'), e('dd', {}, `${fecha(p.enviado_en || p.creado_en)} por ${p.usuario || '—'}`),
            p.aprobado_por ? e('dt', {}, p.estado === 'rechazado' ? 'Rechazó' : 'Aprobó') : null, p.aprobado_por ? e('dd', {}, p.aprobado_por) : null, p.motivo_rechazo ? e('dt', {}, 'Motivo') : null, p.motivo_rechazo ? e('dd', {}, p.motivo_rechazo) : null,
            p.fecha_requerida ? e('dt', {}, 'Lo necesitas para') : null, p.fecha_requerida ? e('dd', {}, fd(p.fecha_requerida)) : null, e('dt', {}, 'Nota'), e('dd', {}, p.nota || '—'),
            e('dt', {}, 'Estado'), e('dd', {}, chipEstado(p)), e('dt', {}, 'Stock'), e('dd', {}, p.estado === 'cancelado' ? 'No se sumó (pedido cancelado)' : p.stock_aplicado ? 'Ya se sumó al inventario' : 'Se sumará al marcar el pedido como recibido'),
            p.recibido_en ? e('dt', {}, 'Recibido') : null, p.recibido_en ? e('dd', {}, fecha(p.recibido_en)) : null, e('dt', {}, 'Correo al proveedor'), e('dd', {}, chipCorreo(p.correo_estado))),
          e('table', {}, e('thead', {}, e('tr', {}, e('th', {}, 'Insumo'), e('th', {}, 'Cantidad pedida'), e('th', { class: 'n' }, 'Precio unit.'), e('th', { class: 'n' }, 'Importe'))), e('tbody', {}, p.items.map((i) => e('tr', {}, e('td', {}, i.nombre), e('td', {}, `${num(i.cantidad)} ${i.unidad}`), e('td', { class: 'n' }, `${mx(aCompra(i.precio_unitario, i.unidad))} / ${UP(i.unidad)}`), e('td', { class: 'n' }, mx(i.subtotal)))),
            e('tr', { class: 'total' }, e('td', {}, 'Total'), e('td', {}), e('td', {}), e('td', { class: 'n', 'data-total-pedido': '1' }, mx(p.total))))), cerrar));
      }
      const preguntarAprobar = (p) => detalle.replaceChildren(confirmar(
        `¿Aprobar la compra ${p.folio} a ${p.proveedor} por ${mx(p.total)}? Se le enviará el pedido por correo y contará como gasto de hoy.`, 'Sí, aprobar y enviar',
        async () => { await api(`/pedidos-proveedor/${p.id}/aprobar`, { method: 'POST' }); await cargar(); detalle.replaceChildren(e('div', { class: 'card' }, ok(`${p.folio} aprobado y enviado a ${p.proveedor}.`))); }, () => detalle.replaceChildren()));
      const preguntarRechazar = (p) => {
        const mot = e('input', { maxlength: 200, placeholder: 'Motivo (opcional)', 'aria-label': 'Motivo del rechazo' }), err = caja(), si = e('button', { class: 'btn', type: 'button' }, 'Sí, rechazar');
        si.onclick = enviar(si, err, async () => { await api(`/pedidos-proveedor/${p.id}/rechazar`, { method: 'POST', body: { motivo: mot.value || undefined } }); await cargar(); detalle.replaceChildren(e('div', { class: 'card' }, ok(`${p.folio} rechazada.`))); });
        detalle.replaceChildren(e('div', { class: 'card', role: 'alertdialog' }, e('p', {}, `¿Rechazar la solicitud ${p.folio}? No se enviará nada al proveedor.`), campo('Motivo', mot), err, e('div', { class: 'row' }, si, e('button', { class: 'btn s', type: 'button', onclick: () => detalle.replaceChildren() }, 'No, volver'))));
      };
      const preguntarRecibir = (p) => detalle.replaceChildren(confirmar(
        p.stock_aplicado ? `¿Marcar ${p.folio} como recibido? El stock ya se había sumado, así que no cambiará.` : `¿Ya llegó ${p.folio}? Al confirmar, los insumos se suman al stock.`, 'Sí, ya llegó',
        async () => { await api(`/pedidos-proveedor/${p.id}/recibir`, { method: 'POST' }); await cargar(); detalle.replaceChildren(e('div', { class: 'card' }, ok(`Listo: ${p.folio} recibido.`))); }, () => detalle.replaceChildren()));
      const preguntarCancelar = (p) => detalle.replaceChildren(confirmar(`¿Cancelar ${p.folio}? Se le mandará un correo a ${p.proveedor} avisando que no surta el pedido.`, 'Sí, cancelar pedido',
        async () => { await api(`/pedidos-proveedor/${p.id}/cancelar`, { method: 'POST' }); await cargar(); detalle.replaceChildren(e('div', { class: 'card' }, ok(`${p.folio} cancelado y proveedor avisado.`))); }, () => detalle.replaceChildren()));
      panel.append(e('div', { class: 'row filtros' }, e('label', { class: 'chk' }, 'Mostrar: ', sel), e('button', { class: 'btn', type: 'button', onclick: () => ir('nuevo') }, '+ Nuevo pedido')), msg, tabla, detalle);
      await cargar();
    }

    /* ===================== NUEVO PEDIDO ===================== */
    async function nuevo() {
      let provs, insumos;
      try { [provs, insumos] = await Promise.all([api('/pedidos-proveedor/proveedores'), api('/inventario')]); } catch (er) { panel.append(e('p', { class: 'err' }, er.message)); return; }
      provs = provs.proveedores; insumos = insumos.insumos.filter((i) => i.activo);
      if (!provs.length) { panel.append(e('div', { class: 'card narrow' }, e('p', {}, 'Todavía no hay proveedores registrados' + (esAdmin ? ': agrega a tu proveedor, necesitamos su correo para poder mandarle el pedido.' : '. Pídele a administración que registre al proveedor.')), esAdmin ? e('button', { class: 'btn', type: 'button', onclick: () => ir('prov') }, 'Agregar proveedor') : null)); return; }
      const err = caja(), lineas = e('div'), aviso = e('p', { class: 'aviso', role: 'status' });
      const pv = e('select', { 'aria-label': 'Proveedor', required: true }, e('option', { value: '' }, '— Elige un proveedor —'), ...provs.map((p) => e('option', { value: p.id }, p.nombre)));
      const nota = e('input', { maxlength: 300, placeholder: 'Opcional: horario de entrega, marca…' });
      const provActual = () => provs.find((p) => String(p.id) === pv.value);
      // Solo se pueden pedir los insumos que el proveedor surte (con el precio que él da, que se captura en Proveedores)
      const opcionesInsumo = () => { const p = provActual(); if (!p) return []; const pre = new Map((p.insumos || []).map((x) => [x.id, Number(x.precio_unitario)])); return insumos.filter((i) => pre.has(i.id)).map((i) => ({ ...i, precio: pre.get(i.id) })); };
      function linea(insumoId, cantidad) {
        const s = e('select', { 'aria-label': 'Insumo' }, e('option', { value: '' }, '— Insumo —'), ...opcionesInsumo().map((i) => e('option', { value: i.id }, `${i.nombre} (hay ${num(i.stock)} ${i.unidad})`)));
        const c = e('input', { type: 'number', min: '0', step: 'any', 'aria-label': 'Cantidad', placeholder: 'Cantidad' }), u = e('span', { class: 'mu u' }, '');
        const im = e('span', { class: 'mu u', 'data-importe': '1' }, '');
        if (insumoId) s.value = String(insumoId); if (cantidad) c.value = String(cantidad);
        const actual = () => opcionesInsumo().find((x) => String(x.id) === s.value);
        // El sistema calcula: cantidad (g o ml) × precio por gramo/ml del proveedor (precio por kg/L ÷ 1000). No se captura ni se sugiere ningún precio.
        const imp = () => { const i = actual(); im.textContent = i && Number(c.value) > 0 ? mx(Number(c.value) * i.precio) : ''; total(); };
        const act = () => { const i = actual(); u.textContent = i ? i.unidad : ''; c.placeholder = i ? `Cantidad en ${i.unidad === 'g' ? 'gramos' : i.unidad === 'ml' ? 'mililitros' : 'piezas'}` : 'Cantidad'; imp(); }; s.onchange = act; c.oninput = imp;
        const fila = e('div', { class: 'lp' }, s, c, u, im, e('button', { class: 'mini', type: 'button', 'aria-label': 'Quitar este insumo', onclick: () => fila.remove() }, '✕'));
        fila.leer = () => ({ insumo_id: s.value, cantidad: c.value });
        fila.importe = () => { const i = actual(); return i && Number(c.value) > 0 ? Number(c.value) * i.precio : 0; };
        if (insumoId) act();
        lineas.append(fila); return fila;
      }
      const filas = () => [...lineas.children];
      const totalTxt = e('p', { class: 'total-cot', 'data-cotizacion': '1', role: 'status' }, '');
      function total() { const t = filas().reduce((a, f) => a + (f.importe ? f.importe() : 0), 0); totalTxt.textContent = t > 0 ? `Cotización: ${mx(t)}` + (esAdmin ? ' · se registrará como gasto de hoy al enviar.' : ' · se registra como gasto cuando administración la apruebe.') : ''; }
      pv.onchange = () => {
        const p = provActual();
        aviso.textContent = !p ? '' : !(p.insumos || []).length ? `${p.nombre} todavía no tiene insumos con precio.${esAdmin ? ' Agrégalos en “Proveedores” para poder pedirle.' : ' Pídele a administración que los registre.'}` : esAdmin ? `Se enviará un correo a ${p.nombre} (${p.correo}). Si responde, su respuesta llegará a ${usuario.correo}. Las cantidades se suman al stock automáticamente al enviar.` : `Tu solicitud a ${p.nombre} llegará a administración. Solo cuando la apruebe se hará la compra.`;
        const previas = filas().map((f) => f.leer()); lineas.replaceChildren();
        const permitidos = new Set(opcionesInsumo().map((i) => String(i.id)));
        previas.filter((x) => x.insumo_id && permitidos.has(x.insumo_id)).forEach((x) => { linea(x.insumo_id, x.cantidad); });
        if (!filas().length) linea();
        total();
      };
      linea();
      const sug = e('button', { class: 'btn s', type: 'button' }, 'Agregar lo que está en reorden');
      sug.onclick = enviar(sug, err, async () => {
        if (!pv.value) throw new Error('Primero elige el proveedor.');
        const { sugerencias } = await api('/pedidos-proveedor/sugerencias?proveedor_id=' + pv.value);
        if (!sugerencias.length) throw new Error('No hay insumos en reorden para este proveedor: todo está por arriba del mínimo.');
        const ya = new Set(filas().map((f) => f.leer().insumo_id));
        filas().filter((f) => !f.leer().insumo_id && !f.leer().cantidad).forEach((f) => f.remove());
        sugerencias.filter((x) => !ya.has(String(x.id))).forEach((x) => linea(x.id, x.sugerido));
      });
      const b = e('button', { class: 'btn', type: 'submit' }, esAdmin ? 'Enviar pedido al proveedor' : 'Enviar solicitud a administración');
      const f = e('form', { onsubmit: enviar(b, err, async () => {
        if (!pv.value) throw new Error('Elige un proveedor.');
        const items = filas().map((x) => x.leer()).filter((x) => x.insumo_id || x.cantidad);
        if (!items.length) throw new Error('Agrega al menos un insumo con su cantidad.');
        if (items.some((x) => !x.insumo_id || !(Number(x.cantidad) > 0))) throw new Error('Cada renglón necesita un insumo y una cantidad mayor a 0.');
        if (new Set(items.map((x) => x.insumo_id)).size !== items.length) throw new Error('Un insumo está repetido: súmalo en un solo renglón.');
        const r = await api('/pedidos-proveedor', { method: 'POST', body: { proveedor_id: pv.value, items, nota: nota.value || undefined, suma_stock_en: 'envio' } });
        const p = r.pedido;
        if (p.estado === 'solicitado') { panel.replaceChildren(e('div', { class: 'card narrow' }, e('h3', {}, `Solicitud ${p.folio} enviada`),
          ok(`Tu solicitud por ${mx(p.total)} quedó pendiente de aprobación. No se ha hecho ninguna compra todavía.`),
          e('div', { class: 'row' }, e('button', { class: 'btn', type: 'button', onclick: () => ir('pedidos') }, 'Ver mis solicitudes'), e('button', { class: 'btn s', type: 'button', onclick: () => ir('nuevo') }, 'Hacer otra')))); return; }
        panel.replaceChildren(e('div', { class: 'card narrow' }, e('h3', {}, `Pedido ${p.folio} enviado`),
          ok(`Se mandó un correo a ${p.proveedor} (${p.proveedor_correo}) con ${p.items.length} insumo(s). Total cotizado: ${mx(p.total)}, registrado como gasto de hoy.`),
          e('p', {}, 'El stock ya se sumó al inventario.'),
          e('div', { class: 'row' }, e('button', { class: 'btn', type: 'button', onclick: () => ir('pedidos') }, 'Ver pedidos'), e('button', { class: 'btn s', type: 'button', onclick: () => ir('nuevo') }, 'Hacer otro pedido'))));
      }) }, campo('Proveedor', pv), aviso, e('h3', {}, 'Qué necesitas'), lineas,
        e('div', { class: 'row' }, e('button', { class: 'btn s', type: 'button', onclick: () => linea() }, '+ Agregar insumo'), sug),
        campo('Nota para el proveedor (opcional)', nota), totalTxt,
        err, b);
      panel.append(e('div', { class: 'card' }, f));
    }

    /* ===================== PROVEEDORES ===================== */
    async function prov() {
      let lista = [], insumos = [], archivados = false;
      const tabla = e('div'), form = e('div');
      try { insumos = (await api('/inventario')).insumos.filter((i) => i.activo); } catch (er) { panel.append(e('p', { class: 'err' }, er.message)); return; }
      const chkArch = e('input', { type: 'checkbox', onchange: () => { archivados = chkArch.checked; cargar(); } });
      async function cargar() {
        try {
          lista = (await api('/proveedores' + (archivados ? '?inactivos=1' : ''))).proveedores;
          tabla.replaceChildren(e('div', { class: 'card tw' }, lista.length ? e('table', {}, e('thead', {}, e('tr', {}, ['Proveedor', 'Correo', 'Contacto', 'Teléfono', 'Surte', 'Pedidos', ''].map((x) => e('th', {}, x)))),
            e('tbody', {}, lista.map((p) => e('tr', {}, e('td', {}, e('b', {}, p.nombre), p.activo ? null : e('span', {}, ' ', chipC('Archivado', '#7D756B'))), e('td', {}, p.correo), e('td', {}, p.contacto || '—'), e('td', {}, p.telefono || '—'),
              e('td', {}, p.insumos.length ? p.insumos.map((i) => `${i.nombre} (${mx(aCompra(i.precio_unitario, i.unidad))}/${UP(i.unidad)})`).join(', ') : 'Cualquier insumo'), e('td', {}, String(p.pedidos)),
              e('td', { class: 'acc' }, e('button', { class: 'mini', type: 'button', onclick: () => editar(p) }, 'Editar'),
                p.activo ? e('button', { class: 'mini', type: 'button', onclick: () => preguntarEliminar(p) }, 'Eliminar') : null)))))
            : e('p', { class: 'mu' }, 'Aún no hay proveedores. Agrega el primero con el botón de arriba.')));
        } catch (er) { tabla.replaceChildren(e('p', { class: 'err' }, er.message)); }
      }
      function editar(p) {
        const n = e('input', { required: true, minlength: 2, maxlength: 80, value: p ? p.nombre : '' }), c = e('input', { type: 'email', required: true, maxlength: 120, value: p ? p.correo : '' }),
          ct = e('input', { maxlength: 80, value: p && p.contacto ? p.contacto : '' }), tl = e('input', { type: 'tel', maxlength: 30, value: p && p.telefono ? p.telefono : '' }), nt = e('input', { maxlength: 300, value: p && p.notas ? p.notas : '' });
        const marcados = new Map(p ? p.insumos.map((i) => [i.id, i.precio_unitario]) : []);
        // Al marcar un insumo se pide su costo unitario con ESTE proveedor: de ahí sale la cotización de los pedidos
        const cks = insumos.map((i) => {
          const k = e('input', { type: 'checkbox', value: i.id }), pu = e('input', { type: 'number', min: '0', step: 'any', 'aria-label': `Precio unitario de ${i.nombre} (MXN por ${UP(i.unidad)})`, placeholder: `$ por ${UP(i.unidad)}`, 'data-costo': String(i.id), class: 'costo-prov' });
          k.checked = marcados.has(i.id); pu.value = marcados.has(i.id) ? String(aCompra(marcados.get(i.id), i.unidad)) : '';
          const sync = () => { pu.disabled = !k.checked; if (!k.checked) pu.value = ''; };
          k.onchange = sync; sync(); if (marcados.has(i.id)) pu.value = String(aCompra(marcados.get(i.id), i.unidad));
          return [i, k, pu];
        });
        const act = e('input', { type: 'checkbox' }); act.checked = p ? p.activo : true;
        const err = caja(), b = e('button', { class: 'btn', type: 'submit' }, p ? 'Guardar cambios' : 'Guardar proveedor');
        const cerrar = e('button', { class: 'btn s', type: 'button', onclick: () => form.replaceChildren() }, 'Cancelar');
        const f = e('form', { onsubmit: enviar(b, err, async () => {
          const body = { nombre: n.value, correo: c.value, contacto: ct.value, telefono: tl.value, notas: nt.value, insumos: cks.filter(([, k]) => k.checked).map(([i, , pu]) => ({ id: i.id, precio_unitario: aBase(pu.value, i.unidad) })) };
          const sinPrecio = cks.find(([, k, pu]) => k.checked && !(Number(pu.value) > 0));
          if (sinPrecio) throw new Error(`Escribe el precio unitario de ${sinPrecio[0].nombre} por ${UP(sinPrecio[0].unidad)} (mayor a 0).`);
          if (p) body.activo = act.checked;
          await api(p ? `/proveedores/${p.id}` : '/proveedores', { method: p ? 'PUT' : 'POST', body });
          await cargar(); form.replaceChildren(e('div', { class: 'card' }, ok(p ? 'Proveedor actualizado.' : 'Proveedor agregado.')));
        }) }, campo('Nombre del proveedor', n), campo('Correo (aquí se mandan los pedidos)', c), campo('Persona de contacto (opcional)', ct), campo('Teléfono (opcional)', tl), campo('Notas (opcional)', nt),
          e('h3', {}, '¿Qué insumos te surte y a qué costo?'), e('p', { class: 'mu' }, 'Marca cada insumo que te surte y escribe el precio unitario que te da este proveedor: por kilo (insumos en gramos), por litro (insumos en mililitros) o por pieza. Al hacerle un pedido eliges la cantidad en gramos o mililitros y el sistema calcula la cotización con ese precio.'),
          e('div', { class: 'lista-insumos' }, ...cks.map(([i, k, pu]) => e('div', { class: 'ins-prov' }, e('label', { class: 'chk' }, k, `${i.nombre} (por ${UP(i.unidad)})`), pu))),
          p ? e('label', { class: 'chk' }, act, 'Proveedor activo') : null, err, e('div', { class: 'row' }, b, cerrar));
        form.replaceChildren(e('div', { class: 'card' }, e('h3', {}, p ? `Editar · ${p.nombre}` : 'Agregar proveedor'), f)); form.scrollIntoView && form.scrollIntoView({ block: 'nearest' });
      }
      const preguntarEliminar = (p) => form.replaceChildren(confirmar(
        p.pedidos ? `¿Eliminar a ${p.nombre}? Como ya tiene pedidos, se archivará: dejará de aparecer para nuevos pedidos pero tu historial se conserva.` : `¿Eliminar a ${p.nombre}? Esta acción no se puede deshacer.`, 'Sí, eliminar',
        async () => { const r = await api(`/proveedores/${p.id}`, { method: 'DELETE' }); await cargar(); form.replaceChildren(e('div', { class: 'card' }, ok(r.archivado ? `${p.nombre} se archivó (su historial se conserva).` : `${p.nombre} se eliminó.`))); }, () => form.replaceChildren()));
      panel.append(e('div', { class: 'row filtros' }, e('button', { class: 'btn', type: 'button', onclick: () => editar(null) }, '+ Agregar proveedor'), e('label', { class: 'chk' }, chkArch, 'Ver archivados')), form, tabla);
      await cargar();
    }

    ir('pedidos');
  });
})();
