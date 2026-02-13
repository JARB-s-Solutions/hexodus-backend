import nodemailer from 'nodemailer';

export const sendEmail = async (options) => {
  // Crear el transportador (Configuración del servicio de correo)
  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: process.env.EMAIL_USER, 
      pass: process.env.EMAIL_PASS  
    }
  });

  // Definir opciones del correo
  const mailOptions = {
    from: '"Soporte Exodus Gym" <no-reply@exodusgym.com>',
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #2c3e50;">Recuperación de Contraseña</h2>
        <p>${options.message}</p>
        <a href="${options.link}" style="background-color: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Restablecer Contraseña</a>
        <p style="font-size: 12px; color: #777; margin-top: 20px;">Si no solicitaste esto, ignora este correo.</p>
      </div>
    `
  };

  // Enviar
  await transporter.sendMail(mailOptions);
};