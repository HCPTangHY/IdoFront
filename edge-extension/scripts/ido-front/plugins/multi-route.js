/**
 * Builtin Multi Route Plugin
 *
 * 新语义：
 * - 并 xN 生成的是「多路分支节点」，用于同轮结果对比
 * - 节点本身进入普通分支树；具体 route 在用户明确点击“继续这路”之前，不进入后续对话上下文
 * - 普通分支系统仍只负责编辑 / 重试 / 显式继续后的后续对话
 */
(function() {
    if (typeof Framework === 'undefined' || !Framework || !Framework.registerPlugin) {
        console.warn('[builtin-multi-route] Framework API not available');
        return;
    }

    const { registerPlugin, SLOTS } = Framework;
    const PLUGIN_ID = 'builtin-multi-route';
    const PLUGIN_SLOT = SLOTS.INPUT_TOP;
    const STORAGE_COUNT_KEY = 'multiRouteCount';
    const STORAGE_ROUTES_KEY = 'multiRouteRoutes';
    const STORAGE_GROUPS_KEY = 'multiRouteGroups';

    let chipEl = null;
    let storeSubscribed = false;

    function getStore() {
        return window.IdoFront && window.IdoFront.store;
    }

    function getUtils() {
        return window.IdoFront && window.IdoFront.utils;
    }

    function getMessageNodeBehaviors() {
        window.IdoFront = window.IdoFront || {};
        const existing = window.IdoFront.messageNodeBehaviors;
        if (existing && typeof existing.registerResolver === 'function' && typeof existing.resolve === 'function') {
            return existing;
        }

        const resolvers = new Map();
        window.IdoFront.messageNodeBehaviors = {
            registerResolver(id, resolver) {
                if (!id || !resolver || typeof resolver.describe !== 'function') {
                    return false;
                }
                resolvers.set(String(id), resolver);
                return true;
            },
            unregisterResolver(id) {
                if (!id) return false;
                return resolvers.delete(String(id));
            },
            resolve(message, context) {
                for (const resolver of resolvers.values()) {
                    try {
                        const resolved = resolver.describe(message, context || {});
                        if (resolved && typeof resolved === 'object') {
                            return resolved;
                        }
                    } catch (e) {
                        console.warn('[message-node-behaviors] resolver failed:', e);
                    }
                }
                return null;
            },
            shouldRenderStandalone(message, context) {
                const resolved = this.resolve(message, context);
                return !(resolved && resolved.renderStandalone === false);
            },
            shouldHideInConversationTree(message, context) {
                const resolved = this.resolve(message, context);
                return !!(resolved && resolved.hideInConversationTree);
            },
            shouldAutoSelectFirstChild(message, context) {
                const resolved = this.resolve(message, context);
                return !(resolved && resolved.autoSelectFirstChild === false);
            },
            shouldIncludeInRequestContext(message, context) {
                const resolved = this.resolve(message, context);
                return !(resolved && resolved.includeInRequestContext === false);
            },
            shouldDisableDomCache(message, context) {
                const resolved = this.resolve(message, context);
                return !!(resolved && resolved.disableDomCache);
            },
            getSendConstraint(message, context) {
                const resolved = this.resolve(message, context);
                return resolved && resolved.sendConstraint ? resolved.sendConstraint : null;
            },
            decorateDisplayPayload(message, payload, context) {
                const resolved = this.resolve(message, context);
                if (resolved && typeof resolved.decorateDisplayPayload === 'function') {
                    return resolved.decorateDisplayPayload(message, payload, context || {}) || payload;
                }
                return payload;
            },
            renderInline(message, container, conv, context) {
                const resolved = this.resolve(message, context || { conversation: conv });
                if (resolved && typeof resolved.renderInline === 'function') {
                    return resolved.renderInline(message, container, conv, context || {});
                }
                return null;
            }
        };

        return window.IdoFront.messageNodeBehaviors;
    }

    function createLocalId(prefix) {
        const utils = getUtils();
        if (utils && typeof utils.createId === 'function') {
            return utils.createId(prefix || 'mr');
        }
        const head = String(prefix || 'mr').replace(/[^a-zA-Z0-9_]/g, '') || 'mr';
        return `${head}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function getActiveConversation() {
        const store = getStore();
        if (!store || typeof store.getActiveConversation !== 'function') {
            return null;
        }
        return store.getActiveConversation();
    }

    function getConversationById(convId) {
        const store = getStore();
        if (!store || !store.state || !Array.isArray(store.state.conversations) || !convId) {
            return null;
        }
        return store.state.conversations.find((item) => item && item.id === convId) || null;
    }

    function ensureMetadata(conv) {
        if (!conv) return null;
        if (!conv.metadata || typeof conv.metadata !== 'object') {
            conv.metadata = {};
        }
        return conv.metadata;
    }

    function ensureGroupsArray(conv) {
        const metadata = ensureMetadata(conv);
        if (!metadata) return [];
        if (!Array.isArray(metadata[STORAGE_GROUPS_KEY])) {
            metadata[STORAGE_GROUPS_KEY] = [];
        }
        return metadata[STORAGE_GROUPS_KEY];
    }

    function normalizeCount(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 1;
        return Math.max(1, Math.floor(parsed));
    }

    function normalizeRouteConfig(config) {
        if (!config || typeof config !== 'object') {
            return null;
        }
        const channelId = String(config.channelId || '').trim();
        const model = String(config.model || '').trim();
        if (!channelId || !model) {
            return null;
        }
        return { channelId, model };
    }

    function isPluginEnabled() {
        const store = getStore();
        const pluginStates = store && store.state && store.state.pluginStates;
        if (!pluginStates || typeof pluginStates !== 'object') {
            return true;
        }
        return pluginStates[`${PLUGIN_SLOT}::${PLUGIN_ID}`] !== false;
    }

    function getCount(conv) {
        const targetConv = conv || getActiveConversation();
        if (!targetConv || !targetConv.metadata) {
            return 1;
        }
        return normalizeCount(targetConv.metadata[STORAGE_COUNT_KEY]);
    }

    function getStoredRoutes(conv) {
        const targetConv = conv || getActiveConversation();
        if (!targetConv || !targetConv.metadata || !Array.isArray(targetConv.metadata[STORAGE_ROUTES_KEY])) {
            return [];
        }
        return targetConv.metadata[STORAGE_ROUTES_KEY].map(normalizeRouteConfig);
    }

    function persistConversationUpdate(convId, updater, persistMode) {
        const store = getStore();
        const conv = getConversationById(convId);
        if (!store || !conv || typeof updater !== 'function') {
            return false;
        }

        updater(ensureMetadata(conv), conv);

        if (persistMode === 'silent' && typeof store.persistSilent === 'function') {
            store.persistSilent();
        } else {
            store.persist();
        }
        return true;
    }

    function setCount(count, convId) {
        const targetConv = getConversationById(convId) || getActiveConversation();
        if (!targetConv) {
            return false;
        }
        const normalizedCount = normalizeCount(count);
        return persistConversationUpdate(targetConv.id, (metadata) => {
            metadata[STORAGE_COUNT_KEY] = normalizedCount;
            if (Array.isArray(metadata[STORAGE_ROUTES_KEY])) {
                const maxOverrides = Math.max(0, normalizedCount - 1);
                metadata[STORAGE_ROUTES_KEY] = metadata[STORAGE_ROUTES_KEY]
                    .slice(0, maxOverrides)
                    .map(normalizeRouteConfig);
            } else if (normalizedCount <= 1) {
                metadata[STORAGE_ROUTES_KEY] = [];
            }
        });
    }

    function getRouteConfig(routeIndex, conv) {
        if (!routeIndex || routeIndex <= 1) {
            return null;
        }
        const routes = getStoredRoutes(conv);
        return normalizeRouteConfig(routes[routeIndex - 2]);
    }

    function setRouteConfig(routeIndex, config, convId) {
        if (!routeIndex || routeIndex <= 1) {
            return false;
        }

        const targetConv = getConversationById(convId) || getActiveConversation();
        if (!targetConv) {
            return false;
        }

        return persistConversationUpdate(targetConv.id, (metadata) => {
            const routes = Array.isArray(metadata[STORAGE_ROUTES_KEY])
                ? metadata[STORAGE_ROUTES_KEY].slice()
                : [];
            routes[routeIndex - 2] = normalizeRouteConfig(config);
            metadata[STORAGE_ROUTES_KEY] = routes;
        });
    }

    function getExecutionCount(conv) {
        if (!isPluginEnabled()) {
            return 1;
        }
        return getCount(conv);
    }

    function getExecutionPlan(conv) {
        const targetConv = conv || getActiveConversation();
        const count = getExecutionCount(targetConv);
        const routes = getStoredRoutes(targetConv);
        const plan = [];

        for (let index = 1; index <= count; index += 1) {
            if (index === 1) {
                plan.push({ index, useCurrent: true, channelId: null, model: null });
                continue;
            }

            const override = normalizeRouteConfig(routes[index - 2]);
            if (override) {
                plan.push({ index, useCurrent: false, channelId: override.channelId, model: override.model });
            } else {
                plan.push({ index, useCurrent: true, channelId: null, model: null });
            }
        }

        return plan.length > 0 ? plan : [{ index: 1, useCurrent: true, channelId: null, model: null }];
    }

    function getChannelById(channelId) {
        const store = getStore();
        const channels = store && store.state && Array.isArray(store.state.channels) ? store.state.channels : [];
        return channels.find((item) => item && item.id === channelId) || null;
    }

    function getMessageById(conv, messageId) {
        if (!conv || !Array.isArray(conv.messages) || !messageId) {
            return null;
        }
        return conv.messages.find((item) => item && item.id === messageId) || null;
    }

    function getCurrentModelLabel(conv) {
        const targetConv = conv || getActiveConversation();
        if (!targetConv) {
            return { text: '未选择模型', title: '请先选择当前会话模型' };
        }

        const channel = getChannelById(targetConv.selectedChannelId);
        const model = targetConv.selectedModel || (channel && Array.isArray(channel.models) ? channel.models[0] : '');
        if (!channel || !model) {
            return { text: '未选择模型', title: '请先选择当前会话模型' };
        }

        const label = `${channel.name} / ${model}`;
        return { text: label, title: label };
    }

    function getRouteButtonLabel(routeIndex, conv) {
        const override = getRouteConfig(routeIndex, conv);
        if (!override) {
            const current = getCurrentModelLabel(conv);
            return {
                text: '当前模型',
                title: `跟随当前会话：${current.title}`
            };
        }

        const channel = getChannelById(override.channelId);
        if (!channel || channel.enabled === false) {
            const current = getCurrentModelLabel(conv);
            return {
                text: '当前模型',
                title: `已回退到当前会话：${current.title}`
            };
        }

        const label = `${channel.name} / ${override.model}`;
        return { text: label, title: label };
    }

    function sanitizeRoute(route, fallbackIndex) {
        const input = route && typeof route === 'object' ? route : {};
        const routeIndex = Number.isFinite(input.routeIndex) ? input.routeIndex : (Number.isFinite(input.index) ? input.index : fallbackIndex);
        return {
            id: String(input.id || createLocalId('mr_r')),
            routeIndex: Math.max(1, Math.floor(routeIndex || 1)),
            channelId: input.channelId ? String(input.channelId) : null,
            channelName: input.channelName ? String(input.channelName) : '',
            model: input.model ? String(input.model) : '',
            useCurrent: input.useCurrent !== false,
            messageId: input.messageId ? String(input.messageId) : null,
            currentMessageId: input.currentMessageId ? String(input.currentMessageId) : null,
            status: input.status ? String(input.status) : 'pending',
            error: input.error ? String(input.error) : '',
            createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
            updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
            continuedAt: Number.isFinite(input.continuedAt) ? input.continuedAt : null
        };
    }

    function sanitizeGroup(group) {
        if (!group || typeof group !== 'object') {
            return null;
        }
        const rawRoutes = Array.isArray(group.routes) ? group.routes : [];
        const routes = rawRoutes.map((item, index) => sanitizeRoute(item, index + 1)).filter(Boolean);
        const selectedRouteId = group.selectedRouteId ? String(group.selectedRouteId) : null;
        const rawFocusedRouteId = group.focusedRouteId ? String(group.focusedRouteId) : null;
        const focusedRouteId = routes.some((item) => item && item.id === rawFocusedRouteId)
            ? rawFocusedRouteId
            : (routes.some((item) => item && item.id === selectedRouteId)
                ? selectedRouteId
                : (routes[0] ? routes[0].id : null));
        return {
            id: String(group.id || createLocalId('mr_g')),
            nodeMessageId: group.nodeMessageId ? String(group.nodeMessageId) : null,
            anchorMessageId: group.anchorMessageId ? String(group.anchorMessageId) : null,
            branchParentId: group.branchParentId ? String(group.branchParentId) : (group.anchorMessageId ? String(group.anchorMessageId) : null),
            createdAt: Number.isFinite(group.createdAt) ? group.createdAt : Date.now(),
            updatedAt: Number.isFinite(group.updatedAt) ? group.updatedAt : Date.now(),
            selectedRouteId,
            selectedMessageId: group.selectedMessageId ? String(group.selectedMessageId) : null,
            focusedRouteId,
            collapsed: typeof group.collapsed === 'boolean' ? group.collapsed : !!selectedRouteId,
            source: group.source ? String(group.source) : 'send',
            routes
        };
    }

    function isNodeMessage(msg) {
        return !!(
            msg &&
            msg.metadata &&
            msg.metadata.multiRouteNode &&
            typeof msg.metadata.multiRouteNode === 'object'
        );
    }

    function isEmbeddedMessage(msg) {
        return !!(
            msg &&
            msg.metadata &&
            msg.metadata.multiRoute &&
            msg.metadata.multiRoute.embedded === true
        );
    }

    function migrateLegacyGroupsToNodes(conv, persistMode) {
        const metadata = ensureMetadata(conv);
        const legacyGroups = metadata && Array.isArray(metadata[STORAGE_GROUPS_KEY])
            ? metadata[STORAGE_GROUPS_KEY].slice()
            : [];
        if (!conv || !metadata || !Array.isArray(conv.messages) || legacyGroups.length === 0) {
            return false;
        }

        let migrated = false;
        conv.activeBranchMap = conv.activeBranchMap || {};

        legacyGroups.forEach((rawGroup) => {
            const legacyGroup = sanitizeGroup(rawGroup);
            if (!legacyGroup) {
                return;
            }

            if (findGroupNodeMessage(conv, legacyGroup.id)) {
                migrated = true;
                return;
            }

            const branchParentId = legacyGroup.branchParentId || legacyGroup.anchorMessageId;
            const parentMessage = getMessageById(conv, branchParentId);
            if (!branchParentId || !parentMessage) {
                return;
            }

            const createdAt = Number.isFinite(legacyGroup.createdAt) ? legacyGroup.createdAt : Date.now();
            const nodeMessageId = createLocalId('msg_mr');
            const nextGroup = sanitizeGroup(Object.assign({}, legacyGroup, {
                nodeMessageId,
                anchorMessageId: branchParentId,
                branchParentId,
                updatedAt: Number.isFinite(legacyGroup.updatedAt) ? legacyGroup.updatedAt : createdAt
            }));
            if (!nextGroup) {
                return;
            }

            const nodeMessage = {
                id: nodeMessageId,
                role: 'assistant',
                content: '',
                createdAt,
                timestamp: new Date(createdAt).toISOString(),
                plugin: null,
                metadata: {
                    multiRouteNode: nextGroup
                }
            };

            conv.messages.push(nodeMessage);
            conv.activeBranchMap[branchParentId] = nodeMessageId;

            nextGroup.routes.forEach((route) => {
                const routeRootMessage = getMessageById(conv, route.messageId);
                if (!routeRootMessage) {
                    return;
                }
                routeRootMessage.parentId = nodeMessageId;
                routeRootMessage.metadata = routeRootMessage.metadata && typeof routeRootMessage.metadata === 'object'
                    ? routeRootMessage.metadata
                    : {};
                routeRootMessage.metadata.multiRoute = Object.assign({}, routeRootMessage.metadata.multiRoute || {}, {
                    groupId: nextGroup.id,
                    routeId: route.id,
                    routeIndex: route.routeIndex,
                    rootMessageId: route.messageId || routeRootMessage.id,
                    detached: false,
                    embedded: true
                });
            });

            const selectedRoute = findRoute(nextGroup, nextGroup.selectedRouteId);
            if (selectedRoute && (selectedRoute.currentMessageId || selectedRoute.messageId)) {
                conv.activeBranchMap[nodeMessageId] = selectedRoute.currentMessageId || selectedRoute.messageId;
            }

            migrated = true;
        });

        if (!migrated) {
            return false;
        }

        metadata[STORAGE_GROUPS_KEY] = [];
        conv.messageCount = conv.messages.length;
        conv.updatedAt = Date.now();
        const store = getStore();
        if (store && typeof store._invalidateActivePathCache === 'function') {
            store._invalidateActivePathCache(conv.id);
        }
        if (store && persistMode !== 'none') {
            if (persistMode === 'silent' && typeof store.persistSilent === 'function') {
                store.persistSilent();
            } else {
                store.persist();
            }
        }
        return true;
    }

    function migrateAllLegacyGroups(persistMode) {
        const store = getStore();
        const conversations = store && store.state && Array.isArray(store.state.conversations)
            ? store.state.conversations
            : [];
        let changed = false;
        conversations.forEach((conv) => {
            if (migrateLegacyGroupsToNodes(conv, 'none')) {
                changed = true;
            }
        });
        if (changed && store) {
            if (persistMode === 'silent' && typeof store.persistSilent === 'function') {
                store.persistSilent();
            } else {
                store.persist();
            }
        }
        return changed;
    }

    function getNodeBackedGroups(conv) {
        const targetConv = conv || getActiveConversation();
        if (!targetConv || !Array.isArray(targetConv.messages)) {
            return [];
        }
        const groups = [];
        targetConv.messages.forEach((msg) => {
            if (!isNodeMessage(msg)) return;
            msg.metadata = msg.metadata && typeof msg.metadata === 'object' ? msg.metadata : {};
            const normalized = sanitizeGroup(Object.assign({}, msg.metadata.multiRouteNode || {}, {
                nodeMessageId: msg.id,
                anchorMessageId: msg.parentId || (msg.metadata.multiRouteNode && msg.metadata.multiRouteNode.anchorMessageId) || null,
                branchParentId: (msg.metadata.multiRouteNode && msg.metadata.multiRouteNode.branchParentId) || msg.parentId || null
            }));
            if (!normalized) return;
            if (msg.metadata.multiRouteNode !== normalized) {
                msg.metadata.multiRouteNode = normalized;
            }
            groups.push(normalized);
        });
        return groups.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    function getGroups(conv) {
        const targetConv = conv || getActiveConversation();
        if (!targetConv) return [];
        migrateLegacyGroupsToNodes(targetConv, 'silent');
        return getNodeBackedGroups(targetConv);
    }

    function findGroupNodeMessage(conv, groupId) {
        if (!conv || !groupId || !Array.isArray(conv.messages)) {
            return null;
        }
        return conv.messages.find((msg) => (
            isNodeMessage(msg) &&
            msg.metadata &&
            msg.metadata.multiRouteNode &&
            msg.metadata.multiRouteNode.id === groupId
        )) || null;
    }

    function findGroup(conv, groupId) {
        if (!conv || !groupId) return null;
        const nodeMessage = findGroupNodeMessage(conv, groupId);
        if (nodeMessage && nodeMessage.metadata && nodeMessage.metadata.multiRouteNode) {
            return sanitizeGroup(Object.assign({}, nodeMessage.metadata.multiRouteNode, { nodeMessageId: nodeMessage.id }));
        }
        const groups = getGroups(conv);
        return groups.find((item) => item && item.id === groupId) || null;
    }

    function findRoute(group, routeId) {
        if (!group || !Array.isArray(group.routes) || !routeId) return null;
        return group.routes.find((item) => item && item.id === routeId) || null;
    }

    function getCurrentRouteId(conv, group) {
        const nodeMessageId = group && group.nodeMessageId;
        if (!conv || !group || !Array.isArray(group.routes) || group.routes.length === 0 || !nodeMessageId) {
            return null;
        }
        const activeBranchMap = conv.activeBranchMap || {};
        const activeMessageId = activeBranchMap[nodeMessageId];
        if (!activeMessageId) {
            return null;
        }
        const currentRoute = group.routes.find((item) => item && (item.messageId === activeMessageId || item.currentMessageId === activeMessageId));
        return currentRoute ? currentRoute.id : null;
    }

    function getFocusedRouteId(group, conv) {
        if (!group || !Array.isArray(group.routes) || group.routes.length === 0) {
            return null;
        }
        if (group.selectedRouteId && group.routes.some((item) => item && item.id === group.selectedRouteId)) {
            return group.selectedRouteId;
        }
        if (group.focusedRouteId && group.routes.some((item) => item && item.id === group.focusedRouteId) && group.focusedRouteId !== (group.routes[0] && group.routes[0].id)) {
            return group.focusedRouteId;
        }
        const currentRouteId = getCurrentRouteId(conv, group);
        if (currentRouteId) {
            return currentRouteId;
        }
        if (group.focusedRouteId && group.routes.some((item) => item && item.id === group.focusedRouteId)) {
            return group.focusedRouteId;
        }
        return group.routes[0] ? group.routes[0].id : null;
    }

    function focusGroupRoute(convId, groupId, routeId, persistMode) {
        const success = mutateGroup(convId, groupId, (group) => {
            const target = findRoute(group, routeId) || findRoute(group, getFocusedRouteId(group));
            if (!target) return;
            group.focusedRouteId = target.id;
            group.collapsed = false;
        }, persistMode || 'silent');
        if (success) {
            syncGroupCard(convId, groupId);
        }
        return success;
    }

    function setGroupCollapsed(convId, groupId, collapsed, persistMode) {
        const nextValue = !!collapsed;
        const success = mutateGroup(convId, groupId, (group) => {
            group.collapsed = nextValue;
            if (!group.focusedRouteId) {
                group.focusedRouteId = getFocusedRouteId(group);
            }
        }, persistMode || 'silent');
        if (success) {
            syncGroupCard(convId, groupId);
        }
        return success;
    }

    function getGroupRoutesContainer(root) {
        return root ? root.querySelector('.ido-multiroute-group__routes') : null;
    }

    function stopGroupScrollAnimation(routesWrap) {
        if (!routesWrap) return;
        if (routesWrap.__mrScrollRaf) {
            window.cancelAnimationFrame(routesWrap.__mrScrollRaf);
            routesWrap.__mrScrollRaf = 0;
        }
        clearTimeout(routesWrap.__mrProgrammaticTimer);
        routesWrap.__mrProgrammaticScroll = false;
    }

    function easeOutCubic(progress) {
        const t = Math.max(0, Math.min(1, progress || 0));
        return 1 - Math.pow(1 - t, 3);
    }

    function animateGroupScroll(routesWrap, delta, duration) {
        if (!routesWrap || !Number.isFinite(delta) || Math.abs(delta) < 2) {
            return;
        }
        stopGroupScrollAnimation(routesWrap);
        const start = routesWrap.scrollLeft;
        const target = start + delta;
        const startTime = performance.now();
        routesWrap.__mrProgrammaticScroll = true;
        const totalDuration = Math.max(180, Number(duration) || 360);
        const step = (now) => {
            const progress = Math.min(1, (now - startTime) / totalDuration);
            routesWrap.scrollLeft = start + (delta * easeOutCubic(progress));
            if (progress < 1) {
                routesWrap.__mrScrollRaf = window.requestAnimationFrame(step);
            } else {
                stopGroupScrollAnimation(routesWrap);
            }
        };
        routesWrap.__mrScrollRaf = window.requestAnimationFrame(step);
    }

    function markGroupUserScrolling(routesWrap, delay) {
        if (!routesWrap) return;
        routesWrap.__mrUserScrolling = true;
        clearTimeout(routesWrap.__mrUserScrollingTimer);
        routesWrap.__mrUserScrollingTimer = window.setTimeout(() => {
            routesWrap.__mrUserScrolling = false;
        }, Math.max(120, Number(delay) || 240));
    }

    function findClosestRouteElement(routesWrap) {
        if (!routesWrap) return null;
        const routeEls = Array.from(routesWrap.querySelectorAll('.ido-multiroute-route')).filter((item) => !item.hidden);
        if (routeEls.length === 0) return null;
        const wrapRect = routesWrap.getBoundingClientRect();
        const wrapCenter = wrapRect.left + (wrapRect.width / 2);
        let closest = routeEls[0];
        let bestDistance = Number.POSITIVE_INFINITY;
        routeEls.forEach((routeEl) => {
            const rect = routeEl.getBoundingClientRect();
            const center = rect.left + (rect.width / 2);
            const distance = Math.abs(center - wrapCenter);
            if (distance < bestDistance) {
                bestDistance = distance;
                closest = routeEl;
            }
        });
        return closest;
    }

    function scrollGroupToRoute(root, routeId, behavior) {
        const routesWrap = getGroupRoutesContainer(root);
        if (!routesWrap || !routeId) return;
        const routeEl = routesWrap.querySelector(`[data-route-id="${routeId}"]`);
        if (!routeEl) return;
        const wrapRect = routesWrap.getBoundingClientRect();
        const routeRect = routeEl.getBoundingClientRect();
        const delta = (routeRect.left + (routeRect.width / 2)) - (wrapRect.left + (wrapRect.width / 2));
        if (Math.abs(delta) < 2) return;
        if (behavior === 'auto') {
            stopGroupScrollAnimation(routesWrap);
            routesWrap.__mrUserScrolling = false;
            routesWrap.__mrProgrammaticScroll = true;
            routesWrap.scrollLeft += delta;
            routesWrap.__mrProgrammaticTimer = window.setTimeout(() => {
                routesWrap.__mrProgrammaticScroll = false;
            }, 0);
            return;
        }
        routesWrap.__mrUserScrolling = false;
        animateGroupScroll(routesWrap, delta, behavior === 'slow' ? 420 : 340);
    }

    function releaseGroupDrag(routesWrap) {
        if (!routesWrap) return;
        routesWrap.classList.remove('is-dragging');
        routesWrap.__mrDrag = null;
        markGroupUserScrolling(routesWrap, 220);
        routesWrap.__mrProgrammaticTimer = window.setTimeout(() => {
            routesWrap.__mrProgrammaticScroll = false;
        }, 0);
    }

    function bindGroupCarousel(root, convId, groupId) {
        const routesWrap = getGroupRoutesContainer(root);
        if (!root || !routesWrap || routesWrap.dataset.carouselBound === 'true') {
            return;
        }
        routesWrap.dataset.carouselBound = 'true';

        let scrollTimer = null;
        routesWrap.addEventListener('wheel', (event) => {
            if (root.dataset.collapsed === 'true') return;
            if (routesWrap.__mrDrag) return;
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            event.preventDefault();
            markGroupUserScrolling(routesWrap, 260);
            const dampedDelta = Math.sign(event.deltaY) * Math.min(140, Math.max(24, Math.abs(event.deltaY) * 0.38));
            routesWrap.scrollBy({ left: dampedDelta, behavior: 'auto' });
        }, { passive: false });

        const syncFocusedRouteFromViewport = () => {
            window.setTimeout(() => {
                const routeEl = findClosestRouteElement(routesWrap);
                const nextRouteId = routeEl && routeEl.dataset ? routeEl.dataset.routeId : '';
                const conv = getConversationById(convId);
                const group = findGroup(conv, groupId);
                if (!conv || !group || !nextRouteId || getFocusedRouteId(group, conv) === nextRouteId) {
                    return;
                }
                focusGroupRoute(convId, groupId, nextRouteId, 'silent');
            }, 0);
        };

        routesWrap.addEventListener('pointerdown', (event) => {
            if (root.dataset.collapsed === 'true') return;
            if (event.pointerType !== 'mouse' || event.button !== 0) return;
            if (event.target && typeof event.target.closest === 'function' && event.target.closest('button, a, input, textarea, select, summary, [data-no-drag]')) {
                return;
            }
            stopGroupScrollAnimation(routesWrap);
            routesWrap.__mrProgrammaticScroll = true;
            routesWrap.__mrDrag = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startScrollLeft: routesWrap.scrollLeft,
                moved: false
            };
            markGroupUserScrolling(routesWrap, 400);
            routesWrap.classList.add('is-dragging');
            if (typeof routesWrap.setPointerCapture === 'function') {
                try {
                    routesWrap.setPointerCapture(event.pointerId);
                } catch (e) {
                    // ignore
                }
            }
        });

        routesWrap.addEventListener('pointermove', (event) => {
            const drag = routesWrap.__mrDrag;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - drag.startX;
            if (Math.abs(deltaX) > 3) {
                drag.moved = true;
            }
            markGroupUserScrolling(routesWrap, 320);
            routesWrap.scrollLeft = drag.startScrollLeft - deltaX;
        });

        routesWrap.addEventListener('pointerup', (event) => {
            const drag = routesWrap.__mrDrag;
            if (!drag || drag.pointerId !== event.pointerId) return;
            if (typeof routesWrap.releasePointerCapture === 'function') {
                try {
                    routesWrap.releasePointerCapture(event.pointerId);
                } catch (e) {
                    // ignore
                }
            }
            releaseGroupDrag(routesWrap);
            syncFocusedRouteFromViewport();
        });

        routesWrap.addEventListener('pointercancel', () => {
            releaseGroupDrag(routesWrap);
        });

        routesWrap.addEventListener('mouseleave', () => {
            if (routesWrap.__mrDrag) {
                releaseGroupDrag(routesWrap);
                syncFocusedRouteFromViewport();
            }
        });

        routesWrap.addEventListener('scroll', () => {
            if (routesWrap.__mrProgrammaticScroll || root.dataset.collapsed === 'true') {
                return;
            }
            clearTimeout(scrollTimer);
            scrollTimer = window.setTimeout(() => {
                const routeEl = findClosestRouteElement(routesWrap);
                const nextRouteId = routeEl && routeEl.dataset ? routeEl.dataset.routeId : '';
                const conv = getConversationById(convId);
                const group = findGroup(conv, groupId);
                if (!conv || !group || !nextRouteId || getFocusedRouteId(group, conv) === nextRouteId) {
                    return;
                }
                focusGroupRoute(convId, groupId, nextRouteId, 'silent');
            }, 80);
        }, { passive: true });
    }

    function mutateGroup(convId, groupId, updater, persistMode) {
        const conv = getConversationById(convId);
        if (!conv || !groupId || typeof updater !== 'function') {
            return false;
        }
        const nodeMessage = findGroupNodeMessage(conv, groupId);
        if (nodeMessage) {
            nodeMessage.metadata = nodeMessage.metadata && typeof nodeMessage.metadata === 'object' ? nodeMessage.metadata : {};
            const normalizedGroup = sanitizeGroup(Object.assign({}, nodeMessage.metadata.multiRouteNode || {}, {
                nodeMessageId: nodeMessage.id,
                anchorMessageId: nodeMessage.parentId || (nodeMessage.metadata.multiRouteNode && nodeMessage.metadata.multiRouteNode.anchorMessageId) || null,
                branchParentId: (nodeMessage.metadata.multiRouteNode && nodeMessage.metadata.multiRouteNode.branchParentId) || nodeMessage.parentId || null
            }));
            if (!normalizedGroup) {
                return false;
            }
            updater(normalizedGroup, conv, nodeMessage);
            normalizedGroup.updatedAt = Date.now();
            nodeMessage.metadata.multiRouteNode = sanitizeGroup(Object.assign({}, normalizedGroup, {
                nodeMessageId: nodeMessage.id,
                anchorMessageId: nodeMessage.parentId || normalizedGroup.anchorMessageId || null,
                branchParentId: normalizedGroup.branchParentId || nodeMessage.parentId || null
            }));
            const store = getStore();
            if (!store) return true;
            if (persistMode === 'silent' && typeof store.persistSilent === 'function') {
                store.persistSilent();
            } else {
                store.persist();
            }
            return true;
        }

        const group = findGroup(conv, groupId);
        if (!group) {
            return false;
        }
        updater(group, conv);
        group.updatedAt = Date.now();
        const store = getStore();
        if (!store) return true;
        if (persistMode === 'silent' && typeof store.persistSilent === 'function') {
            store.persistSilent();
        } else {
            store.persist();
        }
        return true;
    }

    function updateRouteInGroup(convId, groupId, routeId, updater, persistMode) {
        return mutateGroup(convId, groupId, (group, conv) => {
            const route = findRoute(group, routeId);
            if (!route) return;
            updater(route, group, conv);
            route.updatedAt = Date.now();
        }, persistMode);
    }

    function isDetachedMessage(msg) {
        return !!(
            msg &&
            msg.metadata &&
            msg.metadata.multiRoute &&
            msg.metadata.multiRoute.detached === true
        );
    }

    function isNodeBackedGroup(group) {
        return !!(group && group.nodeMessageId);
    }

    function getRouteDisplayMessage(conv, route) {
        if (!conv || !route) return null;
        const current = getMessageById(conv, route.currentMessageId);
        if (current) return current;
        return getMessageById(conv, route.messageId);
    }

    function getRouteRootMessage(conv, route) {
        if (!conv || !route || !route.messageId) {
            return null;
        }
        return getMessageById(conv, route.messageId);
    }

    function deriveRouteStatus(route, message) {
        const rawStatus = route && route.status ? String(route.status) : '';
        if (rawStatus === 'error' || rawStatus === 'stopped' || rawStatus === 'completed' || rawStatus === 'running' || rawStatus === 'pending') {
            return rawStatus;
        }
        if (!message) return 'pending';
        if (message.content || message.reasoning || (Array.isArray(message.attachments) && message.attachments.length > 0)) {
            return 'completed';
        }
        return 'pending';
    }

    function deriveGroupSummary(group, conv) {
        const routes = Array.isArray(group && group.routes) ? group.routes : [];
        const selectedRoute = findRoute(group, group && group.selectedRouteId);
        if (selectedRoute) {
            const selectedMessage = getRouteDisplayMessage(conv, selectedRoute);
            const selectedStatus = deriveRouteStatus(selectedRoute, selectedMessage);
            return {
                text: `已继续 并${selectedRoute.routeIndex}`,
                tone: (selectedStatus === 'error' || selectedStatus === 'stopped') ? 'error' : 'completed'
            };
        }
        let running = 0;
        let completed = 0;
        let error = 0;
        routes.forEach((route) => {
            const message = getRouteDisplayMessage(conv, route);
            const status = deriveRouteStatus(route, message);
            if (status === 'running' || status === 'pending') {
                running += 1;
            } else if (status === 'error' || status === 'stopped') {
                error += 1;
            } else {
                completed += 1;
            }
        });

        if (running > 0) {
            return {
                text: `生成中 ${completed}/${routes.length}`,
                tone: 'running'
            };
        }
        if (completed > 0 && error > 0) {
            return {
                text: `完成 ${completed} 路 · 失败 ${error} 路`,
                tone: 'mixed'
            };
        }
        if (completed > 0) {
            return {
                text: `已完成 ${completed} 路`,
                tone: 'completed'
            };
        }
        if (error > 0) {
            return {
                text: `失败 ${error} 路`,
                tone: 'error'
            };
        }
        return {
            text: `等待中 ${routes.length} 路`,
            tone: 'pending'
        };
    }

    function formatRouteModel(route, message) {
        const model = (message && message.modelName) || route.model || '';
        const channelName = (message && message.channelName) || route.channelName || '';
        if (model && channelName) {
            return `${model} · ${channelName}`;
        }
        if (model) return model;
        if (channelName) return channelName;
        return '模型待定';
    }

    function formatRouteStatusText(status, route) {
        if (status === 'running') return '生成中';
        if (status === 'pending') return '等待中';
        if (status === 'completed') return '已完成';
        if (status === 'stopped') return '已停止';
        if (status === 'error') return route && route.error ? '失败' : '失败';
        return '等待中';
    }

    function formatRouteContent(route, message, status) {
        if (message && typeof message.content === 'string' && message.content.trim()) {
            return message.content;
        }
        if (status === 'running') {
            if (message && typeof message.reasoning === 'string' && message.reasoning.trim()) {
                return '正在思考…';
            }
            return '正在生成…';
        }
        if (status === 'pending') {
            return '等待开始…';
        }
        if (status === 'stopped') {
            return (route && route.error) || '✋ 已停止生成';
        }
        if (status === 'error') {
            return (route && route.error) || (message && message.content) || '请求失败';
        }
        return '暂无内容';
    }

    function normalizePreviewText(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function buildRouteCopyText(route, message, status) {
        if (message && typeof message.content === 'string' && message.content.trim()) {
            return message.content.trim();
        }
        if (message && typeof message.reasoning === 'string' && message.reasoning.trim()) {
            return message.reasoning.trim();
        }
        if (status === 'error' && route && route.error) {
            return String(route.error).trim();
        }
        return '';
    }

    function getRoutePreviewText(route, message, status) {
        const source = buildRouteCopyText(route, message, status) || formatRouteContent(route, message, status);
        const normalized = normalizePreviewText(source);
        if (!normalized) {
            return '暂无内容';
        }
        return normalized.length > 96 ? `${normalized.slice(0, 96)}…` : normalized;
    }

    function flashActionButton(button, nextLabel, tone) {
        if (!button) return;
        const originalLabel = button.dataset.originalLabel || button.textContent || '';
        button.dataset.originalLabel = originalLabel;
        clearTimeout(button.__mrFlashTimer);
        button.textContent = nextLabel || originalLabel;
        button.classList.remove('is-success', 'is-error');
        if (tone === 'success' || tone === 'error') {
            button.classList.add(`is-${tone}`);
        }
        button.__mrFlashTimer = window.setTimeout(() => {
            button.textContent = button.dataset.originalLabel || originalLabel;
            button.classList.remove('is-success', 'is-error');
        }, 1400);
    }

    async function copyTextToClipboard(text, triggerButton, successLabel) {
        const value = typeof text === 'string' ? text.trim() : '';
        if (!value) {
            flashActionButton(triggerButton, '暂无内容', 'error');
            return false;
        }
        try {
            await navigator.clipboard.writeText(value);
            flashActionButton(triggerButton, successLabel || '已复制', 'success');
            return true;
        } catch (e) {
            console.warn('[multi-route] copy failed:', e);
            flashActionButton(triggerButton, '复制失败', 'error');
            return false;
        }
    }

    function renderRouteAttachments(container, attachments) {
        if (!container) return;
        container.innerHTML = '';

        const frameworkMessages = typeof FrameworkMessages !== 'undefined' ? FrameworkMessages : null;
        if (frameworkMessages && typeof frameworkMessages.createAttachmentsContainer === 'function') {
            const built = frameworkMessages.createAttachmentsContainer(Array.isArray(attachments) ? attachments : []);
            if (built) {
                container.appendChild(built);
                container.hidden = false;
                return;
            }
            container.hidden = true;
            return;
        }

        if (!Array.isArray(attachments) || attachments.length === 0) {
            container.hidden = true;
            return;
        }

        const imageAttachments = attachments.filter((item) => item && item.type && item.type.indexOf('image/') === 0);
        if (imageAttachments.length === 0) {
            container.hidden = true;
            return;
        }

        const list = document.createElement('div');
        list.className = 'ido-multiroute-route__images';
        imageAttachments.slice(0, 4).forEach((attachment) => {
            const item = document.createElement('div');
            item.className = 'ido-multiroute-route__image';

            const img = document.createElement('img');
            img.alt = attachment.name || 'Route image';
            img.loading = 'lazy';
            item.appendChild(img);

            if (attachment.dataUrl) {
                img.src = attachment.dataUrl;
            } else if (
                attachment.id &&
                window.IdoFront &&
                window.IdoFront.attachments &&
                typeof window.IdoFront.attachments.getObjectUrl === 'function'
            ) {
                window.IdoFront.attachments.getObjectUrl(attachment.id).then((url) => {
                    if (url) {
                        img.src = url;
                    }
                }).catch(() => {
                    // ignore
                });
            }

            list.appendChild(item);
        });

        container.appendChild(list);
        container.hidden = false;
    }

    function formatRouteStats(message) {
        const stats = message && message.stats;
        if (!stats || typeof stats !== 'object') {
            return '';
        }
        const parts = [];
        if (typeof stats.duration === 'number' && Number.isFinite(stats.duration)) {
            parts.push(`总耗时 ${stats.duration.toFixed(1)}s`);
        }
        if (stats.usage && typeof stats.usage.completion_tokens === 'number') {
            parts.push(`输出 ${stats.usage.completion_tokens} tok`);
        }
        if (typeof stats.tps === 'number' && Number.isFinite(stats.tps)) {
            parts.push(`${stats.tps.toFixed(1)} tok/s`);
        }
        return parts.join(' · ');
    }

    function getRouteActiveState(conv, group, route) {
        const nodeMessageId = group && group.nodeMessageId;
        if (!conv || !group || !route || !route.messageId || !nodeMessageId) return false;
        const activeBranchMap = conv.activeBranchMap || {};
        return activeBranchMap[nodeMessageId] === route.messageId;
    }

    function continueRoute(groupId, routeId, convId) {
        const store = getStore();
        const conv = getConversationById(convId) || getActiveConversation();
        if (!store || !conv) {
            return false;
        }

        const group = findGroup(conv, groupId);
        const route = findRoute(group, routeId);
        const routeMessage = getMessageById(conv, route && route.messageId);
        const selectedMessageId = route && route.messageId;
        if (!group || !route || !routeMessage) {
            return false;
        }

        routeMessage.metadata = routeMessage.metadata && typeof routeMessage.metadata === 'object'
            ? routeMessage.metadata
            : {};
        routeMessage.metadata.multiRoute = Object.assign({}, routeMessage.metadata.multiRoute || {}, {
            groupId: group.id,
            routeId: route.id,
            routeIndex: route.routeIndex,
            rootMessageId: route.messageId,
            detached: false,
            embedded: true
        });

        const updated = mutateGroup(conv.id, group.id, (liveGroup) => {
            const liveRoute = findRoute(liveGroup, route.id);
            if (!liveRoute) return;
            liveGroup.selectedRouteId = liveRoute.id;
            liveGroup.selectedMessageId = selectedMessageId;
            liveGroup.focusedRouteId = liveRoute.id;
            liveGroup.collapsed = true;
            liveRoute.continuedAt = Date.now();
        }, 'silent');
        if (!updated) return false;

        const nextGroup = findGroup(conv, group.id) || group;
        if (nextGroup.branchParentId && nextGroup.nodeMessageId) {
            conv.activeBranchMap = conv.activeBranchMap || {};
            conv.activeBranchMap[nextGroup.branchParentId] = nextGroup.nodeMessageId;
        }

        const switched = store.switchBranch(conv.id, route.messageId, { silent: true });
        if (!switched) {
            store.persist();
            return false;
        }

        if (typeof store._invalidateActivePathCache === 'function') {
            store._invalidateActivePathCache(conv.id);
        }

        syncGroupCard(conv.id, group.id);

        const conversationActions = window.IdoFront && window.IdoFront.conversationActions;
        if (conversationActions && typeof conversationActions.syncUI === 'function') {
            const rerenderAnchorId = nextGroup.branchParentId || nextGroup.anchorMessageId || null;
            if (rerenderAnchorId) {
                conversationActions.syncUI({
                    focusMessageId: rerenderAnchorId,
                    incrementalFromParent: true,
                    skipConversationListUpdate: true,
                    asyncMarkdown: true
                });
            } else {
                conversationActions.syncUI({ skipConversationListUpdate: true, asyncMarkdown: true });
            }
        }

        return true;
    }

    function createRouteCard(conv, group, route) {
        const routeEl = document.createElement('div');
        routeEl.className = 'ido-multiroute-route';
        routeEl.dataset.routeId = route.id;

        const header = document.createElement('div');
        header.className = 'ido-multiroute-route__header';

        const label = document.createElement('div');
        label.className = 'ido-multiroute-route__label';
        header.appendChild(label);

        const model = document.createElement('div');
        model.className = 'ido-multiroute-route__model';
        header.appendChild(model);

        const status = document.createElement('div');
        status.className = 'ido-multiroute-route__status';
        header.appendChild(status);

        const body = document.createElement('div');
        body.className = 'ido-multiroute-route__body';

        const reasoningWrap = document.createElement('details');
        reasoningWrap.className = 'ido-multiroute-route__reasoning';
        const reasoningSummary = document.createElement('summary');
        reasoningSummary.textContent = '查看思考过程';
        const reasoningContent = document.createElement('div');
        reasoningContent.className = 'ido-multiroute-route__reasoning-content markdown-body';
        reasoningWrap.appendChild(reasoningSummary);
        reasoningWrap.appendChild(reasoningContent);
        body.appendChild(reasoningWrap);

        const content = document.createElement('div');
        content.className = 'ido-multiroute-route__content ido-message__content message-content markdown-body';
        body.appendChild(content);

        const attachments = document.createElement('div');
        attachments.className = 'ido-multiroute-route__attachments';
        body.appendChild(attachments);

        const meta = document.createElement('div');
        meta.className = 'ido-multiroute-route__meta';
        body.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'ido-multiroute-route__actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'ido-btn ido-btn--secondary ido-btn--sm ido-multiroute-route__copy';
        copyBtn.textContent = '复制';
        actions.appendChild(copyBtn);

        const continueBtn = document.createElement('button');
        continueBtn.type = 'button';
        continueBtn.className = 'ido-btn ido-btn--primary ido-btn--sm ido-multiroute-route__continue';
        actions.appendChild(continueBtn);

        routeEl.appendChild(header);
        routeEl.appendChild(body);
        routeEl.appendChild(actions);

        updateRouteCard(routeEl, conv, group, route);
        return routeEl;
    }

    function updateRouteCard(routeEl, conv, group, route) {
        if (!routeEl || !conv || !group || !route) return;
        const message = getRouteDisplayMessage(conv, route);
        const status = deriveRouteStatus(route, message);
        const routeLabel = routeEl.querySelector('.ido-multiroute-route__label');
        const routeModel = routeEl.querySelector('.ido-multiroute-route__model');
        const routeStatus = routeEl.querySelector('.ido-multiroute-route__status');
        const routeContent = routeEl.querySelector('.ido-multiroute-route__content');
        const reasoningWrap = routeEl.querySelector('.ido-multiroute-route__reasoning');
        const reasoningContent = routeEl.querySelector('.ido-multiroute-route__reasoning-content');
        const attachmentsWrap = routeEl.querySelector('.ido-multiroute-route__attachments');
        const metaWrap = routeEl.querySelector('.ido-multiroute-route__meta');
        const copyBtn = routeEl.querySelector('.ido-multiroute-route__copy');
        const continueBtn = routeEl.querySelector('.ido-multiroute-route__continue');
        const routeText = formatRouteContent(route, message, status);
        const isCurrent = getRouteActiveState(conv, group, route);
        const rootMessage = getMessageById(conv, route.messageId);
        const hasCommittedMessage = !!rootMessage;
        const copyText = buildRouteCopyText(route, message, status);

        routeEl.dataset.status = status;
        routeEl.classList.toggle('is-current', isCurrent);
        routeEl.classList.toggle('is-selected', group.selectedRouteId === route.id);

        if (routeLabel) {
            routeLabel.textContent = `并${route.routeIndex}`;
        }
        if (routeModel) {
            routeModel.textContent = formatRouteModel(route, message);
            routeModel.title = routeModel.textContent;
        }
        if (routeStatus) {
            routeStatus.textContent = formatRouteStatusText(status, route);
            routeStatus.dataset.tone = status;
        }

        if (routeContent) {
            const shouldRenderMarkdown = status !== 'running' && status !== 'pending';
            if (shouldRenderMarkdown && typeof FrameworkMarkdown !== 'undefined' && FrameworkMarkdown && typeof FrameworkMarkdown.renderSync === 'function') {
                FrameworkMarkdown.renderSync(routeContent, routeText || '');
            } else {
                routeContent.textContent = routeText || '';
            }
        }

        if (reasoningWrap && reasoningContent) {
            if (message && typeof message.reasoning === 'string' && message.reasoning.trim()) {
                if (typeof FrameworkMarkdown !== 'undefined' && FrameworkMarkdown && typeof FrameworkMarkdown.renderSync === 'function') {
                    FrameworkMarkdown.renderSync(reasoningContent, message.reasoning);
                } else {
                    reasoningContent.textContent = message.reasoning;
                }
                reasoningWrap.hidden = false;
            } else {
                reasoningWrap.hidden = true;
                reasoningContent.textContent = '';
            }
        }

        if (attachmentsWrap) {
            renderRouteAttachments(attachmentsWrap, message && Array.isArray(message.attachments) ? message.attachments : null);
        }

        if (metaWrap) {
            const statsText = formatRouteStats(message);
            const errorText = status === 'error' && route.error ? route.error : '';
            metaWrap.textContent = errorText || statsText || '';
            metaWrap.hidden = !metaWrap.textContent;
        }

        if (copyBtn) {
            clearTimeout(copyBtn.__mrFlashTimer);
            copyBtn.classList.remove('is-success', 'is-error');
            copyBtn.dataset.originalLabel = '复制';
            copyBtn.textContent = '复制';
            copyBtn.disabled = !copyText;
            copyBtn.onclick = copyText
                ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    copyTextToClipboard(copyText, copyBtn, '已复制');
                }
                : null;
        }

        if (continueBtn) {
            continueBtn.onclick = null;
            continueBtn.className = 'ido-btn ido-btn--primary ido-btn--sm ido-multiroute-route__continue';

            if (status === 'running' || status === 'pending') {
                continueBtn.textContent = '生成中…';
                continueBtn.disabled = true;
            } else if (!hasCommittedMessage) {
                continueBtn.textContent = status === 'error' ? '无法继续' : '等待结果';
                continueBtn.disabled = true;
                continueBtn.classList.remove('ido-btn--primary');
                continueBtn.classList.add('ido-btn--secondary');
            } else if (isCurrent) {
                continueBtn.textContent = '当前继续中';
                continueBtn.disabled = true;
                continueBtn.classList.remove('ido-btn--primary');
                continueBtn.classList.add('ido-btn--secondary');
            } else if (group.selectedRouteId === route.id) {
                continueBtn.textContent = '切换到这路';
                continueBtn.disabled = false;
                continueBtn.onclick = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    continueRoute(group.id, route.id, conv.id);
                };
            } else {
                continueBtn.textContent = '继续这路';
                continueBtn.disabled = false;
                continueBtn.onclick = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    continueRoute(group.id, route.id, conv.id);
                };
            }
        }
    }

    function createGroupCard(conv, group) {
        const root = document.createElement('div');
        root.className = 'ido-multiroute-group';
        root.dataset.multirouteGroupId = group.id;
        root.dataset.multirouteAnchorId = group.anchorMessageId || '';

        const header = document.createElement('div');
        header.className = 'ido-multiroute-group__header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'ido-multiroute-group__title-wrap';

        const title = document.createElement('div');
        title.className = 'ido-multiroute-group__title';
        title.textContent = '多路结果';
        titleWrap.appendChild(title);

        const subtitle = document.createElement('div');
        subtitle.className = 'ido-multiroute-group__subtitle';
        subtitle.textContent = `共 ${group.routes.length} 路，可先对比再继续`; 
        titleWrap.appendChild(subtitle);

        const summary = document.createElement('div');
        summary.className = 'ido-multiroute-group__summary';
        header.appendChild(titleWrap);
        header.appendChild(summary);

        const controls = document.createElement('div');
        controls.className = 'ido-multiroute-group__controls';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'ido-multiroute-group__nav ido-multiroute-group__nav--prev';
        prevBtn.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';
        controls.appendChild(prevBtn);

        const tabs = document.createElement('div');
        tabs.className = 'ido-multiroute-group__tabs';
        controls.appendChild(tabs);

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'ido-multiroute-group__nav ido-multiroute-group__nav--next';
        nextBtn.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
        controls.appendChild(nextBtn);

        const collapseBtn = document.createElement('button');
        collapseBtn.type = 'button';
        collapseBtn.className = 'ido-btn ido-btn--secondary ido-btn--sm ido-multiroute-group__toggle';
        controls.appendChild(collapseBtn);

        const compact = document.createElement('div');
        compact.className = 'ido-multiroute-group__compact';

        const compactInfo = document.createElement('div');
        compactInfo.className = 'ido-multiroute-group__compact-info';

        const compactTitle = document.createElement('div');
        compactTitle.className = 'ido-multiroute-group__compact-title';
        compactInfo.appendChild(compactTitle);

        const compactMeta = document.createElement('div');
        compactMeta.className = 'ido-multiroute-group__compact-meta';
        compactInfo.appendChild(compactMeta);

        const compactPreview = document.createElement('div');
        compactPreview.className = 'ido-multiroute-group__compact-preview';
        compactInfo.appendChild(compactPreview);
        compact.appendChild(compactInfo);

        const compactActions = document.createElement('div');
        compactActions.className = 'ido-multiroute-group__compact-actions';

        const compactCopyBtn = document.createElement('button');
        compactCopyBtn.type = 'button';
        compactCopyBtn.className = 'ido-btn ido-btn--secondary ido-btn--sm ido-multiroute-group__compact-copy';
        compactCopyBtn.textContent = '复制';
        compactActions.appendChild(compactCopyBtn);

        const compactExpandBtn = document.createElement('button');
        compactExpandBtn.type = 'button';
        compactExpandBtn.className = 'ido-btn ido-btn--secondary ido-btn--sm ido-multiroute-group__compact-expand';
        compactExpandBtn.textContent = '查看候选';
        compactActions.appendChild(compactExpandBtn);

        compact.appendChild(compactActions);

        const routes = document.createElement('div');
        routes.className = 'ido-multiroute-group__routes';

        const sortedRoutes = (group.routes || []).slice().sort((a, b) => (a.routeIndex || 0) - (b.routeIndex || 0));
        sortedRoutes.forEach((route) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'ido-multiroute-group__tab';
            tab.dataset.routeId = route.id;
            tabs.appendChild(tab);
            routes.appendChild(createRouteCard(conv, group, route));
        });

        root.appendChild(header);
        root.appendChild(controls);
        root.appendChild(compact);
        root.appendChild(routes);
        bindGroupCarousel(root, conv.id, group.id);
        updateGroupCard(root, conv, group);
        return root;
    }

    function updateGroupCard(root, conv, group) {
        if (!root || !conv || !group) return;
        const summary = deriveGroupSummary(group, conv);
        const subtitleEl = root.querySelector('.ido-multiroute-group__subtitle');
        const summaryEl = root.querySelector('.ido-multiroute-group__summary');
        if (summaryEl) {
            summaryEl.textContent = summary.text;
            summaryEl.dataset.tone = summary.tone;
        }

        const controlsEl = root.querySelector('.ido-multiroute-group__controls');
        const prevBtn = root.querySelector('.ido-multiroute-group__nav--prev');
        const nextBtn = root.querySelector('.ido-multiroute-group__nav--next');
        const collapseBtn = root.querySelector('.ido-multiroute-group__toggle');
        const tabsWrap = root.querySelector('.ido-multiroute-group__tabs');
        const compactEl = root.querySelector('.ido-multiroute-group__compact');
        const compactTitle = root.querySelector('.ido-multiroute-group__compact-title');
        const compactMeta = root.querySelector('.ido-multiroute-group__compact-meta');
        const compactPreview = root.querySelector('.ido-multiroute-group__compact-preview');
        const compactCopyBtn = root.querySelector('.ido-multiroute-group__compact-copy');
        const compactExpandBtn = root.querySelector('.ido-multiroute-group__compact-expand');
        const routesWrap = root.querySelector('.ido-multiroute-group__routes');
        if (!routesWrap) return;

        const sortedRoutes = (group.routes || []).slice().sort((a, b) => (a.routeIndex || 0) - (b.routeIndex || 0));
        const routeIdSet = new Set(sortedRoutes.map((route) => route.id));
        const focusedRouteId = getFocusedRouteId(group, conv);
        const focusedIndex = Math.max(0, sortedRoutes.findIndex((route) => route.id === focusedRouteId));
        const activeRoute = sortedRoutes[focusedIndex] || null;
        const selectedRoute = findRoute(group, group.selectedRouteId) || activeRoute;
        const selectedMessage = selectedRoute ? getRouteDisplayMessage(conv, selectedRoute) : null;
        const selectedStatus = selectedRoute ? deriveRouteStatus(selectedRoute, selectedMessage) : 'pending';
        const collapsed = !!group.collapsed && !!group.selectedRouteId && !!selectedRoute;

        root.dataset.collapsed = collapsed ? 'true' : 'false';
        root.classList.toggle('is-collapsed', collapsed);

        if (subtitleEl) {
            subtitleEl.textContent = collapsed && selectedRoute
                ? `已选择并${selectedRoute.routeIndex}继续，可随时展开其他候选`
                : `共 ${sortedRoutes.length} 路，可横向滑动 / 滚轮切换`;
        }

        if (controlsEl) {
            controlsEl.hidden = collapsed;
        }

        if (collapseBtn) {
            collapseBtn.hidden = !group.selectedRouteId;
            collapseBtn.textContent = '收起候选';
            collapseBtn.onclick = () => setGroupCollapsed(conv.id, group.id, true);
        }

        routesWrap.hidden = collapsed || sortedRoutes.length === 0;

        if (prevBtn) {
            const target = focusedIndex > 0 ? sortedRoutes[focusedIndex - 1] : null;
            prevBtn.disabled = !target;
            prevBtn.onclick = target ? () => focusGroupRoute(conv.id, group.id, target.id) : null;
        }

        if (nextBtn) {
            const target = focusedIndex < sortedRoutes.length - 1 ? sortedRoutes[focusedIndex + 1] : null;
            nextBtn.disabled = !target;
            nextBtn.onclick = target ? () => focusGroupRoute(conv.id, group.id, target.id) : null;
        }

        if (tabsWrap) {
            Array.from(tabsWrap.querySelectorAll('.ido-multiroute-group__tab')).forEach((tabEl) => {
                if (!routeIdSet.has(tabEl.dataset.routeId)) {
                    tabEl.remove();
                }
            });
        }

        Array.from(routesWrap.querySelectorAll('.ido-multiroute-route')).forEach((routeEl) => {
            if (!routeIdSet.has(routeEl.dataset.routeId)) {
                routeEl.remove();
            }
        });

        sortedRoutes.forEach((route) => {
            const message = getRouteDisplayMessage(conv, route);
            const status = deriveRouteStatus(route, message);

            if (tabsWrap) {
                let tabEl = tabsWrap.querySelector(`[data-route-id="${route.id}"]`);
                if (!tabEl) {
                    tabEl = document.createElement('button');
                    tabEl.type = 'button';
                    tabEl.className = 'ido-multiroute-group__tab';
                    tabEl.dataset.routeId = route.id;
                    tabsWrap.appendChild(tabEl);
                }
                tabEl.textContent = `并${route.routeIndex}`;
                tabEl.dataset.tone = status;
                tabEl.classList.toggle('is-active', activeRoute && activeRoute.id === route.id);
                tabEl.classList.toggle('is-selected', group.selectedRouteId === route.id);
                tabEl.title = `${formatRouteModel(route, message)} · ${formatRouteStatusText(status, route)}${group.selectedRouteId === route.id ? ' · 已选择继续' : ''}`;
                tabEl.onclick = () => focusGroupRoute(conv.id, group.id, route.id);
            }

            let routeEl = routesWrap.querySelector(`[data-route-id="${route.id}"]`);
            if (!routeEl) {
                routeEl = createRouteCard(conv, group, route);
                routesWrap.appendChild(routeEl);
            }
            updateRouteCard(routeEl, conv, group, route);
            routeEl.hidden = collapsed;
            routeEl.classList.toggle('is-active', !!activeRoute && activeRoute.id === route.id);
        });

        if (compactEl) {
            compactEl.hidden = !collapsed;
        }

        if (compactTitle) {
            compactTitle.textContent = selectedRoute ? `已继续并${selectedRoute.routeIndex}` : '已继续';
        }

        if (compactMeta) {
            const metaParts = [];
            if (selectedRoute) {
                metaParts.push(formatRouteModel(selectedRoute, selectedMessage));
            }
            const statsText = formatRouteStats(selectedMessage);
            if (statsText) {
                metaParts.push(statsText);
            } else if (selectedRoute) {
                metaParts.push(formatRouteStatusText(selectedStatus, selectedRoute));
            }
            compactMeta.textContent = metaParts.filter(Boolean).join(' · ');
        }

        if (compactPreview) {
            compactPreview.textContent = selectedRoute ? getRoutePreviewText(selectedRoute, selectedMessage, selectedStatus) : '暂无内容';
        }

        if (compactCopyBtn) {
            clearTimeout(compactCopyBtn.__mrFlashTimer);
            compactCopyBtn.classList.remove('is-success', 'is-error');
            compactCopyBtn.dataset.originalLabel = '复制';
            compactCopyBtn.textContent = '复制';
            const compactCopyText = selectedRoute ? buildRouteCopyText(selectedRoute, selectedMessage, selectedStatus) : '';
            compactCopyBtn.disabled = !compactCopyText;
            compactCopyBtn.onclick = compactCopyText
                ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    copyTextToClipboard(compactCopyText, compactCopyBtn, '已复制');
                }
                : null;
        }

        if (compactExpandBtn) {
            compactExpandBtn.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                setGroupCollapsed(conv.id, group.id, false);
            };
        }

        bindGroupCarousel(root, conv.id, group.id);
        if (!collapsed && activeRoute) {
            const previousFocusedRouteId = root.dataset.focusedRouteId || '';
            if (previousFocusedRouteId !== activeRoute.id) {
                root.dataset.focusedRouteId = activeRoute.id;
                if (!routesWrap.__mrUserScrolling) {
                    scrollGroupToRoute(root, activeRoute.id, previousFocusedRouteId ? 'slow' : 'auto');
                }
            }
        }
    }

    function insertGroupAfterAnchor(anchorEl, groupEl) {
        if (!anchorEl || !groupEl) return;
        let insertAfter = anchorEl;
        let next = anchorEl.nextElementSibling;
        while (next && next.dataset && next.dataset.multirouteAnchorId === groupEl.dataset.multirouteAnchorId) {
            insertAfter = next;
            next = next.nextElementSibling;
        }
        insertAfter.insertAdjacentElement('afterend', groupEl);
    }

    function ensureNodeGroupHost(messageCard, showMessageContent) {
        if (!messageCard) return null;
        const container = messageCard.querySelector('.ido-message__container');
        if (!container) return null;
        messageCard.classList.add('ido-message--multiroute');
        const content = container.querySelector('.ido-message__content');
        if (content) {
            content.hidden = showMessageContent !== true;
        }
        let host = container.querySelector('.ido-multiroute-node-host');
        if (!host) {
            host = document.createElement('div');
            host.className = 'ido-multiroute-node-host';
            container.appendChild(host);
        }
        return host;
    }

    function renderGroupIntoMessageCard(messageCard, conv, group) {
        const selectedRoute = group && group.selectedRouteId ? findRoute(group, group.selectedRouteId) : null;
        const selectedRootMessage = selectedRoute ? getRouteRootMessage(conv, selectedRoute) : null;
        const host = ensureNodeGroupHost(messageCard, !!selectedRootMessage);
        if (!host) return null;
        let groupEl = host.querySelector(`[data-multiroute-group-id="${group.id}"]`);
        if (!groupEl) {
            groupEl = createGroupCard(conv, group);
            host.appendChild(groupEl);
        }
        updateGroupCard(groupEl, conv, group);
        return groupEl;
    }

    function renderMessageNode(message, container, conv) {
        if (!isNodeMessage(message)) {
            return null;
        }
        const group = sanitizeGroup(Object.assign({}, message.metadata.multiRouteNode || {}, {
            nodeMessageId: message.id,
            anchorMessageId: message.parentId || null,
            branchParentId: (message.metadata.multiRouteNode && message.metadata.multiRouteNode.branchParentId) || message.parentId || null
        }));
        if (!group) {
            return null;
        }
        const scope = container && typeof container.querySelector === 'function' ? container : document;
        const messageCard = scope.querySelector(`[data-message-id="${message.id}"]`) || document.querySelector(`[data-message-id="${message.id}"]`);
        if (!messageCard) {
            return null;
        }
        return renderGroupIntoMessageCard(messageCard, conv || getActiveConversation(), group);
    }

    function describeMultiRouteMessageBehavior(message) {
        if (isDetachedMessage(message)) {
            return {
                hideInConversationTree: true,
                renderStandalone: false,
                includeInRequestContext: false
            };
        }

        if (isEmbeddedMessage(message)) {
            return {
                renderStandalone: false
            };
        }

        if (!isNodeMessage(message)) {
            return null;
        }

        const group = sanitizeGroup(Object.assign({}, message.metadata.multiRouteNode || {}, {
            nodeMessageId: message.id,
            anchorMessageId: message.parentId || null,
            branchParentId: (message.metadata.multiRouteNode && message.metadata.multiRouteNode.branchParentId) || message.parentId || null
        }));

        return {
            autoSelectFirstChild: false,
            includeInRequestContext: false,
            disableDomCache: true,
            sendConstraint: (!group || !group.selectedRouteId) ? { blocked: true, message: '请先在多路结果里选择要继续的一路' } : null,
            decorateDisplayPayload: (targetMessage, payload, context) => {
                const conv = context && context.conversation ? context.conversation : getActiveConversation();
                const selectedRoute = group && group.selectedRouteId ? findRoute(group, group.selectedRouteId) : null;
                const selectedRootMessage = selectedRoute ? getRouteRootMessage(conv, selectedRoute) : null;
                if (!selectedRoute || !selectedRootMessage) {
                    return payload;
                }

                payload.content = selectedRootMessage.content || '';
                payload.createdAt = selectedRootMessage.createdAt || payload.createdAt;
                payload.reasoning = selectedRootMessage.reasoning || undefined;
                payload.reasoningDuration = selectedRootMessage.reasoningDuration;
                payload.reasoningAccumulatedTime = selectedRootMessage.reasoningAccumulatedTime;
                payload.reasoningSegmentStart = selectedRootMessage.reasoningSegmentStart;
                payload.attachments = Array.isArray(selectedRootMessage.attachments) ? selectedRootMessage.attachments : undefined;
                payload.toolCalls = Array.isArray(selectedRootMessage.toolCalls) && selectedRootMessage.toolCalls.length > 0 ? selectedRootMessage.toolCalls : undefined;
                payload.modelName = selectedRootMessage.modelName || selectedRoute.model || payload.modelName;
                payload.channelName = selectedRootMessage.channelName || selectedRoute.channelName || payload.channelName;
                payload.stats = selectedRootMessage.stats || payload.stats;
                return payload;
            },
            renderInline: (targetMessage, container, conv) => renderMessageNode(targetMessage || message, container, conv)
        };
    }

    function ensureGroupVisible(convId, groupId) {
        const store = getStore();
        const conv = getConversationById(convId);
        if (!store || !conv || store.state.activeConversationId !== convId) {
            return null;
        }
        const chatStream = document.getElementById('chat-stream');
        if (!chatStream) return null;

        const existing = chatStream.querySelector(`[data-multiroute-group-id="${groupId}"]`);
        if (existing) {
            return existing;
        }

        const group = findGroup(conv, groupId);
        if (group && isNodeBackedGroup(group) && group.nodeMessageId) {
            const messageCard = chatStream.querySelector(`[data-message-id="${group.nodeMessageId}"]`);
            if (!messageCard) {
                return null;
            }
            return renderGroupIntoMessageCard(messageCard, conv, group);
        }

        if (!group || !group.anchorMessageId) {
            return null;
        }

        const anchorEl = chatStream.querySelector(`[data-message-id="${group.anchorMessageId}"]`);
        if (!anchorEl) {
            return null;
        }

        const groupEl = createGroupCard(conv, group);
        insertGroupAfterAnchor(anchorEl, groupEl);
        return groupEl;
    }

    function syncGroupCard(convId, groupId) {
        const conv = getConversationById(convId);
        if (!conv) return;
        const existing = ensureGroupVisible(convId, groupId);
        if (!existing) return;
        const group = findGroup(conv, groupId);
        if (!group) return;
        updateGroupCard(existing, conv, group);
    }

    function syncRoutePreview(convId, groupId, routeId) {
        const conv = getConversationById(convId);
        if (!conv) return;
        const groupEl = ensureGroupVisible(convId, groupId);
        if (!groupEl) return;
        const group = findGroup(conv, groupId);
        const route = group && findRoute(group, routeId);
        if (!group || !route) return;

        let routeEl = groupEl.querySelector(`[data-route-id="${route.id}"]`);
        if (!routeEl) {
            syncGroupCard(convId, groupId);
            return;
        }

        updateRouteCard(routeEl, conv, group, route);
        updateGroupCard(groupEl, conv, group);
    }

    function createExecutionGroup(convId, anchorMessageId, plan, options) {
        const conv = getConversationById(convId);
        if (!conv || !anchorMessageId || !Array.isArray(plan) || plan.length === 0) {
            return null;
        }

        const now = Date.now();
        const currentChannel = getChannelById(conv.selectedChannelId);
        const currentChannelName = currentChannel ? currentChannel.name : '';
        const currentModel = conv.selectedModel || '';
        const groups = getGroups(conv);
        const source = options && options.source ? String(options.source) : 'send';
        const branchParentId = options && options.branchParentId ? String(options.branchParentId) : String(anchorMessageId);
        const reuseGroupId = options && options.reuseGroupId ? String(options.reuseGroupId) : '';
        let reusableGroup = reuseGroupId
            ? groups.find((item) => item && item.id === reuseGroupId)
            : null;

        if (!reusableGroup && options && options.replaceExistingBranchGroup) {
            reusableGroup = groups.find((item) => item && (item.branchParentId || item.anchorMessageId) === branchParentId) || null;
        }

        let nodeMessage = reusableGroup && reusableGroup.nodeMessageId
            ? getMessageById(conv, reusableGroup.nodeMessageId)
            : null;

        if (!nodeMessage) {
            nodeMessage = {
                id: createLocalId('msg_mr'),
                role: 'assistant',
                content: '',
                createdAt: now,
                timestamp: new Date(now).toISOString(),
                plugin: null,
                metadata: {}
            };
            const store = getStore();
            if (!store || typeof store.addMessageToConversation !== 'function') {
                return null;
            }
            store.addMessageToConversation(conv.id, nodeMessage, branchParentId);
        } else {
            nodeMessage.parentId = branchParentId;
            nodeMessage.content = '';
            nodeMessage.metadata = nodeMessage.metadata && typeof nodeMessage.metadata === 'object' ? nodeMessage.metadata : {};
        }

        if (options && options.replaceExistingBranchGroup) {
            const removableChildren = Array.isArray(conv.messages)
                ? conv.messages.filter((msg) => msg && msg.parentId === nodeMessage.id)
                : [];
            removableChildren.forEach((child) => {
                const store = getStore();
                if (store && typeof store.deleteMessage === 'function') {
                    store.deleteMessage(conv.id, child.id);
                }
            });

            conv.activeBranchMap = conv.activeBranchMap || {};
            delete conv.activeBranchMap[nodeMessage.id];
            conv.activeBranchMap[branchParentId] = nodeMessage.id;
            const store = getStore();
            if (store && typeof store._invalidateActivePathCache === 'function') {
                store._invalidateActivePathCache(conv.id);
            }
        }

        const reusableRoutes = reusableGroup && Array.isArray(reusableGroup.routes)
            ? reusableGroup.routes
            : [];
        const routes = plan.map((item, index) => {
            const routeIndex = Number.isFinite(item && item.index) ? item.index : (index + 1);
            const existingRoute = reusableRoutes.find((route) => route && route.routeIndex === routeIndex) || null;
            const channel = item && item.useCurrent === false ? getChannelById(item.channelId) : currentChannel;
            const channelName = channel ? channel.name : (item && item.useCurrent === false ? '' : currentChannelName);
            const model = item && item.useCurrent === false
                ? String(item.model || '')
                : String(currentModel || item && item.model || '');
            return sanitizeRoute({
                id: existingRoute && existingRoute.id ? existingRoute.id : createLocalId('mr_r'),
                routeIndex,
                channelId: item && item.useCurrent === false ? item.channelId : conv.selectedChannelId,
                channelName,
                model,
                useCurrent: !(item && item.useCurrent === false),
                messageId: null,
                currentMessageId: null,
                status: 'pending',
                error: '',
                createdAt: existingRoute && Number.isFinite(existingRoute.createdAt) ? existingRoute.createdAt : now,
                updatedAt: now,
                continuedAt: null
            }, routeIndex);
        });

        const nextGroup = sanitizeGroup({
            id: reusableGroup && reusableGroup.id ? reusableGroup.id : createLocalId('mr_g'),
            nodeMessageId: nodeMessage.id,
            anchorMessageId,
            branchParentId,
            createdAt: reusableGroup && Number.isFinite(reusableGroup.createdAt) ? reusableGroup.createdAt : now,
            updatedAt: now,
            selectedRouteId: null,
            selectedMessageId: null,
            focusedRouteId: null,
            collapsed: false,
            source,
            routes
        });

        if (!nextGroup) {
            return null;
        }

        nodeMessage.metadata = nodeMessage.metadata && typeof nodeMessage.metadata === 'object' ? nodeMessage.metadata : {};
        nodeMessage.metadata.multiRouteNode = nextGroup;
        nodeMessage.hidden = false;

        const store = getStore();
        if (store) {
            if (conv.activeBranchMap) {
                conv.activeBranchMap[branchParentId] = nodeMessage.id;
            }
            store.persist();
        }
        return nextGroup;
    }

    function registerRouteMessage(convId, groupId, routeId, message) {
        if (!message || !message.id) return false;
        const success = updateRouteInGroup(convId, groupId, routeId, (route) => {
            route.messageId = route.messageId || message.id;
            route.currentMessageId = message.id;
            route.status = 'running';
            route.error = '';
            if (message.modelName) route.model = message.modelName;
            if (message.channelName) route.channelName = message.channelName;
        }, 'silent');
        if (success) {
            syncGroupCard(convId, groupId);
        }
        return success;
    }

    function adoptContinuationMessage(convId, groupId, routeId, message) {
        if (!message || !message.id) return false;
        const success = updateRouteInGroup(convId, groupId, routeId, (route) => {
            route.currentMessageId = message.id;
            route.status = 'running';
            if (!route.messageId) {
                route.messageId = message.id;
            }
            if (message.modelName) route.model = message.modelName;
            if (message.channelName) route.channelName = message.channelName;
        }, 'silent');
        if (success) {
            syncGroupCard(convId, groupId);
        }
        return success;
    }

    function markRouteFinished(convId, groupId, routeId, result) {
        const payload = result && typeof result === 'object' ? result : {};
        const success = updateRouteInGroup(convId, groupId, routeId, (route) => {
            if (payload.currentMessageId) {
                route.currentMessageId = payload.currentMessageId;
            }
            if (payload.messageId && !route.messageId) {
                route.messageId = payload.messageId;
            }
            route.status = payload.status || 'completed';
            route.error = payload.error ? String(payload.error) : '';
            if (payload.model) route.model = String(payload.model);
            if (payload.channelName) route.channelName = String(payload.channelName);
        });
        if (success) {
            syncGroupCard(convId, groupId);
        }
        return success;
    }

    function updateChipState() {
        if (!chipEl) return;

        const conv = getActiveConversation();
        const count = getExecutionCount(conv);
        chipEl.textContent = `并x${count}`;
        chipEl.classList.toggle('active', count > 1);
        chipEl.setAttribute('aria-pressed', count > 1 ? 'true' : 'false');
        chipEl.title = count > 1 ? `当前并发 ${count} 路` : '当前单路回答';
    }

    function openRouteSelector(routeIndex, frameworkApi) {
        const api = frameworkApi || Framework;
        const conv = getActiveConversation();
        const modelPicker = window.IdoFront && window.IdoFront.modelPicker;
        if (!conv || !modelPicker || typeof modelPicker.open !== 'function') {
            return;
        }

        const current = getRouteConfig(routeIndex, conv);
        if (api && typeof api.hideBottomSheet === 'function') {
            api.hideBottomSheet();
        }

        window.setTimeout(() => modelPicker.open({
            title: `并${routeIndex}`,
            allowFollowCurrent: true,
            followCurrentLabel: '当前模型',
            followCurrentDescription: '不单独指定',
            selectedChannelId: current ? current.channelId : null,
            selectedModel: current ? current.model : null,
            onSelect: (channelId, model) => {
                if (channelId && model) {
                    setRouteConfig(routeIndex, { channelId, model }, conv.id);
                } else {
                    setRouteConfig(routeIndex, null, conv.id);
                }
                updateChipState();
            },
            onClose: () => {
                if (api && typeof api.showBottomSheet === 'function') {
                    openSettingsSheet(api);
                }
            }
        }), 320);
    }

    function createRouteRow(routeIndex, conv, frameworkApi) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.gap = '12px';
        row.style.padding = '10px 12px';
        row.style.border = '1px solid var(--ido-color-border)';
        row.style.borderRadius = '12px';
        row.style.background = 'var(--ido-color-bg-secondary)';

        const left = document.createElement('div');
        left.style.minWidth = '0';
        left.style.flex = '0 0 auto';
        left.style.fontSize = '13px';
        left.style.fontWeight = '600';
        left.style.color = 'var(--ido-color-text-primary)';
        left.textContent = `并${routeIndex}`;
        row.appendChild(left);

        if (routeIndex === 1) {
            const current = getCurrentModelLabel(conv);
            const fixed = document.createElement('div');
            fixed.style.flex = '1';
            fixed.style.minWidth = '0';
            fixed.style.textAlign = 'right';
            fixed.style.fontSize = '12px';
            fixed.style.color = 'var(--ido-color-text-secondary)';
            fixed.style.whiteSpace = 'nowrap';
            fixed.style.overflow = 'hidden';
            fixed.style.textOverflow = 'ellipsis';
            fixed.textContent = current.text;
            fixed.title = current.title;
            row.appendChild(fixed);
            return row;
        }

        const buttonInfo = getRouteButtonLabel(routeIndex, conv);
        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'ido-btn ido-btn--secondary ido-btn--sm';
        selectBtn.style.minWidth = '0';
        selectBtn.style.maxWidth = '70%';
        selectBtn.style.justifyContent = 'space-between';
        selectBtn.style.gap = '6px';
        selectBtn.title = buttonInfo.title;
        selectBtn.innerHTML = `
            <span class="truncate">${buttonInfo.text}</span>
            <span class="material-symbols-outlined text-[16px] flex-shrink-0">expand_more</span>
        `;
        selectBtn.onclick = () => {
            openRouteSelector(routeIndex, frameworkApi);
        };

        row.appendChild(selectBtn);
        return row;
    }

    function openSettingsSheet(frameworkApi) {
        const api = frameworkApi || Framework;
        const conv = getActiveConversation();
        if (!api || typeof api.showBottomSheet !== 'function' || !conv) {
            return;
        }

        api.showBottomSheet((container) => {
            container.innerHTML = '';
            container.style.padding = '16px';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '14px';
            container.style.maxHeight = '75vh';
            container.style.overflow = 'hidden';

            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.justifyContent = 'space-between';
            header.style.gap = '12px';

            const title = document.createElement('div');
            title.style.fontSize = '16px';
            title.style.fontWeight = '700';
            title.style.color = 'var(--ido-color-text-primary)';
            title.textContent = '并发回答';

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'icon-btn';
            closeBtn.title = '关闭';
            closeBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">close</span>';
            closeBtn.onclick = () => {
                if (typeof api.hideBottomSheet === 'function') {
                    api.hideBottomSheet();
                }
            };

            header.appendChild(title);
            header.appendChild(closeBtn);

            const countRow = document.createElement('div');
            countRow.style.display = 'flex';
            countRow.style.alignItems = 'center';
            countRow.style.justifyContent = 'space-between';
            countRow.style.gap = '12px';
            countRow.style.padding = '10px 12px';
            countRow.style.border = '1px solid var(--ido-color-border)';
            countRow.style.borderRadius = '12px';
            countRow.style.background = 'var(--ido-color-bg-secondary)';

            const countLabel = document.createElement('div');
            countLabel.style.fontSize = '13px';
            countLabel.style.fontWeight = '600';
            countLabel.style.color = 'var(--ido-color-text-primary)';
            countLabel.textContent = '数量';

            const countInput = document.createElement('input');
            countInput.type = 'number';
            countInput.min = '1';
            countInput.inputMode = 'numeric';
            countInput.value = String(getCount(conv));
            countInput.style.width = '96px';
            countInput.style.padding = '8px 10px';
            countInput.style.border = '1px solid var(--ido-color-border)';
            countInput.style.borderRadius = '10px';
            countInput.style.background = 'var(--ido-color-bg-primary)';
            countInput.style.color = 'var(--ido-color-text-primary)';
            countInput.style.textAlign = 'right';
            countInput.style.outline = 'none';

            const routesWrap = document.createElement('div');
            routesWrap.style.display = 'flex';
            routesWrap.style.flexDirection = 'column';
            routesWrap.style.gap = '10px';
            routesWrap.style.overflowY = 'auto';
            routesWrap.style.paddingRight = '2px';

            const renderRoutes = () => {
                const activeConv = getActiveConversation();
                if (!activeConv) return;
                routesWrap.innerHTML = '';
                countInput.value = String(getCount(activeConv));

                const fragment = document.createDocumentFragment();
                const count = getCount(activeConv);
                for (let routeIndex = 1; routeIndex <= count; routeIndex += 1) {
                    fragment.appendChild(createRouteRow(routeIndex, activeConv, api));
                }
                routesWrap.appendChild(fragment);
            };

            const applyCountValue = () => {
                const normalized = normalizeCount(countInput.value);
                setCount(normalized, conv.id);
                updateChipState();
                renderRoutes();
            };

            countInput.addEventListener('input', () => {
                const raw = String(countInput.value || '').trim();
                if (!raw || !/^\d+$/.test(raw)) {
                    return;
                }
                applyCountValue();
            });
            countInput.addEventListener('blur', () => {
                applyCountValue();
            });
            countInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    applyCountValue();
                    countInput.blur();
                }
            });

            countRow.appendChild(countLabel);
            countRow.appendChild(countInput);

            container.appendChild(header);
            container.appendChild(countRow);
            container.appendChild(routesWrap);

            renderRoutes();
        });
    }

    function handleStoreUpdated() {
        updateChipState();
    }

    function handleConversationSwitched() {
        updateChipState();
    }

    window.IdoFront = window.IdoFront || {};
    window.IdoFront.multiRoute = window.IdoFront.multiRoute || {};
    window.IdoFront.multiRoute.PLUGIN_ID = PLUGIN_ID;
    window.IdoFront.multiRoute.PLUGIN_SLOT = PLUGIN_SLOT;
    window.IdoFront.multiRoute.STORAGE_COUNT_KEY = STORAGE_COUNT_KEY;
    window.IdoFront.multiRoute.STORAGE_ROUTES_KEY = STORAGE_ROUTES_KEY;
    window.IdoFront.multiRoute.STORAGE_GROUPS_KEY = STORAGE_GROUPS_KEY;
    window.IdoFront.multiRoute.getCount = getCount;
    window.IdoFront.multiRoute.setCount = setCount;
    window.IdoFront.multiRoute.getRouteConfig = getRouteConfig;
    window.IdoFront.multiRoute.setRouteConfig = setRouteConfig;
    window.IdoFront.multiRoute.getExecutionCount = getExecutionCount;
    window.IdoFront.multiRoute.getExecutionPlan = getExecutionPlan;
    window.IdoFront.multiRoute.getGroups = getGroups;
    window.IdoFront.multiRoute.createExecutionGroup = createExecutionGroup;
    window.IdoFront.multiRoute.registerRouteMessage = registerRouteMessage;
    window.IdoFront.multiRoute.adoptContinuationMessage = adoptContinuationMessage;
    window.IdoFront.multiRoute.markRouteFinished = markRouteFinished;
    window.IdoFront.multiRoute.ensureGroupVisible = ensureGroupVisible;
    window.IdoFront.multiRoute.syncGroupCard = syncGroupCard;
    window.IdoFront.multiRoute.syncRoutePreview = syncRoutePreview;
    window.IdoFront.multiRoute.continueRoute = continueRoute;
    window.IdoFront.multiRoute.focusGroupRoute = focusGroupRoute;
    window.IdoFront.multiRoute.setGroupCollapsed = setGroupCollapsed;
    window.IdoFront.multiRoute.isDetachedMessage = isDetachedMessage;
    window.IdoFront.multiRoute.isEmbeddedMessage = isEmbeddedMessage;
    window.IdoFront.multiRoute.isNodeMessage = isNodeMessage;
    window.IdoFront.multiRoute.migrateAllLegacyGroups = migrateAllLegacyGroups;
    window.IdoFront.multiRoute.migrateLegacyGroupsToNodes = migrateLegacyGroupsToNodes;
    window.IdoFront.multiRoute.renderMessageNode = renderMessageNode;

    getMessageNodeBehaviors().registerResolver(PLUGIN_ID, { describe: describeMultiRouteMessageBehavior });
    migrateAllLegacyGroups('silent');

    registerPlugin(PLUGIN_SLOT, PLUGIN_ID, {
        meta: {
            id: PLUGIN_ID,
            name: '多路回答',
            description: '为同一条用户消息生成多路结果组，用于先对比再继续。',
            source: 'internal',
            listable: true,
            tags: ['builtin', 'chat', 'parallel']
        },
        init: function() {
            const store = getStore();
            if (!storeSubscribed && store && store.events && typeof store.events.on === 'function') {
                store.events.on('updated', handleStoreUpdated);
                store.events.on('conversation:switched', handleConversationSwitched);
                storeSubscribed = true;
            }
            migrateAllLegacyGroups('silent');
        },
        render: function(api) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'status-chip clickable';
            chip.style.order = '22';
            chip.onclick = () => openSettingsSheet(api || Framework);

            chipEl = chip;
            updateChipState();
            return chip;
        },
        destroy: function() {
            const store = getStore();
            if (storeSubscribed && store && store.events && typeof store.events.off === 'function') {
                store.events.off('updated', handleStoreUpdated);
                store.events.off('conversation:switched', handleConversationSwitched);
                storeSubscribed = false;
            }
            chipEl = null;
        }
    });
})();
