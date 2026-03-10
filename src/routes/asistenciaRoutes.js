import { Router } from "express";
import { 
    validarAsistenciaFacial, 
    obtenerHistorialAsistencias,
    obtenerAsistenciasHoy,
    obtenerAsistenciasSocio,
    registrarAsistenciaManual,
    sincronizarHuellas,
    validarAsistenciaHuella,
    marcarAsistenciaDenegada
} from "../controller/asistenciaController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js"; 

const router = Router();

// Todas las rutas requieren autenticación
router.use(verificarToken);

// RUTAS DEL KIOSKO BIOMÉTRICO
// Aunque venga del kiosko, si usamos JWT, debe tener permiso de crear asistencias
router.post("/validar", verificarPermiso("asistencia", "crear"), validarAsistenciaFacial);

// RUTAS BIOMÉTRICAS LOCALES (HUELLA)
router.get("/huellas/sincronizar", verificarToken, sincronizarHuellas);
// Ruta para registrar la entrada cuando el lector local hace Match
router.post("/huellas/validar", verificarToken, validarAsistenciaHuella);

// RUTAS ADMINISTRATIVAS / DASHBOARDS
// Ver el historial general
router.get("/", verificarPermiso("asistencia", "ver"), obtenerHistorialAsistencias);

// Ver asistencias del día actual
router.get("/hoy", verificarPermiso("asistencia", "ver"), obtenerAsistenciasHoy);

// Ver asistencias de un socio en particular
router.get("/socio/:id", verificarPermiso("asistencia", "ver"), obtenerAsistenciasSocio);

// Forzar un registro manual desde la tabla (cuando la huella/cara falla)
router.post("/manual", verificarPermiso("asistencia", "registrarManual"), registrarAsistenciaManual);

// Endpoint para corregir o forzar una denegación manualmente
router.patch("/:id/marcar-denegado", verificarPermiso("asistencia", "editar"), marcarAsistenciaDenegada);

export default router;