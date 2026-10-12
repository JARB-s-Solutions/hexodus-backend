import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import {
  signToken, verifyToken, validateRecognition, validateEnrollmentProof, templateBytes,
  sha256, allowedOrigin, validateLegacyAttendance, checkLifetime, utcDate,
} from "../src/utils/biometriaContrato.js";
import { createBiometricService, prepareFingerprint, fingerprintRevision } from "../src/services/biometriaService.js";
import { exigirPermisosActuales } from "../src/middlewares/biometriaMiddleware.js";

const secret = Buffer.alloc(32, 17);
const env = { BIOMETRIC_DEVICE_KEYS: JSON.stringify({ "TEST-KIOSK": secret.toString("base64") }), BIOMETRIC_ALLOWED_ORIGINS: '["https://gym.example"]' };
const now = new Date("2026-10-10T12:00:00.000Z");
const recognition = (overrides = {}) => ({ v: 1, purpose: "recognition", kioskId: "TEST-KIOSK", eventId: randomUUID(), instanceId: randomUUID(), codigoSocio: "SOC-TEST", tipo: "IN", capturedAtUtc: now.toISOString(), ...overrides });
const xml = '<Fmd><Bytes>áé</Bytes></Fmd>';
const template = Buffer.from(xml, "utf8").toString("base64");
const revision = sha256("synthetic-fingerprint-snapshot");
const enrollment = (overrides = {}) => ({ v: 1, purpose: "enrollment", kioskId: "TEST-KIOSK", proofId: randomUUID(), revision, codigoSocio: null, templateSha256: sha256(Buffer.from(xml, "utf8")), issuedAtUtc: now.toISOString(), expiresAtUtc: new Date(+now + 300_000).toISOString(), ...overrides });

test("firma el segmento Base64URL exacto y valida con HMAC independiente", () => {
  const payload = recognition();
  const token = signToken(payload, env);
  const [segment, signature] = token.split(".");
  assert.equal(signature, createHmac("sha256", secret).update(segment, "ascii").digest("base64url"));
  assert.deepEqual(verifyToken(token, "recognition", { env }).payload, payload);
});

test("rechaza alteración, propósito diferente, clave revocada y base64 no canónico", () => {
  const token = signToken(recognition(), env);
  const [segment, signature] = token.split(".");
  assert.throws(() => verifyToken(`${segment}.${signature.slice(0, -2)}AA`, "recognition", { env }), { code: "INVALID_SIGNATURE" });
  assert.throws(() => verifyToken(token, "session", { env }), { code: "INVALID_PURPOSE" });
  assert.throws(() => verifyToken(token, "recognition", { env: { BIOMETRIC_DEVICE_KEYS: "{}" } }), { code: "DEVICE_UNAUTHORIZED" });
  assert.throws(() => verifyToken(`${segment}=.${signature}`, "recognition", { env }), { code: "INVALID_PROOF" });
});

test("reconocimiento recuperable acepta captura antigua sin inventar expiración o confianza", () => {
  const token = signToken(recognition({ capturedAtUtc: "2026-01-01T01:02:03.1234567Z" }), env);
  assert.equal(validateRecognition(token, { env, now }).payload.capturedAtUtc, "2026-01-01T01:02:03.1234567Z");
  assert.throws(() => validateRecognition(signToken(recognition({ confidence: 100 }), env), { env, now }), { code: "INVALID_INPUT" });
  assert.throws(() => validateRecognition(signToken(recognition({ capturedAtUtc: "2026-10-11T12:00:00Z" }), env), { env, now }), { code: "FUTURE_EVENT" });
  assert.throws(() => validateRecognition(signToken(recognition({ tipo: "DENEGADO" }), env), { env, now }), { code: "INVALID_TYPE" });
});

test("prueba de enrollment liga socio, revisión, XML UTF8 y caducidad", () => {
  const proof = signToken(enrollment(), env);
  assert.equal(validateEnrollmentProof(proof, template, null, { env, now }).revision, revision);
  assert.throws(() => validateEnrollmentProof(proof, template, "SOC-OTHER", { env, now }), { code: "PROOF_MISMATCH" });
  assert.throws(() => validateEnrollmentProof(proof, Buffer.from("<Fmd>other</Fmd>").toString("base64"), null, { env, now }), { code: "PROOF_MISMATCH" });
  assert.throws(() => validateEnrollmentProof(proof, template, null, { env, now: new Date(+now + 300_000) }), { code: "PROOF_EXPIRED" });
  assert.throws(() => validateEnrollmentProof(signToken(enrollment({ revision: "-1" }), env), template, null, { env, now }), { code: "INVALID_REVISION" });
  for (const invalidRevision of ["42", "A".repeat(64), "a".repeat(63), "g".repeat(64)]) {
    assert.throws(() => validateEnrollmentProof(signToken(enrollment({ revision: invalidRevision }), env), template, null, { env, now }), { code: "INVALID_REVISION" });
  }
});

