import express from "express";
import cors from "cors";
import helmet  from "helmet";
import morgan from "morgan";
import routes from "./routes/indexRoutes.js";

// Inicializar la app
const app = express();

// Seguridad básica (Headers HTTP)
app.use(helmet());

// Parseo del cuerpo de las peticiones (JSON y Forms)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use(cors());

// RUTA DE PRUEBA
app.get("/", (req, res) => {
    res.json({
        message: "ControlBarber API funcionando correctamente",
        status: "success",
        timestamp: new Date().toISOString()
    });
});

// Rutas centralizadas
app.use("/api", routes);

export default app;