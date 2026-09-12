import { cookieDePeticion, leerSesion } from '../lib/auth.js';
import { traerPosiciones } from '../lib/ibkr.js';

/**
 * Las posiciones reales, traídas de Interactive Brokers.
 *
 * El testigo vive en el servidor, como las claves de los proveedores de datos:
 * quien usa la app no lo ve ni lo necesita. Con ese testigo se puede leer la
 * cartera entera de Sergi, así que no puede bajar nunca al navegador.
 *
 * Solo lee posiciones. No hay aquí manera de mandar una orden.
 */
export default async function handler(req, res) {
	// Solo para quien haya entrado con su usuario.
	const secreto = process.env.AUTH_SECRET;
	const sesion = secreto
		? await leerSesion(cookieDePeticion(req.headers.cookie || ''), secreto)
		: null;
	if (!sesion) {
		return res.status(401).json({ error: 'Sesión caducada. Vuelve a entrar.' });
	}

	/*
	 * Y solo para quien sea el dueño de esa cuenta.
	 *
	 * Esto no es como los datos de mercado, que son los mismos para todos: aquí
	 * hay una cartera de verdad con nombres y cantidades. Los familiares y amigos
	 * que entran a la app tienen su propio usuario, pero la cuenta de IBKR es de
	 * uno solo, y sin esta línea cualquiera de ellos la vería entera.
	 */
	const duenos = String(process.env.IBKR_USUARIOS || '')
		.split(',')
		.map((u) => u.trim().toLowerCase())
		.filter(Boolean);
	const quien = String(sesion.usuario || '').toLowerCase();
	if (!duenos.length || !duenos.includes(quien)) {
		return res.status(403).json({ error: 'Esta cuenta de bolsa no es tuya.' });
	}

	const token = process.env.IBKR_FLEX_TOKEN;
	const consulta = process.env.IBKR_FLEX_QUERY;
	if (!token || !consulta) {
		return res.status(500).json({
			error: 'Faltan IBKR_FLEX_TOKEN o IBKR_FLEX_QUERY en el servidor.',
		});
	}

	try {
		const salida = await traerPosiciones({ token, consulta });
		if (salida.error) return res.status(502).json({ error: salida.error });

		res.setHeader('Cache-Control', 'no-store');
		return res.status(200).json(salida);
	} catch (err) {
		// El motivo al registro y no a la pantalla: puede llevar dentro el testigo
		// o trozos de la dirección, y eso no se enseña.
		console.error('IBKR:', err);
		return res.status(502).json({ error: 'No se ha podido consultar Interactive Brokers.' });
	}
}
