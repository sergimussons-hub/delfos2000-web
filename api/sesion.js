import { cookieDePeticion, leerSesion } from '../lib/auth.js';

/*
 * Quién eres, para la aplicación.
 *
 * La entrada ya sabía si quien entraba era el administrador —`/api/login` lo
 * devuelve—, pero eso se perdía al recargar la página, así que la aplicación
 * no tenía forma de saberlo y enseñaba lo mismo a todo el mundo. Con Delfos de
 * una sola persona daba igual; con la familia dentro, no: Ajustes lleva las
 * claves de las fuentes y es de quien administra.
 *
 * Esto no protege nada por sí solo, y conviene no confundirlo. Lo que protege
 * está donde tiene que estar: `middleware.js` cierra `/admin`, `/api/usuarios`
 * vuelve a comprobarlo por su cuenta, y `/api/datos` saca de quién son los
 * datos de la sesión y no de lo que pida el navegador. Esto solo sirve para
 * decidir qué se enseña.
 */
export default async function handler(req, res) {
	const secreto = process.env.AUTH_SECRET;
	const sesion = secreto
		? await leerSesion(cookieDePeticion(req.headers.cookie || ''), secreto)
		: null;

	res.setHeader('Cache-Control', 'no-store');
	if (!sesion) return res.status(401).json({ ok: false, error: 'Sesión caducada. Vuelve a entrar.' });

	return res.status(200).json({
		ok: true,
		usuario: sesion.usuario,
		esAdmin: Boolean(sesion.esAdmin),
	});
}
