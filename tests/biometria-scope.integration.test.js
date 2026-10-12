import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = process.env.BIOMETRIC_TEST_DATABASE_URL;

// Exercise the real shared controllers, not copies of their implementations.
// Never import/connect their singleton client until both explicit URLs are checked.
test('regresión: socios y auditoría sin configurar el motor', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && target.pathname.endsWith('_test'),
    'Only an explicitly named local test database is allowed');
  assert.equal(process.env.DATABASE_URL, url, 'The controller client must use the same explicit local test database');

  const savedEnv = Object.fromEntries(['BIOMETRIC_DEVICE_KEYS', 'BIOMETRIC_ALLOWED_ORIGINS', 'BIOMETRIC_ALLOW_LEGACY']
    .map(key => [key, process.env[key]]));
  process.env.BIOMETRIC_DEVICE_KEYS = '{}';
  process.env.BIOMETRIC_ALLOWED_ORIGINS = '[]';
  delete process.env.BIOMETRIC_ALLOW_LEGACY;

  const { default: db } = await import('../src/config/prisma.js');
  const { crearSocio, actualizarSocio } = await import('../src/controller/socioController.js');
  const { listarLogs } = await import('../src/controller/auditoriaController.js');
  const suffix = randomUUID().slice(0, 8);
  const roleId = `scope-${suffix}`;
  let user, plan, plainId, facialId;
  let paymentShift, ownedConcept;
  const paymentMethods = [];
  const response = () => ({
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const request = (body, id) => ({
    body, params: id === undefined ? {} : { id: String(id) }, query: {},
    user: { id: user.id }, headers: {}, socket: { remoteAddress: '127.0.0.1' },
    get() { return 'biometric-scope-regression'; },
  });
  const call = async (controller, req, expected) => {
    const res = response();
    await controller(req, res);
    assert.equal(res.statusCode, expected, JSON.stringify(res.body));
    return res.body;
  };
  try {
    await db.rol.create({ data: { id: roleId, nombre: roleId, esAdministrador: false,
      permisos: { socios: { crear: true, editar: true } } } });
    user = await db.usuario.create({ data: { uid: randomUUID(), username: roleId,
      nombreCompleto: 'Synthetic scope operator', email: `${roleId}@example.invalid`,
      password: 'not-a-login-hash', rolId: roleId } });
    plan = await db.membresiaPlan.create({ data: { uuidPlan: randomUUID(), nombre: roleId,
      precioBase: 123, duracionDias: 30 } });

    await t.test('alta sin biometría conserva contrato y membresía sin exigir permisos de huella', async () => {
      const body = await call(crearSocio, request({
        personal: { nombre_completo: `Scope plain ${suffix}`, genero: 'M' },
        detalles_contrato: { contrato_firmado: true, inicio_contrato: '2026-10-01', fin_contrato: '2026-11-01' },
        membresia: { plan_id: plan.id, fecha_inicio: '2026-10-01', estado_pago: 'sin_pagar' },
      }), 201);
      plainId = body.data.socio_id;
      const row = await db.socio.findUniqueOrThrow({ where: { id: plainId }, include: { contratos: true, membresias: true } });
      assert.equal(row.nombreCompleto, `Scope plain ${suffix}`);
      assert.equal(row.huellaTemplate, null);
      assert.equal(row.huellaUpdatedAt, null);
      assert.equal(row.contratos.length, 1);
      assert.equal(row.membresias.length, 1);
      assert.equal(row.membresias[0].planId, plan.id);
      assert.equal(row.membresias[0].estadoPago, 'sin_pagar');
      assert.equal(Number(row.membresias[0].precioCongelado), 123);
    });

    await t.test('alta exclusivamente facial conserva foto y descriptor sin clave de motor', async () => {
      const face = [0.123, -0.456, 0.789]; // Synthetic storage fixture, not a recognition accuracy test.
      const faceDate = '2026-10-01T12:00:00.000Z';
      const body = await call(crearSocio, request({
        personal: { nombre_completo: `Scope face ${suffix}`, genero: 'F' },
        biometria: { foto_perfil_url: 'https://example.invalid/synthetic.png',
          face_encoding: face, face_encoding_updated_at: faceDate },
      }), 201);
      facialId = body.data.socio_id;
      const row = await db.socio.findUniqueOrThrow({ where: { id: facialId } });
      assert.deepEqual(row.faceEncoding, face);
      assert.equal(row.faceEncodingUpdatedAt.toISOString(), faceDate);
      assert.equal(row.fotoUrl, 'https://example.invalid/synthetic.png');
      assert.equal(row.huellaTemplate, null);
      assert.equal(row.huellaUpdatedAt, null);
    });

    await t.test('edición personal sin huella conserva la plantilla existente y la membresía', async () => {
      const storedTemplate = Buffer.from('<Fmd>synthetic-existing-template</Fmd>').toString('base64');
      const storedAt = new Date('2026-10-01T12:01:00.000Z');
      await db.socio.update({ where: { id: plainId }, data: { huellaTemplate: storedTemplate, huellaUpdatedAt: storedAt } });
      const before = await db.membresiaSocio.findMany({ where: { socioId: plainId } });
      await call(actualizarSocio, request({ personal: { nombre_completo: `Edited ${suffix}`, numero_telefono: '5551234567' } }, plainId), 200);
      const row = await db.socio.findUniqueOrThrow({ where: { id: plainId } });
      assert.equal(row.nombreCompleto, `Edited ${suffix}`);
      assert.equal(row.telefono, '5551234567');
      assert.equal(row.huellaTemplate, storedTemplate);
      assert.equal(row.huellaUpdatedAt.toISOString(), storedAt.toISOString());
      assert.deepEqual(await db.membresiaSocio.findMany({ where: { socioId: plainId } }), before);
    });

    await t.test('edición exclusivamente facial no modifica huella ni requiere el motor', async () => {
      const before = await db.socio.findUniqueOrThrow({ where: { id: plainId } });
      await call(actualizarSocio, request({ biometria: { face_encoding: [0.9, 0.8, 0.7], foto_perfil_url: 'https://example.invalid/edited.png' } }, plainId), 200);
      const after = await db.socio.findUniqueOrThrow({ where: { id: plainId } });
      assert.deepEqual(after.faceEncoding, [0.9, 0.8, 0.7]);
      assert.ok(after.faceEncodingUpdatedAt instanceof Date);
      assert.equal(after.fotoUrl, 'https://example.invalid/edited.png');
      assert.equal(after.huellaTemplate, before.huellaTemplate);
      assert.equal(after.huellaUpdatedAt.toISOString(), before.huellaUpdatedAt.toISOString());
      assert.equal(await db.auditoriaLog.count({ where: { usuarioId: user.id, modulo: 'biometria_interna' } }), 0);
    });

    await t.test('la validación de datos personales mantiene su respuesta original', async () => {
      const body = await call(crearSocio, request({ personal: { nombre_completo: '' } }), 400);
      assert.deepEqual(body, { error: 'El Nombre Completo y Género son obligatorios.' });
    });

    await t.test('un conflicto de transacción sin huella conserva el error original de alta', async () => {
      const transaction = db.$transaction;
      const logs = t.mock.method(console, 'error', () => {});
      try {
        db.$transaction = async () => { throw Object.assign(new Error('synthetic-conflict'), { code: 'P2034' }); };
        const body = await call(crearSocio, request({ personal: { nombre_completo: 'Synthetic failure', genero: 'M' } }), 500);
        assert.deepEqual(body, { error: 'Error interno del servidor al registrar al socio.' });
      } finally {
        db.$transaction = transaction;
        logs.mock.restore();
      }
    });

    await t.test('un conflicto de transacción sin huella conserva el error original de edición', async () => {
      const transaction = db.$transaction;
      const logs = t.mock.method(console, 'error', () => {});
      try {
        db.$transaction = async () => { throw Object.assign(new Error('synthetic-conflict'), { code: 'P2034' }); };
        const body = await call(actualizarSocio, request({ personal: { numero_telefono: '5550000000' } }, plainId), 500);
        assert.deepEqual(body, { error: 'Error interno al actualizar el perfil del socio.' });
        const row = await db.socio.findUniqueOrThrow({ where: { id: plainId } });
        assert.equal(row.telefono, '5551234567');
      } finally {
        db.$transaction = transaction;
        logs.mock.restore();
      }
    });

    await t.test('alta sin huella conserva pago simple, pago dividido y rechazo de importes incorrectos', async () => {
      assert.equal(await db.corteCaja.count({ where: { status: 'abierto' } }), 0, 'test database must not contain another open shift');
      paymentShift = await db.corteCaja.create({ data: { usuarioId: user.id, inicio: new Date(), fin: new Date(), status: 'abierto' } });
      for (const name of ['cash', 'card']) paymentMethods.push(await db.metodoPago.create({ data: { nombre: `${suffix}-${name}`, createdBy: user.id } }));
      if (!await db.concepto.findUnique({ where: { nombre: 'Inscripción / Membresía' } })) {
        ownedConcept = await db.concepto.create({ data: { nombre: 'Inscripción / Membresía', tipo: 'ingreso' } });
      }
      for (const split of [false, true]) {
        const payments = split ? [{ metodo_pago_id: paymentMethods[0].id, monto: 50 }, { metodo_pago_id: paymentMethods[1].id, monto: 73 }] : null;
        const body = await call(crearSocio, request({
          personal: { nombre_completo: `Paid ${suffix} ${split}`, genero: 'M' },
          membresia: { plan_id: plan.id, fecha_inicio: '2026-10-01', estado_pago: 'pagado',
            ...(split ? { pagos: payments } : { metodo_pago_id: paymentMethods[0].id }) },
        }), 201);
        const membership = await db.membresiaSocio.findFirstOrThrow({ where: { socioId: body.data.socio_id }, include: { pagos: true } });
        assert.equal(membership.estadoPago, 'pagado'); assert.equal(Number(membership.precioCongelado), 123);
        assert.equal(membership.pagos.length, split ? 2 : 1);
        assert.equal(membership.pagos.reduce((sum, p) => sum + Number(p.monto), 0), 123);
        assert.deepEqual(membership.pagos.map(p => [p.metodoPagoId, Number(p.monto)]).sort(),
          (split ? [[paymentMethods[0].id, 50], [paymentMethods[1].id, 73]] : [[paymentMethods[0].id, 123]]).sort());
        const movements = await db.cajaMovimiento.findMany({ where: { corteId: paymentShift.id, referenciaId: membership.id, referenciaTipo: 'membresia' } });
        assert.equal(movements.length, membership.pagos.length);
        assert.equal(movements.reduce((sum, m) => sum + Number(m.monto), 0), 123);
      }
      const before = await db.socio.count({ where: { createdBy: user.id } });
      const log = t.mock.method(console, 'error', () => {});
      try {
        await call(crearSocio, request({ personal: { nombre_completo: `Invalid paid ${suffix}`, genero: 'M' },
          membresia: { plan_id: plan.id, fecha_inicio: '2026-10-01', estado_pago: 'pagado', pagos: [{ metodo_pago_id: paymentMethods[0].id, monto: 1 }] },
        }), 400);
      } finally { log.mock.restore(); }
      assert.equal(await db.socio.count({ where: { createdBy: user.id } }), before);
      assert.equal(await db.pagoMembresia.count({ where: { recibidoPor: user.id } }), 3);
    });

    await t.test('auditoría normal continúa visible y sus totales excluyen comprobantes técnicos', async () => {
      const ordinaryId = randomUUID();
      await db.auditoriaLog.createMany({ data: [
        { id: ordinaryId, usuarioId: user.id, modulo: 'socios', accion: 'editar', descripcion: 'Synthetic human audit' },
        { id: `bio-event:${randomUUID()}`, usuarioId: user.id, modulo: 'biometria_interna', accion: 'evento', descripcion: 'Synthetic receipt' },
        { id: `bio-proof:${randomUUID()}`, usuarioId: user.id, modulo: 'biometria_interna', accion: 'enrolamiento', descripcion: 'Synthetic enrollment receipt' },
      ] });
      const req = request({});
      req.query = { usuarioId: String(user.id) };
      const body = await call(listarLogs, req, 200);
      assert.deepEqual(body.data.map(row => row.id), [ordinaryId]);
      assert.equal(body.pagination.total, 1);
      assert.equal(body.data[0].usuario.username, roleId);
      req.query.modulo = 'biometria_interna';
      const filtered = await call(listarLogs, req, 200);
      assert.deepEqual(filtered.data, []);
      assert.equal(filtered.pagination.total, 0);
      assert.equal(await db.auditoriaLog.count({ where: { usuarioId: user.id } }), 3, 'listing must not delete receipts');
    });
  } finally {
    if (user) {
      const own = await db.socio.findMany({ where: { createdBy: user.id }, select: { id: true } });
      const ids = own.map(row => row.id);
      await db.auditoriaLog.deleteMany({ where: { usuarioId: user.id } });
      await db.socioContrato.deleteMany({ where: { socioId: { in: ids } } });
      await db.pagoMembresia.deleteMany({ where: { recibidoPor: user.id } });
      await db.cajaMovimiento.deleteMany({ where: { usuarioId: user.id } });
      if (paymentShift) await db.corteCaja.delete({ where: { id: paymentShift.id } });
      for (const method of paymentMethods) await db.metodoPago.delete({ where: { id: method.id } });
      if (ownedConcept) await db.concepto.delete({ where: { id: ownedConcept.id } });
      await db.membresiaSocio.deleteMany({ where: { socioId: { in: ids } } });
      await db.socio.deleteMany({ where: { id: { in: ids } } });
      await db.usuario.delete({ where: { id: user.id } });
    }
    if (plan) await db.membresiaPlan.delete({ where: { id: plan.id } });
    await db.rol.deleteMany({ where: { id: roleId } });
    await db.$disconnect();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
