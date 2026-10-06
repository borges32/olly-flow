import { telemetry } from './instrument.js';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/config.js';

try {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.listen(config.port, config.host);
  // Spec 012: ao desligar, fecha a API e envia a telemetria pendente ao coletor.
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void app
      .close()
      .then(() => telemetry.shutdown())
      .then(
        () => process.exit(0),
        (error: unknown) => {
          console.error(error);
          process.exit(1);
        },
      );
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
