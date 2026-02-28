import { Router } from "express";
import { crearProducto } from "../controller/productoController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Crear un producto nuevo
router.post("/", verificarToken, crearProducto);

export default router;