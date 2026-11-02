const router = require('express').Router();
const db = require('../db');
const { wrap } = require('../util');

// Público: lo que ve el cliente en el catálogo
router.get('/', wrap(async (req, res) => {
  const [productos, presentaciones] = await Promise.all([
    db.query('SELECT id,nombre,descripcion,precio FROM productos WHERE activo ORDER BY nombre'),
    db.query('SELECT id,nombre,precio FROM presentaciones WHERE activo ORDER BY precio'),
  ]);
  res.json({ productos: productos.rows, presentaciones: presentaciones.rows });
}));

module.exports = router;
