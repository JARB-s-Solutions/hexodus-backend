import { Router } from "express";
import { crearProducto, listarProductos, obtenerProducto, actualizarProducto, ajustarStock, eliminarProducto } from "../controller/productoController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren estar logueado
router.use(verificarToken);

// Permisos por acción (Módulo: inventario)

// Rutas de visualización
router.get("/", verificarPermiso("inventario", "ver"), listarProductos);
router.get("/:id", verificarPermiso("inventario", "ver"), obtenerProducto);

// Rutas de creación y modificación de productos
router.post("/", verificarPermiso("inventario", "crear"), crearProducto);
router.put("/:id", verificarPermiso("inventario", "editar"), actualizarProducto);

// Ruta crítica: Ajustar stock (Requiere permiso específico)
router.post("/:id/ajuste", verificarPermiso("inventario", "ajustarStock"), ajustarStock);

// Ruta de eliminación
router.delete("/:id", verificarPermiso("inventario", "eliminar"), eliminarProducto);

export default router;