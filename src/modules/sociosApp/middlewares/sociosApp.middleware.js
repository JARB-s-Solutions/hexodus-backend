import jwt from "jsonwebtoken";
import { findActiveSocioAppSession, touchSocioAppSession } from "../repositories/sociosAppSession.repository.js";

export const verificarTokenSocioApp = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token de socio faltante o inválido." });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.tipo !== "socio_app" || decoded.scope !== "socio:app" || !decoded.socioId || !decoded.jti) {
      return res.status(403).json({ error: "Este token no pertenece a la app de socios." });
    }

    const session = await findActiveSocioAppSession({
      tokenId: decoded.jti,
      socioId: decoded.socioId,
    });

    if (!session) {
      return res.status(401).json({ error: "Tu sesión ya no está activa. Inicia sesión nuevamente." });
    }

    await touchSocioAppSession({ id: session.id });

    req.socioApp = decoded;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Tu sesión expiró. Inicia sesión nuevamente." });
    }

    return res.status(401).json({ error: "Token de socio inválido." });
  }
};
