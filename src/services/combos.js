const COMBOS = [
  { clave: 'pequeno', nombre: 'Combo Pequeño', descripcion: 'Para una persona: una galleta y un café americano.', items: [{ nombre: 'Galleta', cantidad: 1 }, { nombre: 'Café americano', cantidad: 1 }] },
  { clave: 'mediano', nombre: 'Combo Mediano', descripcion: 'Para dos: cupcake, brownie y un café latte.', items: [{ nombre: 'Cupcake', cantidad: 1 }, { nombre: 'Brownie', cantidad: 1 }, { nombre: 'Café latte', cantidad: 1 }] },
  { clave: 'grande', nombre: 'Combo Grande', descripcion: 'Para compartir: 2 cupcakes, 2 brownies, 2 galletas y 2 cafés latte.', items: [{ nombre: 'Cupcake', cantidad: 2 }, { nombre: 'Brownie', cantidad: 2 }, { nombre: 'Galleta', cantidad: 2 }, { nombre: 'Café latte', cantidad: 2 }] },
  { clave: 'pareja', nombre: 'Combo Pareja', descripcion: 'Dos bebidas y dos postres: café latte, té chai, cupcake y brownie.', items: [{ nombre: 'Café latte', cantidad: 1 }, { nombre: 'Té chai', cantidad: 1 }, { nombre: 'Cupcake', cantidad: 1 }, { nombre: 'Brownie', cantidad: 1 }] },
];
const PERSONALIZADO = { clave: 'personalizado', nombre: 'Combo personalizado', descripcion: 'Tú eliges los productos y las cantidades.', items: [] };
const TODOS = [...COMBOS, PERSONALIZADO];
const porClave = (k) => TODOS.find((c) => c.clave === k) || null;

function vigentes(productos) {
  const por = new Map(productos.map((p) => [p.nombre, p]));
  return COMBOS.filter((c) => c.items.every((i) => por.has(i.nombre))).map((c) => {
    const items = c.items.map((i) => ({ id: por.get(i.nombre).id, nombre: i.nombre, cantidad: i.cantidad, precio: Number(por.get(i.nombre).precio) }));
    return { clave: c.clave, nombre: c.nombre, descripcion: c.descripcion, items, precio: items.reduce((a, x) => a + Math.round(x.precio * 100) * x.cantidad, 0) / 100 };
  });
}

// Devuelve cuántos combos completos forman los productos pedidos (k >= 1) o 0 si no corresponden al combo.
function multiplo(combo, porNombre) {
  if (!combo.items.length || porNombre.size !== combo.items.length) return 0;
  let k = 0;
  for (const i of combo.items) {
    const c = porNombre.get(i.nombre);
    if (!c || c % i.cantidad !== 0) return 0;
    const m = c / i.cantidad;
    if (k && m !== k) return 0;
    k = m;
  }
  return k;
}

module.exports = { COMBOS, PERSONALIZADO, TODOS, porClave, vigentes, multiplo };
