import { cookieDePeticion, leerBroker, leerSesion } from '../lib/auth.js';
import { credencialesDe, duenosDe, traerPosiciones } from '../lib/ibkr.js';

/**
 * Las posiciones reales, traídas de Interactive Brokers.
 *
 * El testigo vive en el servidor y no baja nunca al navegador: con él se lee
 * la cartera entera de alguien. Antes había uno solo, en las variables del
 * proyecto, y esta puerta solo se abría para su dueño. Ahora cada quien conecta
 * la suya —se guarda aparte, en `delfos:broker:`— y aquí se usa la de quien
 * pregunta, que sale de la sesión y no de lo que mande el navegador.
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

	const quien = String(sesion.usuario || '').toLowerCase();

	/*
	 * La cuenta de quien pregunta, y de nadie más.
	 *
	 * Primero la suya, si ha conectado una. Después —y solo si no tiene— la del
	 * servidor, que es de quien administra y sigue abierta a los dueños de
	 * siempre: quien ya lo tenía montado no vuelve a pegar nada.
	 *
	 * El orden no es casual. Al revés, un dueño que conectara su cuenta seguiría
	 * viendo la del servidor y no entendería por qué.
	 *
	 * Lo que no puede pasar nunca es que alguien lea una cuenta que no ha
	 * conectado: el nombre sale de la sesión, así que no hay forma de pedir la de
	 * otro.
	 */
	const suyo = await leerBroker(quien).catch(() => null);
	const cuales = credencialesDe(quien, suyo, process.env);

	if (!cuales) {
		// Y se distinguen los dos noes: a quien no es dueño de la del servidor se
		// le pide la suya; a quien sí lo es, lo que falta es la configuración.
		const duenos = duenosDe(process.env);
		if (duenos.includes(quien)) {
			return res.status(500).json({
				error: 'Faltan IBKR_FLEX_TOKEN o IBKR_FLEX_QUERY en el servidor.',
			});
		}
		return res.status(409).json({
			error: 'Todavía no has conectado tu cuenta de Interactive Brokers. Se conecta en Cartera, en «Mi cuenta de IBKR».',
		});
	}
	const { token, consulta } = cuales;

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
