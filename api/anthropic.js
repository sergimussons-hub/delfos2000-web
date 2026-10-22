import { cookieDePeticion, leerSesion } from '../lib/auth.js';

/*
 * Puente hacia Anthropic, igual que los de FMP y ROIC.
 *
 * Hasta ahora estas peticiones salían directas del navegador con la clave
 * dentro, y cada quien ponía la suya en Ajustes. Eso servía cuando Delfos era
 * de una sola persona. Desde que lo usa la familia no: si la clave viaja al
 * navegador, cualquiera que entre la puede sacar de las herramientas del
 * navegador y gastar con ella por su cuenta, en Delfos o fuera.
 *
 * Así que la clave se queda aquí. Quien usa la aplicación no necesita sacarse
 * ninguna y no puede verla.
 *
 * Y como ahora la paga uno solo para todos, este puente decide qué se puede
 * pedir. Lo que llega del navegador es una propuesta, no una orden.
 */

/**
 * Los modelos que se pueden pedir.
 *
 * Con la clave en el servidor, el cuerpo de la petición lo escribe el navegador
 * de cualquiera que haya entrado. Sin esta lista bastaría con cambiar una
 * palabra en las herramientas del navegador para pedir el modelo más caro que
 * exista, y la factura es de una sola persona.
 */
const MODELOS = new Set(['claude-sonnet-4-6']);

/**
 * El tope de salida.
 *
 * El más alto que pide la aplicación hoy son 2000, para el briefing. Se deja
 * algo de margen y se recorta lo que pase: un `max_tokens` inventado es la
 * manera más rápida de multiplicar el coste de una petición.
 */
const TOPE_SALIDA = 4000;

/** Lo que puede tardar una respuesta con búsqueda web antes de darla por perdida. */
const ESPERA = 55000;

export default async function handler(req, res) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: { message: 'Método no permitido.' } });
	}

	// Solo para quien haya entrado con su usuario. Sin esto, el puente sería una
	// clave de Anthropic abierta a internet.
	const secreto = process.env.AUTH_SECRET;
	const sesion = secreto
		? await leerSesion(cookieDePeticion(req.headers.cookie || ''), secreto)
		: null;
	if (!sesion) {
		return res.status(401).json({ error: { message: 'Sesión caducada. Vuelve a entrar.' } });
	}

	const clave = process.env.ANTHROPIC_API_KEY;
	if (!clave) {
		return res.status(500).json({
			error: { message: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' },
		});
	}

	let cuerpo = req.body;
	if (typeof cuerpo === 'string') {
		try {
			cuerpo = JSON.parse(cuerpo || '{}');
		} catch {
			return res.status(400).json({ error: { message: 'El cuerpo no es JSON.' } });
		}
	}
	if (!cuerpo || typeof cuerpo !== 'object') {
		return res.status(400).json({ error: { message: 'Falta qué preguntar.' } });
	}

	if (!MODELOS.has(cuerpo.model)) {
		return res.status(400).json({
			error: { message: 'Ese modelo no está permitido en Delfos.' },
		});
	}

	const pedido = {
		...cuerpo,
		max_tokens: Math.min(TOPE_SALIDA, Math.max(1, Number(cuerpo.max_tokens) || 1000)),
		// El modo de navegador no pinta nada aquí: esto ya no sale de un navegador.
		stream: false,
	};

	// Si tarda más de lo que aguanta la función, se corta aquí y se dice. Dejarlo
	// correr acabaría en un error de plataforma sin explicación.
	const corta = AbortSignal.timeout ? AbortSignal.timeout(ESPERA) : undefined;

	try {
		const upstream = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': clave,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify(pedido),
			signal: corta,
		});

		const texto = await upstream.text();
		res.status(upstream.status);
		res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
		// Nunca en caché: cada briefing y cada análisis son de su momento.
		res.setHeader('Cache-Control', 'no-store');
		return res.send(texto);
	} catch (err) {
		const esTiempo = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
		console.error('Puente Anthropic:', err);
		return res.status(esTiempo ? 504 : 502).json({
			error: {
				message: esTiempo
					? 'El modelo ha tardado demasiado. Vuelve a intentarlo.'
					: 'No se ha podido consultar a Anthropic.',
			},
		});
	}
}
