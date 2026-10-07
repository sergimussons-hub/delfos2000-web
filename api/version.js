/**
 * Qué versión está publicada ahora mismo.
 *
 * Existe por una razón concreta: la aplicación vive detrás de la puerta de
 * acceso, así que desde fuera no hay manera de ver qué código está sirviendo
 * Vercel. Cuando algo «no funciona», la primera pregunta siempre es si lo que se
 * está probando es lo último que se subió, y sin esto no se puede contestar —se
 * acaba buscando el fallo en código que todavía no está publicado—.
 *
 * Va fuera de la puerta a propósito: si pidiera sesión no serviría para lo que
 * sirve. Lo que devuelve es el identificador del commit, que no dice nada de
 * nadie ni abre nada; el mensaje del commit no se publica, que ese sí puede
 * contar de más.
 */
export default function handler(req, res) {
	res.setHeader('Cache-Control', 'no-store');
	const sha = process.env.VERCEL_GIT_COMMIT_SHA || null;
	return res.status(200).json({
		commit: sha ? sha.slice(0, 7) : null,
		rama: process.env.VERCEL_GIT_COMMIT_REF || null,
		cuando: new Date().toISOString(),
	});
}
