import { Router } from "express";
import { registrarCompra } from "../controller/compraController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Ruta para registrar una compra
router.post("/", verificarToken, registrarCompra);

export default router;