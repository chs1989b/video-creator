import path from 'node:path';
import { createApp } from './server.js';

const dataDir = path.join(process.cwd(), 'data');
const port = process.env.PORT ?? 4000;

const app = createApp({ dataDir });
app.listen(port, () => {
  console.log(`worker listening on http://localhost:${port}`);
});
