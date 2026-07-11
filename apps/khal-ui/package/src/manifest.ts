import type { AppManifest } from '@khal-os/types';

/**
 * Pack manifest consumed by the KHAL desktop/window launcher.
 *
 * The install-time contract (`khal-app.json`) is the language-agnostic sibling
 * of this file; both describe the `omni-admin` app. Group B owns the real view
 * surface — this ships the single `main` view as the vertical-skeleton entry.
 */
const manifest: AppManifest = {
  id: 'omni-admin',
  views: [
    {
      id: 'main',
      label: 'Omni Admin',
      permission: 'omni-admin',
      // 'member' is KHAL's lowest role — i.e. any authenticated user.
      minRole: 'member',
      defaultSize: { width: 1280, height: 800 },
      component: './views/main/MainView',
    },
  ],
  desktop: {
    icon: '/icons/dusk/app.svg',
    categories: ['Utilities'],
    comment: 'Admin console for the Omni messaging platform.',
  },
};

export default manifest;
