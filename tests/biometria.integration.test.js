import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createBiometricService, consumeEnrollmentProof, prepareFingerprint, fingerprintRevision } from '../src/services/biometriaService.js';
import { signToken, verifyToken, sha256 } from '../src/utils/biometriaContrato.js';
import { exigirPermisosActuales } from '../src/middlewares/biometriaMiddleware.js';
import { leerSocioParaAsistencia } from '../src/services/biometriaLecturas.js';
import { evaluarAccesoSocio } from '../src/utils/membresiaVigencia.js';

const url = process.env.BIOMETRIC_TEST_DATABASE_URL;
test('PostgreSQL aislado: transacciones, duplicados concurrentes, revisión y recuperación', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && target.pathname.endsWith('_test'), 'Only an explicitly named local test database is allowed');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const suffix = randomUUID().slice(0, 8);
  const key = Buffer.alloc(32, 17).toString('base64'); // synthetic test key
  const env = { BIOMETRIC_DEVICE_KEYS: JSON.stringify({ 'TEST-KIOSK': key }), BIOMETRIC_ALLOWED_ORIGINS: '["https://gym.example"]' };
  const now = new Date();
  const xml = '<Fmd>synthetic-transaction-fixture</Fmd>'; // not a real SDK template
  const template = Buffer.from(xml).toString('base64');
  let user, plan;
  const members = [];
  const proofIds = [];
  const eventIds = [];
  const roleId = `biotest-${suffix}`;
  const fingerprintRows = () => db.socio.findMany({
    where: { isDeleted: false, huellaTemplate: { not: null } },
    select: { codigoSocio: true, huellaTemplate: true, status: true },
  });
  const currentRevision = async () => fingerprintRevision(await fingerprintRows());
  const createMember = async (name, extras = {}) => {
    const member = await db.socio.create({ data: { uuidSocio: randomUUID(), codigoSocio: `TEST-${suffix}-${name}`, nombreCompleto: `Synthetic ${name}`, ...extras } });
    members.push(member.id); return member;
  };
  try {
    await t.test('funciona sobre el esquema original sin tablas ni trigger biométricos nuevos', async () => {
      const tables = await db.$queryRaw`SELECT relname FROM pg_catalog.pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname IN ('biometric_revision', 'biometric_enrollment_proofs', 'biometric_receipts')`;
      assert.deepEqual(tables, []);
      const triggers = await db.$queryRaw`SELECT tgname FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.socios'::regclass AND NOT tgisinternal AND tgname ILIKE '%biometric%'`;
      assert.deepEqual(triggers, []);
      const auditTable = await db.$queryRaw`SELECT to_regclass('public.auditoria_log')::text AS name`;
      assert.equal(auditTable[0].name, 'auditoria_log');
    });
    await db.rol.create({ data: { id: roleId, nombre: roleId, esAdministrador: true } });
    user = await db.usuario.create({ data: { uid: randomUUID(), username: roleId, nombreCompleto: 'Synthetic test operator', email: `${suffix}@example.invalid`, password: 'not-a-login-hash', rolId: roleId } });
    plan = await db.membresiaPlan.create({ data: { uuidPlan: randomUUID(), nombre: roleId, precioBase: 1, duracionDias: 30 } });
    const member = await createMember('valid', { huellaTemplate: template });
    const membership = await db.membresiaSocio.create({ data: { uuidMembresiaSocio: randomUUID(), socioId: member.id, planId: plan.id, status: 'activa', estadoPago: 'pagado', fechaInicio: new Date(+now - 86400000), fechaFin: new Date(+now + 86400000) } });
    const service = createBiometricService({ db, env, requirePermissions: (req, perms) => exigirPermisosActuales(req, perms, db) });
    const request = body => ({ body, user: { id: user.id } });
    const event = (overrides = {}) => {
      const payload = { v: 1, purpose: 'recognition', kioskId: 'TEST-KIOSK', eventId: randomUUID(), instanceId: randomUUID(), codigoSocio: member.codigoSocio, tipo: 'IN', capturedAtUtc: now.toISOString(), ...overrides };
      eventIds.push(payload.eventId);
      return { payload, eventProof: signToken(payload, env) };
    };
    await t.test('lectura conjunta conserva decisiones, última membresía no cancelada y campos de respuesta', async () => {
      const candidate = await createMember("joined'--", { status: 'inactivo', huellaTemplate: template });
      const compare = async () => {
        const original = await db.socio.findUnique({ where: { codigoSocio: candidate.codigoSocio },
          include: { membresias: { where: { status: { not: 'cancelada' } }, orderBy: { fechaFin: 'desc' }, take: 1, include: { plan: true } } } });
        const joined = await db.$transaction(tx => leerSocioParaAsistencia(tx, candidate.codigoSocio));
        const m = original.membresias[0];
        assert.deepEqual(joined, {
          id: original.id, codigoSocio: original.codigoSocio, nombreCompleto: original.nombreCompleto,
          fotoUrl: original.fotoUrl, status: original.status, isDeleted: original.isDeleted,
          membresias: m ? [{ id: m.id, status: m.status, estadoPago: m.estadoPago, fechaFin: m.fechaFin, plan: { nombre: m.plan.nombre } }] : [],
        });
        assert.deepEqual(evaluarAccesoSocio(joined, joined.membresias[0], now), evaluarAccesoSocio(original, m, now));
        assert.equal(Object.hasOwn(joined, 'huellaTemplate'), false);
        return evaluarAccesoSocio(joined, joined.membresias[0], now);
      };
      assert.equal((await compare()).motivoCodigo, 'sin_membresia');
      const selected = await db.membresiaSocio.create({ data: { uuidMembresiaSocio: randomUUID(), socioId: candidate.id, planId: plan.id,
        status: 'vencida', estadoPago: 'pagado', fechaInicio: new Date(+now - 86400000), fechaFin: new Date(+now + 86400000) } });
      await db.membresiaSocio.create({ data: { uuidMembresiaSocio: randomUUID(), socioId: candidate.id, planId: plan.id,
        status: 'cancelada', estadoPago: 'sin_pagar', fechaInicio: now, fechaFin: new Date(+now + 10 * 86400000) } });
      assert.equal((await compare()).permitido, true);
      await db.membresiaSocio.update({ where: { id: selected.id }, data: { estadoPago: 'sin_pagar' } });
      assert.equal((await compare()).motivoCodigo, 'sin_pago');
      await db.membresiaSocio.update({ where: { id: selected.id }, data: { estadoPago: 'pagado', fechaFin: new Date(+now - 86400000) } });
      assert.equal((await compare()).motivoCodigo, 'membresia_vencida');
      await db.socio.update({ where: { id: candidate.id }, data: { status: 'bloqueado' } });
      assert.equal((await compare()).motivoCodigo, 'socio_bloqueado');
      await db.socio.update({ where: { id: candidate.id }, data: { isDeleted: true } });
      assert.equal((await compare()).motivoCodigo, 'socio_no_disponible');
      assert.equal(await leerSocioParaAsistencia(db, `unknown-${suffix}' OR 1=1 --`), null);
    });
    await t.test('permisos conjuntos reflejan revocación y desactivación entre solicitudes', async () => {
      await db.rol.update({ where: { id: roleId }, data: { esAdministrador: false, permisos: { asistencia: { crear: true } } } });
      try {
        await exigirPermisosActuales(request(), [['asistencia', 'crear']], db);
        await db.rol.update({ where: { id: roleId }, data: { permisos: {} } });
        await assert.rejects(exigirPermisosActuales(request(), [['asistencia', 'crear']], db), { code: 'BIOMETRIC_PERMISSION' });
        await db.usuario.update({ where: { id: user.id }, data: { status: 'inactivo' } });
        await assert.rejects(exigirPermisosActuales(request(), [], db), { code: 'SESSION_INACTIVE' });
      } finally {
        await db.usuario.update({ where: { id: user.id }, data: { status: 'activo' } });
        await db.rol.update({ where: { id: roleId }, data: { esAdministrador: true, permisos: {} } });
      }
    });
    await t.test('dos pestañas y respuesta perdida crean exactamente un acceso y recibo', async () => {
      const e = event();
      const results = await Promise.all(Array.from({ length: 8 }, () => service.recognize(request({ eventProof: e.eventProof }))));
      assert.equal(new Set(results.map(r => r.data.asistencia.id)).size, 1);
      assert.ok(results.every(r => r.data.decision === 'permitido'));
      assert.ok(results.every(r => r.data.motivo_codigo === 'proximo_vencer'), 'la huella conserva el aviso de la membresía que vence mañana');
      const auditId = `bio-event:${e.payload.eventId}`;
      assert.equal(await db.auditoriaLog.count({ where: { id: auditId } }), 1);
      assert.equal(await db.acceso.count({ where: { socioId: member.id } }), 1);
      const audit = await db.auditoriaLog.findUniqueOrThrow({ where: { id: auditId } });
      assert.equal(audit.modulo, 'biometria_interna');
      assert.equal(audit.detalles.kind, 'recognition');
      assert.equal(audit.detalles.eventId, e.payload.eventId);
      assert.equal(audit.detalles.accesoId, results[0].data.asistencia.id);
      assert.deepEqual(audit.detalles.response, results[0]);
      assert.deepEqual(await service.recognize(request({ eventProof: e.eventProof })), results[0]);
      assert.equal(verifyToken(results[0].receipt, 'receipt', { env }).payload.eventId, e.payload.eventId);
      await assert.rejects(service.recognize(request({ eventProof: signToken({ ...e.payload, codigoSocio: 'OTHER' }, env) })), { code: 'EVENT_CONFLICT' });
    });
    await t.test('lectura optimizada conserva normalización y revierte acceso si falla el comprobante', async () => {
      const candidate = await createMember('normalize', { status: 'inactivo' });
      const membership = await db.membresiaSocio.create({ data: { uuidMembresiaSocio: randomUUID(), socioId: candidate.id, planId: plan.id,
        status: 'vencida', estadoPago: 'pagado', fechaInicio: new Date(+now - 86400000), fechaFin: new Date(+now + 86400000) } });
      const e = event({ codigoSocio: candidate.codigoSocio });
      const failure = new Error('synthetic-receipt-write-failure');
      const failingDb = {
        auditoriaLog: db.auditoriaLog,
        $transaction: (callback, options) => db.$transaction(tx => callback(new Proxy(tx, {
          get(target, name) {
            if (name === 'auditoriaLog') return new Proxy(target.auditoriaLog, {
              get(model, method) { return method === 'update' ? async () => { throw failure; } : model[method]; },
            });
            return target[name];
          },
        })), options),
      };
      const failing = createBiometricService({ db: failingDb, env, requirePermissions: (req, perms) => exigirPermisosActuales(req, perms, db) });
      await assert.rejects(failing.recognize(request({ eventProof: e.eventProof })), error => error === failure);
      assert.equal(await db.acceso.count({ where: { socioId: candidate.id } }), 0);
      assert.equal(await db.auditoriaLog.count({ where: { id: `bio-event:${e.payload.eventId}` } }), 0);
      assert.equal((await db.socio.findUniqueOrThrow({ where: { id: candidate.id } })).status, 'inactivo');
      assert.equal((await db.membresiaSocio.findUniqueOrThrow({ where: { id: membership.id } })).status, 'vencida');
      const result = await service.recognize(request({ eventProof: e.eventProof }));
      assert.equal(result.data.decision, 'permitido');
      assert.equal((await db.socio.findUniqueOrThrow({ where: { id: candidate.id } })).status, 'activo');
      assert.equal((await db.membresiaSocio.findUniqueOrThrow({ where: { id: membership.id } })).status, 'activa');
      assert.deepEqual(await service.recognize(request({ eventProof: e.eventProof })), result);
      assert.equal(await db.acceso.count({ where: { socioId: candidate.id } }), 1);
    });
    await t.test('denegación persistida/idempotente; renovación usa información actual', async () => {
      await db.membresiaSocio.update({ where: { id: membership.id }, data: { fechaFin: new Date(+now - 2 * 86400000) } });
      const e = event();
      const denied = await service.recognize(request({ eventProof: e.eventProof }));
      assert.equal(denied.data.decision, 'denegado');
      assert.equal(denied.data.asistencia.tipo, 'DENEGADO');
      await db.membresiaSocio.update({ where: { id: membership.id }, data: { fechaFin: new Date(+now + 86400000) } });
      assert.deepEqual(await service.recognize(request({ eventProof: e.eventProof })), denied);
      assert.equal((await service.recognize(request({ eventProof: event().eventProof }))).data.decision, 'permitido');
    });
    await t.test('corregir manualmente el estado de una asistencia no duplica el evento ni bloquea su confirmación', async () => {
      const e = event();
      const original = await service.recognize(request({ eventProof: e.eventProof }));
      assert.equal(original.data.decision, 'permitido');
      const total = await db.acceso.count({ where: { socioId: member.id } });
      await db.acceso.update({ where: { id: original.data.asistencia.id }, data: { estadoAcceso: 'denegado' } });
      const replay = await service.recognize(request({ eventProof: e.eventProof }));
      assert.deepEqual(replay, original, 'la confirmación conserva el resultado que ya fue procesado');
      assert.equal(verifyToken(replay.receipt, 'receipt', { env }).payload.eventId, e.payload.eventId);
      assert.equal(await db.acceso.count({ where: { socioId: member.id } }), total);
      const edited = await db.acceso.findUniqueOrThrow({ where: { id: original.data.asistencia.id } });
      assert.equal(edited.estadoAcceso, 'denegado', 'el reintento no sobrescribe la corrección manual');
    });
    await t.test('bloqueos, bajas y desconocidos guardan denegación; captura antigua es recuperada', async () => {
      await db.socio.update({ where: { id: member.id }, data: { status: 'bloqueado' } });
      assert.equal((await service.recognize(request({ eventProof: event().eventProof }))).data.motivo_codigo, 'socio_bloqueado');
      await db.socio.update({ where: { id: member.id }, data: { status: 'activo', isDeleted: true } });
      assert.equal((await service.recognize(request({ eventProof: event().eventProof }))).data.decision, 'denegado');
      const unknown = await service.recognize(request({ eventProof: event({ codigoSocio: `MISSING-${suffix}` }).eventProof }));
      assert.equal(unknown.data.decision, 'denegado'); assert.equal(unknown.data.asistencia, null); assert.ok(unknown.receipt);
      await db.socio.update({ where: { id: member.id }, data: { isDeleted: false } });
      const oldTime = new Date(+now - 86400000).toISOString();
      const old = await service.recognize(request({ eventProof: event({ capturedAtUtc: oldTime }).eventProof }));
      assert.equal(old.data.recovered, true); assert.equal(old.data.asistencia.capturedAtUtc, oldTime);
    });
    await t.test('recibo cuyo acceso fue eliminado no confirma entrega ni vuelve a insertar', async () => {
      const e = event();
      const original = await service.recognize(request({ eventProof: e.eventProof }));
      await db.acceso.delete({ where: { id: original.data.asistencia.id } });
      const count = await db.acceso.count({ where: { socioId: member.id } });
      await assert.rejects(service.recognize(request({ eventProof: e.eventProof })), { code: 'BIO_RECEIPT_INCONSISTENT' });
      assert.equal(await db.acceso.count({ where: { socioId: member.id } }), count);
      assert.equal(await db.auditoriaLog.count({ where: { id: `bio-event:${e.payload.eventId}` } }), 1);
    });
    await t.test('snapshot autenticado incluye bloqueados para unicidad y conserva revisión coherente', async () => {
      await db.socio.update({ where: { id: member.id }, data: { status: 'bloqueado' } });
      const snapshot = await service.snapshot({ ...request(), query: { kioskId: 'TEST-KIOSK' } });
      const signed = verifyToken(snapshot.snapshot, 'cache', { env, maxBytes: 1000000 }).payload;
      assert.equal(signed.baseDeDatos.find(s => s.codigoSocio === member.codigoSocio).habilitado, false);
      assert.equal(snapshot.data.some(s => s.codigoSocio === member.codigoSocio), false);
      assert.equal(signed.revision, await currentRevision());
      assert.equal(snapshot.revision, signed.revision);
      assert.match(signed.revision, /^[a-f0-9]{64}$/);
      assert.ok(Date.parse(signed.issuedAtUtc) <= Date.now() + 1000);
      assert.ok(Date.parse(signed.issuedAtUtc) >= Date.now() - 10000);
      assert.equal(Date.parse(signed.expiresAtUtc) - Date.parse(signed.issuedAtUtc), 300000);
    });
    await t.test('dos enrollments sobre revisión R: solo uno escribe; proof y escritura hacen rollback juntos', async () => {
      const a = await createMember('enrollA'), b = await createMember('enrollB');
      const revision = await currentRevision();
      const fingerprint = targetCode => {
        const proofId = randomUUID(); proofIds.push(proofId);
        const proof = signToken({ v: 1, purpose: 'enrollment', kioskId: 'TEST-KIOSK', proofId, revision, codigoSocio: targetCode, templateSha256: sha256(Buffer.from(xml)), issuedAtUtc: new Date().toISOString(), expiresAtUtc: new Date(Date.now() + 290000).toISOString() }, env);
        return prepareFingerprint({ fingerprint_template: template, enrollment_proof: proof }, targetCode, { env });
      };
      const fa = fingerprint(a.codigoSocio), fb = fingerprint(b.codigoSocio);
      await assert.rejects(db.$transaction(async tx => { await consumeEnrollmentProof(tx, fa); throw new Error('rollback-test'); }), /rollback-test/);
      assert.equal(await db.auditoriaLog.count({ where: { id: `bio-proof:${fa.proof.proofId}` } }), 0);
      const write = (member, fp) => db.$transaction(async tx => { await consumeEnrollmentProof(tx, fp); await tx.socio.update({ where: { id: member.id }, data: { huellaTemplate: fp.template } }); });
      const outcomes = await Promise.allSettled([write(a, fa), write(b, fb)]);
      assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
      assert.equal(outcomes.find(o => o.status === 'rejected').reason.code, 'BIOMETRIC_REVISION_STALE');
      assert.equal(await db.socio.count({ where: { id: { in: [a.id, b.id] }, huellaTemplate: { not: null } } }), 1);
      assert.equal(await db.auditoriaLog.count({ where: { id: { in: [fa, fb].map(fp => `bio-proof:${fp.proof.proofId}`) } } }), 1);
    });
    await t.test('hash detecta reemplazo, eliminación, bloqueo/reactivación sin trigger ni cambios en campos ajenos', async () => {
      let before = await currentRevision();
      await db.socio.update({ where: { id: member.id }, data: { nombreCompleto: 'Changed display' } });
      assert.equal(await currentRevision(), before);
      for (const data of [{ status: 'activo' }, { isDeleted: true }, { isDeleted: false }, { huellaTemplate: Buffer.from('<Fmd>replacement</Fmd>').toString('base64') }, { huellaTemplate: null }]) {
        before = await currentRevision(); await db.socio.update({ where: { id: member.id }, data }); assert.notEqual(await currentRevision(), before);
      }
    });
    await t.test('una prueba consumida no se reutiliza aunque el contenido biométrico permanezca igual', async () => {
      const same = await createMember('replay', { huellaTemplate: template });
      const proofId = randomUUID(); proofIds.push(proofId);
      const payload = { v: 1, purpose: 'enrollment', kioskId: 'TEST-KIOSK', proofId, revision: await currentRevision(), codigoSocio: same.codigoSocio,
        templateSha256: sha256(Buffer.from(xml)), issuedAtUtc: new Date().toISOString(), expiresAtUtc: new Date(Date.now() + 290000).toISOString() };
      const fp = prepareFingerprint({ fingerprint_template: template, enrollment_proof: signToken(payload, env) }, same.codigoSocio, { env });
      await db.$transaction(async tx => { await consumeEnrollmentProof(tx, fp); await tx.socio.update({ where: { id: same.id }, data: { huellaTemplate: template } }); });
      assert.equal(await currentRevision(), payload.revision);
      await assert.rejects(db.$transaction(tx => consumeEnrollmentProof(tx, fp)), { code: 'ENROLLMENT_PROOF_REUSED' });
      const record = await db.auditoriaLog.findUniqueOrThrow({ where: { id: `bio-proof:${proofId}` } });
      assert.equal(record.detalles.kind, 'enrollment');
      assert.equal(record.detalles.revision, payload.revision);
    });
    await t.test('un cambio directo de socios invalida una captura previa sin depender de trigger', async () => {
      const targetMember = await createMember('external', { huellaTemplate: template });
      const proofId = randomUUID(); proofIds.push(proofId);
      const payload = { v: 1, purpose: 'enrollment', kioskId: 'TEST-KIOSK', proofId, revision: await currentRevision(), codigoSocio: targetMember.codigoSocio,
        templateSha256: sha256(Buffer.from(xml)), issuedAtUtc: new Date().toISOString(), expiresAtUtc: new Date(Date.now() + 290000).toISOString() };
      const fp = prepareFingerprint({ fingerprint_template: template, enrollment_proof: signToken(payload, env) }, targetMember.codigoSocio, { env });
      await db.socio.update({ where: { id: targetMember.id }, data: { status: 'bloqueado' } });
      await assert.rejects(db.$transaction(tx => consumeEnrollmentProof(tx, fp)), { code: 'BIOMETRIC_REVISION_STALE' });
      assert.equal(await db.auditoriaLog.count({ where: { id: `bio-proof:${proofId}` } }), 0);
    });
  } finally {
    await db.auditoriaLog.deleteMany({ where: { id: { in: [...eventIds.map(id => `bio-event:${id}`), ...proofIds.map(id => `bio-proof:${id}`)] } } });
    await db.acceso.deleteMany({ where: { socioId: { in: members } } });
    await db.membresiaSocio.deleteMany({ where: { socioId: { in: members } } });
    await db.socio.deleteMany({ where: { id: { in: members } } });
    if (plan) await db.membresiaPlan.delete({ where: { id: plan.id } });
    if (user) await db.usuario.delete({ where: { id: user.id } });
    await db.rol.deleteMany({ where: { id: roleId } });
    await db.$disconnect();
  }
});
