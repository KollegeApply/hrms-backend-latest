const pino = require('pino');

let logger;

// Helper function to get IST time string
function getISTTimeString() {
  const now = new Date();
  const istDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  const day = String(istDate.getDate()).padStart(2, '0');
  const hours = String(istDate.getHours()).padStart(2, '0');
  const minutes = String(istDate.getMinutes()).padStart(2, '0');
  const seconds = String(istDate.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} IST`;
}

if (process.env.NODE_ENV !== 'production') {
  const transport = pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:dd-mm-yyyy HH:MM:ss', // Use standard format, we'll override with IST
    },
  });
  logger = pino(
    {
      level: 'debug', // Detailed logs in development
      timestamp: () => {
        return `,"time":"${getISTTimeString()}"`;
      },
    },
    transport
  );
} else {
  logger = pino({
    level: 'info', // Only info and above in production
    timestamp: () => {
      return `,"time":"${getISTTimeString()}"`;
    },
  });
}

// Export both ways for backward compatibility
module.exports = logger;
module.exports.logger = logger;
