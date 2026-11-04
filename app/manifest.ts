import type { MetadataRoute } from 'next';

// Lets a client or freelancer add their deals to a phone's home screen; it opens on "My deals".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Proof of Done',
    short_name: 'Proof of Done',
    description: 'PayPal escrow that pays out when two AI models verify the delivered work.',
    start_url: '/mine',
    display: 'standalone',
    background_color: '#f4f6f9',
    theme_color: '#001c64',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
