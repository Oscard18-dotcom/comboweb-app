// Endpoints de la pasarela SIMULADA (solo desarrollo; responden 404 si no está activa o en producción)
const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap } = require('../util');
const svc = require('../services/pedidos');
const pagos = require('../payments');
const tarjeta = require('../services/tarjeta');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.use((req, res, next) => (pagos.simuladoPermitido() ? next() : res.status(404).json({ error: 'Ruta no encontrada.' })), auth, roles('cliente'));

async function propio(req, res) {
  if (!UUID.test(req.params.id)) { res.status(400).json({ error: 'Identificador inválido.' }); return null; }
  const { rows } = await db.query('SELECT id,total FROM checkouts WHERE id=$1 AND cliente_id=$2 AND proveedor=$3', [req.params.id, req.user.id, 'simulado']);
  if (!rows[0]) { res.status(404).json({ error: 'Pago no encontrado.' }); return null; }
  return rows[0];
}
// Pago con tarjeta SIMULADA: pide los datos, los valida y decide. El número y el CVV no se guardan: solo "Visa •••• 4242".
router.post('/simulado/:id/aprobar', wrap(async (req, res) => {
  const ck = await propio(req, res); if (!ck) return;
  const estado = (await db.query('SELECT estado FROM checkouts WHERE id=$1', [ck.id])).rows[0].estado;
  if (estado !== 'creado') return res.json(await svc.confirmarPago(ck.id, { proveedor: 'simulado', referencia: 'sim_' + ck.id, monto: ck.total }));
  const v = tarjeta.validar((req.body || {}).tarjeta, svc.todayMX());
  if (v.errores) return res.status(400).json({ error: 'Revisa los datos de la tarjeta.', campos: v.errores });
  if (v.rechazo) return res.status(402).json({ error: v.rechazo, estado: 'declinado' });
  res.json(await svc.confirmarPago(ck.id, { proveedor: 'simulado', referencia: 'sim_' + ck.id, monto: ck.total, tarjeta: `${v.marca} •••• ${v.ultimos4}` }));
}));
router.post('/simulado/:id/rechazar', wrap(async (req, res) => {
  const ck = await propio(req, res); if (!ck) return;
  await db.query("UPDATE checkouts SET estado='rechazado' WHERE id=$1 AND estado='creado'", [ck.id]);
  res.json({ estado: 'rechazado' });
}));

module.exports = router;
