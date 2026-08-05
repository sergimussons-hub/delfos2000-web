import { cabeceraCookie } from '../lib/auth.js';

export default async function handler(req, res) {
	res.setHeader('Set-Cookie', cabeceraCookie(''));
	res.setHeader('Location', '/');
	return res.status(302).end();
}
