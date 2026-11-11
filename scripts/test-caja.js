// Pruebas de la pasarela de pago simulada con tarjeta y del corte de caja.
//   npm run db:init && npm run test:caja      (requiere SEED_PASSWORD en .env; no necesita el servidor encendido)
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
  const clientes = [], cortes = [];
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  mail.reemplazar({ nombre: 'prueba', async enviar() {} });
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), cocina = await login('cocina@encombo.test'), almacen = await login('almacen@encombo.test');
    const r0 = await call('POST', '/api/auth/register', { nombre: 'Cliente Caja', correo: `caja${R}@prueba.test`, password: 'secreta123' });
    clientes.push(r0.j.usuario.id); const cli = r0.j.token;
    const cat = (await call('GET', '/api/catalogo')).j; const P = (n) => cat.productos.find((p) => p.nombre === n);
    const base = 20 + Math.floor(Math.random() * 60); let k = 0;
    const dia = () => svc.addDays(svc.todayMX(), base + (k++));
    const DIR = { cp: '91190', colonia: 'Las Flores', calle: 'Calle Caja', num_ext: '1' };
    const nuevo = async () => (await call('POST', '/api/pedidos/checkout', { combo: 'personalizado', items: [{ producto_id: P('Galleta').id, cantidad: 2 }], fecha: dia(), hora: '12:00', direccion: DIR }, cli)).j.checkout_id;
    const pagar = (id, tarjeta, tok = cli) => call('POST', `/api/pagos/simulado/${id}/aprobar`, tarjeta === undefined ? undefined : { tarjeta }, tok);
    const OK = { titular: 'Cliente Prueba', numero: '4242 4242 4242 4242', vence: '12/39', cvv: '123' };

    /* ---- Pasarela simulada con tarjeta ---- */
    let id = await nuevo(), r;
    r = await pagar(id, undefined); t('sin datos de tarjeta → 400 con los campos', r.s === 400 && r.j.campos && Object.keys(r.j.campos).length === 4, JSON.stringify(r.j));
    const malos = [[{ ...OK, titular: '' }, 'titular'], [{ ...OK, titular: '12345' }, 'titular'], [{ ...OK, numero: '4242 4242 4242 4241' }, 'numero'], [{ ...OK, numero: '1234' }, 'numero'], [{ ...OK, numero: 'abcd' }, 'numero'],
      [{ ...OK, vence: '13/30' }, 'vence'], [{ ...OK, vence: '01/20' }, 'vence'], [{ ...OK, vence: '1230' }, 'vence'], [{ ...OK, vence: '12/99' }, 'vence'], [{ ...OK, cvv: '12' }, 'cvv'], [{ ...OK, cvv: 'abc' }, 'cvv'], [{ ...OK, cvv: 1234 }, 'cvv']];
    for (const [tj, campo] of malos) { r = await pagar(id, tj); t(`tarjeta inválida (${campo}: ${JSON.stringify(tj[campo])}) → 400 en ese campo`, r.s === 400 && r.j.campos && r.j.campos[campo], JSON.stringify(r.j)); }
    t('los intentos inválidos no cobran ni crean pedido', (await q('SELECT estado FROM checkouts WHERE id=$1', [id]))[0].estado === 'creado' && (await q('SELECT count(*)::int n FROM pedidos WHERE cliente_id=$1', [clientes[0]]))[0].n === 0);
    r = await pagar(id, { ...OK, numero: '4000 0000 0000 0002' });
    t('tarjeta rechazada por el banco → 402 y el checkout sigue disponible', r.s === 402 && /rechaz/i.test(r.j.error) && (await q('SELECT estado FROM checkouts WHERE id=$1', [id]))[0].estado === 'creado');
    r = await pagar(id, { ...OK, numero: '4000000000009995' });
    t('fondos insuficientes → 402', r.s === 402 && /Fondos insuficientes/.test(r.j.error));
    r = await pagar(id, OK);
    t('tarjeta de prueba válida → pago aprobado y pedido creado', r.s === 200 && r.j.estado === 'pagado' && r.j.pedido_id > 0, JSON.stringify(r.j));
    const pg = (await q('SELECT * FROM pagos WHERE pedido_id=$1', [r.j.pedido_id]))[0];
    t('del pago solo se guarda la marca y los últimos 4 dígitos', pg.tarjeta === 'Visa •••• 4242' && !JSON.stringify(pg).includes('4242424242424242') && !JSON.stringify(pg).includes('123"'));
    t('el número completo y el CVV no aparecen en ninguna columna del pago ni del checkout', !JSON.stringify(await q('SELECT * FROM checkouts WHERE id=$1', [id])).includes('4242 4242') && !JSON.stringify(await q('SELECT * FROM pagos WHERE id=$1', [pg.id])).includes('4242424242'));
    t('pagar otra vez el mismo checkout no duplica el pedido', (await pagar(id, OK)).j.pedido_id === r.j.pedido_id && (await q('SELECT count(*)::int n FROM pedidos WHERE cliente_id=$1', [clientes[0]]))[0].n === 1);
    id = await nuevo(); r = await pagar(id, { ...OK, numero: '5555 5555 5555 4444' });
    t('Mastercard se reconoce', r.s === 200 && (await q('SELECT tarjeta FROM pagos WHERE pedido_id=$1', [r.j.pedido_id]))[0].tarjeta === 'Mastercard •••• 4444');

    /* ---- Corte de caja en dos pasos ---- */
    const hoy = svc.todayMX(), ayer = svc.addDays(hoy, -1), viejo = svc.addDays(hoy, -400);
    await db.query('DELETE FROM cortes_caja WHERE desde = ANY($1)', [[hoy, ayer, viejo]]);
    t('caja: sin sesión 401; cliente, cocina y almacén 403', (await call('GET', '/api/caja')).s === 401 && (await call('GET', '/api/caja/dia', undefined, cli)).s === 403 && (await call('POST', '/api/caja/abrir', {}, cocina)).s === 403 && (await call('POST', '/api/caja/1/cerrar', {}, almacen)).s === 403 && (await call('GET', '/api/caja/1', undefined, almacen)).s === 403);
    r = await call('GET', '/api/caja/dia', undefined, admin);
    const real = (await q("SELECT count(*)::int n, coalesce(sum(monto),0) m FROM pagos WHERE estado='aprobado' AND (creado_en AT TIME ZONE 'America/Mexico_City')::date=$1", [hoy]))[0];
    t('día sin abrir: no hay corte y trae las ventas del día (pagos aprobados)', r.s === 200 && r.j.fecha === hoy && r.j.corte === null && r.j.resumen.pedidos === real.n && Math.abs(r.j.resumen.ventas - Number(real.m)) < 0.005, JSON.stringify(r.j));
    t('el desglose suma el total y trae las marcas', r.j.resumen.desglose.reduce((a, x) => a + x.monto, 0).toFixed(2) === r.j.resumen.ventas.toFixed(2) && r.j.resumen.desglose.some((x) => x.metodo === 'Visa') && r.j.resumen.desglose.some((x) => x.metodo === 'Mastercard'));
    for (const [qs, d] of [['fecha=2026-13-01', 'fecha inválida'], [`fecha=${svc.addDays(hoy, 1)}`, 'día futuro']]) t(`consultar un día con ${d} → 400`, (await call('GET', '/api/caja/dia?' + qs, undefined, admin)).s === 400);
    const malosA = [[{ fondo_inicial: '' }, 'falta el fondo'], [{ fondo_inicial: -5 }, 'negativo'], [{ fondo_inicial: 'abc' }, 'texto'], [{ fondo_inicial: 100.555 }, '3 decimales'], [{ fondo_inicial: 100, notas: 'x'.repeat(201) }, 'notas largas'], [{ fondo_inicial: 100, fecha: svc.addDays(hoy, 3) }, 'día futuro'], [{ fondo_inicial: 100, fecha: '2026-02-30' }, 'fecha inválida']];
    for (const [b, d] of malosA) t(`abrir inválido (${d}) → 400`, (await call('POST', '/api/caja/abrir', b, admin)).s === 400);
    t('lo inválido no guardó ninguna caja', (await q('SELECT count(*)::int n FROM cortes_caja WHERE desde = $1', [hoy]))[0].n === 0);

    // Paso 1: abrir
    r = await call('POST', '/api/caja/abrir', { fondo_inicial: '500', notas: `Prueba ${R}` }, admin);
    const ab = r.j.corte; if (ab) cortes.push(ab.id);
    t('abrir caja → 201, estado abierto, con folio y el fondo guardado', r.s === 201 && ab.estado === 'abierto' && /^CC-\d{4,}$/.test(ab.folio) && ab.fondo_inicial === 500 && ab.fecha === hoy && ab.contado === null && ab.saldo_final === null, JSON.stringify(r.j));
    t('abre a nombre de quien la abrió', /Admin/i.test(ab.abrio || ''));
    t('el fondo queda guardado: al volver a entrar el día aparece abierto con el mismo fondo', await (async () => { const d = (await call('GET', '/api/caja/dia', undefined, admin)).j; return d.corte && d.corte.id === ab.id && d.corte.estado === 'abierto' && d.corte.fondo_inicial === 500; })());
    t('no se puede abrir dos veces el mismo día → 409', (await call('POST', '/api/caja/abrir', { fondo_inicial: 1 }, admin)).s === 409 && (await q('SELECT count(*)::int n FROM cortes_caja WHERE desde=$1', [hoy]))[0].n === 1);
    t('abierta, la caja aparece en el historial con estado abierto', (await call('GET', '/api/caja', undefined, admin)).j.cortes.some((x) => x.id === ab.id && x.estado === 'abierto'));

    // Paso 2: cerrar
    const malosC = [[{}, 'sin cantidad'], [{ contado: '' }, 'vacía'], [{ contado: -1 }, 'negativa'], [{ contado: 'x' }, 'texto'], [{ contado: 10.999 }, '3 decimales'], [{ contado: 10, notas: 'x'.repeat(201) }, 'notas largas']];
    for (const [b, d] of malosC) t(`cerrar inválido (${d}) → 400 y la caja sigue abierta`, (await call('POST', `/api/caja/${ab.id}/cerrar`, b, admin)).s === 400);
    t('tras los intentos inválidos sigue abierta', (await q('SELECT estado FROM cortes_caja WHERE id=$1', [ab.id]))[0].estado === 'abierto');
    t('cerrar una caja inexistente → 404; id inválido → 400', (await call('POST', '/api/caja/99999999/cerrar', { contado: 1 }, admin)).s === 404 && (await call('POST', '/api/caja/abc/cerrar', { contado: 1 }, admin)).s === 400);
    const ventasAntes = (await call('GET', '/api/caja/dia', undefined, admin)).j.resumen;
    const contado = Math.round((500 + ventasAntes.ventas + 2) * 100) / 100;
    r = await call('POST', `/api/caja/${ab.id}/cerrar`, { contado, ventas: 99999, saldo_final: 1, fondo_inicial: 7 }, admin);
    const cr = r.j.corte;
    t('cerrar → 200, estado cerrado', r.s === 200 && cr.estado === 'cerrado' && cr.id === ab.id, JSON.stringify(r.j));
    t('las ventas las calcula el servidor (ignora lo que mande el navegador)', cr.ventas === ventasAntes.ventas && cr.pedidos === ventasAntes.pedidos && cr.ventas !== 99999 && cr.fondo_inicial === 500);
    t('saldo final esperado = fondo inicial + ventas', Math.abs(cr.saldo_final - (500 + cr.ventas)) < 0.005 && cr.saldo_final !== 1);
    t('diferencia = cantidad final − esperado', cr.contado === contado && Math.abs(cr.diferencia - 2) < 0.005, JSON.stringify(cr));
    t('el cierre guarda quién cerró, cuándo y el desglose', /Admin/i.test(cr.hecho_por || '') && !!cr.cerrado_en && Array.isArray(cr.desglose) && cr.notas === `Prueba ${R}`);
    t('cerrar otra vez → 409 y no cambia nada', (await call('POST', `/api/caja/${ab.id}/cerrar`, { contado: 1 }, admin)).s === 409 && (await call('GET', `/api/caja/${ab.id}`, undefined, admin)).j.corte.contado === contado);
    t('un día cerrado no se puede volver a abrir → 409', (await call('POST', '/api/caja/abrir', { fondo_inicial: 5 }, admin)).s === 409);
    t('el corte cerrado se puede reabrir para reimprimir con las mismas cifras', (await call('GET', `/api/caja/${ab.id}`, undefined, admin)).j.corte.saldo_final === cr.saldo_final);
    t('un corte cerrado no cambia aunque entren pagos nuevos', await (async () => { const i2 = await nuevo(); await pagar(i2, OK); const o = (await call('GET', `/api/caja/${ab.id}`, undefined, admin)).j.corte; return o.ventas === cr.ventas && o.saldo_final === cr.saldo_final; })());
    t('corte inexistente → 404; id inválido → 400', (await call('GET', '/api/caja/99999999', undefined, admin)).s === 404 && (await call('GET', '/api/caja/abc', undefined, admin)).s === 400);

    // Un día anterior que se quedó abierto
    r = await call('POST', '/api/caja/abrir', { fecha: ayer, fondo_inicial: 0 }, admin); if (r.j.corte) cortes.push(r.j.corte.id);
    t('se puede abrir la caja de un día anterior (fondo 0)', r.s === 201 && r.j.corte.fecha === ayer && r.j.corte.fondo_inicial === 0);
    const dAyer = (await call('GET', `/api/caja/dia?fecha=${ayer}`, undefined, admin)).j;
    r = await call('POST', `/api/caja/${r.j.corte.id}/cerrar`, { contado: 0 }, admin);
    t('día anterior sin ventas: cierra en ceros y sin diferencia', dAyer.corte.estado === 'abierto' && r.s === 200 && r.j.corte.ventas === 0 && r.j.corte.saldo_final === 0 && r.j.corte.diferencia === 0);
    const lista = (await call('GET', '/api/caja', undefined, admin)).j.cortes;
    t('el historial trae los cortes, el día más reciente primero', lista.length >= 2 && lista[0].fecha >= lista[1].fecha && lista.some((x) => x.id === ab.id && x.estado === 'cerrado'));
  } catch (e) { fail++; console.log('FAIL error inesperado', e); }
  finally {
    try {
      mail.reemplazar(null);
      const ids = clientes.filter(Boolean);
      await db.query('DELETE FROM cortes_caja WHERE id = ANY($1)', [cortes]);
      await db.query('DELETE FROM cortes_caja WHERE desde = ANY($1)', [[svc.todayMX(), svc.addDays(svc.todayMX(), -1), svc.addDays(svc.todayMX(), -400)]]);
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
