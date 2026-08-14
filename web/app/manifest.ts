import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cookmate — your kitchen co-pilot',
    short_name: 'Cookmate',
    description: 'Tell me a dish or a budget, and I’ll build your Swiggy Instamart basket.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fbf5ea',
    theme_color: '#fbf5ea',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
