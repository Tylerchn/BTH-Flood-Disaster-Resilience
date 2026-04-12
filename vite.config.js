import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ⚠️ 重要：把 'bth-resilience-dashboard' 替换成你的 GitHub 仓库名
// 例如你的仓库地址是 https://github.com/你的用户名/my-dashboard
// 那么这里就写 '/my-dashboard/'
export default defineConfig({
  plugins: [react()],
  base: '/BTH-Flood-Disaster-Resilience/',
})
