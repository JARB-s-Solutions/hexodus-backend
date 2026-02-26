import { Router } from "express";
import { crearSocio, cotizarMembresia } from "../controller/socioController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Ruta protegida para crear un socio con biometría
router.post("/", verificarToken, crearSocio);

// Ruta protegida para cotizar membresía
router.post("/cotizar", verificarToken, cotizarMembresia);

export default router;