import { Router } from "express";
import { crearMetodoPago, listarMetodosPago } from "../controller/metodoPagoController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Rutas protegidas
router.post("/", verificarToken, crearMetodoPago);
router.get("/", verificarToken, listarMetodosPago);

export default router;