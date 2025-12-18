/**
 * Hybrid Plugin Parser
 * 解析 YAML/JS 混合格式的插件文件
 *
 * 格式示例:
 * ```yaml
 * id: my-plugin
 * version: 1.0.0
 *
 * ui:
 *   INPUT_TOP:
 *     - component: md-chip
 *       props: { text: "状态" }
 *
 * settings:
 *   fields:
 *     enabled:
 *       type: boolean
 *       default: true
 *
 * channel:
 *   type: my-channel
 *   defaults:
 *     baseUrl: https://api.example.com
 *
 * # JS 脚本使用 YAML 多行字符串语法
 * script: |
 *   const adapter = {
 *     async call(messages, config, onUpdate, signal) {
 *       // Channel 逻辑
 *     }
 *   };
 *   Plugin.registerChannel(adapter);
 * ```
 */
(function() {
    'use strict';

    window.IdoFront = window.IdoFront || {};
    window.IdoFront.hybridParser = {};

    /**
     * 解析混合格式插件内容
     * 使用 YAML 原生 `script:` 字段存放 JS 代码
     *
     * @param {string} content - 插件文件内容
     * @returns {Object} { yaml: Object, js: string|null, raw: { yamlPart: string, jsPart: string } }
     */
    function parseHybridPlugin(content) {
        if (!content || typeof content !== 'string') {
            throw new Error('Invalid plugin content');
        }

        const result = {
            yaml: null,
            js: null,
            raw: {
                yamlPart: content.trim(),
                jsPart: ''
            }
        };

        // 解析 YAML
        try {
            if (typeof jsyaml !== 'undefined') {
                result.yaml = jsyaml.load(content);
            } else if (typeof YAML !== 'undefined') {
                result.yaml = YAML.parse(content);
            } else {
                // 简易 YAML 解析器（仅支持基础语法）
                result.yaml = parseSimpleYaml(content);
            }
        } catch (e) {
            console.error('[HybridParser] YAML parse error:', e);
            throw new Error(`YAML parse error: ${e.message}`);
        }

        // 从 YAML 中提取 script 字段作为 JS 部分
        if (result.yaml && result.yaml.script) {
            result.js = result.yaml.script;
            result.raw.jsPart = result.yaml.script;
            // 从 yaml 对象中删除 script 字段，避免重复
            delete result.yaml.script;
        }

        return result;
    }

    /**
     * 简易 YAML 解析器（仅支持基础语法）
     * 用于无外部依赖的场景
     * @param {string} yamlStr 
     * @returns {Object}
     */
    function parseSimpleYaml(yamlStr) {
        const lines = yamlStr.split('\n');
        const result = {};
        const stack = [{ indent: -1, obj: result }];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // 跳过空行和注释
            if (!trimmed || trimmed.startsWith('#')) continue;

            // 计算缩进
            const indent = line.search(/\S/);
            
            // 解析键值对
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex === -1) continue;

            const key = trimmed.substring(0, colonIndex).trim();
            let value = trimmed.substring(colonIndex + 1).trim();

            // 回退到正确的父级
            while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
                stack.pop();
            }

            const parent = stack[stack.length - 1].obj;

            if (value === '' || value === '|' || value === '>') {
                // 嵌套对象或多行字符串
                const newObj = {};
                if (Array.isArray(parent)) {
                    parent.push({ [key]: newObj });
                } else {
                    parent[key] = newObj;
                }
                stack.push({ indent, obj: newObj });
            } else if (value.startsWith('-')) {
                // 数组开始
                const arr = [];
                parent[key] = arr;
                stack.push({ indent, obj: arr });
                // 处理第一个数组项
                const itemValue = value.substring(1).trim();
                if (itemValue) {
                    arr.push(parseYamlValue(itemValue));
                }
            } else {
                // 简单值
                if (Array.isArray(parent)) {
                    parent.push({ [key]: parseYamlValue(value) });
                } else {
                    parent[key] = parseYamlValue(value);
                }
            }
        }

        return result;
    }

    /**
     * 解析 YAML 值
     * @param {string} value 
     * @returns {any}
     */
    function parseYamlValue(value) {
        if (!value) return null;
        
        // 布尔值
        if (value === 'true') return true;
        if (value === 'false') return false;
        
        // null
        if (value === 'null' || value === '~') return null;
        
        // 数字
        if (/^-?\d+$/.test(value)) return parseInt(value, 10);
        if (/^-?\d*\.\d+$/.test(value)) return parseFloat(value);
        
        // 字符串（去除引号）
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            return value.substring(1, value.length - 1);
        }
        
        // 内联对象 { key: value }
        if (value.startsWith('{') && value.endsWith('}')) {
            try {
                // 简单处理：转换为 JSON 格式
                const jsonStr = value
                    .replace(/(\w+):/g, '"$1":')
                    .replace(/'/g, '"');
                return JSON.parse(jsonStr);
            } catch (e) {
                return value;
            }
        }
        
        // 内联数组 [a, b, c]
        if (value.startsWith('[') && value.endsWith(']')) {
            try {
                const jsonStr = value.replace(/'/g, '"');
                return JSON.parse(jsonStr);
            } catch (e) {
                return value;
            }
        }
        
        return value;
    }

    /**
     * 验证插件结构
     * @param {Object} parsed - 解析后的插件对象
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    function validatePlugin(parsed) {
        const errors = [];
        const yaml = parsed.yaml || {};

        // 必需字段
        if (!yaml.id) {
            errors.push('Missing required field: id');
        }

        // 验证 UI 配置
        if (yaml.ui) {
            if (typeof yaml.ui !== 'object') {
                errors.push('Invalid ui configuration: must be an object');
            }
        }

        // 验证 settings 配置
        if (yaml.settings) {
            if (yaml.settings.fields && typeof yaml.settings.fields !== 'object') {
                errors.push('Invalid settings.fields: must be an object');
            }
        }

        // 验证 channel 配置
        if (yaml.channel) {
            if (!yaml.channel.type && !parsed.js) {
                errors.push('Channel requires either a type or JS adapter');
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * 规范化插件配置
     * @param {Object} parsed - 解析后的插件对象
     * @returns {Object} 规范化后的配置
     */
    function normalizePlugin(parsed) {
        const yaml = parsed.yaml || {};
        
        return {
            // 元数据
            id: yaml.id || `plugin-${Date.now()}`,
            version: yaml.version || '1.0.0',
            name: yaml.name || yaml.id || 'Unnamed Plugin',
            description: yaml.description || '',
            author: yaml.author || '',
            icon: yaml.icon || '',
            homepage: yaml.homepage || '',

            // UI 声明
            ui: normalizeUIConfig(yaml.ui),

            // 设置声明
            settings: normalizeSettingsConfig(yaml.settings),

            // Channel 声明
            channel: normalizeChannelConfig(yaml.channel),

            // 样式（CSS）
            styles: normalizeStyles(yaml.styles),

            // JS 脚本（需要沙箱执行）
            script: parsed.js || null,

            // 原始内容
            raw: parsed.raw
        };
    }

    /**
     * 规范化样式配置
     * @param {string|Object} stylesConfig
     * @returns {Object|null}
     */
    function normalizeStyles(stylesConfig) {
        if (!stylesConfig) return null;

        // 字符串形式：直接 CSS
        if (typeof stylesConfig === 'string') {
            return {
                css: stylesConfig.trim(),
                scoped: false
            };
        }

        // 对象形式：带配置
        if (typeof stylesConfig === 'object') {
            return {
                css: (stylesConfig.css || '').trim(),
                scoped: stylesConfig.scoped === true
            };
        }

        return null;
    }

    /**
     * 规范化 UI 配置
     * @param {Object} uiConfig 
     * @returns {Object}
     */
    function normalizeUIConfig(uiConfig) {
        if (!uiConfig) return null;

        const normalized = {};

        Object.keys(uiConfig).forEach(slotName => {
            const slotConfig = uiConfig[slotName];
            
            // 确保是数组
            const components = Array.isArray(slotConfig) ? slotConfig : [slotConfig];
            
            normalized[slotName] = components.map((comp, index) => ({
                id: comp.id || `${slotName}-${index}`,
                component: comp.component || 'custom',
                visible: comp.visible !== undefined ? comp.visible : true,
                props: comp.props || {},
                actions: comp.actions || {},
                onClick: comp.onClick || null
            }));
        });

        return normalized;
    }

    /**
     * 规范化 Settings 配置
     * @param {Object} settingsConfig 
     * @returns {Object}
     */
    function normalizeSettingsConfig(settingsConfig) {
        if (!settingsConfig) return null;

        return {
            section: settingsConfig.section || null,
            fields: normalizeSettingsFields(settingsConfig.fields)
        };
    }

    /**
     * 规范化设置字段
     * @param {Object} fields 
     * @returns {Object}
     */
    function normalizeSettingsFields(fields) {
        if (!fields) return {};

        const normalized = {};

        Object.keys(fields).forEach(fieldName => {
            const field = fields[fieldName];
            
            normalized[fieldName] = {
                type: field.type || 'text',
                label: field.label || fieldName,
                hint: field.hint || '',
                default: field.default !== undefined ? field.default : null,
                options: field.options || null,
                min: field.min,
                max: field.max,
                transform: field.transform || null,
                validation: field.validation || null
            };
        });

        return normalized;
    }

    /**
     * 规范化 Channel 配置
     * @param {Object} channelConfig 
     * @returns {Object}
     */
    function normalizeChannelConfig(channelConfig) {
        if (!channelConfig) return null;

        return {
            type: channelConfig.type || null,
            label: channelConfig.label || channelConfig.type || 'Custom Channel',
            extends: channelConfig.extends || null,
            defaults: channelConfig.defaults || {},
            capabilities: channelConfig.capabilities || {
                streaming: true,
                vision: false
            },
            request: channelConfig.request || null,
            response: channelConfig.response || null,
            polling: channelConfig.polling || null
        };
    }

    /**
     * 判断是否为混合格式插件
     * @param {string} filename 
     * @returns {boolean}
     */
    function isHybridPlugin(filename) {
        return filename.endsWith('.plugin.yaml') || 
               filename.endsWith('.plugin.yml') ||
               filename.endsWith('.idoplugin');
    }

    /**
     * 判断插件是否需要沙箱执行
     * @param {Object} normalizedPlugin 
     * @returns {boolean}
     */
    function needsSandbox(normalizedPlugin) {
        // 有 JS 脚本就需要沙箱
        if (normalizedPlugin.script) return true;
        
        // 纯声明式插件不需要沙箱
        return false;
    }

    /**
     * 从 YAML 配置生成声明式渲染代码
     * 用于主线程直接执行（无需沙箱）
     * @param {Object} normalizedPlugin 
     * @returns {string} 可执行的 JS 代码
     */
    function generateDeclarativeCode(normalizedPlugin) {
        const parts = [];

        // 生成 UI 注册代码
        if (normalizedPlugin.ui) {
            Object.keys(normalizedPlugin.ui).forEach(slotName => {
                const components = normalizedPlugin.ui[slotName];
                
                components.forEach(comp => {
                    parts.push(`
// 声明式 UI 组件: ${slotName}/${comp.id}
IdoFront.declarativeUI.register('${slotName}', '${comp.id}', ${JSON.stringify(comp)});
`);
                });
            });
        }

        // 生成 Settings 注册代码
        if (normalizedPlugin.settings) {
            parts.push(`
// 声明式设置
IdoFront.declarativeSettings.register('${normalizedPlugin.id}', ${JSON.stringify(normalizedPlugin.settings)});
`);
        }

        // 生成 Channel 注册代码（仅声明式部分）
        if (normalizedPlugin.channel && !normalizedPlugin.script) {
            const channelId = normalizedPlugin.channel.type || normalizedPlugin.id;
            parts.push(`
// 声明式 Channel（继承自 ${normalizedPlugin.channel.extends || 'base'}）
IdoFront.declarativeChannel.register('${channelId}', ${JSON.stringify(normalizedPlugin.channel)});
`);
        }

        return parts.join('\n');
    }

    /**
     * 生成沙箱执行代码
     * 直接返回用户脚本，Plugin API 由沙箱的 executePlugin 注入
     * @param {Object} normalizedPlugin
     * @returns {string}
     */
    function generateSandboxCode(normalizedPlugin) {
        // 不再创建 Plugin 对象，直接使用沙箱注入的 Plugin API
        // Plugin API 由 sandbox-loader.js 的 createPluginAPI 提供，包含完整功能：
        // - getSettings / saveSettings
        // - getConversationMeta / setConversationMeta / clearConversationMeta
        // - addBodyClass / removeBodyClass / toggleBodyClass
        // - onSettingsChange
        // - registerChannel
        return normalizedPlugin.script || '';
    }

    /**
     * 获取默认设置值
     * @param {Object} settingsConfig 
     * @returns {Object}
     */
    function getDefaultSettings(settingsConfig) {
        if (!settingsConfig || !settingsConfig.fields) return {};

        const defaults = {};
        Object.keys(settingsConfig.fields).forEach(key => {
            const field = settingsConfig.fields[key];
            if (field.default !== undefined) {
                defaults[key] = field.default;
            }
        });
        return defaults;
    }

    // 导出 API
    window.IdoFront.hybridParser = {
        parse: parseHybridPlugin,
        validate: validatePlugin,
        normalize: normalizePlugin,
        isHybridPlugin,
        needsSandbox,
        generateDeclarativeCode,
        generateSandboxCode
    };

    console.log('[HybridParser] Module loaded');
})();