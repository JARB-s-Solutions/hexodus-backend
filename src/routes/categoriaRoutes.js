import { Router } from "express";
import { crearCategoria, listarCategorias, actualizarCategoria, eliminarCategoria, obtenerEstadisticasCategoria } from "../controller/categoriaController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Crear una nueva categoría
router.post("/", verificarToken, crearCategoria);
// Listar todas las categorías
router.get("/", verificarToken, listarCategorias);
// Actualizar una categoría
router.put("/:id", verificarToken, actualizarCategoria);
// Eliminar una categoría
router.delete("/:id", verificarToken, eliminarCategoria);
// Obtener estadísticas de una categoría
router.get("/stats/:id", verificarToken, obtenerEstadisticasCategoria);

export default router;