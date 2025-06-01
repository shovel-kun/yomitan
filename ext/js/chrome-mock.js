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
        this.onDisconnect.callListeners(this);
    }

    /**
     * Posts a message through the port
     * @param {unknown} message
     */
    postMessage(message) {
        // eslint-disable-next-line no-console
        console.log('Posting message', message);
        this.onMessage.callListeners(message);
    }
}

/** @type {Record<number, Function>} */
const callbackRegistry = {};
let messageId = 0;
let callbackId = 0;

const chrome = {
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
    runtime: {
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
                {id: globalThis.senderContext},
                (response) => {
                    const registeredCallback = callbackRegistry[modifiedMessage.params.messageId];
                    if (registeredCallback) {
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
                {id: sender},
                (response) => {
                    const registeredCallback = callbackRegistry[modifiedMessage.params.messageId];
                    if (registeredCallback) {
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
            return `http://127.0.0.1:2453${url}`;
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
             * @param {string} key
             * @param {unknown} value
             */
            set(key, value) {
                // eslint-disable-next-line no-console
                console.log('Set local storage', key, value);
            },
            /**
             * @param {string} key
             * @returns {null}
             */
            get(key) {
                // eslint-disable-next-line no-console
                console.log('Get local storage', key);
                return null;
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

class CrossFrameAPI {
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

export {chrome, CrossFrameAPI};
