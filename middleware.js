import { cookieDePeticion, leerSesion } from './lib/auth.js';

export const config = {
	matcher: ['/app', '/app.html', '/admin', '/admin.html'],
};

export default async function middleware(req) {
	const url = new URL(req.url);
	const secreto = process.env.AUTH_SECRET;

	const sesion = secreto
		? await leerSesion(cookieDePeticion(req.headers.get('cookie') || ''), secreto)
		: null;

	// Sin sesión: a la puerta, recordando a dónde quería ir.
	if (!sesion) {
		const destino = new URL('/', url);
		destino.searchParams.set('volver', url.pathname);
		return Response.redirect(destino, 302);
	}

	// El panel de usuarios es solo del administrador.
	if (url.pathname.startsWith('/admin') && !sesion.esAdmin) {
		return Response.redirect(new URL('/app', url), 302);
	}

	return undefined;
}
