// Pruebas de pedidos para el mismo día (con tiempo de preparación) y de la regla de fecha mínima.
//   npm run db:init && npm run test:mismo-dia      (requiere SEED_PASSWORD en .env; no necesita el servidor encendido)
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
  const clientes = [];
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  const minOrig = svc.reloj.minutos;
  mail.reemplazar({ nombre: 'prueba', async enviar() {} });
  try {
    const r0 = await call('POST', '/api/auth/register', { nombre: 'Cliente Hoy', correo: `hoy${R}@prueba.test`, password: 'secreta123' });
    clientes.push(r0.j.usuario.id); const cli = r0.j.token;
    const cat = (await call('GET', '/api/catalogo')).j; const G = cat.productos.find((p) => p.nombre === 'Galleta');
    const hoy = svc.todayMX(), manana = svc.addDays(hoy, 1);
    const DIR = { cp: '91190', colonia: 'Las Flores', calle: 'Calle Hoy', num_ext: '1' };
    const cot = (fecha, hora) => call('POST', '/api/pedidos/cotizar', { combo: 'personalizado', items: [{ producto_id: G.id, cantidad: 1 }], fecha, hora }, cli);
    const codigos = (r) => (r.j.errores || []).map((e) => e.codigo);
    const reloj = (h, m = 0) => { svc.reloj.minutos = () => h * 60 + m; };
    const horas = async (f) => Object.fromEntries((await call('GET', `/api/pedidos/disponibilidad?fecha=${f}`, undefined, cli)).j.horarios.map((x) => [x.hora, x.disponible]));
    delete process.env.MIN_DAYS_AHEAD; delete process.env.MIN_HOURS_AHEAD;

    reloj(10);
    t('a las 10:00 se puede pedir para HOY a las 12:00 (2 h de preparación)', (await cot(hoy, '12:00')).j.ok);
    t('a las 10:00 NO se puede pedir para hoy a las 11:00 (falta menos de 2 h) → hora_pasada', codigos(await cot(hoy, '11:00')).includes('hora_pasada') && codigos(await cot(hoy, '09:00')).includes('hora_pasada'));
    t('a las 10:00 las 12:00 en adelante están libres y 09, 10 y 11 no', await (async () => { const h = await horas(hoy); return !h['09:00'] && !h['10:00'] && !h['11:00'] && h['12:00'] && h['18:00']; })());
    t('mañana no se ve afectado por la hora actual', (await cot(manana, '09:00')).j.ok && (await horas(manana))['09:00'] === true);
    t('ayer sigue sin poderse → fecha_pasada', codigos(await cot(svc.addDays(hoy, -1), '12:00')).includes('fecha_pasada'));
    reloj(17, 30);
    t('a las 17:30 ya no queda ningún horario para hoy, pero mañana sí', Object.values(await horas(hoy)).every((v) => !v) && codigos(await cot(hoy, '18:00')).includes('hora_pasada') && (await cot(manana, '10:00')).j.ok);
    reloj(10, 30);
    t('a las 10:30 la hora de las 12:00 ya no alcanza y la de las 13:00 sí (hay que contar los minutos)', codigos(await cot(hoy, '12:00')).includes('hora_pasada') && (await cot(hoy, '13:00')).j.ok);
    process.env.MIN_HOURS_AHEAD = '0'; reloj(10);
    t('con MIN_HOURS_AHEAD=0 se acepta la hora en punto actual pero no una pasada', (await cot(hoy, '10:00')).j.ok && codigos(await cot(hoy, '09:00')).includes('hora_pasada'));
    delete process.env.MIN_HOURS_AHEAD; process.env.MIN_DAYS_AHEAD = '1';
    t('con MIN_DAYS_AHEAD=1 se vuelve a exigir un día de anticipación', codigos(await cot(hoy, '15:00')).includes('fecha_pasada') && (await cot(manana, '15:00')).j.ok);
    delete process.env.MIN_DAYS_AHEAD; reloj(10);

    // Pedido real para hoy
    const ck = await call('POST', '/api/pedidos/checkout', { combo: 'personalizado', items: [{ producto_id: G.id, cantidad: 2 }], fecha: hoy, hora: '14:00', direccion: DIR }, cli);
    const ap = await call('POST', `/api/pagos/simulado/${ck.j.checkout_id}/aprobar`, { tarjeta: { titular: 'Cliente Prueba', numero: '4242 4242 4242 4242', vence: '12/39', cvv: '123' } }, cli);
    t('un pedido para hoy se paga y se crea con la fecha de hoy', ck.s < 300 && ap.s === 200 && (await q('SELECT fecha_entrega::text f, left(hora_entrega::text,5) h FROM pedidos WHERE id=$1', [ap.j.pedido_id]))[0].f === hoy);
    reloj(10);
    t('ese horario de hoy ya cuenta como ocupado (1 de 2 lugares)', (await horas(hoy))['14:00'] === true);
    const ck2 = await call('POST', '/api/pedidos/checkout', { combo: 'personalizado', items: [{ producto_id: G.id, cantidad: 1 }], fecha: hoy, hora: '09:00', direccion: DIR }, cli);
    t('el checkout rechaza una hora de hoy que ya pasó', ck2.s === 400 || ck2.s === 422 || (ck2.j.errores || []).some((e) => e.codigo === 'hora_pasada'), JSON.stringify(ck2.j));
  } catch (e) { fail++; console.log('FAIL error inesperado', e); }
  finally {
    try {
      svc.reloj.minutos = minOrig; mail.reemplazar(null);
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
