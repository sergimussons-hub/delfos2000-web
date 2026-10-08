import { cookieDePeticion, guardarDatos, hayAlmacen, leerDatos, leerSesion } from '../lib/auth.js';

/*
 * Los datos de trabajo de cada persona: cartera, seguimiento, análisis.
 *
 * Vivían solo en el navegador porque la aplicación nació sin servidor. Cuando se
 * publicó se puso servidor para lo que lo necesitaba —la entrada y las claves de
 * las fuentes— y los datos se quedaron donde ya estaban. No fue una decisión de
 * diseño: fue inercia, y costaba dos cosas que sí importan. Un proceso
 * programado no puede leer el navegador de nadie, así que el correo diario era
 * imposible; y limpiar los datos del navegador borraba el historial entero, que
 * ahora lleva las fechas de entrada de la cartera virtual.
 *
 * Cada quien lee y escribe lo suyo y nada más: la clave sale de la sesión, no de
 * lo que pida quien llama. Sin eso, mandar otro nombre bastaría para leer la
 * cartera de otro.
 */

/*
 * Lo que cabe en una tanda.
 *
 * Upstash corta las peticiones grandes, y una ficha de análisis por empresa sube
 * rápido. Si no cabe, se dice: callarlo haría creer que se ha guardado algo que
 * no está, y eso se descubre el día que se cambia de ordenador.
 */
const TOPE = 900 * 1024;

export default async function handler(req, res) {
	const secreto = process.env.AUTH_SECRET;
	const sesion = secreto
		? await leerSesion(cookieDePeticion(req.headers.cookie || ''), secreto)
		: null;
	if (!sesion) return res.status(401).json({ error: 'Sesión caducada. Vuelve a entrar.' });
	if (!hayAlmacen()) return res.status(500).json({ error: 'El servidor no tiene base de datos configurada.' });

	const quien = sesion.usuario;

	if (req.method === 'GET') {
		try {
			const datos = await leerDatos(quien);
			res.setHeader('Cache-Control', 'no-store');
			return res.status(200).json({ datos: datos || null });
		} catch (e) {
			console.error('datos: leer', e);
			return res.status(502).json({ error: 'No se han podido leer tus datos.' });
		}
	}

	if (req.method === 'POST') {
		let cuerpo = req.body;
		// Según cómo llegue la petición, el cuerpo puede venir sin interpretar.
		if (typeof cuerpo === 'string') {
			try {
				cuerpo = JSON.parse(cuerpo);
			} catch {
				return res.status(400).json({ error: 'El cuerpo no es JSON.' });
			}
		}
		if (!cuerpo || typeof cuerpo !== 'object' || !cuerpo.datos) {
			return res.status(400).json({ error: 'Falta qué guardar.' });
		}

		const texto = JSON.stringify(cuerpo.datos);
		if (texto.length > TOPE) {
			return res.status(413).json({
				error: 'Tus datos ocupan ' + Math.round(texto.length / 1024) + ' kB y el tope son ' + Math.round(TOPE / 1024) + '. Borra análisis viejos que ya no mires.',
			});
		}

		try {
			await guardarDatos(quien, cuerpo.datos);
			res.setHeader('Cache-Control', 'no-store');
			return res.status(200).json({ ok: true, kb: Math.round(texto.length / 1024) });
		} catch (e) {
			console.error('datos: guardar', e);
			return res.status(502).json({ error: 'No se han podido guardar tus datos.' });
		}
	}

	return res.status(405).json({ error: 'Método no permitido.' });
}
