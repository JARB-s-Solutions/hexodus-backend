# ISSUE: Persistencia de autenticación para socios en la app móvil

## Contexto

Actualmente el backend de Hexodus cuenta con autenticación JWT para usuarios administrativos del sistema web. Esa autenticación vive alrededor del modelo `Usuario`, roles y permisos.

Para la app móvil de socios se creó una primera capa separada bajo:

```txt
/api/app/socios
```

con los siguientes endpoints iniciales:

```txt
POST /api/app/socios/auth/request-otp
POST /api/app/socios/auth/verify-otp
GET  /api/app/socios/me
```

Esta implementación permite:

- Buscar un socio por correo o teléfono.
- Enviar un código OTP por correo usando Nodemailer.
- Verificar el código.
- Emitir un JWT específico para la app de socios.
- Consultar el perfil del socio autenticado.

Sin embargo, por la restricción actual de no modificar base de datos, los códigos OTP se almacenan temporalmente en memoria del proceso Node.js.

## Problema

El almacenamiento en memoria no es suficiente para producción porque:

- Se pierde si el servidor se reinicia.
- No funciona correctamente con múltiples instancias del backend.
- No permite auditoría confiable de intentos.
- No permite rate limiting persistente por socio, correo, teléfono o IP.
- No permite invalidar sesiones en todos los dispositivos.
- No permite implementar contraseña de app de forma segura.

Además, el socio no debe autenticarse usando el modelo `Usuario`, porque ese modelo representa personal administrativo con permisos sobre el sistema web.

## Objetivo

Agregar persistencia para la autenticación de socios de la app móvil sin modificar datos existentes de forma destructiva y sin resetear la base de datos.

La solución debe mantener separados:

- Usuarios administrativos: `Usuario`
- Clientes/socios de la app: `Socio` + nuevas tablas de autenticación móvil

## Propuesta de tablas

### 1. `SocioAppAccount`

Cuenta de acceso móvil vinculada a un socio existente.

Campos sugeridos:

```prisma
model SocioAppAccount {
  id                 Int       @id @default(autoincrement())
  socioId            Int       @unique
  email              String?
  phone              String?
  passwordHash       String?
  passwordEnabled    Boolean   @default(false)
  status             String    @default("activa")
  lastLoginAt        DateTime?
  linkedAt           DateTime  @default(now())
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  socio              Socio     @relation(fields: [socioId], references: [id])

  @@index([email])
  @@index([phone])
  @@map("socio_app_accounts")
}
```

Notas:

- `socioId` debe ser único para evitar múltiples cuentas móviles para el mismo socio, salvo que se decida soportar cuentas familiares.
- `passwordHash` puede ser nulo al inicio si se mantiene login passwordless.
- `passwordEnabled` permite distinguir entre cuenta solo OTP y cuenta con contraseña.
- `status` puede evolucionar a enum en una migración posterior si se desea.

### 2. `SocioAppOtp`

Persistencia de códigos OTP.

```prisma
model SocioAppOtp {
  id              Int       @id @default(autoincrement())
  verificationId  String    @unique
  socioId         Int
  destination     String
  channel         String    @default("email")
  codeHash        String
  attempts        Int       @default(0)
  maxAttempts     Int       @default(5)
  expiresAt       DateTime
  consumedAt      DateTime?
  createdAt       DateTime  @default(now())

  socio           Socio     @relation(fields: [socioId], references: [id])

  @@index([socioId])
  @@index([destination])
  @@index([expiresAt])
  @@map("socio_app_otps")
}
```

Notas:

- Nunca guardar el OTP en texto plano.
- Guardar `codeHash` usando SHA-256 o HMAC con secreto del backend.
- `verificationId` es lo que recibe el cliente móvil.
- `destination` permite auditar a qué correo/teléfono fue enviado.

### 3. `SocioAppSession`

Sesiones móviles activas o revocadas.

```prisma
model SocioAppSession {
  id             Int       @id @default(autoincrement())
  socioId         Int
  tokenId        String    @unique
  deviceId       String?
  deviceName     String?
  platform       String?
  appVersion     String?
  ipAddress      String?
  userAgent      String?
  revokedAt      DateTime?
  expiresAt      DateTime
  createdAt      DateTime  @default(now())
  lastUsedAt     DateTime?

  socio          Socio     @relation(fields: [socioId], references: [id])

  @@index([socioId])
  @@index([tokenId])
  @@index([expiresAt])
  @@map("socio_app_sessions")
}
```

Notas:

- El JWT debe incluir `jti` o `tokenId`.
- Permite cerrar sesión de un dispositivo.
- Permite invalidar todas las sesiones del socio.
- Permite auditoría básica por dispositivo.

### 4. `SocioAppAuthEvent`

Auditoría de eventos de autenticación.

