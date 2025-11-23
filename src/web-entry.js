'use strict';

const SCRIPT_ORDER = [
  'edge-extension/scripts/tailwind.js',
  'edge-extension/scripts/ui-kit.js',
  'edge-extension/scripts/framework.js',

  // IdoFront core (from loader.js order, excluding loader itself)
  'edge-extension/scripts/ido-front/utils.js',
  'edge-extension/scripts/ido-front/idb-storage.js',
  'edge-extension/scripts/ido-front/store.js',
  'edge-extension/scripts/ido-front/runtime.js',
  'edge-extension/scripts/ido-front/network-logger.js',
  'edge-extension/scripts/ido-front/channels/channel-registry.js',
  'edge-extension/scripts/ido-front/plugin-loader.js',
  'edge-extension/scripts/ido-front/channels/openai-channel.js',
  'edge-extension/scripts/ido-front/channels/gemini-channel.js',
  'edge-extension/scripts/ido-front/service.js',

  // actions
  'edge-extension/scripts/ido-front/actions/conversation.js',
  'edge-extension/scripts/ido-front/actions/message.js',

  // plugins
  'edge-extension/scripts/ido-front/plugins/model-selector.js',
  'edge-extension/scripts/ido-front/plugins/network-log-panel.js',
  'edge-extension/scripts/ido-front/plugins/file-upload.js',
  'edge-extension/scripts/ido-front/plugins/image-gallery/core.js',
  'edge-extension/scripts/ido-front/plugins/image-gallery/view.js',
  'edge-extension/scripts/ido-front/plugins/image-gallery.js',
  'edge-extension/scripts/ido-front/plugins/core-plugins.js',
  'edge-extension/scripts/ido-front/plugins/theme-toggle.js',

  // settings
  'edge-extension/scripts/ido-front/settings/channel-editor.js',
  'edge-extension/scripts/ido-front/settings/channel-settings.js',
  'edge-extension/scripts/ido-front/settings/persona-editor.js',
  'edge-extension/scripts/ido-front/settings/persona-settings.js',
  'edge-extension/scripts/ido-front/settings/plugin-settings.js',
  'edge-extension/scripts/ido-front/settings/settings-manager.js',

  // main entry
  'edge-extension/scripts/ido-front/main.js',

  // bridge & markdown
  'edge-extension/scripts/plugins.js',
  'edge-extension/scripts/marked.min.js'
];

module.exports = {
  SCRIPT_ORDER
};