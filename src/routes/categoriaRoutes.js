import { Router } from "express";
import { crearCategoria, listarCategorias } from "../controller/categoriaController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Crear una nueva categoría
router.post("/", verificarToken, crearCategoria);
// Listar todas las categorías
router.get("/", verificarToken, listarCategorias);

export default router;