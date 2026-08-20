import { createApp } from './app';

const port = Number(process.env.PORT) || 8080;
const app = createApp();

app.listen(port, () => {
  console.log(`www-klaushofrichter listening on port ${port}`);
});