```prisma
model SocioAppAuthEvent {
  id             Int       @id @default(autoincrement())
  socioId         Int?
  eventType      String
  channel        String?
  destination    String?
  success        Boolean
  reason         String?
  ipAddress      String?
  userAgent      String?
  createdAt      DateTime  @default(now())

  socio          Socio?    @relation(fields: [socioId], references: [id])

  @@index([socioId])
  @@index([eventType])
  @@index([createdAt])
  @@map("socio_app_auth_events")
}
```

Eventos sugeridos:

```txt
otp_requested
otp_sent
otp_verified
otp_failed
login_success
login_failed
session_revoked
password_created
password_changed
```

## Cambios en el flujo actual

### Flujo actual temporal

```txt
1. Cliente ingresa correo/teléfono.
2. Backend busca socio.
3. Backend genera OTP en memoria.
4. Backend envía OTP por correo.
5. Cliente verifica OTP.
6. Backend emite JWT de socio.
```

### Flujo esperado con persistencia

```txt
1. Cliente ingresa correo/teléfono.
2. Backend busca socio existente.
3. Backend crea o reutiliza SocioAppAccount.
4. Backend crea SocioAppOtp con codeHash y expiración.
5. Backend envía OTP por correo.
6. Cliente verifica OTP.
7. Backend marca OTP como consumido.
8. Backend crea SocioAppSession.
9. Backend emite JWT con tipo socio_app, socioId y tokenId.
10. Cliente consume /api/app/socios/me.
```

## Migración no destructiva

No se debe resetear la base de datos.

Pasos recomendados:

```bash
npx prisma migrate dev --name add_socio_app_auth
```

En ambientes productivos:

```bash
npx prisma migrate deploy
```

Reglas:

- Solo agregar tablas nuevas.
- No renombrar columnas existentes.
- No borrar tablas existentes.
- No modificar enums actuales salvo que sea estrictamente necesario.
- No cambiar relaciones existentes de `Socio`, salvo agregar relaciones nuevas opcionales.
- Hacer backup antes de aplicar en producción.

## Cambios esperados en código

Estado actual: el store en memoria fue retirado y el flujo OTP usa tablas persistentes `socio_app_*` desde `src/modules/sociosApp/services/sociosApp.service.js`.

Se reemplazó:

```txt
src/modules/sociosApp/stores/sociosApp.otpStore.js
```

por persistencia en DB. Si el módulo crece, se recomienda extraer la lógica a repositorios:

```txt
src/modules/sociosApp/repositories/sociosAppOtp.repository.js
src/modules/sociosApp/repositories/sociosAppAccount.repository.js
src/modules/sociosApp/repositories/sociosAppSession.repository.js
src/modules/sociosApp/repositories/sociosAppAuthEvent.repository.js
```

También se recomienda separar:

```txt
src/modules/sociosApp/services/sociosAppAuth.service.js
src/modules/sociosApp/services/sociosAppProfile.service.js
```

## Seguridad mínima requerida

- OTP de 6 dígitos con expiración de 5 a 10 minutos.
- Máximo 5 intentos por OTP.
- Rate limit por identificador e IP.
- No revelar si un correo/teléfono existe en respuestas públicas, si se decide endurecer seguridad.
- Guardar OTP hasheado, nunca en texto plano.
- JWT de socio separado del JWT administrativo.
- Claims mínimos del JWT:

```json
{
  "tipo": "socio_app",
  "scope": "socio:app",
  "socioId": 123,
  "codigoSocio": "SOC-123456",
  "jti": "uuid-de-sesion"
}
```

## Variables de entorno sugeridas

```env
SOCIO_APP_JWT_EXPIRES_IN=30d
SOCIO_APP_OTP_TTL_MS=600000
SOCIO_APP_OTP_MAX_ATTEMPTS=5
SOCIO_APP_SKIP_EMAIL=false
EMAIL_SERVICE=Gmail
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM="Hexodus Fitness Center <no-reply@hexodusgym.com>"
```

## Criterios de aceptación

- Un socio existente puede solicitar OTP por correo.
- El OTP se guarda hasheado en base de datos.
- El OTP expira correctamente.
- El OTP se consume una sola vez.
- Los intentos fallidos incrementan contador.
- Al verificar OTP se crea una sesión móvil.
- El JWT incluye `tipo: "socio_app"` y `jti`.
- `/api/app/socios/me` funciona solo con token de socio.
- Un token administrativo no puede consumir endpoints de socio app.
- Un token de socio app no puede consumir endpoints administrativos.
- Se puede revocar una sesión móvil.
- No se requiere reset de base de datos.
- La migración solo agrega tablas nuevas.

## Nota sobre contraseña

El flujo de "crear contraseña" debe implementarse después de tener `SocioAppAccount`.

Mientras no exista persistencia, la app debe operar en modo passwordless con OTP por correo.

Cuando exista la tabla:

- `passwordHash` debe guardarse con bcrypt.
- El endpoint de crear contraseña debe requerir OTP verificado o sesión activa.
- El login con contraseña debe seguir usando el perfil `Socio`, no `Usuario`.
