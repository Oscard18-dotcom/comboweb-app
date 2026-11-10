// Combos del catálogo. Los prearmados se guardan en la base (el administrador los crea, edita, deshabilita o elimina);
// "Combo personalizado" es fijo: el cliente elige los productos.
const db = require('../db');

const PERSONALIZADO = { clave: 'personalizado', nombre: 'Combo personalizado', descripcion: 'Tú eliges los productos y las cantidades.', items: [] };

// Combos de ejemplo que se cargan una sola vez en una base nueva (o que ya tenía productos).
const INICIALES = [
  { clave: 'pequeno', nombre: 'Combo Pequeño', descripcion: 'Para una persona: una galleta y un café americano.', items: [['Galleta', 1], ['Café americano', 1]] },
  { clave: 'mediano', nombre: 'Combo Mediano', descripcion: 'Para dos: cupcake, brownie y un café latte.', items: [['Cupcake', 1], ['Brownie', 1], ['Café latte', 1]] },
  { clave: 'grande', nombre: 'Combo Grande', descripcion: 'Para compartir: 2 cupcakes, 2 brownies, 2 galletas y 2 cafés latte.', items: [['Cupcake', 2], ['Brownie', 2], ['Galleta', 2], ['Café latte', 2]] },
  { clave: 'pareja', nombre: 'Combo Pareja', descripcion: 'Dos bebidas y dos postres: café latte, té chai, cupcake y brownie.', items: [['Café latte', 1], ['Té chai', 1], ['Cupcake', 1], ['Brownie', 1]] },
];

const cents = (n) => Math.round(Number(n) * 100);

async function listar(q = db) {
  const { rows } = await q.query(
    `SELECT c.id, c.clave, c.nombre, c.descripcion, c.activo,
            (SELECT count(*)::int FROM pedidos p WHERE p.combo = c.clave) AS pedidos,
            COALESCE((SELECT json_agg(json_build_object('id', pr.id, 'nombre', pr.nombre, 'cantidad', ci.cantidad, 'precio', pr.precio, 'activo', pr.activo) ORDER BY pr.nombre)
                        FROM combo_items ci JOIN productos pr ON pr.id = ci.producto_id WHERE ci.combo_id = c.id), '[]') AS items
       FROM combos c ORDER BY c.id`);
  return rows.map((c) => {
    const items = c.items.map((i) => ({ ...i, precio: Number(i.precio) }));
    return { ...c, items, precio: items.reduce((a, i) => a + cents(i.precio) * i.cantidad, 0) / 100,
      disponible: c.activo && items.length > 0 && items.every((i) => i.activo) };
  });
}

// Lo que ve el cliente: combos activos cuyos productos están todos activos.
async function vigentes(q = db) {
  return (await listar(q)).filter((c) => c.disponible).map((c) => ({
    clave: c.clave, nombre: c.nombre, descripcion: c.descripcion || '', precio: c.precio,
    items: c.items.map((i) => ({ id: i.id, nombre: i.nombre, cantidad: i.cantidad, precio: i.precio })) }));
}

async function porClave(q, clave) {
  if (clave === PERSONALIZADO.clave) return { ...PERSONALIZADO, activo: true };
  const c = (await listar(q)).find((x) => x.clave === clave);
  return c || null;
}

// ¿Los productos pedidos (id → cantidad) son exactamente k combos completos? Devuelve k (≥ 1) o 0.
function multiplo(combo, porId) {
  if (!combo.items.length || porId.size !== combo.items.length) return 0;
  let k = 0;
  for (const i of combo.items) {
    const c = porId.get(i.id);
    if (!c || c % i.cantidad !== 0) return 0;
    const m = c / i.cantidad;
    if (k && m !== k) return 0;
    k = m;
  }
  return k;
}

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'combo';

