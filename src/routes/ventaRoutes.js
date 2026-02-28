import { Router } from "express";
import { crearVenta, listarVentas, obtenerVenta } from "../controller/ventaController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Endpoint para registrar la venta
router.post("/", verificarToken, crearVenta);

// Endpoint para listar el historial de ventas
router.get("/", verificarToken, listarVentas);

// Endpoint para obtener detalle de una venta
router.get("/:id", verificarToken, obtenerVenta);

export default router;