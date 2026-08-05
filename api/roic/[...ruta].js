import { puente } from '../../lib/mercado.js';

export default async function handler(req, res) {
	return puente({
		req,
		res,
		base: 'https://api.roic.ai',
		claveEnv: 'ROIC_API_KEY',
		nombre: 'ROIC.ai',
	});
}
