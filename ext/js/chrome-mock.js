/*
 * Copyright (C) 2023-2025  Ebisuzawa Kurumi
 * Copyright (C) 2023-2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Refer:
// https://github.com/chromium/chromium/blob/c2311095314bbdfc78c95d030442b512774bfc42/tools/typescript/definitions/runtime.d.ts
// https://github.com/chromium/chromium/blob/b11d0cf754e793dd4ad89ab1fa7013bd2d1637d0/chrome/browser/resources/chromeos/accessibility/definitions/runtime.d.ts
// This module can be evaluated more than once in some bundling/runtime setups.
// Avoid re-initializing the mock and wiping listeners/callback registries.
let chrome = globalThis.chrome;
let CrossFrameAPI = globalThis.CrossFrameAPI;

if (!chrome || chrome.__yomitanChromeMock !== true) {
class ChromeEvent {
    /**
     * @param {Function | null} listenerAddedCallback Callback to run the first time a listener is added.
     */
    constructor(listenerAddedCallback) {
        /** @type {Set<Function>} */
        this.listeners_ = new Set();
        /** @type {Function | null} */
        this.listenerAddedCallback_ = listenerAddedCallback;
    }

    /**
     * Adds a listener to this event.
     * @param {Function} listener
     */
    addListener(listener) {
        this.listeners_.add(listener);
        if (this.listenerAddedCallback_) {
            this.listenerAddedCallback_();
            this.listenerAddedCallback_ = null;
        }
    }

    /**
     * Removes a listener from this event.
     * @param {Function} listener
     */
    removeListener(listener) {
        this.listeners_.delete(listener);
    }

    /**
     * Calls all listeners of this event with the given args.
     * @param {...unknown} args Args to pass to listeners.
     */
    callListeners(...args) {
        try {
            for (const listener of this.listeners_) {
                listener(...args);
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error);
        }
    }
}

class Port {
    /**
     * @param {string} name
     * @param {unknown} sender
     */
    constructor(name, sender) {
        /** @type {string} */
        this.name = name;
        /** @type {unknown} */
        this.sender = sender;
        /** @type {ChromeEvent} */
        this.onDisconnect = new ChromeEvent();
        /** @type {ChromeEvent} */
        this.onMessage = new ChromeEvent();
    }

    /**
     * Disconnects the port
     */
    disconnect() {
        if (typeof this.__portId === 'number') {
            chrome.runtime.sendMessage({action: '__portDisconnect', params: {portId: this.__portId}});
        }
        this.onDisconnect.callListeners(this);
    }

    /**
     * Posts a message through the port
     * @param {unknown} message
     */
    postMessage(message) {
        if (typeof this.__portId === 'number') {
            chrome.runtime.sendMessage({action: '__portPostMessage', params: {portId: this.__portId, message}});
            return;
        }
        // eslint-disable-next-line no-console
        console.log('Posting message', message);
        this.onMessage.callListeners(message);
    }
}

/** @type {Record<number, Function>} */
const callbackRegistry = {};
let messageId = 0;
let callbackId = 0;

/**
 * Ensures a stable tabId/frameId per JS context.
 * - tabId: shared across frames within the same WebView "tab" (default: 1)
 * - frameId: 0 for top frame; random non-zero for subframes
 */
function ensureFrameIdentity() {
    if (!(typeof globalThis.tabId === 'number' && Number.isFinite(globalThis.tabId))) {
        globalThis.tabId = 1;
    }
    if (!(typeof globalThis.frameId === 'number' && Number.isFinite(globalThis.frameId))) {
        let isTop = false;
        try {
            isTop = (globalThis.top === globalThis);
        } catch (e) {
            isTop = false;
        }
        if (isTop) {
            globalThis.frameId = 0;
        } else {
            const n = (Math.random() * 2147483647) | 0;
            globalThis.frameId = n === 0 ? 1 : n;
        }
    }
}

/**
 * Creates a Chrome-like message sender object.
 * Some Yomitan background APIs require `sender.tab.id` (e.g. `api.getZoom`).
 *
 * @param {number} id
 * @returns {{id: number, tab?: {id: number}, frameId?: number}}
 */
function createSender(id) {
    // Background senderContext is 1; avoid pretending background is a tab.
    if (id === 1) {
        return {id};
    }
    ensureFrameIdentity();
    return {id, tab: {id: globalThis.tabId}, frameId: globalThis.frameId};
}

/** @type {Map<number, Port>} */
const portRegistry = new Map();

