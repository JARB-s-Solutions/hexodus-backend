import { requestOtpSchema, verifyOtpSchema } from "../schemas/sociosApp.schemas.js";
import { getSocioAppProfile, logoutSocioApp, requestSocioOtp, verifySocioOtp } from "../services/sociosApp.service.js";

const getRequestMeta = (req) => ({
  ipAddress: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress,
  userAgent: req.headers["user-agent"],
  deviceId: req.headers["x-device-id"],
  deviceName: req.headers["x-device-name"],
  platform: req.headers["x-app-platform"],
  appVersion: req.headers["x-app-version"],
});

const handleError = (res, error) => {
  console.error("Error en socios app:", error);

  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : "Error interno del servidor.",
    ...(error.details ? { details: error.details } : {}),
  });
};

export const solicitarOtpSocio = async (req, res) => {
  try {
    const payload = requestOtpSchema.parse(req.body);
    const data = await requestSocioOtp({ ...payload, meta: getRequestMeta(req) });

    return res.status(200).json({
      message: "Código enviado correctamente.",
      data,
    });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(400).json({
        error: "Datos inválidos.",
        details: error.issues,
      });
    }

    return handleError(res, error);
  }
};

export const verificarOtpSocio = async (req, res) => {
  try {
    const payload = verifyOtpSchema.parse(req.body);
    const data = await verifySocioOtp({ ...payload, meta: getRequestMeta(req) });

    return res.status(200).json({
      message: "Sesión iniciada correctamente.",
      data,
    });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(400).json({
        error: "Datos inválidos.",
        details: error.issues,
      });
    }

    return handleError(res, error);
  }
};

export const obtenerPerfilSocioApp = async (req, res) => {
  try {
    const data = await getSocioAppProfile({ socioId: req.socioApp.socioId });

    return res.status(200).json({
      message: "Perfil de socio obtenido correctamente.",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const cerrarSesionSocioApp = async (req, res) => {
  try {
    await logoutSocioApp({
      socioId: req.socioApp.socioId,
      tokenId: req.socioApp.jti,
      meta: getRequestMeta(req),
    });

    return res.status(200).json({
      message: "Sesión cerrada correctamente.",
    });
  } catch (error) {
    return handleError(res, error);
  }
};