test("la revisión de contenido es estable y detecta cambios biométricos sin contador en base de datos", () => {
  const a = { id: 1, codigoSocio: "SOC-A", huellaTemplate: template, status: "activo" };
  const b = { id: 2, codigoSocio: "SOC-B", huellaTemplate: Buffer.from("<Fmd>other</Fmd>").toString("base64"), status: "bloqueado" };
  const initial = fingerprintRevision([a, b]);
  assert.match(initial, /^[a-f0-9]{64}$/);
  assert.equal(fingerprintRevision([b, a]), initial, "el orden de consulta no cambia la revisión");
  assert.equal(fingerprintRevision([{ ...a, nombreCompleto: "Otro nombre", huellaUpdatedAt: new Date(), id: 99 }, b]), initial);
  assert.equal(fingerprintRevision([{ ...a, status: "inactivo" }, b]), initial, "solo bloqueo afecta la habilitación biométrica");
  assert.notEqual(fingerprintRevision([{ ...a, codigoSocio: "SOC-C" }, b]), initial);
  assert.notEqual(fingerprintRevision([{ ...a, huellaTemplate: b.huellaTemplate }, b]), initial);
  assert.notEqual(fingerprintRevision([{ ...a, status: "bloqueado" }, b]), initial);
  assert.notEqual(fingerprintRevision([a]), initial);
  assert.match(fingerprintRevision([]), /^[a-f0-9]{64}$/);
});

test("plantillas limitadas y sin declaraciones XML peligrosas", () => {
  assert.equal(templateBytes(template).toString("utf8"), xml);
  for (const invalid of ["", "<Fmd/>", "@@", Buffer.from('<!DOCTYPE Fmd [<!ENTITY x SYSTEM "file:///c:/secret">]><Fmd/>').toString("base64"), Buffer.alloc(65 * 1024).toString("base64")]) {
    assert.throws(() => templateBytes(invalid), { code: "INVALID_TEMPLATE" });
  }
  assert.throws(() => utcDate("2026-02-31T12:00:00Z"), { code: "INVALID_DATE" });
  assert.throws(() => checkLifetime(enrollment({ expiresAtUtc: new Date(+now + 3600_000).toISOString() }), 300_000, now), { code: "PROOF_EXPIRED" });
});

test("legacy exige un identificador inequívoco y tipos estrictos", () => {
  assert.deepEqual(validateLegacyAttendance({ socioId: "12", kioskId: "TEST-KIOSK" }), { id: 12 });
  for (const body of [{ socioId: "12abc" }, { socioId: 1, codigoSocio: "SOC-TEST" }, {}, { codigoSocio: {} }, { socioId: 1, tipo: "DENEGADO" }, { socioId: 1, confidence: "100" }]) {
    assert.throws(() => validateLegacyAttendance({ kioskId: "TEST-KIOSK", ...body }));
  }
});

test("orígenes exactos y capability limitada de enrollment", async () => {
  assert.equal(allowedOrigin("https://gym.example", env), "https://gym.example");
  for (const origin of [undefined, "null", "https://evil.gym.example", "https://gym.example.evil", "http://gym.example"]) assert.throws(() => allowedOrigin(origin, env), { code: "ORIGIN_UNAUTHORIZED" });
  const checks = [];
  const service = createBiometricService({ db: {}, env, clock: () => now, requirePermissions: async (_, permissions) => checks.push(permissions) });
  const response = await service.session({ body: { kioskId: "TEST-KIOSK", scope: "enrollment" }, headers: { origin: "https://gym.example" } });
  const p = verifyToken(response.data.motorToken, "session", { env }).payload;
  assert.equal(p.codigoSocio, null);
  assert.equal(new Date(p.expiresAtUtc) - new Date(p.issuedAtUtc), 600_000);
  assert.deepEqual(checks[0], [["biometria", "enrolar"], ["biometria", "sincronizar"], ["socios", "crear"]]);
});

test("permisos actuales invalidan token de administrador antiguo y usuario bloqueado", async () => {
  const oldAdminRequest = () => ({ user: { id: 1, rol: { esAdministrador: true }, permisos: { biometria: { sincronizar: true } } } });
  const revokedRole = { $queryRaw: async () => [{ id: 1, status: "activo", rolId: "operator", esAdministrador: false, permisos: {} }] };
  await assert.rejects(exigirPermisosActuales(oldAdminRequest(), [["biometria", "sincronizar"]], revokedRole), { code: "BIOMETRIC_PERMISSION" });
  const inactive = { $queryRaw: async () => [{ id: 1, status: "bloqueado", rolId: "admin", esAdministrador: true }] };
  await assert.rejects(exigirPermisosActuales(oldAdminRequest(), [], inactive), { code: "SESSION_INACTIVE" });
});

test("omitir huella conserva; null elimina; plantilla sin prueba falla en modo seguro", () => {
  const previous = process.env.BIOMETRIC_ALLOW_LEGACY;
  process.env.BIOMETRIC_ALLOW_LEGACY = "false";
  try {
    assert.deepEqual(prepareFingerprint({}, "SOC-TEST"), { changed: false });
    assert.deepEqual(prepareFingerprint({ fingerprint_template: null }, "SOC-TEST"), { changed: true, template: null, proof: null });
    assert.throws(() => prepareFingerprint({ fingerprint_template: template }, null), { code: "ENROLLMENT_PROOF_REQUIRED" });
  } finally { if (previous === undefined) delete process.env.BIOMETRIC_ALLOW_LEGACY; else process.env.BIOMETRIC_ALLOW_LEGACY = previous; }
});
