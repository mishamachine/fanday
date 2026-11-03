import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `vite build --mode native` = Capacitor build into dist-native/ (capacitor.config.json webDir).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { 'import.meta.env.VITE_NATIVE': JSON.stringify(mode === 'native') },
  esbuild: mode === 'production' || mode === 'native' ? { pure: ['console.log', 'console.info', 'console.debug'] } : {},
  build: { outDir: mode === 'native' ? 'dist-native' : 'dist' },
}))
