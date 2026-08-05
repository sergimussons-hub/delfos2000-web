import { puente } from '../lib/mercado.js';

// Igual que el de FMP: la ruta llega en «ruta» por la reescritura de vercel.json.
export default async function handler(req, res) {
	return puente({
		req,
		res,
		base: 'https://api.roic.ai',
		claveEnv: 'ROIC_API_KEY',
		nombre: 'ROIC.ai',
	});
}
