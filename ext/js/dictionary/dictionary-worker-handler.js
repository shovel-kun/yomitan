/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2021-2022  Yomichan Authors
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

import {ExtensionError} from '../core/extension-error.js';
import {DictionaryDatabase} from './dictionary-database.js';
import {DictionaryImporter} from './dictionary-importer.js';
import {DictionaryWorkerMediaLoader} from './dictionary-worker-media-loader.js';

const NATIVE_DICTIONARY_IMPORT_ERROR_PREFIX = '__NATIVE_DICTIONARY_IMPORT_ERROR__:';

export class DictionaryWorkerHandler {
    constructor() {
        /** @type {DictionaryWorkerMediaLoader} */
        this._mediaLoader = new DictionaryWorkerMediaLoader();
        /** @type {Map<string, Set<Function>>} */
        this._listeners = new Map();
        this._messageHandler = this._onMessage.bind(this);
    }

    /** */
    prepare() {
        this.addEventListener('message', this._messageHandler);
    }

    /**
     * @param {string} type
     * @param {Function} listener
     */
    addEventListener(type, listener) {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, new Set());
        }
        this._listeners.get(type).add(listener);
    }

    /**
     * @param {string} type
     * @param {Function} listener
     */
    removeEventListener(type, listener) {
        if (this._listeners.has(type)) {
            const listeners = this._listeners.get(type);
            listeners.delete(listener);
            if (listeners.size === 0) {
                this._listeners.delete(type);
            }
        }
    }

    /**
     * @param {Object} message
     */
    postMessage(message) {
        this._dispatchEvent({type: 'message', data: message});
    }

    terminate() {
        this.removeEventListener('message', this._messageHandler);
        this._listeners.clear();
    }

    /**
     * @param {Object} event
     */
    _dispatchEvent(event) {
        const listeners = this._listeners.get(event.type);
        if (listeners) {
            for (const listener of listeners) {
                try {
                    listener(event);
                } catch (e) {
                    console.error('Error in event listener:', e);
                }
            }
        }
    }

    // Private

    /**
    * @param {import('dictionary-worker-handler').Message} message
    */
    _onMessage(message) {
        if (message.type === 'message') {
            const { action, params } = message.data;
            switch (action) {
                case 'importDictionary':
                    void this._onMessageWithProgress(params, this._importDictionary.bind(this));
                    break;
                case 'deleteDictionary':
                    void this._onMessageWithProgress(params, this._deleteDictionary.bind(this));
                    break;
                case 'getDictionaryCounts':
                    void this._onMessageWithProgress(params, this._getDictionaryCounts.bind(this));
                    break;
                case 'getImageDetails.response':
                    this._mediaLoader.handleMessage(params);
                    break;
            }
        }
    }

    /**
     * @template [T=unknown]
     * @param {T} params
     * @param {(details: T, onProgress: import('dictionary-worker-handler').OnProgressCallback) => Promise<unknown>} handler
     */
    async _onMessageWithProgress(params, handler) {
        /**
         * @param {...unknown} args
         */
        const onProgress = (...args) => {
            this.postMessage({action: 'progress', params: {args}});
        };
        let response;
        try {
            const result = await handler(params, onProgress);
            response = {result};
        } catch (e) {
            response = {error: ExtensionError.serialize(e)};
        }
        this.postMessage({action: 'complete', params: response});
    }

    /**
     * @param {import('dictionary-worker-handler').ImportDictionaryMessageParams} details
     * @param {import('dictionary-worker-handler').OnProgressCallback} onProgress
     * @returns {Promise<import('dictionary-worker').MessageCompleteResultSerialized>}
     */
    async _importDictionary({details, archiveContent}, onProgress) {
        // Prefer native Kotlin importer when running in the embedded QuickJS backend.
        if (typeof globalThis._nativeDictionaryImport === 'function') {
            const text = globalThis._nativeDictionaryImport(String(archiveContent), JSON.stringify(details));
            if (typeof text === 'string' && text.startsWith(NATIVE_DICTIONARY_IMPORT_ERROR_PREFIX)) {
                throw new Error(text.slice(NATIVE_DICTIONARY_IMPORT_ERROR_PREFIX.length).trim());
            }
            const payload = (typeof text === 'string' && text.length > 0) ? JSON.parse(text) : null;
            const errors = Array.isArray(payload?.errors) ? payload.errors : [];
            const result = payload?.result ?? null;
            return {
                result,
                errors: errors.map((message) => ExtensionError.serialize(new Error(String(message)))),
            };
        }

        const dictionaryDatabase = await this._getPreparedDictionaryDatabase();
        try {
            const dictionaryImporter = new DictionaryImporter(this._mediaLoader, onProgress);
            const {result, errors} = await dictionaryImporter.importDictionary(dictionaryDatabase, archiveContent, details);
            return {
                result,
                errors: errors.map((error) => ExtensionError.serialize(error)),
            };
        } finally {
            void dictionaryDatabase.close();
        }
    }

    /**
     * @param {import('dictionary-worker-handler').DeleteDictionaryMessageParams} details
     * @param {import('dictionary-database').DeleteDictionaryProgressCallback} onProgress
     * @returns {Promise<void>}
     */
    async _deleteDictionary({dictionaryTitle}, onProgress) {
        const dictionaryDatabase = await this._getPreparedDictionaryDatabase();
        try {
            return await dictionaryDatabase.deleteDictionary(dictionaryTitle, 1000, onProgress);
        } finally {
            void dictionaryDatabase.close();
        }
    }

    /**
     * @param {import('dictionary-worker-handler').GetDictionaryCountsMessageParams} details
     * @returns {Promise<import('dictionary-database').DictionaryCounts>}
     */
    async _getDictionaryCounts({dictionaryNames, getTotal}) {
        const dictionaryDatabase = await this._getPreparedDictionaryDatabase();
        try {
            return await dictionaryDatabase.getDictionaryCounts(dictionaryNames, getTotal);
        } finally {
            void dictionaryDatabase.close();
        }
    }

    /**
     * @returns {Promise<DictionaryDatabase>}
     */
    async _getPreparedDictionaryDatabase() {
        const dictionaryDatabase = new DictionaryDatabase();
        await dictionaryDatabase.prepare();
        return dictionaryDatabase;
    }
}
