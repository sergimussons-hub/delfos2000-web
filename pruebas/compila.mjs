// ¿Compila la app?
//
// Delfos es un solo HTML con Babel dentro del navegador: no hay paso de
// compilación, así que un error de sintaxis no lo ve nadie. No falla el
// despliegue, no falla el arranque; simplemente la pantalla sale en blanco, y
// se descubre en producción. Esto lo parsea con el mismo dialecto —JSX— antes.
//
// node pruebas/compila.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');

/*
 * El parser, de donde se deje encontrar.
 *
 * Es una dependencia de desarrollo: no viaja a producción —allí el que compila
 * es el Babel del navegador— y no hace falta para que la app funcione. Si no
 * está, esto NO pasa de largo: avisa y falla, porque una comprobación que se
 * salta sola es peor que no tenerla.
 */
function buscarParser() {
	const sitios = [
		join(raiz, 'package.json'),
		// El vecino: Sharpa lo tiene instalado y sirve igual.
		join(raiz, '..', 'sharpa2000', 'package.json'),
	];
	for (const sitio of sitios) {
		try {
			return createRequire(sitio)('@babel/parser');
		} catch {
			/* el siguiente */
		}
	}
	return null;
}

const parser = buscarParser();
if (!parser) {
	console.log('\nNo encuentro @babel/parser, así que no puedo comprobar si la app compila.');
	console.log('Instálalo con:  npm install\n');
	process.exit(1);
}

const html = readFileSync(join(raiz, 'app.html'), 'utf8');

// Los bloques con código: los que traen `src` son librerías de fuera.
const bloques = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
	.filter((m) => !/\bsrc=/.test(m[1]) && m[2].trim())
	.map((m) => ({
		jsx: /text\/babel/.test(m[1]),
		codigo: m[2],
		// Dónde empieza en el fichero, para que la línea del error sea la de verdad
		// y no la del trozo.
		linea: html.slice(0, m.index).split('\n').length,
	}));

let fallos = 0;
console.log('');
if (!bloques.length) {
	console.log(' FALLA  no encuentro ningún bloque de código en app.html');
	fallos++;
}

for (const b of bloques) {
	try {
		parser.parse(b.codigo, { sourceType: 'script', plugins: b.jsx ? ['jsx'] : [] });
		console.log(`  ok   ${b.jsx ? 'JSX' : 'JS '} · ${b.codigo.split('\n').length} líneas`);
	} catch (e) {
		fallos++;
		const donde = (e.loc?.line ?? 0) + b.linea - 1;
		console.log(` FALLA ${e.message.split(' (')[0]}`);
		console.log(`        app.html línea ${donde}`);
		const lineas = html.split('\n');
		for (let n = Math.max(1, donde - 2); n <= Math.min(lineas.length, donde + 2); n++) {
			console.log(`        ${n === donde ? '>' : ' '} ${n}: ${lineas[n - 1].slice(0, 110)}`);
		}
	}
}

console.log('\n' + (fallos ? fallos + ' bloque(s) no compilan' : 'La app compila') + '\n');
process.exit(fallos ? 1 : 0);
