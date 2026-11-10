// Pruebas de combos (pequeño, mediano, grande, pareja y personalizado), sin cajas, y ventas por periodo del Dashboard.
//   npm run db:init && npm run test:combos      (requiere SEED_PASSWORD en .env; no necesita el servidor encendido)
const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/pedidos');
const mail = require('../src/mail');

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
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  const clientes = [];
  mail.reemplazar({ nombre: 'prueba', async enviar() {} });
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), cocina = await login('cocina@encombo.test');
    const r0 = await call('POST', '/api/auth/register', { nombre: 'Cliente Combos', correo: `cmb${R}@prueba.test`, password: 'secreta123' });
    clientes.push(r0.j.usuario.id); const cli = r0.j.token;
    const cat = (await call('GET', '/api/catalogo')).j;
    const P = (n) => cat.productos.find((p) => p.nombre === n);
    const base = 20 + Math.floor(Math.random() * 60); let k = 0;
    const dia = () => svc.addDays(svc.todayMX(), base + (k++));
    const DIR = { cp: '91190', colonia: 'Las Flores', calle: 'Calle Combos', num_ext: '1' };
    const por = (lista) => lista.map(([n, c]) => ({ producto_id: P(n).id, cantidad: c }));
    const cot = (combo, lista, extra = {}) => call('POST', '/api/pedidos/cotizar', { combo, items: por(lista), fecha: dia(), hora: '12:00', ...extra }, cli);
    const hay = (r, c) => (r.j.errores || []).some((e) => e.codigo === c);

    const nombres = cat.combos.map((c) => c.nombre);
    t('catálogo: combos Pequeño, Mediano, Grande y Pareja (más el personalizado) y sin presentaciones', nombres.join() === 'Combo Pequeño,Combo Mediano,Combo Grande,Combo Pareja' && cat.combo_personalizado.nombre === 'Combo personalizado' && cat.presentaciones === undefined, nombres.join());
    const pr = (n) => Number(P(n).precio);
    t('catálogo: el precio de cada combo es la suma de sus productos', cat.combos.every((c) => Math.abs(c.precio - c.items.reduce((a, x) => a + x.cantidad * pr(x.nombre), 0)) < 0.005));
    t('catálogo: contenido de cada combo', cat.combos.find((c) => c.clave === 'pequeno').items.map((x) => x.cantidad + x.nombre).sort().join() === '1Café americano,1Galleta' && cat.combos.find((c) => c.clave === 'grande').items.every((x) => x.cantidad === 2) && cat.combos.find((c) => c.clave === 'pareja').items.length === 4);

    let r = await cot('pequeno', [['Galleta', 1], ['Café americano', 1]]);
    t('Combo Pequeño con sus productos → válido, total = suma, sin caja y con el combo en el detalle', r.s === 200 && r.j.ok && r.j.detalle.total === 45 && r.j.detalle.combo.clave === 'pequeno' && r.j.detalle.presentacion === undefined, JSON.stringify(r.j).slice(0, 250));
    r = await cot('pequeno', [['Galleta', 2], ['Café americano', 2]]);
    t('2 Combos Pequeños (cantidades en múltiplo) → válido', r.j.ok && r.j.detalle.total === 90);
    r = await cot('pequeno', [['Galleta', 2], ['Café americano', 1]]);
    t('Combo Pequeño con cantidades desiguales → combo_invalido', !r.j.ok && hay(r, 'combo_invalido'));
    r = await cot('pequeno', [['Galleta', 1], ['Café americano', 1], ['Brownie', 1]]);
    t('Combo Pequeño con un producto de más → combo_invalido', hay(r, 'combo_invalido'));
    r = await cot('mediano', [['Galleta', 1], ['Café americano', 1]]);
    t('Combo Mediano con los productos de otro combo → combo_invalido', hay(r, 'combo_invalido'));
    r = await cot('inventado', [['Galleta', 1]]);
    t('combo desconocido → combo_invalido', hay(r, 'combo_invalido'));
    r = await cot('personalizado', [['Galleta', 3], ['Brownie', 1]]);
    t('Combo personalizado acepta cualquier mezcla', r.j.ok && r.j.detalle.combo.clave === 'personalizado' && r.j.detalle.total === 75);
    r = await cot(undefined, [['Galleta', 1]]);
    t('sin indicar combo se toma como personalizado', r.j.ok && r.j.detalle.combo.clave === 'personalizado');
    r = await cot('grande', [['Cupcake', 2], ['Brownie', 2], ['Galleta', 2], ['Café latte', 2]]);
    t('Combo Grande: 2 de cada uno de sus 4 productos', r.j.ok && r.j.detalle.total === 2 * (pr('Cupcake') + pr('Brownie') + pr('Galleta') + pr('Café latte')), JSON.stringify(r.j).slice(0, 250));
    r = await cot('pareja', [['Café latte', 1], ['Té chai', 1], ['Cupcake', 1], ['Brownie', 1]]);
    t('Combo Pareja válido', r.j.ok);
    r = await cot('pequeno', [['Galleta', 1], ['Café americano', 1]], { presentacion_id: 999999 });
    t('un presentacion_id enviado se ignora (ya no existe el tamaño de caja)', r.j.ok && r.j.detalle.total === 45);

    const antesCaja = Number((await q("SELECT stock FROM insumos WHERE nombre='Caja mediana'"))[0].stock);
    const pagar = async (combo, lista) => {
      const ck = await call('POST', '/api/pedidos/checkout', { combo, items: por(lista), fecha: dia(), hora: '13:00', direccion: DIR }, cli);
      const ap = await call('POST', `/api/pagos/simulado/${ck.j.checkout_id}/aprobar`, undefined, cli);
      return ap.j.pedido_id;
    };
    const idPeq = await pagar('pequeno', [['Galleta', 1], ['Café americano', 1]]);
    const idPer = await pagar('personalizado', [['Brownie', 2]]);
    t('se crearon los pedidos y el combo queda guardado', idPeq > 0 && idPer > 0 && (await q('SELECT combo FROM pedidos WHERE id=$1', [idPeq]))[0].combo === 'pequeno' && (await q('SELECT combo FROM pedidos WHERE id=$1', [idPer]))[0].combo === 'personalizado');
    t('ya no se descuentan cajas del inventario', Number((await q("SELECT stock FROM insumos WHERE nombre='Caja mediana'"))[0].stock) === antesCaja && (await q("SELECT count(*)::int AS n FROM movimientos_inventario m JOIN insumos i ON i.id=m.insumo_id WHERE m.pedido_id=ANY($1) AND i.nombre LIKE 'Caja%'", [[idPeq, idPer]]))[0].n === 0);
    r = await call('GET', `/api/pedidos/${idPeq}`, undefined, cli);
    t('comprobante: muestra el combo y el total sin caja', r.j.pedido.combo.nombre === 'Combo Pequeño' && r.j.pedido.total === 45 && r.j.pedido.presentacion === null);
    r = await call('GET', '/api/pedidos', undefined, cli);
    t('Mis pedidos: cada pedido trae su combo', r.j.pedidos.find((x) => x.id === idPeq).combo.nombre === 'Combo Pequeño');
    r = await call('GET', `/api/cocina/pedidos/${idPeq}`, undefined, cocina);
    t('cocina: la ficha técnica muestra el tipo de combo', JSON.stringify(r.j).includes('Combo Pequeño'), JSON.stringify(r.j).slice(0, 200));

    const hoy = svc.todayMX();
    const rep = (await call('GET', `/api/reportes/ventas?desde=${hoy}&hasta=${svc.addDays(hoy, 200)}&agrupar=dia`, undefined, admin)).j;
    r = await call('GET', `/api/reportes/ventas?desde=${svc.addDays(hoy, -30)}&hasta=${hoy}&agrupar=dia`, undefined, admin);
    t('Reportes → ventas incluye "Ventas por combo" con los 5 tipos', r.j.combos.length >= 5 && ['Combo Pequeño', 'Combo Mediano', 'Combo Grande', 'Combo Pareja', 'Combo personalizado'].every((n) => r.j.combos.some((c) => c.nombre === n)));
    t('Reportes: la suma por combo coincide con los pedidos y las ventas del periodo', r.j.combos.reduce((a, c) => a + c.pedidos, 0) === r.j.totales.pedidos && Math.abs(r.j.combos.reduce((a, c) => a + c.ventas, 0) - r.j.totales.ventas) < 0.02);
    t('Reportes: el rango futuro de este pedido separa los combos (Pequeño y personalizado)', rep.combos.find((c) => c.clave === 'pequeno').pedidos >= 1 && rep.combos.find((c) => c.clave === 'personalizado').pedidos >= 1);

    const vp = {};
    for (const p of ['hoy', 'semana', 'mes', 'trimestre', 'semestre', 'anio', 'total']) vp[p] = (await call('GET', `/api/reportes/ventas-periodo?periodo=${p}`, undefined, admin)).j;
    t('ventas por periodo: los 7 periodos responden con desde/hasta y cifras', Object.values(vp).every((x) => x.desde && x.hasta && typeof x.ventas === 'number' && x.serie && x.combos));
    t('ventas por periodo: hoy ≤ semana ≤ mes ≤ trimestre ≤ semestre ≤ año ≤ histórico', ['hoy', 'semana', 'mes', 'trimestre', 'semestre', 'anio', 'total'].every((p, i, a) => !i || (vp[a[i - 1]].ventas <= vp[p].ventas + 0.005 && vp[a[i - 1]].pedidos <= vp[p].pedidos)));
    t('ventas por periodo: la serie y los combos suman lo mismo que el total del periodo', Object.values(vp).every((x) => Math.abs(x.serie.reduce((a, y) => a + y.ventas, 0) - x.ventas) < 0.02 && Math.abs(x.combos.reduce((a, y) => a + y.ventas, 0) - x.ventas) < 0.02 && x.serie.reduce((a, y) => a + y.pedidos, 0) === x.pedidos));
    const total = (await q('SELECT count(*)::int AS n, coalesce(sum(total),0)::float AS v FROM pedidos'))[0];
    t('ventas por periodo: el histórico total coincide con la base de datos', vp.total.pedidos === total.n && Math.abs(vp.total.ventas - total.v) < 0.02);
    t('ventas por periodo: mes empieza el día 1, año el 1 de enero, trimestre y semestre en su mes de inicio, semana en lunes', vp.mes.desde === hoy.slice(0, 8) + '01' && vp.anio.desde === hoy.slice(0, 4) + '-01-01' && /^\d{4}-(01|04|07|10)-01$/.test(vp.trimestre.desde) && /^\d{4}-(01|07)-01$/.test(vp.semestre.desde) && vp.hoy.desde === hoy && vp.hoy.hasta === hoy && new Date(vp.semana.desde + 'T12:00:00Z').getUTCDay() === 1);
    const h30 = (await call('GET', '/api/reportes/ventas-periodo?periodo=ultimos30', undefined, admin)).j, hy = svc.todayMX();
    t('ventas por periodo: "últimos 30 días" va de hoy-29 a hoy', h30.hasta === hy && h30.desde === svc.addDays(hy, -29) && h30.unidad === 'day');
    const rg1 = (await call('GET', `/api/reportes/ventas-periodo?periodo=rango&desde=${svc.addDays(hy, -90)}&hasta=${svc.addDays(hy, -10)}`, undefined, admin)).j;
    const rg2 = (await call('GET', `/api/reportes/ventas?desde=${svc.addDays(hy, -90)}&hasta=${svc.addDays(hy, -10)}&agrupar=dia`, undefined, admin)).j;
    t('ventas por periodo: un rango de fechas elegido coincide con Reportes para las mismas fechas', rg1.desde === svc.addDays(hy, -90) && rg1.hasta === svc.addDays(hy, -10) && rg1.pedidos === rg2.totales.pedidos && Math.abs(rg1.ventas - rg2.totales.ventas) < 0.02);
    const un = (await call('GET', `/api/reportes/ventas-periodo?periodo=rango&desde=${hy}&hasta=${hy}`, undefined, admin)).j;
    t('ventas por periodo: un rango de un solo día se detalla por hora y es igual a "hoy"', un.unidad === 'hour' && un.pedidos === (await call('GET', '/api/reportes/ventas-periodo?periodo=hoy', undefined, admin)).j.pedidos);
    t('ventas por periodo: rango inválido (inicial posterior, faltan fechas, formato o más de 5 años) → 400', (await call('GET', `/api/reportes/ventas-periodo?periodo=rango&desde=${hy}&hasta=${svc.addDays(hy, -3)}`, undefined, admin)).s === 400 && (await call('GET', '/api/reportes/ventas-periodo?periodo=rango', undefined, admin)).s === 400 && (await call('GET', '/api/reportes/ventas-periodo?periodo=rango&desde=hola&hasta=mañana', undefined, admin)).s === 400 && (await call('GET', `/api/reportes/ventas-periodo?periodo=rango&desde=${svc.addDays(hy, -2000)}&hasta=${hy}`, undefined, admin)).s === 400);
    const mm = (await call('GET', `/api/reportes/ventas?desde=${vp.mes.desde}&hasta=${vp.mes.hasta}&agrupar=dia`, undefined, admin)).j;
    t('ventas por periodo: "este mes" coincide con Reportes para las mismas fechas', mm.totales.pedidos === vp.mes.pedidos && Math.abs(mm.totales.ventas - vp.mes.ventas) < 0.02 && Math.abs(mm.totales.utilidad - vp.mes.utilidad) < 0.05);
    t('ventas por periodo: periodo inválido → 400; sin sesión → 401; cocina y cliente → 403', (await call('GET', '/api/reportes/ventas-periodo?periodo=ayer', undefined, admin)).s === 400 && (await call('GET', '/api/reportes/ventas-periodo?periodo=mes')).s === 401 && (await call('GET', '/api/reportes/ventas-periodo?periodo=mes', undefined, cocina)).s === 403 && (await call('GET', '/api/reportes/ventas-periodo?periodo=mes', undefined, cli)).s === 403);
  } catch (e) { fail++; console.log('FAIL error inesperado', e); }
  finally {
    try {
      mail.reemplazar(null);
      const ids = clientes.filter(Boolean);
      await db.query('DELETE FROM checkouts WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM movimientos_inventario WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pagos WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_estatus_historial WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]).catch(() => {});
      await db.query('DELETE FROM notificaciones WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]).catch(() => {});
      await db.query('DELETE FROM pedidos WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [ids]);
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      for (const i of insumos0) await db.query('UPDATE insumos SET stock=$2,stock_minimo=$3,costo_unitario=$4,activo=$5 WHERE id=$1', [i.id, i.stock, i.stock_minimo, i.costo_unitario, i.activo]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    server.close();
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    await db.pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
