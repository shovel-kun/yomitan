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

const callbackMap = new Map();

window.onNativeMessage = function(message) {
    try {
        // console.log('Received message from RN environment:', message);
        message = JSON.parse(decodeURI(message));
        console.log('Parsed message from RN environment:', message);
    } catch (error) {
        console.error('Failed to parse message from RN environment:', error);
    }

    if (message.messageId !== undefined && message.messageId !== null && message.response) {
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
chrome.runtime.onMessage.addListener(function (message, sender, callback) {
  if (sender.id === globalThis.senderContext) {
    if (window.ReactNativeWebView) {
      const messageAndSender = {message, sender};
      console.log('Sent message to RN environment:', JSON.stringify(messageAndSender));
      window.ReactNativeWebView.postMessage(JSON.stringify(messageAndSender));
    } else if (window.ReadiumWebView) {
      const messageAndSender = {message, sender};
      console.log('Sent message to Readium environment:', JSON.stringify(messageAndSender));
      window.ReadiumWebView.postMessage(JSON.stringify(messageAndSender));
    }

    if (message.params && message.params.messageId !== undefined) {
      callbackMap.set(message.params.callbackId, callback);
    }
  }
  return true;
});

await Application.main(false, async (application) => {
    const hotkeyHandler = new HotkeyHandler();
    hotkeyHandler.prepare(application.crossFrame);

    console.log('Preparing popup factory');
    const popupFactory = new PopupFactory(application);
    popupFactory.prepare();

    console.log('Creating frontend');
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
