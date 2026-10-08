/**
 * Utilidades de acceso: contraseñas, sesiones y almacén de usuarios.
 * Funciona tanto en funciones Node como en el middleware (Edge).
 */

const COOKIE = 'delfos_sesion';
const DIAS_SESION = 30;

// ---------- Contraseñas ----------
// Nunca se guarda la contraseña: solo su huella (PBKDF2 con sal).

function aHex(buf) {
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function huella(clave, sal) {
	const material = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(clave),
		'PBKDF2',
		false,
		['deriveBits'],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: new TextEncoder().encode(sal), iterations: 120000, hash: 'SHA-256' },
		material,
		256,
	);
	return aHex(bits);
}

export function nuevaSal() {
	return aHex(crypto.getRandomValues(new Uint8Array(16)));
}

/** Comparación en tiempo constante, para no filtrar información. */
export function iguales(a = '', b = '') {
	if (a.length !== b.length) return false;
	let dif = 0;
	for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return dif === 0;
}

// ---------- Sesión (cookie firmada) ----------

async function firmar(texto, secreto) {
	const clave = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secreto),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	return aHex(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(texto)));
}

export async function crearSesion(usuario, esAdmin, secreto) {
	const caduca = Date.now() + DIAS_SESION * 24 * 60 * 60 * 1000;
	const cuerpo = `${usuario}|${esAdmin ? 1 : 0}|${caduca}`;
	return `${btoa(encodeURIComponent(cuerpo))}.${await firmar(cuerpo, secreto)}`;
}

export async function leerSesion(valor, secreto) {
	if (!valor || !valor.includes('.')) return null;
	const [datos, firma] = valor.split('.');
	let cuerpo;
	try {
		cuerpo = decodeURIComponent(atob(datos));
	} catch {
		return null;
	}
	if (!iguales(firma, await firmar(cuerpo, secreto))) return null;

	const [usuario, admin, caduca] = cuerpo.split('|');
	if (!usuario || Number(caduca) < Date.now()) return null;
	return { usuario, esAdmin: admin === '1' };
}

export function cabeceraCookie(valor) {
	const base = `${COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax`;
	return valor ? `${base}; Max-Age=${DIAS_SESION * 24 * 60 * 60}` : `${base}; Max-Age=0`;
}

export function cookieDePeticion(cabecera = '') {
	const trozo = cabecera.split(';').find((c) => c.trim().startsWith(`${COOKIE}=`));
	return trozo ? trozo.split('=').slice(1).join('=').trim() : null;
}

export { COOKIE };

// ---------- Almacén de usuarios (Upstash Redis vía REST) ----------

const PREFIJO = 'delfos:usuario:';

function conf() {
	const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
	const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
	return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

export function hayAlmacen() {
	return conf() !== null;
}

/*
 * El sitio al que se esta llamando, sin nada que no se pueda ensenar.
 *
 * Solo el protocolo y el nombre de la maquina: una URL de Redis lleva el token
 * dentro (redis://default:TOKEN@host) y eso no puede acabar en un mensaje de
 * error. Con el protocolo basta para ver el fallo mas tipico, que es haber
 * pegado la direccion de Redis donde va la del REST.
 */
function anfitrion(u) {
	try {
		const x = new URL(u);
		return `${x.protocol}//${x.hostname}`;
	} catch {
		return 'la direccion configurada, que no es una URL valida';
	}
}

/*
 * Un mensaje de error listo para ensenar.
 *
 * Esto no es precaucion teorica: probandolo salio que, con una URL de tipo
 * redis://usuario:TOKEN@host, el propio mensaje de Node trae la URL entera
 * dentro —token incluido— y acabaria en la pantalla del navegador. Se quita
 * el token conocido y cualquier credencial incrustada en una direccion.
 */
function sinSecretos(texto, token) {
	let t = String(texto == null ? '' : texto);
	if (token) t = t.split(token).join('···');
	// Y cualquier credencial incrustada en una dirección, que puede ser otra.
	t = t.replace(new RegExp('//[^/ @]*@', 'g'), '//···@');
	return t.slice(0, 160);
}

async function redis(camino, opciones = {}) {
	const c = conf();
	if (!c) throw new Error('No hay base de datos configurada.');
	let res;
	try {
		res = await fetch(`${c.url}/${camino}`, {
			...opciones,
			headers: { Authorization: `Bearer ${c.token}`, ...(opciones.headers || {}) },
		});
	} catch (e) {
		/*
		 * 'fetch failed' a secas no dice nada, y es lo unico que sale cuando la
		 * peticion no llega a ninguna parte. El detalle esta en la causa que
		 * envuelve Node —ENOTFOUND si el nombre ya no existe, ECONNREFUSED,
		 * TLS—, y el anfitrion dice si la direccion es siquiera la del REST.
		 */
		const detalle = sinSecretos((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || 'fallo de red', c.token);
		throw new Error(`No se ha podido conectar con ${anfitrion(c.url)}: ${detalle}`);
	}
	if (!res.ok) {
		/*
		 * El cuerpo dice de cual de los tres se trata: la credencial, la base que
		 * ya no existe, o el tamano. Con solo 'Redis 401' hay que adivinar, y
		 * adivinar es lo que ha costado media tarde.
		 */
		const dice = sinSecretos(await res.text().catch(() => ''), c.token);
		throw new Error(`Redis ${res.status}` + (dice ? `: ${dice}` : ''));
	}
	return (await res.json()).result;
}

export async function leerUsuario(usuario) {
	const bruto = await redis(`get/${encodeURIComponent(PREFIJO + usuario)}`);
	if (!bruto) return null;
	try {
		return typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
	} catch {
		return null;
	}
}

export async function guardarUsuario(usuario, datos) {
	await redis(`set/${encodeURIComponent(PREFIJO + usuario)}`, {
		method: 'POST',
		body: JSON.stringify(datos),
	});
}

export async function borrarUsuario(usuario) {
	await redis(`del/${encodeURIComponent(PREFIJO + usuario)}`, { method: 'POST' });
}

/*
 * Los datos de trabajo de una persona: cartera, seguimiento, análisis.
 *
 * En su propia clave y no dentro de la ficha del usuario. La ficha la lee el
 * panel de administración para listar quién entra, y ahí no pinta nada la
 * cartera de nadie: separadas, listar usuarios no arrastra los datos de todos.
 */
const PREFIJO_DATOS = 'delfos:datos:';

export async function leerDatos(usuario) {
	const bruto = await redis(`get/${encodeURIComponent(PREFIJO_DATOS + usuario)}`);
	if (!bruto) return null;
	try {
		return typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
	} catch {
		return null;
	}
}

export async function guardarDatos(usuario, datos) {
	await redis(`set/${encodeURIComponent(PREFIJO_DATOS + usuario)}`, {
		method: 'POST',
		body: JSON.stringify(datos),
	});
}

export async function borrarDatos(usuario) {
	await redis(`del/${encodeURIComponent(PREFIJO_DATOS + usuario)}`, { method: 'POST' });
}

export async function listarUsuarios() {
	const claves = (await redis(`keys/${encodeURIComponent(PREFIJO)}*`)) || [];
	const lista = await Promise.all(
		claves.map(async (k) => {
			const nombre = k.slice(PREFIJO.length);
			const datos = await leerUsuario(nombre);
			return { usuario: nombre, nota: datos?.nota || '', creado: datos?.creado || null };
		}),
	);
	return lista.sort((a, b) => a.usuario.localeCompare(b.usuario));
}
