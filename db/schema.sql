-- ComboWeb App · Esquema PostgreSQL (Sprint 2)
CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  nombre        VARCHAR(80)  NOT NULL,
  correo        VARCHAR(120) NOT NULL,
  telefono      VARCHAR(20),
  password_hash TEXT         NOT NULL,
  rol           TEXT         NOT NULL DEFAULT 'cliente' CHECK (rol IN ('cliente','cocina','almacen','admin')),
  activo        BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_uq ON usuarios (lower(correo));

CREATE TABLE IF NOT EXISTS insumos (
  id             SERIAL PRIMARY KEY,
  nombre         VARCHAR(80) NOT NULL UNIQUE,
  unidad         VARCHAR(10) NOT NULL,
  stock          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_minimo   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  costo_unitario NUMERIC(10,4) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  activo         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS productos (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(80) NOT NULL UNIQUE,
  descripcion VARCHAR(300),
  precio      NUMERIC(10,2) NOT NULL CHECK (precio > 0),
  activo      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS presentaciones (
  id        SERIAL PRIMARY KEY,
  nombre    VARCHAR(60) NOT NULL UNIQUE,
  precio    NUMERIC(10,2) NOT NULL CHECK (precio >= 0),
  insumo_id INTEGER NOT NULL REFERENCES insumos(id),  -- la caja que se descuenta del inventario
  activo    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS recetas (
  id          SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL UNIQUE REFERENCES productos(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS receta_ingredientes (
  receta_id INTEGER NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
  insumo_id INTEGER NOT NULL REFERENCES insumos(id),
  cantidad  NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (receta_id, insumo_id)
);

-- Tablas que se usan desde el Sprint 3 en adelante (se crean ahora para tener el modelo completo)
CREATE TABLE IF NOT EXISTS pedidos (
  id              SERIAL PRIMARY KEY,
  cliente_id      INTEGER NOT NULL REFERENCES usuarios(id),
  presentacion_id INTEGER REFERENCES presentaciones(id),
  combo           VARCHAR(20),
  fecha_entrega   DATE NOT NULL,
  hora_entrega    TIME NOT NULL,
  dedicatoria     VARCHAR(120),
  total           NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  estatus         TEXT NOT NULL DEFAULT 'Pendiente'
                  CHECK (estatus IN ('Pendiente','En preparación','Listo para entrega','Entregado')),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE pedidos ALTER COLUMN presentacion_id DROP NOT NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS combo VARCHAR(20);
CREATE INDEX IF NOT EXISTS pedidos_entrega_idx ON pedidos (fecha_entrega, hora_entrega);
CREATE INDEX IF NOT EXISTS pedidos_estatus_idx ON pedidos (estatus);

CREATE TABLE IF NOT EXISTS pedido_items (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id     INTEGER NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(10,2) NOT NULL CHECK (precio_unitario > 0)
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id         SERIAL PRIMARY KEY,
  insumo_id  INTEGER NOT NULL REFERENCES insumos(id),
  tipo       TEXT NOT NULL CHECK (tipo IN ('entrada','salida','ajuste')),
  cantidad   NUMERIC(12,2) NOT NULL,
  pedido_id  INTEGER REFERENCES pedidos(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pagos (
  id         SERIAL PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos(id),
  proveedor  VARCHAR(30) NOT NULL,
  referencia VARCHAR(120),
  monto      NUMERIC(10,2) NOT NULL CHECK (monto > 0),
  estado     TEXT NOT NULL CHECK (estado IN ('aprobado','rechazado','pendiente')),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Sprint 3: pago =====
-- Un "checkout" es el intento de compra: guarda el combo y el monto mientras el cliente paga.
-- El pedido real solo se crea cuando el pago se confirma (así no existen pedidos sin pagar).
CREATE TABLE IF NOT EXISTS checkouts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id INTEGER NOT NULL REFERENCES usuarios(id),
  payload    JSONB NOT NULL,
  total      NUMERIC(10,2) NOT NULL CHECK (total > 0),
  estado     TEXT NOT NULL DEFAULT 'creado' CHECK (estado IN ('creado','pagado','rechazado','expirado','revision')),
  proveedor  VARCHAR(30) NOT NULL,
  referencia VARCHAR(120),
  pedido_id  INTEGER REFERENCES pedidos(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS checkouts_cliente_idx ON checkouts (cliente_id);
-- Evita registrar dos veces el mismo cobro (los webhooks pueden repetirse)
CREATE UNIQUE INDEX IF NOT EXISTS pagos_ref_uq ON pagos (proveedor, referencia);

-- ===== Sprint 4: inventario y recetas =====
-- "rinde": cuántas piezas salen de la receta. Las cantidades de la receta son para TODO el lote;
-- el consumo por pieza vendida es cantidad / rinde. (Las recetas del Sprint 3 quedan con rinde 1.)
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS rinde INTEGER NOT NULL DEFAULT 1 CHECK (rinde > 0 AND rinde <= 1000);
-- Más decimales para que recetas fraccionadas (p. ej. 100 g / 7 piezas) no acumulen error
ALTER TABLE insumos ALTER COLUMN stock TYPE NUMERIC(14,4);
ALTER TABLE insumos ALTER COLUMN stock_minimo TYPE NUMERIC(14,4);
ALTER TABLE movimientos_inventario ALTER COLUMN cantidad TYPE NUMERIC(14,4);
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS nota VARCHAR(200);
CREATE INDEX IF NOT EXISTS movimientos_insumo_idx ON movimientos_inventario (insumo_id, creado_en DESC);

-- ===== Sprint 5: seguimiento, cocina y notificaciones =====
-- Cada cambio de estatus queda registrado con fecha, hora y quién lo hizo (HU06)
CREATE TABLE IF NOT EXISTS pedido_estatus_historial (
  id         SERIAL PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  estatus    TEXT NOT NULL CHECK (estatus IN ('Pendiente','En preparación','Listo para entrega','Entregado')),
  usuario_id INTEGER REFERENCES usuarios(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, estatus)
);
INSERT INTO pedido_estatus_historial (pedido_id, estatus, creado_en)
  SELECT p.id, 'Pendiente', p.creado_en FROM pedidos p
  WHERE NOT EXISTS (SELECT 1 FROM pedido_estatus_historial h WHERE h.pedido_id = p.id AND h.estatus = 'Pendiente');

-- Bandeja de salida de correos: se escribe en la MISMA transacción que el cambio de estatus,
-- así nunca se pierde un aviso ni se manda dos veces (UNIQUE pedido + plantilla).
CREATE TABLE IF NOT EXISTS notificaciones (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  cliente_id      INTEGER NOT NULL REFERENCES usuarios(id),
  canal           TEXT NOT NULL DEFAULT 'correo',
  plantilla       TEXT NOT NULL,
  destinatario    VARCHAR(120) NOT NULL,
  asunto          VARCHAR(200) NOT NULL,
  cuerpo_texto    TEXT NOT NULL,
  cuerpo_html     TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviando','enviada','error','fallida')),
  intentos        INTEGER NOT NULL DEFAULT 0,
  ultimo_error    TEXT,
  proximo_intento TIMESTAMPTZ,
  reclamado_en    TIMESTAMPTZ,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviada_en      TIMESTAMPTZ,
  UNIQUE (pedido_id, plantilla)
);
CREATE INDEX IF NOT EXISTS notificaciones_estado_idx ON notificaciones (estado, proximo_intento);

-- ===== Sprint 6: seguridad de cuentas =====
-- Al cambiar o restablecer una contraseña sube este número y todas las sesiones anteriores dejan de servir.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- ===== Sprint 7: proveedores y pedidos de compra de insumos =====
CREATE TABLE IF NOT EXISTS proveedores (
  id        SERIAL PRIMARY KEY,
  nombre    VARCHAR(80) NOT NULL,
  correo    VARCHAR(120) NOT NULL,
  contacto  VARCHAR(80),
  telefono  VARCHAR(30),
  notas     VARCHAR(300),
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS proveedores_nombre_uq ON proveedores (lower(nombre));

-- Qué insumos surte cada proveedor (opcional: sin filas = puede pedírsele cualquier insumo)
CREATE TABLE IF NOT EXISTS proveedor_insumos (
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  insumo_id    INTEGER NOT NULL REFERENCES insumos(id),
  PRIMARY KEY (proveedor_id, insumo_id)
);

CREATE TABLE IF NOT EXISTS pedidos_proveedor (
  id             SERIAL PRIMARY KEY,
  proveedor_id   INTEGER NOT NULL REFERENCES proveedores(id),
  usuario_id     INTEGER REFERENCES usuarios(id),
  estado         TEXT NOT NULL DEFAULT 'enviado' CHECK (estado IN ('enviado','recibido','cancelado')),
  suma_stock_en  TEXT NOT NULL DEFAULT 'recepcion' CHECK (suma_stock_en IN ('recepcion','envio')),
  stock_aplicado BOOLEAN NOT NULL DEFAULT false,
  nota           VARCHAR(300),
  fecha_requerida DATE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  recibido_en    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pedidos_proveedor_estado_idx ON pedidos_proveedor (estado, creado_en DESC);

CREATE TABLE IF NOT EXISTS pedido_proveedor_items (
  id         SERIAL PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos_proveedor(id) ON DELETE CASCADE,
  insumo_id  INTEGER NOT NULL REFERENCES insumos(id),
  cantidad   NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
  UNIQUE (pedido_id, insumo_id)
);

ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS pedido_proveedor_id INTEGER REFERENCES pedidos_proveedor(id);

-- La bandeja de correos ahora también sirve a los pedidos a proveedor
ALTER TABLE notificaciones ALTER COLUMN pedido_id DROP NOT NULL;
ALTER TABLE notificaciones ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS pedido_proveedor_id INTEGER REFERENCES pedidos_proveedor(id) ON DELETE CASCADE;
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS responder_a VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS notificaciones_pp_uq ON notificaciones (pedido_proveedor_id, plantilla) WHERE pedido_proveedor_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_destino_ck
    CHECK ((pedido_id IS NOT NULL AND pedido_proveedor_id IS NULL) OR (pedido_id IS NULL AND pedido_proveedor_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sprint 9: dirección de entrega del pedido (los pedidos anteriores quedan sin dirección)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_cp          VARCHAR(5);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_colonia     VARCHAR(80);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_calle       VARCHAR(100);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_num_ext     VARCHAR(20);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_num_int     VARCHAR(20);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_municipio   VARCHAR(80);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_estado      VARCHAR(40);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dir_referencias VARCHAR(200);

-- Sprint 9: bandeja de notificaciones del cliente (se reutilizan los avisos de pedido; solo se marca cuándo los leyó)
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS leida_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS notificaciones_cliente_idx ON notificaciones (cliente_id, creado_en DESC);

-- Recuperación de contraseña: solo se guarda el hash del enlace; vence en 1 hora y sirve una sola vez
CREATE TABLE IF NOT EXISTS recuperaciones_password (
  id         SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expira_en  TIMESTAMPTZ NOT NULL,
  usado_en   TIMESTAMPTZ,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recuperaciones_usuario_idx ON recuperaciones_password (usuario_id, creado_en);

-- Combos que el administrador crea, edita, deshabilita o elimina (el "combo personalizado" es fijo y no se guarda aquí)
CREATE TABLE IF NOT EXISTS combos (
  id          SERIAL PRIMARY KEY,
  clave       VARCHAR(40) NOT NULL UNIQUE,
  nombre      VARCHAR(40) NOT NULL,
  descripcion VARCHAR(120),
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS combos_nombre_idx ON combos (lower(nombre));
CREATE TABLE IF NOT EXISTS combo_items (
  combo_id    INTEGER NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad    INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 50),
  PRIMARY KEY (combo_id, producto_id)
);
CREATE TABLE IF NOT EXISTS ajustes (
  clave VARCHAR(40) PRIMARY KEY,
  valor TEXT NOT NULL
);
-- El pedido guarda el nombre que tenía el combo al comprarse (así el historial no cambia si luego se renombra o elimina)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS combo_nombre VARCHAR(40);
-- La clave de un combo creado por el administrador puede ser más larga que las de ejemplo
ALTER TABLE pedidos ALTER COLUMN combo TYPE VARCHAR(40);
UPDATE pedidos SET combo_nombre = CASE combo WHEN 'pequeno' THEN 'Combo Mini' WHEN 'mediano' THEN 'Combo Clásico' WHEN 'grande' THEN 'Combo Grande'
                                             WHEN 'pareja' THEN 'Combo Pareja' WHEN 'personalizado' THEN 'Combo personalizado' END
 WHERE combo_nombre IS NULL AND combo IN ('pequeno', 'mediano', 'grande', 'pareja', 'personalizado');

-- Cambio de nombre de los combos de ejemplo: Pequeño → Mini y Mediano → Clásico (solo si conservan el nombre original; la clave interna no cambia)
UPDATE combos SET nombre = 'Combo Mini' WHERE clave = 'pequeno' AND nombre = 'Combo Pequeño' AND NOT EXISTS (SELECT 1 FROM combos WHERE lower(nombre) = 'combo mini');
UPDATE combos SET nombre = 'Combo Clásico' WHERE clave = 'mediano' AND nombre = 'Combo Mediano' AND NOT EXISTS (SELECT 1 FROM combos WHERE lower(nombre) = 'combo clásico');
UPDATE pedidos SET combo_nombre = 'Combo Mini' WHERE combo = 'pequeno' AND combo_nombre = 'Combo Pequeño';
UPDATE pedidos SET combo_nombre = 'Combo Clásico' WHERE combo = 'mediano' AND combo_nombre = 'Combo Mediano';

-- ===== Pasarela simulada con tarjeta y corte de caja =====
-- Del pago con tarjeta solo se guarda la marca y los últimos 4 dígitos (nunca el número completo ni el CVV)
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS tarjeta VARCHAR(40);

-- Cortes de caja: fondo con el que se abre, lo cobrado en el periodo y con lo que se cierra
CREATE TABLE IF NOT EXISTS cortes_caja (
  id              SERIAL PRIMARY KEY,
  desde           DATE NOT NULL,
  hasta           DATE NOT NULL,
  fondo_inicial   NUMERIC(10,2) NOT NULL CHECK (fondo_inicial >= 0),
  ventas          NUMERIC(10,2) NOT NULL,
  pedidos         INTEGER NOT NULL,
  desglose        JSONB NOT NULL DEFAULT '[]',
  saldo_final     NUMERIC(10,2) NOT NULL,
  contado         NUMERIC(10,2),
  diferencia      NUMERIC(10,2),
  notas           VARCHAR(200),
  usuario_id      INTEGER REFERENCES usuarios(id),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
