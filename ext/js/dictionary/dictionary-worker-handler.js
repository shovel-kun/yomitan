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

export class DictionaryWorkerHandler {
    constructor() {
        /** @type {DictionaryWorkerMediaLoader} */
        this._mediaLoader = new DictionaryWorkerMediaLoader();
    }

    /** */
    prepare() {
        console.log('Preparing DictionaryWorkerHandler');
        // self.addEventListener('message', this._onMessage.bind(this), false);
        chrome.runtime.onMessage.addListener(this._onMessage.bind(this));
    }

    // Private

    /**
    * @param {import('dictionary-worker-handler').Message} message
    * @param {chrome.runtime.MessageSender} sender
    * @param {(response?: any) => void} sendResponse
    */
    _onMessage(message, sender, sendResponse) {
        // NOTE: Needed to modify for chrome runtime messaging
        const { action, params } = message;
        switch (action) {
            case 'importDictionary':
                void this._onMessageWithProgress(params, this._importDictionary.bind(this), sendResponse);
                break;
            case 'deleteDictionary':
                void this._onMessageWithProgress(params, this._deleteDictionary.bind(this), sendResponse);
                break;
            case 'getDictionaryCounts':
                void this._onMessageWithProgress(params, this._getDictionaryCounts.bind(this), sendResponse);
                break;
            case 'getImageDetails.response':
                this._mediaLoader.handleMessage(params);
                break;
        }
    }

    /**
     * @template [T=unknown]
     * @param {T} params
     * @param {(details: T, onProgress: import('dictionary-worker-handler').OnProgressCallback) => Promise<unknown>} handler
     * @param {(response?: any) => void} sendResponse
     */
    async _onMessageWithProgress(params, handler, sendResponse) {
        /**
         * @param {...unknown} args
         */
        const onProgress = (...args) => {
            // NOTE: Replace all postMessage with chrome.runtime.sendMessage
            // sendResponse({ action: 'complete', params: response });
            chrome.runtime.sendMessage({
              action: 'progress',
              params: {args},
            });
        };
        let response;
        try {
            const result = await handler(params, onProgress);
            response = {result};
        } catch (e) {
            response = {error: ExtensionError.serialize(e)};
        }
        // self.postMessage({action: 'complete', params: response});
        chrome.runtime.sendMessage({
          action: 'complete',
          params: response,
        });
    }

    /**
     * @param {import('dictionary-worker-handler').ImportDictionaryMessageParams} details
     * @param {import('dictionary-worker-handler').OnProgressCallback} onProgress
     * @returns {Promise<import('dictionary-worker').MessageCompleteResultSerialized>}
     */
    async _importDictionary({details, archiveContent}, onProgress) {
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
        console.log('Preparing Dictionary Database');
        const dictionaryDatabase = new DictionaryDatabase();
        await dictionaryDatabase.prepare();
        return dictionaryDatabase;
    }
}
