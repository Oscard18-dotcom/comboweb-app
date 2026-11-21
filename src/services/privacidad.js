/* Aviso de privacidad: versión vigente. Si se cambia el texto de public/privacidad.html, sube esta versión
   y todos los clientes tendrán que aceptarlo de nuevo la próxima vez que entren. */
const VERSION = '2026-11';
const aceptada = (u) => !!u && u.privacidad_version === VERSION;
// Solo los clientes (quienes dejan datos personales al comprar) deben aceptarlo; el personal lo acepta al darle su cuenta el administrador
const pendiente = (u) => !!u && u.rol === 'cliente' && !aceptada(u);
module.exports = { VERSION, aceptada, pendiente };