chrome = {
    __yomitanChromeMock: true,
    tabs: {
        /**
         * @param {number} tabId
         * @param {{frameId: number, name: string}} connectInfo
         * @returns {Port}
         */
        connect(tabId, connectInfo) {
            const {frameId, name} = connectInfo;
            const sender = {tab: {id: tabId}, frameId};
            return new Port(name, sender);
        },
    },
    // MV3 APIs used by Yomitan's background script. In our embedded WebView/QuickJS environment we
    // don't actually "inject" scripts/CSS via Chrome; these operations are handled natively, so
    // these are implemented as no-op success callbacks.
    scripting: {
        /**
         * @param {unknown} _details
         * @param {Function} [callback]
         */
        insertCSS(_details, callback) {
            if (typeof callback === 'function') {
                setTimeout(callback, 0);
            }
        },
        /**
         * @param {unknown} _scripts
         * @param {Function} [callback]
         */
        registerContentScripts(_scripts, callback) {
            if (typeof callback === 'function') {
                setTimeout(callback, 0);
            }
        },
        /**
         * @param {unknown} _filter
         * @param {Function} callback
         */
        getRegisteredContentScripts(_filter, callback) {
            if (typeof callback === 'function') {
                setTimeout(() => callback([]), 0);
            }
        },
        /**
         * @param {unknown} _filter
         * @param {Function} [callback]
         */
        unregisterContentScripts(_filter, callback) {
            if (typeof callback === 'function') {
                setTimeout(callback, 0);
            }
        },
    },
    runtime: {
        /** @param {Function} callback */
        getPlatformInfo(callback) {
            const result = {os: 'android', arch: 'arm', nacl_arch: 'arm'};
            if (typeof callback === 'function') {
                setTimeout(() => callback(result), 0);
            }
        },
        /** @type {ChromeEvent} */
        onMessage: new ChromeEvent(null),
        /**
         * @param {unknown} message
         * @param {Function} callback
         */
        sendMessage(message, callback) {
            /** @type {{action: string, params: {callbackId?: number, messageId?: number}}} */
            let modifiedMessage;

            if (typeof message === 'string') {
                try {
                    modifiedMessage = JSON.parse(message);
                } catch (error) {
                    console.error('JSON.parse error', error);
                    modifiedMessage = {action: message, params: {}};
                }
            } else if (typeof message === 'object' && message !== null) {
                modifiedMessage = {...message};
            } else {
                modifiedMessage = {action: String(message), params: {}};
            }

            modifiedMessage.params ??= {};

            modifiedMessage.params.callbackId =
                'callbackId' in modifiedMessage.params ?
                modifiedMessage.params.callbackId :
                callbackId++;

            const id = messageId++;
            callbackRegistry[id] = callback;

            modifiedMessage.params.messageId = id;

            this.onMessage.callListeners(
                modifiedMessage,
                createSender(globalThis.senderContext),
                (response) => {
                    const registeredCallback = callbackRegistry[modifiedMessage.params.messageId];
                    if (registeredCallback) {
                        console.log('Response is:', JSON.stringify(response));
                        registeredCallback(response);
                        delete callbackRegistry[modifiedMessage.params.messageId];
                    }
                },
            );
        },
        /**
         * @param {unknown} message
         * @param {unknown} sender
         * @param {Function} callback
         */
        sendMessageWithSender(message, sender, callback) {
            /** @type {{action: string, params: {callbackId?: number, messageId?: number}}} */
            let modifiedMessage;

            if (typeof message === 'string') {
                try {
                    modifiedMessage = JSON.parse(message);
                } catch (error) {
                    // eslint-disable-next-line no-console
                    console.error('JSON.parse error', error);
                    modifiedMessage = {action: message, params: {}};
                }
            } else if (typeof message === 'object' && message !== null) {
                modifiedMessage = {...message};
            } else {
                modifiedMessage = {action: String(message), params: {}};
            }

            modifiedMessage.params ??= {};

            modifiedMessage.params.callbackId =
                'callbackId' in modifiedMessage.params ?
                modifiedMessage.params.callbackId :
                callbackId++;

            const id = messageId++;
            callbackRegistry[id] = callback;

            modifiedMessage.params.messageId = id;

            this.onMessage.callListeners(
                modifiedMessage,
                createSender(sender),
                (response) => {
                    const registeredCallback = callbackRegistry[modifiedMessage.params.messageId];
                    if (registeredCallback) {
                        console.log('Response is:', JSON.stringify(response));
                        registeredCallback(response);
                        delete callbackRegistry[modifiedMessage.params.messageId];
                    }
                },
            );
        },
        /** @type {ChromeEvent} */
        onInstalled: new ChromeEvent(() => {
            // eslint-disable-next-line no-console
            console.log('Added permission listener');
        }),
        /** @type {ChromeEvent} */
        onConnect: new ChromeEvent(() => {
            // eslint-disable-next-line no-console
            console.log('Added permission listener');
        }),
        declarativeNetRequest: {
            /**
            * @param {chrome.declarativeNetRequest.UpdateRuleOptions} options
            * @param {Function} [callback]
            */
            updateDynamicRules(options, callback) {
                if (typeof callback === 'function') {
                    setTimeout(callback, 0);
                }
            },
            /**
            * @param {Function} callback
            */
            getDynamicRules(callback) {
                if (typeof callback === 'function') {
                    setTimeout(() => callback([]), 0);
                }
            }
        },
        /**
         * @param {string} name
         * @returns {Port}
         */
        connect(name) {
            const port = new Port(name, undefined);
            this.onConnect.callListeners(port);
            return port;
        },
        /**
         * @param {string} url
         * @returns {string}
         */
        getURL(url) {
            const path = (typeof url === 'string' && url.length > 0) ?
                (url.startsWith('/') ? url : `/${url}`) :
                '/';
            return `http://127.0.0.1:2453${path}`;
        },
        /**
         * @returns {chrome.runtime.Manifest}
         */
        getManifest() {
            return {
                manifest_version: 3,
                name: 'Yomitan',
                version: '0.0.0.0',
                description: 'Japanese dictionary with Anki integration',
                author: {
                    email: 'themoeway@googlegroups.com',
                },
                icons: {
                    16: 'images/icon16.png',
                    19: 'images/icon19.png',
                    32: 'images/icon32.png',
                    38: 'images/icon38.png',
                    48: 'images/icon48.png',
                    64: 'images/icon64.png',
                    128: 'images/icon128.png',
                },
                action: {
                    default_icon: {
                        16: 'images/icon16.png',
                        19: 'images/icon19.png',
                        32: 'images/icon32.png',
                        38: 'images/icon38.png',
                        48: 'images/icon48.png',
                        64: 'images/icon64.png',
                        128: 'images/icon128.png',
                    },
                    default_title: 'Yomitan',
                    default_popup: 'action-popup.html',
                },
                background: {
                    service_worker: 'sw.js',
                    type: 'module',
                },
                content_scripts: [
                    {
                        run_at: 'document_idle',
                        matches: ['http://*/*', 'https://*/*', 'file://*/*'],
                        match_about_blank: true,
                        all_frames: true,
                        js: ['js/app/content-script-wrapper.js'],
                    },
                ],
                minimum_chrome_version: '102.0.0.0',
                options_ui: {
                    page: 'settings.html',
                    open_in_tab: true,
                },
                sandbox: {
                    pages: ['template-renderer.html'],
                },
                permissions: [
                    'storage',
                    'clipboardWrite',
                    'unlimitedStorage',
                    'declarativeNetRequest',
                    'scripting',
                    'offscreen',
                    'contextMenus',
                ],
                optional_permissions: ['clipboardRead', 'nativeMessaging'],
                host_permissions: ['<all_urls>'],
                commands: {
                    toggleTextScanning: {
                        suggested_key: {
                            default: 'Alt+Delete',
                        },
                        description: 'Toggle text scanning on/off',
                    },
                    openInfoPage: {
                        description: 'Open the info page',
                    },
                    openSettingsPage: {
                        description: 'Open the settings page',
                    },
                    openSearchPage: {
                        suggested_key: {
                            default: 'Alt+Insert',
                        },
                        description: 'Open the search page',
                    },
                    openPopupWindow: {
                        description: 'Open the popup window',
                    },
                },
                web_accessible_resources: [
                    {
                        resources: ['popup.html', 'template-renderer.html', 'js/*'],
                        matches: ['<all_urls>'],
                    },
                ],
                content_security_policy: {
                    extension_pages:
                        "default-src 'self'; img-src blob: 'self'; style-src 'self' 'unsafe-inline'; media-src *; connect-src *",
                    sandbox:
                        "sandbox allow-scripts; default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'",
                },
            };
        },
    },
    /** @type {undefined} */
    lastError: void 0,
    PlatformOs: {
        /**
         * @returns {string}
         */
        get platformOs() {
            return 'android';
        },
    },
    permissions: {
        /** @type {ChromeEvent} */
        onAdded: new ChromeEvent(() => {
            // eslint-disable-next-line no-console
            console.log('Added permission listener');
        }),
        /** @type {ChromeEvent} */
        onRemoved: new ChromeEvent(() => {
            // eslint-disable-next-line no-console
            console.log('Added permission listener');
        }),
        /**
         * @param {Function} callback
         */
        getAll(callback) {
            const permissions = {
                origins: ['https://www.google.com'],
            };
            if (callback) {
                setTimeout(() => callback(permissions), 0);
            }
        },
    },
    i18n: {
        /**
         * @returns {string}
         */
        getUILanguage() {
            return 'en';
        },
    },
    storage: {
        session: {
            /**
             * @param {string} key
             * @param {unknown} value
             */
            set(key, value) {
                // eslint-disable-next-line no-console
                console.log('Set session storage', key, value);
            },
            /**
             * @param {string} key
             * @returns {null}
             */
            get(key) {
                // eslint-disable-next-line no-console
                console.log('Get session storage', key);
                return null;
            },
            /**
             * @param {string} key
             */
            remove(key) {
                // eslint-disable-next-line no-console
                console.log('Remove session storage', key);
            },
        },
        local: {
            /**
             * @param {{[key: string]: unknown}} items
             * @param {Function} callback
             */
            set(items, callback) {
                console.log("Setting local storage");
                try {
                  for (const [key, value] of Object.entries(items)) {
                    _nativeStorageSave(key, value);
                  }
                  if (callback) {
                    callback();
                  }
                } catch (error) {
                  console.error("Error setting local storage", error);
                  if (callback) {
                    callback(error);
                  }
                }
            },
            /**
             * @param {string} keys
             * @param {Function} callback
             */
            async get(keys, callback) {
                try {
                  let result = {};
                  if (Array.isArray(keys)) {
                    for (const key of keys) {
                      const value = _nativeStorageLoad(key);
                      result[key] = value;
                    }
                  } else if (typeof keys === "string") {
                    const value = _nativeStorageLoad(keys);
                    result[keys] = value;
                  } else if (typeof keys === "object") {
                    for (const key of Object.keys(keys)) {
                      const value = _nativeStorageLoad(key);
                      result[key] = value ?? keys[key];
                    }
                  }
                  console.log("Got local storage");
                  callback(result);
                } catch (error) {
                  console.error("Error in mock chrome.storage.local.get:", error);
                  callback({});
                }
            },
            /**
             * @param {string} key
             */
            remove(key) {
                // eslint-disable-next-line no-console
                console.log('Remove local storage', key);
            },
        },
    },
};

