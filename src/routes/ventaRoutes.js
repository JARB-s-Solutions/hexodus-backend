import { Router } from "express";
import { crearVenta, listarVentas, obtenerVenta } from "../controller/ventaController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas de ventas requieren estar logueado
router.use(verificarToken);

// Permisos por acción (Módulo: ventas)

// Endpoint para registrar la venta (Crea ticket, afecta inventario y suma a caja)
router.post("/", verificarPermiso("ventas", "crear"), crearVenta);

// Endpoint para listar el historial de ventas
router.get("/", verificarPermiso("ventas", "ver"), listarVentas);

// Endpoint para obtener detalle de una venta específica
router.get("/:id", verificarPermiso("ventas", "ver"), obtenerVenta);

export default router;