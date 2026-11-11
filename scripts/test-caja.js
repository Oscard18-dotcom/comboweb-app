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

    /* ---- Corte de caja ---- */
    t('caja: sin sesión 401; cliente, cocina y almacén 403', (await call('GET', '/api/caja')).s === 401 && (await call('GET', '/api/caja/resumen', undefined, cli)).s === 403 && (await call('POST', '/api/caja', {}, cocina)).s === 403 && (await call('GET', '/api/caja/1', undefined, almacen)).s === 403);
    const hoy = svc.todayMX();
    const real = (await q("SELECT count(*)::int n, coalesce(sum(monto),0) m FROM pagos WHERE estado='aprobado' AND (creado_en AT TIME ZONE 'America/Mexico_City')::date=$1", [hoy]))[0];
    r = await call('GET', '/api/caja/resumen', undefined, admin);
    t('resumen de hoy (por defecto) = pagos aprobados de hoy en la base', r.s === 200 && r.j.desde === hoy && r.j.hasta === hoy && r.j.pedidos === real.n && Math.abs(r.j.ventas - Number(real.m)) < 0.005, JSON.stringify(r.j));
    t('el desglose suma lo mismo que el total y trae las marcas', r.j.desglose.reduce((a, x) => a + x.monto, 0).toFixed(2) === r.j.ventas.toFixed(2) && r.j.desglose.some((x) => x.metodo === 'Visa') && r.j.desglose.some((x) => x.metodo === 'Mastercard'));
    const resumenes = [['desde=2026-13-01', 'fecha inválida'], [`desde=${svc.addDays(hoy, 1)}&hasta=${svc.addDays(hoy, 1)}`, 'futuro'], [`desde=${hoy}&hasta=${svc.addDays(hoy, -2)}`, 'invertido'], [`desde=${svc.addDays(hoy, -200)}&hasta=${hoy}`, 'más de 3 meses']];
    for (const [qs, d] of resumenes) t(`resumen con rango ${d} → 400`, (await call('GET', '/api/caja/resumen?' + qs, undefined, admin)).s === 400);
    t('un día sin pagos da ceros', (await call('GET', '/api/caja/resumen?desde=2020-01-01&hasta=2020-01-01', undefined, admin)).j.ventas === 0);

    const malosC = [[{ fondo_inicial: '' }, 'falta el fondo'], [{ fondo_inicial: -5 }, 'negativo'], [{ fondo_inicial: 'abc' }, 'texto'], [{ fondo_inicial: 100.555 }, '3 decimales'], [{ fondo_inicial: 100, contado: 'x' }, 'contado inválido'], [{ fondo_inicial: 100, notas: 'x'.repeat(201) }, 'notas largas'], [{ fondo_inicial: 100, hasta: svc.addDays(hoy, 3) }, 'futuro']];
    for (const [b, d] of malosC) t(`guardar corte inválido (${d}) → 400`, (await call('POST', '/api/caja', b, admin)).s === 400);
    t('los cortes inválidos no se guardan', (await q('SELECT count(*)::int n FROM cortes_caja WHERE notas LIKE $1', [`%${R}%`]))[0].n === 0);

    r = await call('POST', '/api/caja', { fondo_inicial: '500', contado: '' + (500 + Number(real.m) + 2 + 20.5 * 0), notas: `Prueba ${R}`, ventas: 99999, saldo_final: 1 }, admin);
    const rr = await call('GET', '/api/caja/resumen', undefined, admin);
    const cr = r.j.corte; if (cr) cortes.push(cr.id);
    t('guardar corte → 201 con folio CC-####', r.s === 201 && /^CC-\d{4,}$/.test(cr.folio), JSON.stringify(r.j));
    t('el servidor calcula las ventas (ignora las que mande el navegador)', cr.ventas === rr.j.ventas && cr.pedidos === rr.j.pedidos && cr.ventas !== 99999);
    t('saldo final = fondo inicial + ventas', Math.abs(cr.saldo_final - (500 + cr.ventas)) < 0.005 && cr.fondo_inicial === 500 && cr.saldo_final !== 1);
    t('diferencia = contado − esperado', cr.contado != null && Math.abs(cr.diferencia - (cr.contado - cr.saldo_final)) < 0.005 && Math.abs(cr.diferencia - 2) < 0.005, JSON.stringify(cr));
    t('el corte guarda quién lo hizo y las notas', /Admin/i.test(cr.hecho_por || '') && cr.notas === `Prueba ${R}`);
    r = await call('POST', '/api/caja', { fondo_inicial: 0 }, admin); if (r.j.corte) cortes.push(r.j.corte.id);
    t('sin monto contado la diferencia queda vacía', r.s === 201 && r.j.corte.contado === null && r.j.corte.diferencia === null);
    const lista = (await call('GET', '/api/caja', undefined, admin)).j.cortes;
    t('el historial trae los cortes, el más reciente primero', lista.length >= 2 && lista[0].id > lista[1].id && lista.some((x) => x.id === cr.id));
    r = await call('GET', `/api/caja/${cr.id}`, undefined, admin);
    t('se puede volver a abrir un corte guardado (para reimprimir) con las mismas cifras', r.s === 200 && r.j.corte.folio === cr.folio && r.j.corte.saldo_final === cr.saldo_final && Array.isArray(r.j.corte.desglose));
    t('corte inexistente → 404; id inválido → 400', (await call('GET', '/api/caja/99999999', undefined, admin)).s === 404 && (await call('GET', '/api/caja/abc', undefined, admin)).s === 400);
    t('un corte guardado no cambia aunque entren pagos nuevos', await (async () => { const i2 = await nuevo(); await pagar(i2, OK); const o = (await call('GET', `/api/caja/${cr.id}`, undefined, admin)).j.corte; return o.ventas === cr.ventas && o.saldo_final === cr.saldo_final; })());
  } catch (e) { fail++; console.log('FAIL error inesperado', e); }
  finally {
    try {
      mail.reemplazar(null);
      const ids = clientes.filter(Boolean);
      await db.query('DELETE FROM cortes_caja WHERE id = ANY($1)', [cortes]);
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
