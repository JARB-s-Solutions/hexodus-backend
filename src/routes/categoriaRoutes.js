import { Router } from "express";
import { crearCategoria, listarCategorias, actualizarCategoria, eliminarCategoria, obtenerEstadisticasCategoria } from "../controller/categoriaController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren estar logueado
router.use(verificarToken);

// Permisos por acción (Módulo: inventario)

// Listar todas las categorías (Solo requiere permiso de ver inventario)
router.get("/", verificarPermiso("inventario", "ver"), listarCategorias);

// Obtener estadísticas de una categoría
router.get("/stats/:id", verificarPermiso("inventario", "ver"), obtenerEstadisticasCategoria);

// Acciones de modificación (Requieren el permiso especial de gestionarCategorias)
router.post("/", verificarPermiso("inventario", "gestionarCategorias"), crearCategoria);
router.put("/:id", verificarPermiso("inventario", "gestionarCategorias"), actualizarCategoria);
router.delete("/:id", verificarPermiso("inventario", "gestionarCategorias"), eliminarCategoria);

export default router;