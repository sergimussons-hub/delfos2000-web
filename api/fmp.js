import { puente } from '../lib/mercado.js';

// La ruta llega en el parámetro «ruta» gracias a la reescritura de vercel.json,
// que convierte /api/fmp/stable/quote en /api/fmp?ruta=stable/quote
export default async function handler(req, res) {
	return puente({
		req,
		res,
		base: 'https://financialmodelingprep.com',
		claveEnv: 'FMP_API_KEY',
		nombre: 'FinancialModelingPrep',
	});
}
