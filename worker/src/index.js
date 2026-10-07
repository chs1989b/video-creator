import path from 'node:path';
import { createApp } from './server.js';

const dataDir = path.join(process.cwd(), 'data');
const port = process.env.PORT ?? 4000;

const generator = process.env.GENERATOR === 'mock' ? 'mock' : 'higgsfield';

const app = createApp({ dataDir, generator });
app.listen(port, () => {
  console.log(`worker listening on http://localhost:${port} (generator: ${generator})`);
});
