/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2019-2022  Yomichan Authors
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
import {HotkeyHandler} from '../input/hotkey-handler.js';
import {Frontend} from './frontend.js';
import {PopupFactory} from './popup-factory.js';
import {chrome} from '../chrome-mock.js';

globalThis.senderContext = 3;

// The KMP JS bridge can be injected slightly after page scripts run on some platforms.
// Queue outbound messages until a bridge becomes available so the content script doesn't stall.
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

window.onNativeMessage = function(message) {
    try {
        message = JSON.parse(decodeURI(message));
    } catch (error) {
        console.error('Failed to parse message from native environment:', error);
        return;
    }

    if (message.messageId !== undefined && message.messageId !== null && message.response) {
        const callback = callbackMap.get(message.messageId);
        if (callback) {
            callback(message.response);
            callbackMap.delete(message.messageId);
        }
    } else if (message.sender) {
        chrome.runtime.sendMessageWithSender(message.message, message.sender.id);
    } else {
        chrome.runtime.sendMessage(message);
    }
};

// Listens to all messages and decides whether to forward them to native.
chrome.runtime.onMessage.addListener(function (message, sender, callback) {
  if (sender.id === globalThis.senderContext) {
    postMessageToNative(message, sender);

    if (message.params && message.params.messageId !== undefined) {
      callbackMap.set(message.params.callbackId, callback);
    }
  }
  return true;
});

(async () => {
    await Application.main(false, async (application) => {
        const hotkeyHandler = new HotkeyHandler();
        hotkeyHandler.prepare(application.crossFrame);

        const popupFactory = new PopupFactory(application);
        popupFactory.prepare();

        const frontend = new Frontend({
            application,
            popupFactory,
            depth: 0,
            parentPopupId: null,
            parentFrameId: null,
            useProxyPopup: false,
            pageType: 'web',
            canUseWindowPopup: true,
            allowRootFramePopupProxy: true,
            childrenSupported: true,
            hotkeyHandler,
        });
        await frontend.prepare();
    });
})().catch((error) => {
    console.error(error);
});
