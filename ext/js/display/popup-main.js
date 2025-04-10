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

const callbackMap = new Map();

window.onNativeMessage = function(message) {
    try {
        // console.log("Received message from RN environment:", message);
        message = JSON.parse(decodeURI(message));
        console.log("Parsed message from RN environment:", message);
    } catch (error) {
        console.log("Error:", error);
    }

    if (
        message.messageId !== undefined &&
        message.messageId !== null &&
        message.response
    ) {
        const callback = callbackMap.get(message.messageId);
        if (callback) {
            callback(message.response);
            callbackMap.delete(message.messageId);
        }
    } else {
        if (message.sender) {
            chrome.runtime.sendMessageWithSender(message.message, message.sender.id);
        } else {
            chrome.runtime.sendMessage(message);
        }
    }
};

// Listens to all messages and decides whether to forward them to RN
chrome.runtime.onMessage.addListener(function(message, sender, callback) {
    if (sender.id === globalThis.senderContext) {
        if (window.ReactNativeWebView) {
            const messageAndSender = {
                message,
                sender,
            };
            console.log(
                "Sent message to RN environment:",
                JSON.stringify(messageAndSender),
            );
            window.ReactNativeWebView.postMessage(JSON.stringify(messageAndSender));
        }

        if (message.params && message.params.messageId !== undefined) {
            callbackMap.set(message.params.callbackId, callback);
        }
    }
    return true;
});

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

    display.initializeState();

    document.documentElement.dataset.loaded = 'true';
});
