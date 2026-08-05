import {
	cabeceraCookie,
	crearSesion,
	hayAlmacen,
	huella,
	iguales,
	leerUsuario,
} from '../lib/auth.js';

export default async function handler(req, res) {
	if (req.method !== 'POST') {
		return res.status(405).json({ ok: false, error: 'Método no permitido.' });
	}

	const secreto = process.env.AUTH_SECRET;
	if (!secreto) {
		return res.status(500).json({ ok: false, error: 'Falta configurar AUTH_SECRET.' });
	}

	const cuerpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
	const usuario = String(cuerpo.usuario || '').trim().toLowerCase();
	const clave = String(cuerpo.clave || '');

	if (!usuario || !clave) {
		return res.status(400).json({ ok: false, error: 'Faltan el usuario o la contraseña.' });
	}

	// Pequeña espera: desanima los intentos a lo bruto.
	await new Promise((r) => setTimeout(r, 400));

	// 1. Administrador (siempre disponible, definido por variables de entorno)
	const adminUsuario = (process.env.ADMIN_USER || '').trim().toLowerCase();
	const adminClave = process.env.ADMIN_PASSWORD || '';
	if (adminUsuario && usuario === adminUsuario) {
		if (iguales(clave, adminClave)) {
			res.setHeader('Set-Cookie', cabeceraCookie(await crearSesion(usuario, true, secreto)));
			return res.status(200).json({ ok: true, admin: true });
		}
		return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
	}

	// 2. Usuarios normales (guardados en la base de datos)
	if (!hayAlmacen()) {
		return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
	}

	let ficha = null;
	try {
		ficha = await leerUsuario(usuario);
	} catch (err) {
		console.error('Almacén:', err);
		return res.status(500).json({ ok: false, error: 'No se ha podido comprobar el acceso.' });
	}

	if (!ficha) {
		return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
	}

	const calculada = await huella(clave, ficha.sal);
	if (!iguales(calculada, ficha.huella)) {
		return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
	}

	res.setHeader('Set-Cookie', cabeceraCookie(await crearSesion(usuario, false, secreto)));
	return res.status(200).json({ ok: true });
}
