import {
	borrarBroker,
	cookieDePeticion,
	guardarBroker,
	hayAlmacen,
	leerBroker,
	leerSesion,
} from '../lib/auth.js';

/*
 * La cuenta de bolsa de cada persona.
 *
 * Delfos leía posiciones reales de una sola cuenta, la de quien administra, con
 * un testigo guardado en las variables del servidor. Con la familia dentro eso
 * no escala: o conectan la suya, o el botón de traer posiciones no es para
 * ellos.
 *
 * Tres reglas, y las tres por el mismo motivo —con este testigo se lee la
 * cartera entera de alguien—:
 *
 *   · De quién es sale de la sesión, nunca de lo que mande el navegador. Si
 *     viniera en el cuerpo, bastaría con escribir otro nombre para leer la
 *     cuenta de otro.
 *   · El testigo no vuelve nunca al navegador. Ni al que lo puso: aquí se
 *     contesta si hay cuenta conectada y desde cuándo, y nada más. Quien lo
 *     pierda saca otro en IBKR, que es gratis y cuesta un minuto.
 *   · Vive en su propia clave, fuera de la ficha del usuario y fuera de los
 *     datos de trabajo. En la ficha lo arrastraría el panel de administración
 *     al listar; en los datos saldría en cada lectura y dentro de la copia de
 *     seguridad que cualquiera puede descargarse.
 */

/** Lo que miden un testigo y una consulta de IBKR, con margen por si cambian. */
const TOPE = 128;

export default async function handler(req, res) {
	const secreto = process.env.AUTH_SECRET;
	const sesion = secreto
		? await leerSesion(cookieDePeticion(req.headers.cookie || ''), secreto)
		: null;
	if (!sesion) return res.status(401).json({ ok: false, error: 'Sesión caducada. Vuelve a entrar.' });

	/*
	 * Mirando por encima del hombro de alguien, no se toca.
	 *
	 * Quien administra puede entrar a ver la aplicación como otra persona para
	 * comprobar qué le llega. Conectar una cuenta de bolsa desde ahí dejaría la
	 * cuenta de uno firmada por otro, y nadie sabría de quién es el testigo.
	 */
	if (sesion.verComo) {
		return res.status(403).json({ ok: false, error: 'Mirando como otra persona solo se puede mirar.' });
	}

	const quien = String(sesion.usuario || '').toLowerCase();
	if (!quien) return res.status(403).json({ ok: false, error: 'Esto lo conecta cada persona con su usuario.' });

	if (!hayAlmacen()) {
		return res.status(503).json({ ok: false, error: 'El servidor no tiene base de datos configurada.' });
	}

	res.setHeader('Cache-Control', 'no-store');

	try {
		// Si hay cuenta conectada. El testigo no sale de aquí.
		if (req.method === 'GET') {
			const suyo = await leerBroker(quien);
			return res.status(200).json({
				ok: true,
				configurado: Boolean(suyo?.token && suyo?.consulta),
				puestoEn: suyo?.puestoEn || null,
			});
		}

		if (req.method === 'POST') {
			const cuerpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
			const token = String(cuerpo.token || '').trim();
			const consulta = String(cuerpo.consulta || '').trim();

			if (!token || !consulta) {
				return res.status(400).json({ ok: false, error: 'Faltan el testigo o el número de la consulta.' });
			}
			if (token.length > TOPE || consulta.length > TOPE) {
				return res.status(400).json({ ok: false, error: 'Eso es demasiado largo para ser un testigo de IBKR.' });
			}
			/*
			 * Los dos son números en IBKR. Comprobarlo aquí no es manía: estos
			 * valores se pegan de un correo o de una pantalla, y con un espacio o
			 * media línea de más el fallo aparecería mucho después, al pulsar
			 * «traer posiciones», y diciendo que IBKR no contesta.
			 */
			if (!/^\d+$/.test(token) || !/^\d+$/.test(consulta)) {
				return res.status(400).json({
					ok: false,
					error: 'El testigo y la consulta de IBKR son solo números. Repasa que no se haya colado un espacio o un salto de línea.',
				});
			}

			await guardarBroker(quien, { token, consulta, puestoEn: new Date().toISOString() });
			return res.status(200).json({ ok: true, configurado: true });
		}

		if (req.method === 'DELETE') {
			await borrarBroker(quien);
			return res.status(200).json({ ok: true, configurado: false });
		}

		return res.status(405).json({ ok: false, error: 'Método no permitido.' });
	} catch (err) {
		console.error('Broker:', err);
		return res.status(500).json({ ok: false, error: 'No se ha podido guardar la conexión.' });
	}
}
