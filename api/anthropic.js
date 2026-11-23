import { cookieDePeticion, guardarComun, hayAlmacen, leerComun, leerSesion } from '../lib/auth.js';

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

/*
 * Cuánto vale una respuesta ya dada sobre una empresa.
 *
 * Doce horas. Lo que mide el análisis cualitativo —foso, potencial, gestión—
 * no cambia de un día para otro; lo que sí cambia son las noticias, y por eso
 * no es una semana. Quien quiera una recién hecha tiene el botón de rehacer,
 * que salta esto.
 */
const VALE_HORAS = 12;

/*
 * De qué se guarda respuesta común y con qué nombre.
 *
 * La clave la arma el servidor, no el navegador: si viniera de fuera, bastaría
 * con pedir otro nombre para leer o pisar lo que no toca. Del cuerpo solo se
 * acepta el tipo y el ticker, y el ticker se limpia.
 */
function claveComun(compartir) {
	if (!compartir || compartir.tipo !== 'cualitativa') return null;
	const t = String(compartir.ticker || '').trim().toUpperCase();
	if (!t || t.length > 15 || !/^[A-Z0-9.\-]+$/.test(t)) return null;
	return `cualitativa:v1:${t}`;
}

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

	/*
	 * Lo nuestro se queda aquí.
	 *
	 * `compartir` y `forzar` son instrucciones para este puente, no para el
	 * modelo: colándolas en el cuerpo, Anthropic devuelve un 400 por campos que
	 * no conoce.
	 */
	const compartir = cuerpo.compartir;
	const forzar = cuerpo.forzar === true;
	delete cuerpo.compartir;
	delete cuerpo.forzar;

	const clave_comun = claveComun(compartir);
	if (clave_comun && !forzar && hayAlmacen()) {
		try {
			const ya = await leerComun(clave_comun);
			const horas = ya && ya.cuando ? (Date.now() - ya.cuando) / 3600000 : null;
			if (ya && ya.respuesta && horas != null && horas < VALE_HORAS) {
				res.setHeader('Cache-Control', 'no-store');
				// El mismo cuerpo que daría el modelo, con una marca de que no se le ha preguntado.
				return res.status(200).json({ ...ya.respuesta, compartida: { cuando: ya.cuando } });
			}
		} catch (e) {
			// Si el almacén no contesta, se pregunta y ya está: esto es un ahorro, no un requisito.
			console.error('cualitativa compartida: leer', e);
		}
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

		/*
		 * Y se guarda para quien pregunte después. Solo lo que ha salido bien:
		 * guardar un error sería repartirlo durante doce horas.
		 */
		if (clave_comun && upstream.ok && hayAlmacen()) {
			try {
				const respuesta = JSON.parse(texto);
				if (respuesta && Array.isArray(respuesta.content)) {
					await guardarComun(clave_comun, { cuando: Date.now(), respuesta });
				}
			} catch (e) {
				console.error('cualitativa compartida: guardar', e);
			}
		}

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
