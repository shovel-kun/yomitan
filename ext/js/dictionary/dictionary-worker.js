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
import {DictionaryImporterMediaLoader} from './dictionary-importer-media-loader.js';

export class DictionaryWorker {
    constructor() {
        /** @type {DictionaryImporterMediaLoader} */
        this._dictionaryImporterMediaLoader = new DictionaryImporterMediaLoader();
    }

    /**
     * @param {ArrayBuffer} archiveContent
     * @param {import('dictionary-importer').ImportDetails} details
     * @param {?import('dictionary-worker').ImportProgressCallback} onProgress
     * @returns {Promise<import('dictionary-importer').ImportResult>}
     */
    importDictionary(archiveContent, details, onProgress) {
        return this._invoke(
            'importDictionary',
            {details, archiveContent},
            [archiveContent],
            onProgress,
            this._formatImportDictionaryResult.bind(this),
        );
    }

    /**
     * @param {string} dictionaryTitle
     * @param {?import('dictionary-worker').DeleteProgressCallback} onProgress
     * @returns {Promise<void>}
     */
    deleteDictionary(dictionaryTitle, onProgress) {
        return this._invoke('deleteDictionary', {dictionaryTitle}, [], onProgress, null);
    }

    /**
     * @param {string[]} dictionaryNames
     * @param {boolean} getTotal
     * @returns {Promise<import('dictionary-database').DictionaryCounts>}
     */
    getDictionaryCounts(dictionaryNames, getTotal) {
        return this._invoke('getDictionaryCounts', {dictionaryNames, getTotal}, [], null, null);
    }

    // Private

    /**
     * @template [TParams=import('core').SerializableObject]
     * @template [TResponseRaw=unknown]
     * @template [TResponse=unknown]
     * @param {string} action
     * @param {TParams} params
     * @param {Transferable[]} transfer
     * @param {?(arg: import('core').SafeAny) => void} onProgress
     * @param {?(result: TResponseRaw) => TResponse} formatResult
     */
    _invoke(action, params, transfer, onProgress, formatResult) {
        return new Promise(async (resolve, reject) => {
            const senderContext =
                (typeof globalThis !== 'undefined' && typeof globalThis.senderContext !== 'undefined') ? globalThis.senderContext :
                (typeof global !== 'undefined' && typeof global.senderContext !== 'undefined') ? global.senderContext :
                void 0;

            if (senderContext === 1) {
                const {DictionaryWorkerHandler} = await import('./dictionary-worker-handler.js');
                const worker = new DictionaryWorkerHandler();
                worker.prepare();
                /** @type {import('dictionary-worker').InvokeDetails<TResponseRaw, TResponse>} */
                const details = {
                    complete: false,
                    worker,
                    resolve,
                    reject,
                    onMessage: null,
                    onProgress,
                    formatResult,
                };
                // Ugly typecast below due to not being able to explicitly state the template types
                /** @type {(event: MessageEvent<import('dictionary-worker').MessageData<TResponseRaw>>) => void} */
                const onMessage = /** @type {(details: import('dictionary-worker').InvokeDetails<TResponseRaw, TResponse>, event: MessageEvent<import('dictionary-worker').MessageData<TResponseRaw>>) => void} */ (this._onMessage).bind(this, details);
                details.onMessage = onMessage;
                worker.addEventListener('message', onMessage);
                worker.postMessage({action, params});
                // worker.postMessage({action, params}, transfer);
            } else {
                reject(new Error(`DictionaryWorker unavailable (senderContext=${String(senderContext)})`));
            }
        });
    }

    /**
     * @template [TResponseRaw=unknown]
     * @template [TResponse=unknown]
     * @param {import('dictionary-worker').InvokeDetails<TResponseRaw, TResponse>} details
     * @param {MessageEvent<import('dictionary-worker').MessageData<TResponseRaw>>} event
     */
    _onMessage(details, event) {
        if (details.complete) { return; }
        const {action, params} = event.data;
        switch (action) {
            case 'complete':
                {
                    const {worker, resolve, reject, onMessage, formatResult} = details;
                    if (worker === null || onMessage === null || resolve === null || reject === null) { return; }
                    details.complete = true;
                    details.worker = null;
                    details.resolve = null;
                    details.reject = null;
                    details.onMessage = null;
                    details.onProgress = null;
                    details.formatResult = null;
                    worker.removeEventListener('message', onMessage);
                    worker.terminate();
                    this._onMessageComplete(params, resolve, reject, formatResult);
                }
                break;
            case 'progress':
                this._onMessageProgress(params, details.onProgress);
                break;
            case 'getImageDetails':
                {
                    const {worker} = details;
                    if (worker === null) { return; }
                    void this._onMessageGetImageDetails(params, worker);
                }
                break;
        }
    }

    /**
     * @template [TResponseRaw=unknown]
     * @template [TResponse=unknown]
     * @param {import('dictionary-worker').MessageCompleteParams<TResponseRaw>} params
     * @param {(result: TResponse) => void} resolve
     * @param {(reason?: import('core').RejectionReason) => void} reject
     * @param {?(result: TResponseRaw) => TResponse} formatResult
     */
    _onMessageComplete(params, resolve, reject, formatResult) {
        const {error} = params;
        if (typeof error !== 'undefined') {
            reject(ExtensionError.deserialize(error));
        } else {
            const {result} = params;
            if (typeof formatResult === 'function') {
                let result2;
                try {
                    result2 = formatResult(result);
                } catch (e) {
                    reject(e);
                    return;
                }
                resolve(result2);
            } else {
                // If formatResult is not provided, the response is assumed to be the same type
                // For some reason, eslint thinks the TResponse type is undefined
                // eslint-disable-next-line jsdoc/no-undefined-types
                resolve(/** @type {TResponse} */ (/** @type {unknown} */ (result)));
            }
        }
    }

    /**
     * @param {import('dictionary-worker').MessageProgressParams} params
     * @param {?(...args: unknown[]) => void} onProgress
     */
    _onMessageProgress(params, onProgress) {
        const {args} = params;
        // Progress needs to be streamed to the WebView. In the QuickJS backend, we can emit it
        // through the native bridge by calling `returns(...)`, which Kotlin forwards to active
        // WebSocket sessions. (No session => broadcast; acceptable for now.)
        if (typeof globalThis.returns === 'function') {
            globalThis.returns(JSON.stringify({message: {action: 'progress', params: args}, sender: {id: 1}}));
            return;
        }
        chrome.runtime.sendMessage({action: 'progress', params: args});
    }

    /**
     * @param {import('dictionary-worker').MessageGetImageDetailsParams} params
     * @param {Worker} worker
     */
    async _onMessageGetImageDetails(params, worker) {
        const {id, content, mediaType} = params;
        /** @type {Transferable[]} */
        const transfer = [];
        let response;
        try {
            const result = await this._dictionaryImporterMediaLoader.getImageDetails(content, mediaType, transfer);
            response = {id, result};
        } catch (e) {
            response = {id, error: ExtensionError.serialize(e)};
        }
        worker.postMessage({action: 'getImageDetails.response', params: response}, transfer);
    }

    /**
     * @param {import('dictionary-worker').MessageCompleteResultSerialized} response
     * @returns {import('dictionary-worker').MessageCompleteResultSerialized}
     */
    _formatImportDictionaryResult(response) {
        const {result, errors} = response;
        return {
            result,
            // Don't deserialize errors because we have to send them over webview bridge
            errors
        };
    }
}
