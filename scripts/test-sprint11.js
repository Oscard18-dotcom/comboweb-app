// Sprint 11: periodos en reportes/dashboard, caja única, cotización y gastos, solicitudes de Almacén,
// ticket de compra y Aviso de privacidad.   npm run db:init && npm run test:sprint11
const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/pedidos');
const mail = require('../src/mail');
const priv = require('../src/services/privacidad');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const server = app.listen(0);
const B = `http://localhost:${server.address().port}`;
async function call(m, p, body, tok) {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
const R = Date.now();
const q = async (sql, p) => (await db.query(sql, p)).rows;

(async () => {
  const clientes = [], pedidosPP = [], provs = [];
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  const notifMax = (await q('SELECT coalesce(max(id),0) AS m FROM notificaciones'))[0].m;
  mail.reemplazar({ nombre: 'prueba', async enviar() {} });
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), almacen = await login('almacen@encombo.test'), cocina = await login('cocina@encombo.test');
    const hoy = svc.todayMX();

    // ---------- 1) Todos los reportes aceptan el mismo selector de periodo ----------
    for (const p of ['hoy', 'semana', 'mes', 'anio', 'ultimos30', 'total']) {
      for (const ruta of ['ventas-periodo', 'ventas', 'estatus']) {
        const r = await call('GET', `/api/reportes/${ruta}?periodo=${p}`, undefined, admin);
        t(`reporte ${ruta} con periodo=${p}`, r.s === 200 && r.j.desde && r.j.hasta && r.j.hasta === hoy, JSON.stringify(r.j).slice(0, 120));
      }
    }
    let r = await call('GET', '/api/reportes/ventas?periodo=hoy', undefined, admin);
    t('periodo=hoy: desde = hasta = hoy', r.j.desde === hoy && r.j.hasta === hoy);
    r = await call('GET', `/api/reportes/estatus?periodo=rango&desde=${svc.addDays(hoy, -3)}&hasta=${hoy}`, undefined, admin);
    t('periodo=rango con fechas elegidas', r.s === 200 && r.j.desde === svc.addDays(hoy, -3));
    for (const ruta of ['ventas', 'estatus', 'ventas-periodo']) {
      t(`${ruta}: periodo=rango sin fechas → 400`, (await call('GET', `/api/reportes/${ruta}?periodo=rango`, undefined, admin)).s === 400);
      t(`${ruta}: periodo desconocido → 400`, (await call('GET', `/api/reportes/${ruta}?periodo=siglo`, undefined, admin)).s === 400);
    }
    r = await call('GET', '/api/reportes/ventas?periodo=total', undefined, admin);
    t('histórico total: agrupa automáticamente', ['dia', 'semana', 'mes'].includes(r.j.agrupar));
    t('el selector de reportes sigue siendo solo del administrador', (await call('GET', '/api/reportes/ventas?periodo=hoy', undefined, almacen)).s === 403);

    // ---------- 2) Caja de un solo tamaño ----------
    const cajas = await q("SELECT nombre,activo,stock FROM insumos WHERE nombre LIKE 'Caja%' ORDER BY nombre");
    t('existe un solo insumo "Caja" activo', cajas.filter((c) => c.activo).length === 1 && cajas.find((c) => c.activo).nombre === 'Caja', JSON.stringify(cajas));
    const inv = (await call('GET', '/api/inventario', undefined, almacen)).j.insumos;
    t('inventario: aparece "Caja" y ya no chica/mediana/grande', inv.some((i) => i.nombre === 'Caja') && !inv.some((i) => /^Caja (chica|mediana|grande)$/.test(i.nombre)));
    t('no hay presentaciones activas (tamaños de caja)', (await q('SELECT count(*)::int n FROM presentaciones WHERE activo'))[0].n === 0);
    const cajaProv = await call('POST', '/api/proveedores', { nombre: `Cajas ${R}`, correo: `cajas${R}@prov.test`, insumos: [] }, admin);
    provs.push(cajaProv.j.proveedor.id);
    t('al crear proveedor solo se ofrece "Caja" (un tamaño) entre los insumos', (await call('GET', '/api/inventario', undefined, admin)).j.insumos.filter((i) => i.activo && /^Caja/.test(i.nombre)).length === 1);

    // ---------- 3) Cotización y gastos del día ----------
    const harina = (await q("SELECT id,costo_unitario FROM insumos WHERE nombre='Harina'"))[0], azucar = (await q("SELECT id,costo_unitario FROM insumos WHERE nombre='Azúcar'"))[0];
    const prov = cajaProv.j.proveedor.id;
    r = await call('POST', '/api/pedidos-proveedor/cotizar', { items: [{ insumo_id: harina.id, cantidad: 1000 }, { insumo_id: azucar.id, cantidad: 500, precio_unitario: 0.03 }] }, admin);
    const esperado = Math.round((1000 * Number(harina.costo_unitario) + 500 * 0.03) * 100) / 100;
    t('cotizar: usa el costo vigente si no hay precio y el precio escrito si lo hay', r.s === 200 && r.j.total === esperado && r.j.items[1].origen === 'capturado' && r.j.items[0].origen === 'costo_vigente', JSON.stringify(r.j));
    t('cotizar rechaza precios negativos', (await call('POST', '/api/pedidos-proveedor/cotizar', { items: [{ insumo_id: harina.id, cantidad: 1, precio_unitario: -1 }] }, admin)).s === 400);
    const gasto0 = (await call('GET', '/api/reportes/dashboard', undefined, admin)).j.gastos_hoy;
    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: prov, items: [{ insumo_id: harina.id, cantidad: 1000, precio_unitario: 0.05 }, { insumo_id: azucar.id, cantidad: 100, precio_unitario: 0.1 }], suma_stock_en: 'envio' }, admin);
    pedidosPP.push(r.j.pedido.id);
    t('pedido del administrador: queda enviado con total = 1000×0.05 + 100×0.10 = 60.00', r.s === 201 && r.j.pedido.estado === 'enviado' && r.j.pedido.total === 60 && r.j.pedido.items.find((i) => i.insumo_id === harina.id).subtotal === 50, JSON.stringify(r.j.pedido.items) + r.j.pedido.total);
    let d = (await call('GET', '/api/reportes/dashboard', undefined, admin)).j;
    t('dashboard: el pedido aparece en "gastos de hoy"', Math.abs(d.gastos_hoy - gasto0 - 60) < 0.005 && d.compras_hoy >= 1);
    r = await call('GET', '/api/reportes/ventas-periodo?periodo=hoy', undefined, admin);
    t('ventas del periodo: incluye gastos y detalle de la compra', r.j.gastos >= 60 && r.j.gastos_detalle.some((g) => g.proveedor === `Cajas ${R}` && g.total === 60));
    r = await call('GET', '/api/reportes/ventas?periodo=hoy', undefined, admin);
    t('reporte de ventas: gastos de compras y resultado', r.j.gastos_compras.total >= 60 && r.j.totales.resultado === Math.round((r.j.totales.utilidad - r.j.gastos_compras.total) * 100) / 100);
    const gC = (await call('GET', '/api/reportes/dashboard', undefined, admin)).j.gastos_hoy;
    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: prov, items: [{ insumo_id: azucar.id, cantidad: 10, precio_unitario: 1 }], suma_stock_en: 'recepcion' }, admin);
    pedidosPP.push(r.j.pedido.id);
    t('un pedido enviado cuenta como gasto', Math.abs((await call('GET', '/api/reportes/dashboard', undefined, admin)).j.gastos_hoy - gC - 10) < 0.005);
    await call('POST', `/api/pedidos-proveedor/${r.j.pedido.id}/cancelar`, {}, admin);
    t('un pedido cancelado deja de contar como gasto', Math.abs((await call('GET', '/api/reportes/dashboard', undefined, admin)).j.gastos_hoy - gC) < 0.005);

    // ---------- 4) Solicitudes de Almacén: solo el administrador aprueba ----------
    const stock0 = Number((await q('SELECT stock FROM insumos WHERE id=$1', [harina.id]))[0].stock);
    const gasto1 = (await call('GET', '/api/reportes/dashboard', undefined, admin)).j.gastos_hoy;
    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: prov, items: [{ insumo_id: harina.id, cantidad: 2000 }], suma_stock_en: 'envio' }, almacen);
    const sol = r.j.pedido; pedidosPP.push(sol.id);
    t('almacén crea una SOLICITUD (no una compra): estado solicitado y sin correo', r.s === 201 && sol.estado === 'solicitado' && !sol.enviado_en);
    t('la solicitud no suma stock ni cuenta como gasto', Number((await q('SELECT stock FROM insumos WHERE id=$1', [harina.id]))[0].stock) === stock0 && (await call('GET', '/api/reportes/dashboard', undefined, admin)).j.gastos_hoy === gasto1);
    t('la solicitud no manda correo al proveedor', (await q("SELECT count(*)::int n FROM notificaciones WHERE id > $1 AND referencia_id = $2", [notifMax, sol.id]).catch(() => [{ n: 0 }]))[0].n === 0);
    d = (await call('GET', '/api/reportes/dashboard', undefined, admin)).j;
    t('dashboard: avisa de solicitudes por aprobar', d.solicitudes_pendientes >= 1);
    for (const acc of ['aprobar', 'rechazar', 'recibir', 'cancelar']) t(`almacén NO puede ${acc} → 403`, (await call('POST', `/api/pedidos-proveedor/${sol.id}/${acc}`, {}, almacen)).s === 403);
    t('cocina no ve pedidos a proveedor', (await call('GET', '/api/pedidos-proveedor', undefined, cocina)).s === 403);
    t('almacén ve su solicitud en la lista', (await call('GET', '/api/pedidos-proveedor?estado=solicitado', undefined, almacen)).j.pedidos.some((p) => p.id === sol.id));
    t('una solicitud no se puede recibir ni cancelar antes de aprobarla → 409', (await call('POST', `/api/pedidos-proveedor/${sol.id}/recibir`, {}, admin)).s === 409 && (await call('POST', `/api/pedidos-proveedor/${sol.id}/cancelar`, {}, admin)).s === 409);
    r = await call('POST', `/api/pedidos-proveedor/${sol.id}/aprobar`, {}, admin);
    t('el administrador aprueba: pasa a enviado, queda quién aprobó, suma stock', r.s === 200 && r.j.pedido.estado === 'enviado' && r.j.pedido.aprobado_por && Number((await q('SELECT stock FROM insumos WHERE id=$1', [harina.id]))[0].stock) === stock0 + 2000);
    t('al aprobar cuenta como gasto del día (2000 × costo vigente)', Math.abs((await call('GET', '/api/reportes/dashboard', undefined, admin)).j.gastos_hoy - gasto1 - r.j.pedido.total) < 0.005 && r.j.pedido.total > 0);
    t('aprobar dos veces → 409 (no duplica stock)', (await call('POST', `/api/pedidos-proveedor/${sol.id}/aprobar`, {}, admin)).s === 409 && Number((await q('SELECT stock FROM insumos WHERE id=$1', [harina.id]))[0].stock) === stock0 + 2000);
    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: prov, items: [{ insumo_id: azucar.id, cantidad: 50 }] }, almacen);
    pedidosPP.push(r.j.pedido.id);
    const rech = await call('POST', `/api/pedidos-proveedor/${r.j.pedido.id}/rechazar`, { motivo: 'Aún hay suficiente' }, admin);
    t('el administrador rechaza con motivo; no hay gasto ni stock', rech.s === 200 && rech.j.pedido.estado === 'rechazado' && rech.j.pedido.motivo_rechazo === 'Aún hay suficiente' && (await call('POST', `/api/pedidos-proveedor/${r.j.pedido.id}/aprobar`, {}, admin)).s === 409);
    t('almacén puede cotizar y ver proveedores activos (sin catálogo completo)', (await call('POST', '/api/pedidos-proveedor/cotizar', { items: [{ insumo_id: harina.id, cantidad: 1 }] }, almacen)).s === 200 && (await call('GET', '/api/pedidos-proveedor/proveedores', undefined, almacen)).j.proveedores.some((p) => p.id === prov) && (await call('GET', '/api/proveedores', undefined, almacen)).s === 403);

    // ---------- 5) Aviso de privacidad ----------
    const base = { nombre: 'Cliente Priv', correo: `priv${R}@prueba.test`, password: 'secreta123' };
    r = await call('POST', '/api/auth/register', base);
    t('registro SIN aceptar el aviso → 400', r.s === 400 && /privacidad/i.test(r.j.error));
    r = await call('POST', '/api/auth/register', { ...base, acepta_privacidad: 'true' });
    t('registro con aceptación que no es true (texto) → 400', r.s === 400);
    r = await call('POST', '/api/auth/register', { ...base, acepta_privacidad: true });
    clientes.push(r.j.usuario.id); const cli = r.j.token;
    const fila = (await q('SELECT privacidad_version,privacidad_aceptada_en FROM usuarios WHERE id=$1', [r.j.usuario.id]))[0];
    t('registro con aceptación: guarda versión y fecha', r.s === 201 && fila.privacidad_version === priv.VERSION && fila.privacidad_aceptada_en && r.j.usuario.privacidad_pendiente === false);
    // cuenta anterior al aviso: debe aceptarlo antes de comprar
    await db.query('UPDATE usuarios SET privacidad_version=NULL, privacidad_aceptada_en=NULL WHERE id=$1', [clientes[0]]);
    r = await call('POST', '/api/auth/login', { correo: base.correo, password: base.password });
    t('login de cuenta sin aceptar: el usuario viene con privacidad_pendiente', r.s === 200 && r.j.usuario.privacidad_pendiente === true);
    const ck = await call('POST', '/api/pedidos/checkout', { combo: 'personalizado', items: [], fecha: hoy, hora: '23:00' }, cli);
    t('sin aceptar el aviso NO se puede comprar → 403 codigo privacidad', ck.s === 403 && ck.j.codigo === 'privacidad');
    t('aceptar sin marcar → 400', (await call('POST', '/api/auth/aceptar-privacidad', {}, cli)).s === 400 && (await call('POST', '/api/auth/aceptar-privacidad', { acepto: 'si' }, cli)).s === 400);
    r = await call('POST', '/api/auth/aceptar-privacidad', { acepto: true }, cli);
    t('aceptar: queda guardado y ya no está pendiente', r.s === 200 && r.j.usuario.privacidad_pendiente === false && (await q('SELECT privacidad_version FROM usuarios WHERE id=$1', [clientes[0]]))[0].privacidad_version === priv.VERSION);
    t('después de aceptar, el checkout ya no se bloquea por privacidad', (await call('POST', '/api/pedidos/checkout', { combo: 'personalizado', items: [], fecha: hoy, hora: '23:00' }, cli)).j.codigo !== 'privacidad');
    t('el personal no tiene privacidad pendiente (solo clientes)', (await call('GET', '/api/auth/me', undefined, admin)).j.usuario.privacidad_pendiente === false);
    const pag = await (await fetch(B + '/privacidad.html')).text();
    t('la página del aviso existe y menciona derechos ARCO y la versión', /Aviso de privacidad/.test(pag) && /ARCO/.test(pag) && pag.includes(`data-version="${priv.VERSION}"`));

    // ---------- 6) Ticket de compra (cocina y administración) ----------
    const cat = (await call('GET', '/api/catalogo')).j;
    const gal = cat.productos.find((p) => p.nombre === 'Galleta');
    const ped = (await q(`INSERT INTO pedidos(cliente_id,fecha_entrega,hora_entrega,total,estatus,combo,combo_nombre) VALUES($1,$2,'12:00',15,'Pendiente','personalizado','Combo personalizado') RETURNING id`, [clientes[0], hoy]))[0].id;
    await q('INSERT INTO pedido_items(pedido_id,producto_id,cantidad,precio_unitario) VALUES($1,$2,1,15)', [ped, gal.id]);
    await q("INSERT INTO pagos(pedido_id,proveedor,referencia,monto,estado,tarjeta) VALUES($1,'simulado','ref-t11',15,'aprobado','Visa •••• 4242')", [ped]);
    for (const [n, tok] of [['cocina', cocina], ['admin', admin]]) {
      r = await call('GET', `/api/cocina/pedidos/${ped}/ticket`, undefined, tok);
      t(`${n}: ticket con folio, cliente, partidas, total y pago (solo últimos 4 dígitos)`, r.s === 200 && r.j.ticket.folio === svc.folio(ped) && r.j.ticket.items[0].nombre === 'Galleta' && r.j.ticket.total === 15 && r.j.ticket.pago.tarjeta === 'Visa •••• 4242' && !('correo' in r.j.ticket) && !JSON.stringify(r.j).includes('cliente_id'));
    }
    t('almacén y cliente no pueden pedir el ticket → 403', (await call('GET', `/api/cocina/pedidos/${ped}/ticket`, undefined, almacen)).s === 403 && (await call('GET', `/api/cocina/pedidos/${ped}/ticket`, undefined, cli)).s === 403);
    t('ticket de un pedido inexistente → 404', (await call('GET', '/api/cocina/pedidos/99999999/ticket', undefined, cocina)).s === 404);
  } catch (e) { fail++; console.log('FAIL excepción', e.stack || e); }
  finally {
    try {
      const ids = clientes;
      await db.query('DELETE FROM pagos WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_estatus_historial WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedidos WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM checkouts WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [ids]);
      await db.query('DELETE FROM notificaciones WHERE id > $1', [notifMax]);
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      await db.query('DELETE FROM pedido_proveedor_items WHERE pedido_id = ANY($1)', [pedidosPP]);
      await db.query('DELETE FROM pedidos_proveedor WHERE id = ANY($1)', [pedidosPP]);
      await db.query('DELETE FROM proveedor_insumos WHERE proveedor_id = ANY($1)', [provs]);
      await db.query('DELETE FROM proveedores WHERE id = ANY($1)', [provs]);
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      for (const i of insumos0) await db.query('UPDATE insumos SET stock=$2,stock_minimo=$3,costo_unitario=$4,activo=$5 WHERE id=$1', [i.id, i.stock, i.stock_minimo, i.costo_unitario, i.activo]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    server.close();
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    await db.pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