globalThis.chrome = chrome;

// Native Port plumbing:
// - Native sends `{action:'__portConnect', params:{portId,name}}` to create a Port and trigger onConnect.
// - Native sends `{action:'__portDeliver', params:{portId,message}}` to deliver to port.onMessage.
// - This side sends `{action:'__portPostMessage', params:{portId,message}}` when Port.postMessage is called.
// - This side sends `{action:'__portDisconnect', params:{portId}}` when Port.disconnect is called.
chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') { return false; }
    const {action, params} = message;
    if (action === '__portConnect') {
        const portId = params && typeof params.portId === 'number' ? params.portId : null;
        const name = params && typeof params.name === 'string' ? params.name : '';
        if (portId === null) { return true; }
        const port = new Port(name, params && params.sender ? params.sender : void 0);
        port.__portId = portId;
        portRegistry.set(portId, port);
        chrome.runtime.onConnect.callListeners(port);
        return true;
    }
    if (action === '__portDeliver') {
        const portId = params && typeof params.portId === 'number' ? params.portId : null;
        if (portId === null) { return true; }
        const port = portRegistry.get(portId);
        if (port) {
            port.onMessage.callListeners(params.message);
        }
        return true;
    }
    if (action === '__portDisconnectDeliver') {
        const portId = params && typeof params.portId === 'number' ? params.portId : null;
        if (portId === null) { return true; }
        const port = portRegistry.get(portId);
        if (port) {
            portRegistry.delete(portId);
            port.onDisconnect.callListeners(port);
        }
        return true;
    }
    return false;
});

CrossFrameAPI = class CrossFrameAPI {
    /**
     * @param {unknown} api
     * @param {number} tabId
     * @param {number} frameId
     */
    constructor(api, tabId, frameId) {
        /** @type {unknown} */
        this.api = api;
        /** @type {number} */
        this.tabId = tabId;
        /** @type {number} */
        this.frameId = frameId;
    }

    /**
     * Prepares the API
     */
    prepare() {
        // eslint-disable-next-line no-console
        console.log('CrossFrameAPI prepared');
    }
}

globalThis.CrossFrameAPI = CrossFrameAPI;
}

export {chrome, CrossFrameAPI};
