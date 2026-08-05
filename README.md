# Delfos 2000 · acceso privado

Análisis value diario, con entrada por usuario y contraseña para un grupo
reducido de personas (hasta ~20).

## Cómo está montado

| Ruta | Qué es | Quién entra |
|---|---|---|
| `/` | Puerta de acceso | Todo el mundo |
| `/app` | La aplicación | Quien tenga usuario |
| `/admin` | Alta y baja de accesos | Solo el administrador |
| `/api/fmp/…` | Puente a FinancialModelingPrep | Sesión iniciada |
| `/api/roic/…` | Puente a ROIC.ai | Sesión iniciada |

**Las claves de FMP y ROIC viven en el servidor**, así que quien usa la app no
tiene que registrarse en ningún sitio ni puede verlas. La clave de Anthropic
(para el briefing con noticias) sí la pone cada uno, porque es de pago por uso.

**Los datos de cada persona** (cartera, seguimiento, análisis) se guardan en su
propio navegador. Nadie ve los de nadie, tampoco el administrador.

## Puesta en marcha

### 1. Base de datos para los usuarios

En Vercel → pestaña **Storage** → **Create Database** → **Upstash Redis** (gratis).
Al conectarla al proyecto, Vercel añade solas las variables `KV_REST_API_URL` y
`KV_REST_API_TOKEN`.

Sin esta base de datos el administrador puede entrar, pero no dar de alta a nadie.

### 2. Variables de entorno

En Vercel → **Environment Variables**:

| Variable | Qué es |
|---|---|
| `AUTH_SECRET` | Texto largo y aleatorio para firmar las sesiones (mín. 32 caracteres) |
| `ADMIN_USER` | Tu usuario de administrador, p. ej. `sergi` |
| `ADMIN_PASSWORD` | Tu contraseña de administrador |
| `FMP_API_KEY` | Clave de financialmodelingprep.com |
| `ROIC_API_KEY` | Clave de roic.ai |

Después de guardarlas hay que hacer **Redeploy**: las variables solo se aplican
en despliegues posteriores.

### 3. Dar de alta a la gente

Entra en `/admin` con el usuario de administrador. Por cada persona: nombre de
usuario, contraseña (hay un botón para generar una) y una nota para acordarte de
quién es. La contraseña se muestra una sola vez: apúntala antes de cerrar.

## Seguridad

- Las contraseñas no se guardan: solo su huella (PBKDF2, 120.000 iteraciones).
- La sesión va en una cookie firmada, `HttpOnly` y `Secure`, válida 30 días.
- Todo el sitio va con `noindex`: no aparece en buscadores.
- Los puentes a FMP y ROIC exigen sesión iniciada, para que nadie de fuera gaste
  las claves.

## Pendiente

- Estética: está la del original (papel, tinta y latón). Falta decidir el
  acabado definitivo.
- Automatizaciones (resumen diario por correo, alertas de desplomes): requieren
  mover los datos del navegador al servidor. Ver las notas de la conversación.

## Archivos

- `app.html` — la aplicación (React vía CDN, un solo archivo)
- `index.html` — puerta de acceso
- `admin.html` — panel de accesos
- `lib/auth.js` — contraseñas, sesiones y almacén de usuarios
- `lib/mercado.js` — puente común hacia los proveedores de datos
- `middleware.js` — protege `/app` y `/admin`
- `_original/` — copia intacta de lo que había antes de tocar nada
