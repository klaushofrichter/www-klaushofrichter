import { createApp } from './app';
import { refreshAllImages, scheduleDailyRefresh } from './refreshImages';

const port = Number(process.env.PORT) || 8080;

async function start(): Promise<void> {
  await refreshAllImages();
  scheduleDailyRefresh();
  const app = createApp();
  app.listen(port, () => {
    console.log(`www-klaushofrichter listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
