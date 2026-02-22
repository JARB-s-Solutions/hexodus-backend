import { Router } from "express";
import { crearMembresia } from "../controller/membresiaController.js";
import { verificarToken } from "../middlewares/authMiddleware.js"

const router = Router();

// Ruta para crear una membresía.
router.post("/", verificarToken, crearMembresia);

export default router;