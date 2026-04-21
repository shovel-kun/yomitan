/*
 * Copyright (C) 2023-2026  Yomitan Authors
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

import {Application} from '../application.js';
import {DocumentFocusController} from '../dom/document-focus-controller.js';
import {HotkeyHandler} from '../input/hotkey-handler.js';
import {DisplayAnki} from './display-anki.js';
import {DisplayAudio} from './display-audio.js';
import {DisplayProfileSelection} from './display-profile-selection.js';
import {DisplayResizer} from './display-resizer.js';
import {Display} from './display.js';
import {chrome} from '../chrome-mock.js';

globalThis.senderContext = 2;

// The KMP JS bridge can be injected slightly after page scripts run on some platforms.
// Queue outbound messages until a bridge becomes available so popup doesn't stall on startup.
const nativeMessageQueue = [];
let nativeQueueFlushScheduled = false;

function flushNativeMessageQueue() {
    nativeQueueFlushScheduled = false;

    const hasKmpBridge = (window.kmpJsBridge && typeof window.kmpJsBridge.callNative === 'function');
    if (!hasKmpBridge) {
        if (nativeMessageQueue.length > 0) {
            nativeQueueFlushScheduled = true;
            setTimeout(flushNativeMessageQueue, 50);
        }
        return;
    }

    while (nativeMessageQueue.length > 0) {
        const payload = nativeMessageQueue.shift();
        window.kmpJsBridge.callNative('postMessage', payload, null);
    }
}

function postMessageToNative(message, sender) {
    const payload = JSON.stringify({message, sender});

    if (window.kmpJsBridge && typeof window.kmpJsBridge.callNative === 'function') {
        window.kmpJsBridge.callNative('postMessage', payload, null);
        return;
    }

    nativeMessageQueue.push(payload);
    if (!nativeQueueFlushScheduled) {
        nativeQueueFlushScheduled = true;
        setTimeout(flushNativeMessageQueue, 50);
    }
}

const callbackMap = new Map();
let pendingNativeLookupRequestId = getRequestIdFromLocation();

function getRequestIdFromLocation() {
    const requestId = new URLSearchParams(window.location.search).get('request_id');
    if (requestId === null) { return null; }
    const parsed = Number.parseInt(requestId, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function updatePendingLookupRequestId() {
    pendingNativeLookupRequestId = getRequestIdFromLocation();
}

function getResolvedLookupSourceText(display) {
    const dictionaryEntry = display.dictionaryEntries[display.selectedIndex] ?? display.dictionaryEntries[0] ?? null;
    if (dictionaryEntry === null) { return null; }

    if (dictionaryEntry.type === 'kanji') {
        return typeof dictionaryEntry.character === 'string' && dictionaryEntry.character.length > 0 ? dictionaryEntry.character : null;
    }

    if (dictionaryEntry.type !== 'term' || !Array.isArray(dictionaryEntry.headwords)) {
        return null;
    }

    for (const headword of dictionaryEntry.headwords) {
        if (!Array.isArray(headword.sources)) { continue; }
        for (const source of headword.sources) {
            if (!source?.isPrimary) { continue; }
            return typeof source.originalText === 'string' && source.originalText.length > 0 ? source.originalText : null;
        }
    }

    return null;
}

window.onNativeMessage = function(message) {
    try {
        message = JSON.parse(decodeURI(message));
        // console.log('popup-main: Received native message', message);
    } catch (error) {
        console.error('Failed to parse message from native environment:', error);
        return;
    }

    if (message.messageId !== undefined && message.messageId !== null && message.response) {
        const callback = callbackMap.get(message.messageId);
        if (callback) {
            // console.log('popup-main: Calling callback for messageId', message.messageId);
            callback(message.response);
            callbackMap.delete(message.messageId);
        }
    } else if (message.sender) {
        // console.log('popup-main: Sending message with sender', message);
        chrome.runtime.sendMessageWithSender(message.message, message.sender.id);
    } else {
        // console.log('popup-main: Sending message without sender', message);
        chrome.runtime.sendMessage(message);
    }
};

// Listens to all messages and decides whether to forward them to native
chrome.runtime.onMessage.addListener(function(message, sender, callback) {
    if (sender.id === globalThis.senderContext) {
        // console.log('popup-main: Posting message to native', message);
        postMessageToNative(message, sender);

        if (message.params && message.params.messageId !== undefined) {
            callbackMap.set(message.params.callbackId, callback);
        }
    }
    return true;
});

window.addEventListener('popstate', updatePendingLookupRequestId);

await Application.main(true, async (application) => {
    const documentFocusController = new DocumentFocusController();
    documentFocusController.prepare();

    const hotkeyHandler = new HotkeyHandler();
    hotkeyHandler.prepare(application.crossFrame);

    const display = new Display(application, 'popup', documentFocusController, hotkeyHandler);
    await display.prepare();

    const displayAudio = new DisplayAudio(display);
    displayAudio.prepare();

    const displayAnki = new DisplayAnki(display, displayAudio);
    displayAnki.prepare();

    const displayProfileSelection = new DisplayProfileSelection(display);
    void displayProfileSelection.prepare();

    const displayResizer = new DisplayResizer(display);
    displayResizer.prepare();

    display.on('contentUpdateComplete', () => {
        const requestId = pendingNativeLookupRequestId;
        if (requestId === null) { return; }

        pendingNativeLookupRequestId = null;
        chrome.runtime.sendMessage({
            action: 'nativeResolvedLookup',
            params: {
                requestId,
                sourceText: getResolvedLookupSourceText(display),
            },
        });
    });
    display.initializeState();

    document.documentElement.dataset.loaded = 'true';
});
