// De qué cuenta de IBKR se leen las posiciones de alguien.
//
// Esto decidía dos sitios por su cuenta —el que trae las posiciones y el que le
// dice a la pantalla si hay cuenta— y daban respuestas distintas: a quien tira
// de la cuenta del servidor, la pantalla le abría el panel de «conecta tu
// cuenta» mientras el botón de traer posiciones le funcionaba. Ahora contesta
// una sola función y esto comprueba lo que contesta.
//
// node pruebas/credenciales.mjs
import { credencialesDe, duenosDe } from '../lib/ibkr.js';

let fallos = 0;
function comprobar(titulo, ok, detalle) {
	if (!ok) fallos++;
	console.log((ok ? '  ok  ' : ' FALLA ') + titulo + (detalle && !ok ? `\n        ${detalle}` : ''));
}

const SERVIDOR = {
	IBKR_USUARIOS: 'sergi, ana',
	IBKR_FLEX_TOKEN: 'testigo-del-servidor',
	IBKR_FLEX_QUERY: '12345',
};
const SUYA = { token: 'suyo', consulta: '999', puestoEn: '2026-10-01' };

console.log('\nQuién es dueño de la cuenta del servidor');
comprobar('los que diga IBKR_USUARIOS', duenosDe(SERVIDOR).join(',') === 'sergi,ana');
comprobar('sin esa variable, el administrador', duenosDe({ ADMIN_USER: 'Jefe' }).join(',') === 'jefe');
comprobar('y sin nada, nadie', duenosDe({}).length === 0);

console.log('\nDe qué cuenta se lee');
{
	const r = credencialesDe('sergi', SUYA, SERVIDOR);
	comprobar('la propia manda sobre la del servidor', r?.de === 'suya' && r.token === 'suyo');
	comprobar('y lleva desde cuándo está puesta', r?.puestoEn === '2026-10-01');
}
{
	const r = credencialesDe('sergi', null, SERVIDOR);
	comprobar('sin cuenta propia, la del servidor si es suyo', r?.de === 'servidor' && r.token === 'testigo-del-servidor');
}
{
	// El caso que rompió la pantalla: dueño, sin cuenta propia. Antes esto se
	// contestaba «no configurado» en un sitio y «sí, tira de la del servidor» en
	// el otro.
	const r = credencialesDe('ANA', null, SERVIDOR);
	comprobar('da igual cómo esté escrito su nombre', r?.de === 'servidor');
}
{
	const r = credencialesDe('primo', null, SERVIDOR);
	comprobar('quien no es dueño no la toca', r === null, 'leería la cartera entera de otro');
}
{
	const r = credencialesDe('primo', SUYA, SERVIDOR);
	comprobar('pero sí lee la suya', r?.de === 'suya');
}
{
	const r = credencialesDe('sergi', null, { IBKR_USUARIOS: 'sergi' });
	comprobar('dueño pero sin testigo en el servidor, nada', r === null);
}
{
	const a = credencialesDe('sergi', { token: 'x' }, SERVIDOR);
	comprobar('media cuenta propia no es una cuenta', a?.de === 'servidor', 'le falta la consulta');
	const b = credencialesDe('primo', { consulta: '1' }, SERVIDOR);
	comprobar('ni con solo la consulta', b === null);
}

console.log('\n' + (fallos ? fallos + ' comprobaciones fallan' : 'Todas las comprobaciones pasan') + '\n');
process.exit(fallos ? 1 : 0);
