/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
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

import '../chrome-mock.js'
import {log} from '../core/log.js';
import {WebExtension} from '../extension/web-extension.js';
import {Backend} from './backend.js';

// Make startup idempotent: on some platforms the backend module can be evaluated more than once.
if (globalThis.__yomitanBackgroundMainStarted !== true) {
    globalThis.__yomitanBackgroundMainStarted = true;

    // Background context sender id (matches chrome-mock conventions and enables DictionaryWorker in this runtime).
    globalThis.senderContext = 1;

    const handleChromeMessage = (message, sender, callback) => {
        // Only forward background-originated messages (push/broadcasts) to WebViews.
        // Requests from WebViews (sender.id !== 1) are handled via the normal sendResponse callback
        // path and should not be echoed back as "push" messages.
        if (sender && sender.id === 1) {
            const messageAndSender = {message, sender: {id: 1}};
            returns(JSON.stringify(messageAndSender));

            // Clear callback registries for sendMessageIgnoreResponse-style calls.
            if (typeof callback === 'function') {
                callback({});
            }
        }
    };

    chrome.runtime.onMessage.addListener(handleChromeMessage);

/** Entry point. */
    async function main() {
        const webExtension = new WebExtension();
        log.configure(webExtension.extensionName);

        const backend = new Backend(webExtension);
        await backend.prepare();
    }

    void main();
} else {
    // Already started; skip duplicate initialization.
}
