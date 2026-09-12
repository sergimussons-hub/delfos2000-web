/**
 * Traer las posiciones reales desde Interactive Brokers.
 *
 * Por el Flex Web Service, que es el único camino que sirve para un proceso sin
 * nadie delante: se pide con un testigo por HTTPS y no hace falta iniciar sesión
 * en Client Portal ni tener ningún programa de IBKR encendido. La otra puerta
 * —la Client Portal Web API— da datos en directo, pero pide firmar con claves y
 * una sesión que caduca, y para una foto diaria de la cartera es mucha
 * maquinaria para nada.
 *
 * Solo lee. No hay aquí ninguna manera de mandar una orden, y es a propósito:
 * un fallo en un proceso automático no puede acabar tocando una cartera de
 * verdad.
 */

const BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';

/** El informe no está hecho en el momento de pedirlo: hay que volver a llamar. */
const ESPERAS = [1200, 2000, 3000, 5000];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Un valor de un atributo XML, por su nombre.
 *
 * Se lee con expresiones y no con un analizador de XML de verdad porque lo que
 * devuelve IBKR es plano: etiquetas sin hijos con todo en los atributos. Meter
 * una dependencia para esto sería cargar un motor entero para leer un renglón.
 */
function atributo(trozo, nombre) {
	const m = trozo.match(new RegExp(`\\b${nombre}="([^"]*)"`));
	return m ? m[1] : null;
}

const aNumero = (v) => {
	const n = Number(String(v ?? '').replace(/,/g, ''));
	return Number.isFinite(n) ? n : null;
};

/**
 * Qué ha contestado IBKR a una petición.
 *
 * Cuando algo va mal contesta con un XML de error y un código, no con un HTTP
 * distinto de 200. Si no se mira, un token caducado pasa por «no tienes nada en
 * cartera», que es la peor manera de fallar: silenciosa y creíble.
 */
export function leerRespuesta(xml) {
	const texto = String(xml || '');
	const error = atributo(texto, 'ErrorMessage') || (texto.match(/<ErrorMessage>([^<]*)</) || [])[1];
	if (error) {
		const codigo = atributo(texto, 'ErrorCode') || (texto.match(/<ErrorCode>([^<]*)</) || [])[1];
		return { error: codigo ? `${error} (${codigo})` : error };
	}
	const referencia =
		atributo(texto, 'ReferenceCode') || (texto.match(/<ReferenceCode>([^<]*)</) || [])[1] || null;
	return { referencia };
}

/**
 * Las posiciones abiertas que vienen dentro de un informe Flex.
 *
 * Se queda solo con las acciones. Un Flex puede traer también opciones, futuros
 * y divisas, y meterlas en una cartera que analiza empresas por sus cuentas no
 * dice nada: no hay PER de un futuro del maíz.
 *
 * Las posiciones cerradas —cantidad cero— se descartan: aparecen en el informe
 * porque hubo movimiento, pero ya no se tiene nada.
 */
export function posicionesDe(xml) {
	const texto = String(xml || '');
	const fuera = [];
	const dentro = [];

	for (const [trozo] of texto.matchAll(/<OpenPosition\b[^>]*\/?>/g)) {
		const cantidad = aNumero(atributo(trozo, 'position'));
		if (!cantidad) continue;

		const clase = atributo(trozo, 'assetCategory');
		const simbolo = atributo(trozo, 'symbol');
		if (!simbolo) continue;

		if (clase && clase !== 'STK') {
			fuera.push({ ticker: simbolo, clase });
			continue;
		}

		dentro.push({
			ticker: simbolo.toUpperCase(),
			acciones: cantidad,
			// El coste medio por acción. IBKR lo da ya dividido; si no viniera, se
			// saca del coste total, que siempre está.
			precioCompra:
				aNumero(atributo(trozo, 'costBasisPrice')) ??
				(aNumero(atributo(trozo, 'costBasisMoney')) !== null
					? aNumero(atributo(trozo, 'costBasisMoney')) / cantidad
					: null),
			moneda: atributo(trozo, 'currency'),
			nombre: atributo(trozo, 'description'),
			cuenta: atributo(trozo, 'accountId'),
		});
	}

	/*
	 * Una misma empresa puede venir en varias líneas: dos cuentas, o lotes
	 * comprados por separado. Se juntan con el precio medio ponderado, que es lo
	 * que la app guarda por cada posición.
	 */
	const juntas = new Map();
	for (const p of dentro) {
		const ya = juntas.get(p.ticker);
		if (!ya) {
			juntas.set(p.ticker, { ...p });
			continue;
		}
		const total = ya.acciones + p.acciones;
		const coste =
			ya.precioCompra !== null && p.precioCompra !== null
				? (ya.precioCompra * ya.acciones + p.precioCompra * p.acciones) / total
				: (ya.precioCompra ?? p.precioCompra);
		juntas.set(p.ticker, { ...ya, acciones: total, precioCompra: coste });
	}

	return { posiciones: [...juntas.values()], fuera };
}

/**
 * Pide el informe y espera a que esté.
 *
 * Dos pasos porque así lo hace IBKR: el primero devuelve un resguardo y el
 * segundo el informe, que tarda un momento en generarse. Se reintenta unas
 * cuantas veces con esperas cada vez más largas, que es más barato que pedir una
 * sola vez y fallar por llegar medio segundo pronto.
 */
export async function traerPosiciones({ token, consulta, buscar = fetch, esperar = dormir }) {
	if (!token || !consulta) {
		return { error: 'Faltan el testigo o el identificador de la consulta Flex.' };
	}

	const uno = await buscar(`${BASE}/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(consulta)}&v=3`);
	const pedida = leerRespuesta(await uno.text());
	if (pedida.error) return { error: pedida.error };
	if (!pedida.referencia) return { error: 'IBKR no ha devuelto ningún resguardo.' };

	for (const espera of ESPERAS) {
		await esperar(espera);
		const dos = await buscar(
			`${BASE}/GetStatement?t=${encodeURIComponent(token)}&q=${encodeURIComponent(pedida.referencia)}&v=3`,
		);
		const xml = await dos.text();

		const fallo = leerRespuesta(xml);
		// Mientras se genera contesta con un aviso, no con un error de verdad. Se
		// distingue por que no trae todavía el informe.
		if (fallo.error && !/<FlexQueryResponse/.test(xml)) continue;
		if (!/<FlexQueryResponse/.test(xml)) continue;

		return { ...posicionesDe(xml), cuando: new Date().toISOString() };
	}

	return { error: 'El informe de IBKR está tardando más de lo normal. Vuelve a intentarlo en un minuto.' };
}
