import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

// Initializar Express app

const app = express();

// Seguridas básica (Headers HTTP)
app.use(helmet());

// Logger de peticiones
app.use(morgan('dev'));

// Parseo del cuerpo de las peticiones como JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Habilitar CORS
app.use(cors());

// RUTA DE PRUEBA
app.get("/", (req, res) => {
    res.json({
        message: "HEXODUS API funcionando correctamente",
        status: "success",
        timestamp: new Date().toISOString()
    });
});

export default app;