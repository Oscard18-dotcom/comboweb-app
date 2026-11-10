// Pruebas de la administración de combos: crear, editar, deshabilitar y eliminar.
//   npm run db:init && npm run test:combos-admin      (requiere SEED_PASSWORD en .env; no necesita el servidor encendido)
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
  const clientes = [], combosCreados = [];
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  mail.reemplazar({ nombre: 'prueba', async enviar() {} });
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), cocina = await login('cocina@encombo.test'), almacen = await login('almacen@encombo.test');
    const r0 = await call('POST', '/api/auth/register', { nombre: 'Cliente CRUD', correo: `crud${R}@prueba.test`, password: 'secreta123' });
    clientes.push(r0.j.usuario.id); const cli = r0.j.token;
    const cat0 = (await call('GET', '/api/catalogo')).j;
    const P = (n) => cat0.productos.find((p) => p.nombre === n);
    const nombre = `Combo Prueba ${R}`.slice(0, 40);
    const base = 20 + Math.floor(Math.random() * 60); let k = 0;
    const dia = () => svc.addDays(svc.todayMX(), base + (k++));
    const DIR = { cp: '91190', colonia: 'Las Flores', calle: 'Calle CRUD', num_ext: '1' };
    const it = (lista) => lista.map(([n, c]) => ({ producto_id: P(n).id, cantidad: c }));
    const ped = (combo, lista) => call('POST', '/api/pedidos/cotizar', { combo, items: it(lista), fecha: dia(), hora: '12:00' }, cli);

    t('permisos: sin sesión 401; cliente, cocina y almacén 403', (await call('GET', '/api/admin/combos')).s === 401 && (await call('GET', '/api/admin/combos', undefined, cli)).s === 403 && (await call('POST', '/api/admin/combos', {}, cocina)).s === 403 && (await call('DELETE', '/api/admin/combos/1', undefined, almacen)).s === 403);
    const l0 = (await call('GET', '/api/admin/combos', undefined, admin)).j.combos;
    t('listado: trae los 4 combos de ejemplo con contenido, precio y estado', l0.length >= 4 && l0.every((c) => Array.isArray(c.items) && typeof c.precio === 'number' && typeof c.activo === 'boolean'));

    // Validaciones
    const malos = [
      [{ nombre: 'ab', items: [{ producto_id: P('Galleta').id, cantidad: 1 }] }, 'nombre muy corto'],
      [{ nombre: 'Combo personalizado', items: it([['Galleta', 1]]) }, 'nombre reservado'],
      [{ nombre, items: [] }, 'sin productos'],
      [{ nombre, items: it([['Galleta', 0]]) }, 'cantidad 0'],
      [{ nombre, items: it([['Galleta', 51]]) }, 'cantidad 51'],
      [{ nombre, items: it([['Galleta', 1], ['Galleta', 2]]) }, 'producto repetido'],
      [{ nombre, items: [{ producto_id: 99999999, cantidad: 1 }] }, 'producto inexistente'],
      [{ nombre, descripcion: 'x'.repeat(121), items: it([['Galleta', 1]]) }, 'descripción larga'],
      [{ nombre: 'Combo Mini', items: it([['Galleta', 1]]) }, 'nombre repetido'],
    ];
    for (const [b, d] of malos) { const r = await call('POST', '/api/admin/combos', b, admin); t(`crear inválido (${d}) → 4xx`, r.s === 400 || r.s === 409, r.s + ' ' + JSON.stringify(r.j)); }

    // Crear
    let r = await call('POST', '/api/admin/combos', { nombre, descripcion: 'Para la prueba', items: it([['Galleta', 2], ['Brownie', 1]]) }, admin);
    t('crear combo → 201 con id', r.s === 201 && r.j.id > 0, JSON.stringify(r.j));
    const id = r.j.id; combosCreados.push(id);
    const mio = async () => (await call('GET', '/api/admin/combos', undefined, admin)).j.combos.find((c) => c.id === id);
    let c = await mio();
    t('el combo nuevo queda activo, con precio = suma de sus productos', c && c.activo && Math.abs(c.precio - (2 * Number(P('Galleta').precio) + Number(P('Brownie').precio))) < 0.005 && c.disponible);
    t('crear: nombre repetido (sin importar mayúsculas) → 409', (await call('POST', '/api/admin/combos', { nombre: nombre.toUpperCase(), items: it([['Galleta', 1]]) }, admin)).s === 409);
    let cat = (await call('GET', '/api/catalogo')).j;
    t('el cliente ve el combo nuevo en el catálogo', cat.combos.some((x) => x.clave === c.clave));
    r = await ped(c.clave, [['Galleta', 2], ['Brownie', 1]]);
    t('el cliente puede pedir el combo nuevo y 2 combos (múltiplo)', r.j.ok && (await ped(c.clave, [['Galleta', 4], ['Brownie', 2]])).j.ok);
    t('el combo nuevo rechaza cantidades que no son múltiplo', !(await ped(c.clave, [['Galleta', 3], ['Brownie', 1]])).j.ok);

    // Pedido real para probar el historial
    const ck = await call('POST', '/api/pedidos/checkout', { combo: c.clave, items: it([['Galleta', 2], ['Brownie', 1]]), fecha: dia(), hora: '13:00', direccion: DIR }, cli);
    const ap = await call('POST', `/api/pagos/simulado/${ck.j.checkout_id}/aprobar`, undefined, cli);
    const pid = ap.j.pedido_id;
    t('pedido real con el combo nuevo guarda clave y nombre', pid > 0 && (await q('SELECT combo,combo_nombre FROM pedidos WHERE id=$1', [pid]))[0].combo_nombre === nombre);

    // Editar
    const nombre2 = `Combo Editado ${R}`.slice(0, 40);
    r = await call('PUT', `/api/admin/combos/${id}`, { nombre: nombre2, descripcion: 'Editado', items: it([['Cupcake', 1], ['Café latte', 3]]) }, admin);
    c = await mio();
    t('editar: cambia nombre, descripción, productos y cantidades', r.s === 200 && c.nombre === nombre2 && c.descripcion === 'Editado' && c.items.length === 2 && c.items.some((x) => x.nombre === 'Café latte' && x.cantidad === 3) && !c.items.some((x) => x.nombre === 'Galleta'));
    t('editar: la clave no cambia y el precio se recalcula', Math.abs(c.precio - (Number(P('Cupcake').precio) + 3 * Number(P('Café latte').precio))) < 0.005);
    t('editar: puede conservar su propio nombre', (await call('PUT', `/api/admin/combos/${id}`, { nombre: nombre2, items: it([['Cupcake', 1], ['Café latte', 3]]) }, admin)).s === 200);
    t('editar: no puede tomar el nombre de otro combo → 409', (await call('PUT', `/api/admin/combos/${id}`, { nombre: 'Combo Clásico', items: it([['Cupcake', 1]]) }, admin)).s === 409);
    t('editar: inválido no cambia nada', (await call('PUT', `/api/admin/combos/${id}`, { nombre: nombre2, items: [] }, admin)).s === 400 && (await mio()).items.length === 2);
    t('editar: combo inexistente → 404; id inválido → 400', (await call('PUT', '/api/admin/combos/99999999', { nombre, items: it([['Galleta', 1]]) }, admin)).s === 404 && (await call('PUT', '/api/admin/combos/abc', {}, admin)).s === 400);
    t('el pedido anterior conserva el nombre con el que se compró', (await q('SELECT combo_nombre FROM pedidos WHERE id=$1', [pid]))[0].combo_nombre === nombre);
    t('con la nueva receta, la anterior ya no es válida y la nueva sí', !(await ped(c.clave, [['Galleta', 2], ['Brownie', 1]])).j.ok && (await ped(c.clave, [['Cupcake', 1], ['Café latte', 3]])).j.ok);

    // Deshabilitar
    r = await call('PATCH', `/api/admin/combos/${id}/activo`, { activo: false }, admin);
    t('deshabilitar → 200 y queda inactivo', r.s === 200 && (await mio()).activo === false);
    cat = (await call('GET', '/api/catalogo')).j;
    t('deshabilitado: el cliente ya no lo ve', !cat.combos.some((x) => x.clave === c.clave));
    t('deshabilitado: el servidor rechaza pedirlo (combo_invalido)', (await ped(c.clave, [['Cupcake', 1], ['Café latte', 3]])).j.errores?.some((e) => e.codigo === 'combo_invalido'));
    t('deshabilitado: el administrador lo sigue viendo en su lista', !!(await mio()));
    t('deshabilitar: valor no booleano → 400; inexistente → 404', (await call('PATCH', `/api/admin/combos/${id}/activo`, { activo: 'no' }, admin)).s === 400 && (await call('PATCH', '/api/admin/combos/99999999/activo', { activo: true }, admin)).s === 404);
    await call('PATCH', `/api/admin/combos/${id}/activo`, { activo: true }, admin);
    t('habilitar de nuevo: vuelve al catálogo', (await call('GET', '/api/catalogo')).j.combos.some((x) => x.clave === c.clave));

    // Producto dentro de un combo
    r = await call('DELETE', `/api/admin/productos/${P('Cupcake').id}`, undefined, admin);
    t('no se puede eliminar un producto que está en un combo → 409', r.s === 409 && /combo/i.test(r.j.error || ''), JSON.stringify(r));
    // Producto desactivado → combo no disponible
    const act = (await q('SELECT activo FROM productos WHERE id=$1', [P('Café latte').id]))[0].activo;
    await call('PATCH', `/api/admin/productos/${P('Café latte').id}/activo`, { activo: false }, admin);
    t('si un producto del combo se desactiva, el combo deja de ofrecerse', !(await call('GET', '/api/catalogo')).j.combos.some((x) => x.clave === c.clave) && (await mio()).disponible === false);
    await call('PATCH', `/api/admin/productos/${P('Café latte').id}/activo`, { activo: act }, admin);

    // Eliminar
    r = await call('DELETE', `/api/admin/combos/${id}`, undefined, admin);
    t('eliminar → 200 y desaparece de la lista y del catálogo', r.s === 200 && !(await mio()) && !(await call('GET', '/api/catalogo')).j.combos.some((x) => x.clave === c.clave));
    t('eliminar de nuevo → 404', (await call('DELETE', `/api/admin/combos/${id}`, undefined, admin)).s === 404);
    t('eliminado: el pedido histórico conserva su nombre y su clave', (await q('SELECT combo,combo_nombre FROM pedidos WHERE id=$1', [pid]))[0].combo_nombre === nombre);
    const hoy = svc.todayMX();
    const rep = (await call('GET', `/api/reportes/ventas?desde=${hoy}&hasta=${svc.addDays(hoy, 200)}&agrupar=mes`, undefined, admin)).j;
    t('Reportes marca el combo eliminado y sus ventas siguen contadas', rep.combos.some((x) => /\(eliminado\)/.test(x.nombre) && x.pedidos >= 1));
    t('Reportes lista los combos vigentes aunque no tengan ventas', ['Combo Mini', 'Combo Clásico', 'Combo Grande', 'Combo Pareja', 'Combo personalizado'].every((n) => rep.combos.some((x) => x.nombre === n)));
    r = await call('GET', '/api/pedidos', undefined, cli);
    t('Mis pedidos sigue mostrando el combo eliminado', r.j.pedidos.some((p) => p.id === pid && p.combo && p.combo.nombre === nombre), JSON.stringify(r.j).slice(0, 200));

    // Siembra única
    const antes = (await q('SELECT count(*)::int AS n FROM combos'))[0].n;
    const sem = await require('../src/services/combos').sembrar(db);
    t('los combos de ejemplo no reaparecen (se siembran una sola vez)', sem === 0 && (await q('SELECT count(*)::int AS n FROM combos'))[0].n === antes);
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
      await db.query('DELETE FROM combos WHERE id = ANY($1)', [combosCreados]);
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      for (const i of insumos0) await db.query('UPDATE insumos SET stock=$2,stock_minimo=$3,costo_unitario=$4,activo=$5 WHERE id=$1', [i.id, i.stock, i.stock_minimo, i.costo_unitario, i.activo]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    server.close();
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    await db.pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
