import { ping } from '@gksk/shared';
import { createApp } from './app.js';
import { ConfigError, loadConfigFromEnvFile } from './config.js';
import { createLogger } from './logger.js';

function start(): void {
  let config;
  try {
    config = loadConfigFromEnvFile();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
    } else {
      process.stderr.write(
        `Lỗi khởi động cấu hình: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    process.exit(1);
  }

  const logger = createLogger({ level: config.logLevel });
  const app = createApp({ config, logger });

  app.listen(config.port, '127.0.0.1', () => {
    logger.info(
      {
        port: config.port,
        appEnv: config.appEnv,
        facilityId: config.gksk.facilityId,
        shared: ping(),
      },
      'GKSKLaiXe server listening',
    );
  });
}

start();
