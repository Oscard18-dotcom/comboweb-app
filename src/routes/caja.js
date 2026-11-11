// Corte de caja (solo administrador), en dos pasos: 1) ABRIR el día con el fondo inicial; 2) CERRAR con la cantidad final.
const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, paramId } = require('../util');
const svc = require('../services/pedidos');

router.use(auth, roles('admin'));

const TZ = "'America/Mexico_City'";
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const folio = (id) => `CC-${String(id).padStart(4, '0')}`;

// Fecha AAAA-MM-DD válida, no futura (por defecto hoy)
function dia(valor, res) {
  const hoy = svc.todayMX(), f = valor || hoy;
  if (typeof f !== 'string' || !svc.fechaValida(f)) { res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD.' }); return null; }
  if (f > hoy) { res.status(400).json({ error: 'No se puede abrir ni cerrar la caja de un día futuro.' }); return null; }
  return f;
}

// Pagos aprobados de ese día, agrupados por método (marca de la tarjeta)
async function calcular(q, fecha) {
  const { rows } = await q.query(
    `SELECT CASE WHEN g.tarjeta IS NOT NULL THEN split_part(g.tarjeta, ' ••••', 1)
                 WHEN g.proveedor = 'stripe' THEN 'Tarjeta (Stripe)' ELSE 'Tarjeta' END AS metodo,
            count(*)::int AS pedidos, coalesce(sum(g.monto), 0) AS monto
       FROM pagos g WHERE g.estado = 'aprobado' AND (g.creado_en AT TIME ZONE ${TZ})::date = $1
      GROUP BY 1 ORDER BY 3 DESC, 1`, [fecha]);
  const desglose = rows.map((x) => ({ metodo: x.metodo, pedidos: x.pedidos, monto: r2(x.monto) }));
  return { pedidos: desglose.reduce((a, x) => a + x.pedidos, 0), ventas: r2(desglose.reduce((a, x) => a + x.monto, 0)), desglose };
}

// Importe en pesos: número con hasta 2 decimales y no negativo (null si viene vacío, NaN si es inválido)
const dinero = (v) => (v === '' || v == null ? null : (typeof v === 'number' || typeof v === 'string') && /^\d{1,8}(\.\d{1,2})?$/.test(String(v).trim()) ? Number(v) : NaN);
const num = (v) => (v == null ? null : Number(v));
const fila = (x) => ({ id: x.id, folio: folio(x.id), estado: x.estado, fecha: x.desde, desde: x.desde, hasta: x.hasta, fondo_inicial: Number(x.fondo_inicial), ventas: num(x.ventas), pedidos: x.pedidos, desglose: x.desglose,
  saldo_final: num(x.saldo_final), contado: num(x.contado), diferencia: num(x.diferencia), notas: x.notas, abierto_en: x.creado_en, cerrado_en: x.cerrado_en, abrio: x.abrio || null, hecho_por: x.hecho_por || null });
const COLS = `c.id, c.estado, c.desde::text AS desde, c.hasta::text AS hasta, c.fondo_inicial, c.ventas, c.pedidos, c.desglose, c.saldo_final, c.contado, c.diferencia, c.notas, c.creado_en, c.cerrado_en, ua.nombre AS abrio, u.nombre AS hecho_por`;
const FROM = 'FROM cortes_caja c LEFT JOIN usuarios u ON u.id = c.usuario_id LEFT JOIN usuarios ua ON ua.id = c.abierto_por';
const notasOk = (n) => n == null || (typeof n === 'string' && n.length <= 200);

// Estado de un día: el corte de ese día (si ya se abrió) y las ventas que lleva hasta ahora
router.get('/dia', wrap(async (req, res) => {
  const f = dia(req.query.fecha, res); if (!f) return;
  const { rows } = await db.query(`SELECT ${COLS} ${FROM} WHERE c.desde = $1 AND c.hasta = $1 ORDER BY c.id DESC LIMIT 1`, [f]);
  res.json({ fecha: f, corte: rows[0] ? fila(rows[0]) : null, resumen: await calcular(db, f) });
}));

// Paso 1: ABRIR la caja del día con el dinero con el que se inicia (queda guardado)
router.post('/abrir', wrap(async (req, res) => {
  const b = req.body || {};
  const f = dia(b.fecha, res); if (!f) return;
  const fondo = dinero(b.fondo_inicial);
  if (fondo == null || Number.isNaN(fondo)) return res.status(400).json({ error: 'Escribe con cuánto dinero abres (0 o más, con máximo 2 decimales).' });
  if (!notasOk(b.notas)) return res.status(400).json({ error: 'Las notas no pueden pasar de 200 caracteres.' });
  const ya = (await db.query('SELECT id, estado FROM cortes_caja WHERE desde = $1 AND hasta = $1 LIMIT 1', [f])).rows[0];
  if (ya) return res.status(409).json({ error: ya.estado === 'abierto' ? 'La caja de ese día ya está abierta.' : 'La caja de ese día ya fue cerrada.' });
  try {
    const { rows: [n] } = await db.query(
      `INSERT INTO cortes_caja(desde,hasta,fondo_inicial,estado,notas,abierto_por) VALUES($1,$1,$2,'abierto',$3,$4) RETURNING id`, [f, fondo, b.notas ? b.notas.trim() : null, req.user.id]);
    const { rows } = await db.query(`SELECT ${COLS} ${FROM} WHERE c.id=$1`, [n.id]);
    res.status(201).json({ corte: fila(rows[0]) });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'La caja de ese día ya está abierta.' }); throw e; }
}));

// Paso 2: CERRAR con la cantidad final. Las ventas y el saldo esperado los calcula el servidor en este momento.
router.post('/:id/cerrar', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const b = req.body || {};
  const contado = dinero(b.contado);
  if (contado == null || Number.isNaN(contado)) return res.status(400).json({ error: 'Escribe la cantidad final con la que cierras (0 o más, con máximo 2 decimales).' });
  if (!notasOk(b.notas)) return res.status(400).json({ error: 'Las notas no pueden pasar de 200 caracteres.' });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const cur = (await c.query('SELECT id, estado, desde::text AS desde, fondo_inicial FROM cortes_caja WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!cur) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Corte no encontrado.' }); }
    if (cur.estado !== 'abierto') { await c.query('ROLLBACK'); return res.status(409).json({ error: 'Esta caja ya fue cerrada.' }); }
    const r = await calcular(c, cur.desde);
    const saldo = r2(Number(cur.fondo_inicial) + r.ventas), dif = r2(contado - saldo);
    await c.query(
      `UPDATE cortes_caja SET estado='cerrado', ventas=$2, pedidos=$3, desglose=$4, saldo_final=$5, contado=$6, diferencia=$7, notas=coalesce($8, notas), usuario_id=$9, cerrado_en=now() WHERE id=$1`,
      [id, r.ventas, r.pedidos, JSON.stringify(r.desglose), saldo, contado, dif, b.notas ? b.notas.trim() : null, req.user.id]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  const { rows } = await db.query(`SELECT ${COLS} ${FROM} WHERE c.id=$1`, [id]);
  res.json({ corte: fila(rows[0]) });
}));

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT ${COLS} ${FROM} ORDER BY c.desde DESC, c.id DESC LIMIT 60`);
  res.json({ cortes: rows.map(fila) });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const { rows } = await db.query(`SELECT ${COLS} ${FROM} WHERE c.id=$1`, [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Corte no encontrado.' });
  res.json({ corte: fila(rows[0]) });
}));

module.exports = router;
