// src/plugins/core-chat.js

// Core chat plugin for IdoFront.
// Implements a basic multi-conversation chat state purely in JavaScript,
// to be hosted by the runtime plugin system.

const CORE_PLUGIN_ID = 'core.chat';

const STORAGE_KEY = 'core.chat.state';

const coreChatPlugin = {
  id: CORE_PLUGIN_ID,
  type: 'chat',
  name: 'Core Chat (Built-in)',
  version: '0.2.0',
  setup(context) {
    const logger = context && context.logger ? context.logger : console;
    const vue = context && context.framework && context.framework.vue
      ? context.framework.vue
      : null;
    const useReactive = vue && typeof vue.reactive === 'function'
      ? vue.reactive
      : (x) => x;

    const state = useReactive({
      conversations: [],
      activeConversationId: null,
      inputText: '',
      logs: [],
      isTyping: false,
      inspector: {
        current: null
      }
    });

    function persist() {
      if (!context || !context.storage) return;
      const snapshot = {
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        logs: state.logs
      };
      context.storage.setItem(STORAGE_KEY, snapshot);
    }

    function restore() {
      if (!context || !context.storage) return;
      const snapshot = context.storage.getItem(STORAGE_KEY, null);
      if (!snapshot) return;

      if (Array.isArray(snapshot.conversations)) {
        state.conversations = snapshot.conversations;
      }
      state.activeConversationId = snapshot.activeConversationId || null;
      if (Array.isArray(snapshot.logs)) {
        state.logs = snapshot.logs;
      }
    }

    function createConversationInternal(title) {
      const now = Date.now();
      const conversation = {
        id: createId('conv'),
        title: title || '新的对话',
        createdAt: now,
        updatedAt: now,
        messages: []
      };
      state.conversations.unshift(conversation);
      if (!state.activeConversationId) {
        state.activeConversationId = conversation.id;
      }
      persist();
      if (context && context.events && typeof context.events.emit === 'function') {
        context.events.emit('chat:conversation-created', {
          pluginId: CORE_PLUGIN_ID,
          conversation
        });
      }
      return conversation;
    }

    function ensureActiveConversation() {
      if (state.activeConversationId) {
        const existing = state.conversations.find(
          (c) => c.id === state.activeConversationId
        );
        if (existing) return existing;
      }
      return createConversationInternal('新的对话');
    }

    function setInputText(text) {
      state.inputText = text == null ? '' : String(text);
    }

    function selectConversation(id) {
      if (!id) return;
      const target = state.conversations.find((c) => c.id === id);
      if (!target) return;
      state.activeConversationId = target.id;
      if (context && context.events && typeof context.events.emit === 'function') {
        context.events.emit('chat:conversation-selected', {
          pluginId: CORE_PLUGIN_ID,
          conversationId: target.id
        });
      }
      persist();
    }

    function createConversation(initialText) {
      const title =
        initialText && initialText.trim()
          ? initialText.trim().slice(0, 30)
          : '新的对话';
      const conv = createConversationInternal(title);
      state.activeConversationId = conv.id;
      if (initialText && initialText.trim()) {
        state.inputText = initialText;
        sendMessage();
      } else {
        persist();
      }
      return conv;
    }

    function sendMessage() {
      const text = (state.inputText || '').trim();
      if (!text) return;

      const now = Date.now();
      const timestamp = new Date(now).toISOString();
      const conv = ensureActiveConversation();

      const userMessage = {
        id: createId('msg_u'),
        role: 'user',
        content: text,
        createdAt: now,
        timestamp,
        plugin: null
      };

      conv.messages.push(userMessage);
      conv.updatedAt = now;
      conv.title = deriveTitleFromConversation(conv) || conv.title;
      state.inputText = '';

      if (context && context.events && typeof context.events.emit === 'function') {
        context.events.emit('chat:user-message', {
          pluginId: CORE_PLUGIN_ID,
          conversationId: conv.id,
          message: userMessage
        });
      }

      const requestPayload = {
        model: 'gpt-4-turbo-modular',
        messages: conv.messages.map((m) => ({
          role: m.role,
          content: m.content
        })),
        plugins_enabled: true
      };

      addLog('outgoing', 'POST /v1/chat/completions', requestPayload, userMessage.id);

      state.isTyping = true;
      persist();

      simulateAssistantResponse(conv, text);
    }

    function simulateAssistantResponse(conversation, userText) {
      const lower = userText.toLowerCase();

      let usedPlugin = 'core';
      let responseContent = '';

      const hasCalcPattern =
        lower.includes('calc') || /[0-9+\-*/]{3,}/.test(userText);

      if (hasCalcPattern) {
        usedPlugin = 'calculator';
        responseContent =
          'Processing calculation...\nResult: ' +
          Math.floor(Math.random() * 10000);
      } else if (
        lower.includes('image') ||
        lower.includes('draw') ||
        lower.includes('画')
      ) {
        usedPlugin = 'image_gen';
        responseContent = 'Generating image asset based on prompt...';
      } else {
        usedPlugin = 'core';
        responseContent =
          'I understand. This is a modular interface response. I can route your request to different internal plugins. Try asking me to "calculate" something or "draw" an image to see the plugins in action.';
      }

      const delay = 1200 + Math.floor(Math.random() * 400);

      setTimeout(() => {
        const now = Date.now();
        const timestamp = new Date(now).toISOString();

        const assistantMessage = {
          id: createId('msg_b'),
          role: 'assistant',
          content: responseContent,
          createdAt: now,
          timestamp,
          plugin: usedPlugin
        };

        conversation.messages.push(assistantMessage);
        conversation.updatedAt = now;
        state.isTyping = false;

        if (
          context &&
          context.events &&
          typeof context.events.emit === 'function'
        ) {
          context.events.emit('chat:assistant-message', {
            pluginId: CORE_PLUGIN_ID,
            conversationId: conversation.id,
            message: assistantMessage
          });
        }

        const responsePayload = {
          id: assistantMessage.id,
          object: 'chat.completion',
          created: now,
          model: 'gpt-4-turbo-modular',
          choices: [
            {
              index: 0,
              message: {
                role: assistantMessage.role,
                content: assistantMessage.content
              },
              finish_reason: 'stop'
            }
          ],
          usage: {
            prompt_tokens: userText.length,
            completion_tokens: responseContent.length,
            total_tokens: userText.length + responseContent.length
          }
        };

        addLog('incoming', '200 OK', responsePayload, assistantMessage.id);
        persist();
      }, delay);
    }

    function addLog(direction, label, data, relatedMessageId) {
      const logEntry = {
        id: createId('log'),
        direction, // 'outgoing' | 'incoming'
        label,
        timestamp: Date.now(),
        data,
        relatedMessageId
      };
      state.logs.unshift(logEntry);

      if (context && context.events && typeof context.events.emit === 'function') {
        context.events.emit('chat:log', {
          pluginId: CORE_PLUGIN_ID,
          log: logEntry
        });
      }
    }

    function clearLogs() {
      state.logs = [];
      if (context && context.events && typeof context.events.emit === 'function') {
        context.events.emit('chat:logs-cleared', {
          pluginId: CORE_PLUGIN_ID
        });
      }
      persist();
    }

    function inspect(data) {
      state.inspector.current = data;
      if (context && context.events && typeof context.events.emit === 'function') {
        context.events.emit('chat:inspect', {
          pluginId: CORE_PLUGIN_ID,
          data
        });
      }
    }

    function inspectMessage(messageId) {
      let found = null;
      for (const conv of state.conversations) {
        const msg = conv.messages.find((m) => m.id === messageId);
        if (msg) {
          found = { conversation: conv, message: msg };
          break;
        }
      }
      if (!found) return;

      const msg = found.message;
      const detail = {
        _meta: {
          type: 'Message Object',
          description: 'Internal representation of the chat bubble'
        },
        message_id: msg.id,
        role: msg.role,
        content_raw: msg.content,
        plugin_processor: msg.plugin || 'default_llm',
        createdAt: msg.createdAt,
        timestamp: msg.timestamp || null
      };
      inspect(detail);
    }

    function inspectLog(logId) {
      const log = state.logs.find((l) => l.id === logId);
      if (!log) return;
      inspect(log.data);
    }

    restore();
    if (state.conversations.length === 0) {
      createConversationInternal('新的对话');
    }

    if (logger && typeof logger.info === 'function') {
      logger.info('core.chat plugin initialized');
    }

    return {
      state,
      actions: {
        setInputText,
        sendMessage,
        selectConversation,
        createConversation,
        applyQuickPrompt: setInputText,
        addLog,
        clearLogs,
        inspect,
        inspectMessage,
        inspectLog
      }
    };
  }
};

function deriveTitleFromConversation(conversation) {
  if (!conversation || !Array.isArray(conversation.messages)) {
    return conversation && conversation.title ? conversation.title : '新的对话';
  }
  for (let i = 0; i < conversation.messages.length; i += 1) {
    const msg = conversation.messages[i];
    if (msg.role === 'user' && msg.content) {
      const trimmed = String(msg.content).trim().replace(/\s+/g, ' ');
      if (!trimmed) continue;
      if (trimmed.length <= 30) return trimmed;
      return trimmed.slice(0, 30) + '…';
    }
  }
  return conversation.title || '新的对话';
}

let idCounter = 1;

function createId(prefix) {
  const now = Date.now().toString(36);
  const counter = (idCounter++).toString(36);
  return String(prefix || 'id') + '-' + now + '-' + counter;
}

export default coreChatPlugin;