import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins:[react(),tailwindcss()],
  server:{proxy:{'/api':'http://localhost:8787'}},
  build:{target:'es2022',cssCodeSplit:true,rollupOptions:{output:{manualChunks(id){if(id.includes('node_modules/gsap'))return'gsap';if(id.includes('node_modules/framer-motion'))return'motion';if(id.includes('node_modules/@tanstack/react-query'))return'query';if(id.includes('node_modules/react'))return'vendor'}}}},
});
