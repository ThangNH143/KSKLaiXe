import { ping } from '@gksk/shared';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`GKSKLaiXe server listening on http://127.0.0.1:${port} (shared=${ping()})\n`);
});
