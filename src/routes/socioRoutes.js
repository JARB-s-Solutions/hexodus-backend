import { Router } from "express";
import { crearSocio } from "../controller/socioController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Ruta protegida para crear un socio con biometría
router.post("/", verificarToken, crearSocio);

export default router;