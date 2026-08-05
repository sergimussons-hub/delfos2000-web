import { puente } from '../../lib/mercado.js';

export default async function handler(req, res) {
	return puente({
		req,
		res,
		base: 'https://financialmodelingprep.com',
		claveEnv: 'FMP_API_KEY',
		nombre: 'FinancialModelingPrep',
	});
}
