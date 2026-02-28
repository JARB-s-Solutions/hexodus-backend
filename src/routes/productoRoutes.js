import { Router } from "express";
import { crearProducto, listarProductos } from "../controller/productoController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Crear un producto nuevo
router.post("/", verificarToken, crearProducto);
// Listar productos (con stock)
router.get("/", verificarToken, listarProductos);

export default router;