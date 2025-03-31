const pino = require('pino');

let logger;

if (process.env.NODE_ENV !== 'production') {
  const transport = pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  });
  logger = pino(
    {
      level: 'debug', // Detailed logs in development
    },
    transport
  );
} else {
  logger = pino({
    level: 'info', // Only info and above in production
  });
}

// Export both ways for backward compatibility
module.exports = logger;
module.exports.logger = logger;
