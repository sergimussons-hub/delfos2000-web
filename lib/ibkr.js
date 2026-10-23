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

/**
 * Quién puede ver esta cuenta de bolsa.
 *
 * Por defecto, quien administra Delfos: la cuenta es suya y es el nombre con el
 * que entra, así que no hace falta escribirlo en ningún sitio más. IBKR_USUARIOS
 * sirve para añadir a alguien, y entonces manda ella entera.
 *
 * Nunca devuelve «todos»: sin nada configurado, la lista queda vacía y no la ve
 * nadie. Un fallo de configuración tiene que cerrar la puerta, no abrirla.
 */
export function duenosDe(entorno = {}) {
	const dichos = String(entorno.IBKR_USUARIOS || '')
		.split(',')
		.map((u) => u.trim().toLowerCase())
		.filter(Boolean);
	if (dichos.length) return dichos;

	const admin = String(entorno.ADMIN_USER || '').trim().toLowerCase();
	return admin ? [admin] : [];
}

/**
 * Con qué credenciales se lee la cartera de alguien, y de dónde salen.
 *
 * Dos sitios posibles y un orden: la cuenta que esa persona haya conectado
 * manda, y si no tiene, la del servidor —pero solo si ella es una de sus
 * dueñas—. Devuelve también `de`, porque no es lo mismo para quien lo lee:
 * una cuenta propia se desconecta desde la pantalla y la del servidor no.
 *
 * Esto lo contestaban por su cuenta el que trae las posiciones y el que le dice
 * a la pantalla si hay cuenta. Con dos respuestas, al administrador le salía el
 * panel de «conecta tu cuenta» mientras traer posiciones le funcionaba.
 */
export function credencialesDe(quien, suyo, entorno = {}) {
	if (suyo?.token && suyo?.consulta) {
		return { token: suyo.token, consulta: suyo.consulta, de: 'suya', puestoEn: suyo.puestoEn || null };
	}

	const duenos = duenosDe(entorno);
	if (!quien || !duenos.includes(String(quien).toLowerCase())) return null;
	if (!entorno.IBKR_FLEX_TOKEN || !entorno.IBKR_FLEX_QUERY) return null;

	return {
		token: entorno.IBKR_FLEX_TOKEN,
		consulta: entorno.IBKR_FLEX_QUERY,
		de: 'servidor',
		puestoEn: null,
	};
}

const BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';

/*
 * El informe no está hecho en el momento de pedirlo: hay que volver a llamar.
 *
 * Las pausas crecen y se cuentan contra un presupuesto. Antes eran cuatro fijas
 * que sumaban once segundos, y un informe de un año recién pedido tarda más:
 * se rendía antes de tiempo y lo contaba como si IBKR fuera lento.
 */
const ESPERAS = [1500, 2500, 4000, 5000, 6000, 8000, 8000, 10000];
const PRESUPUESTO = 45000;

/*
 * Los dos avisos que SÍ son «vuelve a llamar».
 *
 * 1019 es «lo estoy generando» y 1018 «me estás preguntando demasiado». Todo lo
 * demás —testigo caducado, consulta que no existe, permiso que falta— es un
 * fallo de verdad y hay que decirlo en vez de seguir esperando: lo contrario
 * manda a esperar a quien tiene que ir a arreglar algo.
 */
const MIENTRAS_SE_HACE = new Set(['1019', '1018']);

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
		const codigo = atributo(texto, 'ErrorCode') || (texto.match(/<ErrorCode>([^<]*)</) || [])[1] || null;
		// El código sale aparte y no solo pegado al texto: es lo que decide si
		// hay que esperar o si hay que ir a arreglar algo.
		return { error: codigo ? `${error} (${codigo})` : error, codigo };
	}
	const referencia =
		atributo(texto, 'ReferenceCode') || (texto.match(/<ReferenceCode>([^<]*)</) || [])[1] || null;
	/*
	 * Y a donde hay que ir a recogerlo.
	 *
	 * IBKR lo dice en la propia respuesta. Tenerlo fijo en el codigo funciona
	 * hasta el dia que cambian el camino, y ese dia no falla con un error: lo
	 * que vuelve no es el informe y uno se queda esperando sin saber por que.
	 */
	const donde = atributo(texto, 'Url') || (texto.match(/<Url>([^<]*)</) || [])[1] || null;
	return { referencia, donde };
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

	// Donde lo dice la respuesta; si no lo dice, donde siempre.
	const recogida = pedida.donde || `${BASE}/GetStatement`;

	let esperado = 0;
	// Lo ultimo que contesto, para poder contarlo si se agota el tiempo.
	let ultimo = null;
	for (let vuelta = 0; ; vuelta++) {
		const espera = ESPERAS[Math.min(vuelta, ESPERAS.length - 1)];
		if (esperado + espera > PRESUPUESTO) break;
		await esperar(espera);
		esperado += espera;

		const dos = await buscar(
			`${recogida}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(pedida.referencia)}&v=3`,
		);
		const xml = await dos.text();
		const hecho = /<FlexQueryResponse/.test(xml);
		if (hecho) return { ...posicionesDe(xml), cuando: new Date().toISOString() };

		/*
		 * Sin informe todavía: o lo está haciendo, o algo va mal de verdad.
		 *
		 * Antes se seguía esperando en los dos casos, y así un testigo caducado
		 * acababa diciendo «está tardando más de lo normal». Ahora el aviso de
		 * «lo estoy generando» espera y lo demás se cuenta tal cual.
		 */
		const fallo = leerRespuesta(xml);
		ultimo = {
			codigo: fallo.codigo ?? null,
			// Un recorte corto y en una linea, con el testigo tapado por si acaso:
			// es para leerlo en pantalla, no para guardarlo.
			muestra: String(xml).replace(token, '···').replace(/\s+/g, ' ').trim().slice(0, 180),
		};
		if (fallo.error && !MIENTRAS_SE_HACE.has(String(fallo.codigo ?? ''))) return { error: fallo.error };
	}

	const segundos = Math.round(esperado / 1000);

	/*
	 * Dos finales distintos, y antes se decia el mismo para los dos.
	 *
	 * Si lo ultimo fue «lo estoy generando», es lentitud y se espera. Si fue
	 * cualquier otra cosa, no hay nada que esperar: se enseña lo que dijo, que
	 * es lo unico que permite ir a mirar donde toca.
	 */
	if (ultimo && MIENTRAS_SE_HACE.has(String(ultimo.codigo ?? ''))) {
		return {
			error: 'El informe de IBKR sigue generándose después de ' + segundos +
				' segundos. Suele pasar la primera vez o con consultas de un año entero: vuelve a darle en un minuto, o acorta el periodo de la consulta Flex.',
		};
	}

	return {
		error: 'IBKR no ha devuelto el informe en ' + segundos +
			' segundos, y lo último que ha contestado no es ni el informe ni un error conocido: ' +
			(ultimo ? ultimo.muestra : 'nada'),
	};
}
