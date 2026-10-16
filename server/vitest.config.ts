import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { UPLOAD_DIR: '/tmp/prebind-test-uploads' },
  },
});
