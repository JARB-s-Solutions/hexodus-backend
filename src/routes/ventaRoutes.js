import { Router } from "express";
import { crearVenta } from "../controller/ventaController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Endpoint para registrar la venta
router.post("/", verificarToken, crearVenta);

export default router;