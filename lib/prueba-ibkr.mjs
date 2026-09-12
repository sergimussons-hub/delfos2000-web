// Leer las posiciones de un informe Flex de Interactive Brokers.
//
// Se equivoca caro de una manera concreta: IBKR contesta con HTTP 200 aunque el
// testigo esté caducado —el error va dentro del XML—, así que una lectura
// descuidada convierte «no has podido entrar» en «no tienes nada en cartera».
// Eso no falla: miente.
//
// node lib/prueba-ibkr.mjs
import { leerRespuesta, posicionesDe, traerPosiciones } from './ibkr.js';

let fallos = 0;
function comprobar(titulo, ok, detalle) {
	if (!ok) fallos++;
	console.log(`  ${ok ? 'ok ' : 'FALLA'}  ${titulo}`);
	if (!ok && detalle) console.log(`         ${detalle}`);
}

const INFORME = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Posiciones" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20260901" toDate="20260912">
<OpenPositions>
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL"
  description="APPLE INC" position="100" costBasisPrice="150.5" costBasisMoney="15050" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="aapl"
  description="APPLE INC" position="50" costBasisPrice="180.5" costBasisMoney="9025" />
<OpenPosition accountId="U1234567" currency="EUR" assetCategory="STK" symbol="ITX"
  description="INDUSTRIA DE DISENO TEXTIL" position="200" costBasisPrice="42.25" costBasisMoney="8450" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="OPT" symbol="AAPL 260116C00200000"
  description="AAPL 16JAN26 200 C" position="3" costBasisPrice="4.2" costBasisMoney="1260" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="TSLA"
  description="TESLA INC" position="0" costBasisPrice="0" costBasisMoney="0" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="MSFT"
  description="MICROSOFT CORP" position="-40" costBasisPrice="300" costBasisMoney="-12000" />
</OpenPositions>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

console.log('\nLo que trae un informe');
{
	const { posiciones, fuera } = posicionesDe(INFORME);
	const por = (t) => posiciones.find((p) => p.ticker === t);

	comprobar(
		'las acciones salen, y una sola vez cada empresa',
		posiciones.length === 3,
		'salen ' + posiciones.map((p) => p.ticker).join(', '),
	);
	comprobar(
		'dos líneas de la misma empresa se juntan',
		por('AAPL')?.acciones === 150,
		'150 acciones repartidas en dos lotes, no dos posiciones de Apple',
	);
	comprobar(
		'y con el precio medio ponderado, no la media a secas',
		Math.abs(por('AAPL').precioCompra - 160.5) < 0.001,
		'(150,5×100 + 180,5×50) / 150 = 160,5; la media pelada daría 165,5 y mentiría sobre lo que costó',
	);
	comprobar(
		'el símbolo se normaliza',
		!posiciones.some((p) => p.ticker !== p.ticker.toUpperCase()),
		'«aapl» y «AAPL» son la misma empresa: si no, salen dos posiciones de lo mismo',
	);
	comprobar(
		'lo que no es una acción se queda fuera, pero dicho',
		fuera.length === 1 && fuera[0].clase === 'OPT',
		'no hay PER de una opción; y callárselo haría pensar que la cartera está entera',
	);
	comprobar(
		'una posición cerrada no es una posición',
		!por('TSLA'),
		'sale en el informe porque hubo movimiento, pero ya no se tiene nada',
	);
	comprobar(
		'y un corto se trae tal cual, en negativo',
		por('MSFT')?.acciones === -40,
		'esconderlo daría una cartera que no es la que hay',
	);
	comprobar('se guarda la moneda', por('ITX')?.moneda === 'EUR');
}

console.log('\nCuando IBKR contesta que no');
{
	const caducado = `<FlexStatementResponse timestamp="12 September, 2026 08:00 AM EDT">
		<Status>Fail</Status><ErrorCode>1020</ErrorCode>
		<ErrorMessage>Invalid request or unable to validate request.</ErrorMessage></FlexStatementResponse>`;
	const leido = leerRespuesta(caducado);
	comprobar(
		'se ve que es un error y no una cartera vacía',
		Boolean(leido.error),
		'IBKR contesta 200 con el error dentro: si no se mira, un testigo caducado pasa por «no tienes nada»',
	);
	comprobar('y se dice el código, que es lo que se busca en su web', leido.error.includes('1020'));

	comprobar(
		'un informe sin posiciones sí es una cartera vacía',
		posicionesDe('<FlexQueryResponse><OpenPositions/></FlexQueryResponse>').posiciones.length === 0,
	);
}

console.log('\nLos dos pasos');
{
	const resguardo = `<FlexStatementResponse><Status>Success</Status>
		<ReferenceCode>9876543210</ReferenceCode></FlexStatementResponse>`;

	// Sin esperas de verdad: la prueba no tiene por qué tardar once segundos.
	const yaVoy = () => Promise.resolve();

	{
		let pedidas = [];
		const falso = async (url) => {
			pedidas.push(url);
			return { text: async () => (url.includes('SendRequest') ? resguardo : INFORME) };
		};
		const salida = await traerPosiciones({
			token: 'T', consulta: '123', buscar: falso, esperar: yaVoy,
		});
		comprobar('se piden los dos pasos en orden', pedidas.length === 2 &&
			pedidas[0].includes('SendRequest') && pedidas[1].includes('GetStatement'));
		comprobar(
			'el resguardo del primero se usa en el segundo',
			pedidas[1].includes('9876543210'),
			'sin esto se pediría cualquier otra cosa, o nada',
		);
		comprobar('y llegan las posiciones', salida.posiciones?.length === 3);
	}

	{
		// Mientras se genera, IBKR contesta que todavía no. No es un fallo.
		let vez = 0;
		const falso = async (url) => {
			if (url.includes('SendRequest')) return { text: async () => resguardo };
			vez++;
			return {
				text: async () =>
					vez < 3
						? '<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress.</ErrorMessage></FlexStatementResponse>'
						: INFORME,
			};
		};
		const salida = await traerPosiciones({
			token: 'T', consulta: '123', buscar: falso, esperar: yaVoy,
		});
		comprobar(
			'«todavía se está haciendo» no se toma por un error',
			salida.posiciones?.length === 3,
			'pedir una vez y rendirse fallaría casi siempre: el informe tarda un momento en generarse',
		);
	}

	{
		const falso = async () => ({
			text: async () =>
				'<FlexStatementResponse><Status>Fail</Status><ErrorCode>1020</ErrorCode><ErrorMessage>Invalid request.</ErrorMessage></FlexStatementResponse>',
		});
		const salida = await traerPosiciones({
			token: 'malo', consulta: '123', buscar: falso, esperar: yaVoy,
		});
		comprobar('un testigo que no vale se dice, no se calla', Boolean(salida.error));
		comprobar('y no se devuelve ninguna cartera', salida.posiciones === undefined);
	}

	{
		const salida = await traerPosiciones({ token: '', consulta: '', esperar: yaVoy });
		comprobar('sin testigo ni consulta, ni se llama a IBKR', Boolean(salida.error));
	}
}

console.log('\n' + (fallos ? fallos + ' comprobaciones fallan' : 'Todas las comprobaciones pasan') + '\n');
process.exit(fallos ? 1 : 0);