// Valida lo que envía el administrador al crear o editar. Devuelve { error } o { datos }.
async function validarEntrada(q, body, idActual = null) {
  const b = body || {};
  const nombre = typeof b.nombre === 'string' ? b.nombre.trim().replace(/\s+/g, ' ') : '';
  if (nombre.length < 3 || nombre.length > 40) return { error: 'El nombre del combo debe tener entre 3 y 40 caracteres.' };
  if (nombre.toLowerCase() === PERSONALIZADO.nombre.toLowerCase()) return { error: 'Ese nombre está reservado para el combo personalizado.' };
  let descripcion = null;
  if (b.descripcion != null && b.descripcion !== '') {
    if (typeof b.descripcion !== 'string' || b.descripcion.trim().length > 120) return { error: 'La descripción no puede pasar de 120 caracteres.' };
    descripcion = b.descripcion.trim() || null;
  }
  if (!Array.isArray(b.items) || b.items.length === 0) return { error: 'Agrega al menos un producto al combo.' };
  if (b.items.length > 10) return { error: 'Un combo puede tener como máximo 10 productos distintos.' };
  const items = new Map();
  for (const it of b.items) {
    const id = Number(it && it.producto_id), n = Number(it && it.cantidad);
    if (!Number.isInteger(id) || id <= 0) return { error: 'Elige un producto válido en cada renglón.' };
    if (!Number.isInteger(n) || n < 1 || n > 50) return { error: 'Cada cantidad debe ser un número entero de 1 a 50.' };
    if (items.has(id)) return { error: 'No repitas un producto dentro del mismo combo: sube su cantidad.' };
    items.set(id, n);
  }
  const prods = (await q.query('SELECT id,nombre FROM productos WHERE id = ANY($1)', [[...items.keys()]])).rows;
  if (prods.length !== items.size) return { error: 'Alguno de los productos ya no existe.' };
  const dup = (await q.query('SELECT 1 FROM combos WHERE lower(nombre)=lower($1) AND id IS DISTINCT FROM $2', [nombre, idActual])).rows[0];
  if (dup) return { error: 'Ya existe un combo con ese nombre.' };
  return { datos: { nombre, descripcion, items: [...items.entries()] } };
}

async function claveNueva(q, nombre) {
  const base = slug(nombre);
  let clave = base, n = 1;
  while (clave === PERSONALIZADO.clave || (await q.query('SELECT 1 FROM combos WHERE clave=$1', [clave])).rows[0]) clave = `${base}-${++n}`;
  return clave;
}

async function crear(q, datos) {
  const clave = await claveNueva(q, datos.nombre);
  const { rows: [c] } = await q.query('INSERT INTO combos(clave,nombre,descripcion) VALUES($1,$2,$3) RETURNING id', [clave, datos.nombre, datos.descripcion]);
  for (const [pid, cant] of datos.items) await q.query('INSERT INTO combo_items(combo_id,producto_id,cantidad) VALUES($1,$2,$3)', [c.id, pid, cant]);
  return c.id;
}

async function reemplazar(q, id, datos) {
  await q.query('UPDATE combos SET nombre=$2, descripcion=$3 WHERE id=$1', [id, datos.nombre, datos.descripcion]);
  await q.query('DELETE FROM combo_items WHERE combo_id=$1', [id]);
  for (const [pid, cant] of datos.items) await q.query('INSERT INTO combo_items(combo_id,producto_id,cantidad) VALUES($1,$2,$3)', [id, pid, cant]);
}

// Carga los combos de ejemplo una sola vez (queda marcado en "ajustes": lo que el administrador borre no reaparece).
async function sembrar(q = db) {
  if ((await q.query("SELECT 1 FROM ajustes WHERE clave='combos_sembrados'")).rows[0]) return 0;
  const productos = new Map((await q.query('SELECT id,nombre FROM productos')).rows.map((p) => [p.nombre, p.id]));
  if (!productos.size) return 0;
  let n = 0;
  for (const c of INICIALES) {
    if (!c.items.every(([nombre]) => productos.has(nombre))) continue;
    if ((await q.query('SELECT 1 FROM combos WHERE clave=$1 OR lower(nombre)=lower($2)', [c.clave, c.nombre])).rows[0]) continue;
    const { rows: [x] } = await q.query('INSERT INTO combos(clave,nombre,descripcion) VALUES($1,$2,$3) RETURNING id', [c.clave, c.nombre, c.descripcion]);
    for (const [nombre, cant] of c.items) await q.query('INSERT INTO combo_items(combo_id,producto_id,cantidad) VALUES($1,$2,$3)', [x.id, productos.get(nombre), cant]);
    n++;
  }
  await q.query("INSERT INTO ajustes(clave,valor) VALUES('combos_sembrados','1') ON CONFLICT DO NOTHING");
  return n;
}

module.exports = { PERSONALIZADO, INICIALES, listar, vigentes, porClave, multiplo, validarEntrada, crear, reemplazar, sembrar };
