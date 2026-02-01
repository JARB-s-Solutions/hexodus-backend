## 📝 ESTRUCTURA DE COLECCIONES FIRESTORE

```
📦 Firestore Database
├── 📁 users (usuarios del sistema - admin, staff)
│   └── {userId}
│       ├── email: string
│       ├── nombre: string
│       ├── role: string
│       ├── password: string (hasheado)
│       └── activo: boolean
│
├── 📁 socios (miembros del gimnasio)
│   └── {socioId}
│       ├── nombre, apellido, email, telefono, genero, direccion
│       ├── membresiaId, membresiaInfo, fechas
│       ├── estado: string
│       ├── faceDescriptor: array
│       ├── foto: string
│       └── 📁 historialMembresias (subcolección)
│
├── 📁 membresias (tipos de membresías disponibles)
│   └── {membresiaId}
│       ├── nombre, tipo, precio, duracion
│       ├── esOferta, descuento
│       └── activa: boolean
│
├── 📁 pagos (pagos de membresías)
│   └── {pagoId}
│       ├── socioId, membresiaId
│       ├── importe, metodoPago, folio
│       └── fecha: timestamp
│
├── 📁 registros_acceso (control de asistencia)
│   └── {registroId}
│       ├── socioId, nombreSocio
│       ├── timestamp
│       ├── tipo: "permitido" | "rechazado"
│       └── confianza: number
│
├── 📁 productos (inventario)
│   └── {productoId}
│       ├── nombre, codigo, categoria, marca
│       ├── precioCompra, precioVenta
│       ├── stockActual, stockMinimo, estadoStock
│       └── activo: boolean
│
├── 📁 ventas (transacciones de productos)
│   └── {ventaId}
│       ├── folio, cliente, socioId
│       ├── productos: array
│       ├── total, metodoPago
│       └── fecha: timestamp
│
├── 📁 compras (compras de inventario)
│   └── {compraId}
│       ├── proveedor
│       ├── productos: array
│       ├── total
│       └── fecha: timestamp
│
├── 📁 movimientos (movimientos financieros)
│   └── {movimientoId}
│       ├── tipo: "ingreso" | "egreso"
│       ├── concepto, categoria
│       ├── monto, metodoPago
│       ├── referenciaId, referenciaModulo
│       └── fecha: timestamp
│
├── 📁 configuracion (configuración del sistema)
│   └── sistema_config (documento único)
│       ├── apariencia: {}
│       ├── notificaciones: {}
│       └── reconocimientoFacial: {}
│
└── 📁 logs (registro de actividades)
    └── {logId}
        ├── tipo, accion, userId
        ├── detalles: {}
        └── timestamp
```

## 📚 RECURSOS ADICIONALES

### Dependencias NPM Recomendadas:
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "firebase-admin": "^12.0.0",
    "jsonwebtoken": "^9.0.2",
    "bcryptjs": "^2.4.3",
    "zod": "^3.22.4",
    "dotenv": "^16.4.1",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "morgan": "^1.10.0",
    "express-rate-limit": "^7.1.5",
    "nodemailer": "^6.9.8"
  },
  "devDependencies": {
    "nodemon": "^3.0.3",
    "jest": "^29.7.0",
    "supertest": "^6.3.4"
  }
}
```

### Variables de Entorno (.env):
```env
PORT=3000
NODE_ENV=development

# Firebase
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# JWT
JWT_SECRET=
JWT_EXPIRES_IN=7d

# Email (opcional)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

## 🎯 NOTAS FINALES

1. **Firestore Query Limitations:** Recordar que Firestore tiene limitaciones en queries compuestos. Usar índices compuestos cuando sea necesario.

2. **Face Recognition:** El cálculo de distancia euclidiana debe hacerse en el backend para mayor seguridad.

3. **Transacciones:** Para operaciones que modifican múltiples documentos (ej: venta que reduce stock), usar batch writes de Firestore.

4. **Paginación:** Usar `startAfter` con el último documento para paginación eficiente.

5. **Seguridad:** Todos los endpoints deben estar protegidos excepto `/auth/login` y `/auth/register`.

6. **Performance:** Considerar cacheo con Redis para datos que se consultan frecuentemente (membresías activas, configuración).
