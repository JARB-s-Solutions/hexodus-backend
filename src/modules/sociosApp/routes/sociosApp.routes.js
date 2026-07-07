import { Router } from "express";
import { cerrarSesionSocioApp, obtenerPerfilSocioApp, solicitarOtpSocio, verificarOtpSocio } from "../controllers/sociosApp.controller.js";
import { verificarTokenSocioApp } from "../middlewares/sociosApp.middleware.js";

const router = Router();

router.post("/auth/request-otp", solicitarOtpSocio);
router.post("/auth/verify-otp", verificarOtpSocio);
router.post("/auth/logout", verificarTokenSocioApp, cerrarSesionSocioApp);
router.get("/me", verificarTokenSocioApp, obtenerPerfilSocioApp);

export default router;
