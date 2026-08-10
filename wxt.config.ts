import { defineConfig, type ConfigEnv, type UserManifest } from 'wxt';

export function createManifest(env: ConfigEnv): UserManifest {
  const isChromium = env.browser === 'chrome' || env.browser === 'edge';
  return {
    name: 'Gemini++',
    description: '把 Gemini 网页版扩展成支持 Skills、记忆、预设与侧边栏的 AI 工作台',
    version: '0.1.0',
    permissions: ['storage', 'tabs', 'sidePanel'],
    host_permissions: ['https://gemini.google.com/*'],
    optional_host_permissions: ['https://api.github.com/*', 'https://raw.githubusercontent.com/*'],
    ...(isChromium ? {
      action: {
        default_title: 'Gemini++',
        default_icon: 'icon/128.png',
      },
      side_panel: {
        default_path: 'sidepanel.html',
      },
    } : {}),
  };
}

export default defineConfig({
  outDir: 'dist',
  targetBrowsers: ['chrome', 'edge'],
  modules: ['@wxt-dev/module-react'],
  manifest: createManifest,
});
