import {
	borrarDatos,
	borrarUsuario,
	guardarDatos,
	cookieDePeticion,
	guardarUsuario,
	hayAlmacen,
	huella,
	leerSesion,
	leerUsuario,
	listarUsuarios,
	nuevaSal,
} from '../lib/auth.js';

/** Solo el administrador puede tocar esto. */
async function comprobarAdmin(req, res) {
	const secreto = process.env.AUTH_SECRET;
	if (!secreto) {
		res.status(500).json({ ok: false, error: 'Falta configurar AUTH_SECRET.' });
		return false;
	}
	const sesion = await leerSesion(cookieDePeticion(req.headers.cookie || ''), secreto);
	if (!sesion?.esAdmin) {
		res.status(403).json({ ok: false, error: 'Necesitas entrar como administrador.' });
		return false;
	}
	return true;
}

export default async function handler(req, res) {
	if (!(await comprobarAdmin(req, res))) return;

	if (!hayAlmacen()) {
		return res.status(503).json({
			ok: false,
			error: 'No hay base de datos conectada. Créala en Vercel → Storage.',
		});
	}

	try {
		// Listar
		if (req.method === 'GET') {
			return res.status(200).json({ ok: true, usuarios: await listarUsuarios() });
		}

		const cuerpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

		/*
		 * Vaciar lo suyo sin tocarle la cuenta.
		 *
		 * Hasta que la copia del navegador llevó nombre, quien entraba en un
		 * ordenador se traía los datos de quien lo hubiera usado antes y acababan
		 * subiendo a su cuenta. Arreglar el camino no saca de ahí lo que ya
		 * subió.
		 *
		 * Quitar el acceso y volverlo a dar ya borraba los datos, pero obliga a
		 * inventar otra contraseña y a dársela otra vez a alguien que no ha hecho
		 * nada. Esto vacía y deja la cuenta como estaba.
		 */
		if (req.method === 'POST' && cuerpo.accion === 'vaciar') {
			const usuario = String(cuerpo.usuario || '').trim().toLowerCase();
			if (!usuario) return res.status(400).json({ ok: false, error: 'Falta el usuario.' });
			/*
			 * Una marca, no un borrado.
			 *
			 * Borrando el registro, la aplicación de esa persona se encontraría el
			 * servidor vacío y haría lo que hace siempre en ese caso: dar por buena
			 * su copia del navegador y subirla. O sea, devolver justo lo que se
			 * acaba de quitar, y encima pareciendo que se había quitado.
			 *
			 * Con la marca, su aplicación sabe que esto es una orden y tira también
			 * su copia local.
			 */
			await guardarDatos(usuario, { vaciadoEn: new Date().toISOString() });
			return res.status(200).json({ ok: true, vaciado: usuario });
		}

		// Crear o cambiar contraseña
		if (req.method === 'POST') {
			const usuario = String(cuerpo.usuario || '').trim().toLowerCase();
			const clave = String(cuerpo.clave || '');
			const nota = String(cuerpo.nota || '').trim();

			if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) {
				return res.status(400).json({
					ok: false,
					error: 'El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.',
				});
			}
			if (clave.length < 8) {
				return res
					.status(400)
					.json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' });
			}
			if (usuario === (process.env.ADMIN_USER || '').trim().toLowerCase()) {
				return res.status(400).json({ ok: false, error: 'Ese nombre está reservado.' });
			}

			const existia = await leerUsuario(usuario);
			const sal = nuevaSal();
			await guardarUsuario(usuario, {
				sal,
				huella: await huella(clave, sal),
				nota,
				creado: existia?.creado || new Date().toISOString(),
			});
			return res.status(200).json({ ok: true, actualizado: Boolean(existia) });
		}

		// Borrar
		if (req.method === 'DELETE') {
			const usuario = String(cuerpo.usuario || '').trim().toLowerCase();
			if (!usuario) return res.status(400).json({ ok: false, error: 'Falta el usuario.' });
			await borrarUsuario(usuario);
			// Y lo suyo con ella: datos sin dueño no los vuelve a mirar nadie.
			await borrarDatos(usuario).catch(function () {});
			return res.status(200).json({ ok: true });
		}

		return res.status(405).json({ ok: false, error: 'Método no permitido.' });
	} catch (err) {
		console.error('Usuarios:', err);
		return res.status(500).json({ ok: false, error: 'Error en la base de datos.' });
	}
}
