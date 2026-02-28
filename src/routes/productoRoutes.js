import { Router } from "express";
import { crearProducto, listarProductos, obtenerProducto, actualizarProducto, ajustarStock, eliminarProducto } from "../controller/productoController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Crear un producto nuevo
router.post("/", verificarToken, crearProducto);
// Listar productos (con stock)
router.get("/", verificarToken, listarProductos);
// Obtener un producto por ID
router.get("/:id", verificarToken, obtenerProducto);
// Actualizar un producto por ID
router.put("/:id", verificarToken, actualizarProducto);
// Ajustar stock de un producto
router.post("/:id/ajuste", verificarToken, ajustarStock);
// Eliminar Producto
router.delete("/:id", verificarToken, eliminarProducto);
export default router;