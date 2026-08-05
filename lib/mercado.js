import { cookieDePeticion, leerSesion } from './auth.js';

/**
 * Puente hacia los proveedores de datos financieros.
 *
 * La clave vive en el servidor, así que quien usa la app no necesita
 * sacarse ninguna ni puede verla. De paso resuelve el bloqueo de CORS
 * que daba ROIC.ai en el navegador.
 */
export async function puente({ req, res, base, claveEnv, nombre }) {
	// Solo para quien haya entrado con su usuario.
	const secreto = process.env.AUTH_SECRET;
	const sesion = secreto
		? await leerSesion(cookieDePeticion(req.headers.cookie || ''), secreto)
		: null;
	if (!sesion) {
		return res.status(401).json({ 'Error Message': 'Sesión caducada. Vuelve a entrar.' });
	}

	const clave = process.env[claveEnv];
	if (!clave) {
		return res
			.status(500)
			.json({ 'Error Message': `Falta configurar ${claveEnv} en el servidor.` });
	}

	// La ruta llega troceada por Vercel; el resto de parámetros se conservan.
	const partes = req.query.ruta;
	const ruta = Array.isArray(partes) ? partes.join('/') : String(partes || '');

	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(req.query)) {
		// 'ruta' es del enrutador y 'apikey' la ponemos nosotros.
		if (k === 'ruta' || k === 'apikey') continue;
		params.append(k, Array.isArray(v) ? v[0] : v);
	}
	params.append('apikey', clave);

	const destino = `${base}/${ruta}?${params.toString()}`;

	try {
		const upstream = await fetch(destino, { headers: { Accept: 'application/json' } });
		const texto = await upstream.text();

		res.status(upstream.status);
		res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
		// Repetir la misma consulta en un rato es habitual: se cachea un poco.
		res.setHeader('Cache-Control', 'private, max-age=300');
		return res.send(texto);
	} catch (err) {
		console.error(`Puente ${nombre}:`, err);
		return res.status(502).json({ 'Error Message': `No se ha podido consultar ${nombre}.` });
	}
}
