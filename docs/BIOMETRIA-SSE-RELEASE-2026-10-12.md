# Entrega backend biométrica — 12 de octubre de 2026

## Qué se incorporó

- Sesiones autorizadas para el motor local con `POST /api/asistencia/huellas/sesion`.
- Sincronización de huellas con revisión calculada desde el contenido existente; no se añadió un contador ni una tabla nueva.
- Eventos de asistencia firmados, idempotentes y con comprobante durable para evitar duplicados cuando el motor reintenta.
- Pruebas de enrolamiento ligadas al socio, a la revisión de huellas y a la clave del dispositivo.
- Validación de permisos y estado actual del usuario en operaciones biométricas.
- Exclusión de comprobantes técnicos de la bitácora humana general.
- Aviso de membresía próxima a vencer dentro de los dos días anteriores, respetando la zona horaria de Mérida.

## Seguridad de base de datos

- `prisma/schema.prisma` y `prisma/migrations/` no se modificaron ni se subieron en esta rama.
- No se agregaron tablas, columnas, índices, triggers ni migraciones biométricas.
- No se ejecutó `prisma migrate`, `prisma db push`, `prisma migrate reset` ni ningún comando contra Supabase.
- No se incluyeron archivos `.env`, contraseñas, URLs privadas ni claves reales.
- El `push` de Git solo cambia el repositorio; no abre una conexión con la base de datos.

El backend sí realiza las escrituras normales que requiere el flujo de asistencia: registra el acceso y sus comprobantes en las tablas existentes (`acceso` y `auditoria_log`) y conserva la lógica existente de socios y membresías. Eso ocurre únicamente cuando el frontend o el motor llaman al endpoint correspondiente; instalar o fusionar esta rama no escribe datos.

## Validación ejecutada

`npm test` sobre la copia local: **29 pruebas, 27 aprobadas, 0 fallidas y 2 omitidas**. Las dos omitidas son las pruebas de integración PostgreSQL porque no se configuró `BIOMETRIC_TEST_DATABASE_URL` con una base local terminada en `_test`. Se omitieron deliberadamente para no tocar la base real.

Las pruebas unitarias verifican firma HMAC, expiración, permisos, plantillas XML, idempotencia de eventos, revisión de huellas y el aviso de dos días. Las pruebas de integración, cuando se habilitan, crean y limpian únicamente datos sintéticos en la base local autorizada.

## Archivos modificados

- Controladores y rutas de asistencia y socios.
- Servicio, contrato, lecturas y middleware biométricos.
- Evaluación de vigencia de membresías.
- Pruebas biométricas y script `npm test` en modo secuencial.

La configuración de conexión de Prisma y el esquema de datos permanecen como estaban en `main`.
