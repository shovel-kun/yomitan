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

import {Application} from '../../application.js';
import {DocumentFocusController} from '../../dom/document-focus-controller.js';
import {querySelectorNotNull} from '../../dom/query-selector.js';
import {ExtensionContentController} from '../common/extension-content-controller.js';
import {AnkiController} from './anki-controller.js';
import {AnkiDeckGeneratorController} from './anki-deck-generator-controller.js';
import {AnkiTemplatesController} from './anki-templates-controller.js';
import {AudioController} from './audio-controller.js';
import {BackupController} from './backup-controller.js';
import {CollapsibleDictionaryController} from './collapsible-dictionary-controller.js';
import {DictionaryController} from './dictionary-controller.js';
import {DictionaryImportController} from './dictionary-import-controller.js';
import {ExtensionKeyboardShortcutController} from './extension-keyboard-shortcuts-controller.js';
import {GenericSettingController} from './generic-setting-controller.js';
import {KeyboardShortcutController} from './keyboard-shortcuts-controller.js';
import {LanguagesController} from './languages-controller.js';
import {MecabController} from './mecab-controller.js';
import {ModalController} from './modal-controller.js';
import {NestedPopupsController} from './nested-popups-controller.js';
import {PermissionsToggleController} from './permissions-toggle-controller.js';
import {PersistentStorageController} from './persistent-storage-controller.js';
import {PopupPreviewController} from './popup-preview-controller.js';
import {PopupWindowController} from './popup-window-controller.js';
import {ProfileController} from './profile-controller.js';
import {RecommendedSettingsController} from './recommended-settings-controller.js';
import {ScanInputsController} from './scan-inputs-controller.js';
import {ScanInputsSimpleController} from './scan-inputs-simple-controller.js';
import {SecondarySearchDictionaryController} from './secondary-search-dictionary-controller.js';
import {SentenceTerminationCharactersController} from './sentence-termination-characters-controller.js';
import {SettingsController} from './settings-controller.js';
import {SettingsDisplayController} from './settings-display-controller.js';
import {SortFrequencyDictionaryController} from './sort-frequency-dictionary-controller.js';
import {StatusFooter} from './status-footer.js';
import {StorageController} from './storage-controller.js';
import {TranslationTextReplacementsController} from './translation-text-replacements-controller.js';
import {chrome} from '../../chrome-mock.js';
import {arrayBufferToBase64} from '../../data/array-buffer-util.js';

globalThis.senderContext = 4;

const callbackMap = new Map();

window.onNativeMessage = function(message) {
    try {
        // console.log('Received message from RN environment:', message);
        message = JSON.parse(decodeURI(message));
        console.log('Parsed message from RN:', message);
    } catch (error) {
        console.error('Failed to parse message from RN environment:', error);
        return;
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
chrome.runtime.onMessage.addListener(function(message, sender, callback) {
    if (sender.id === globalThis.senderContext) {
        if (window.ReactNativeWebView) {
            // TODO: Remove once we do all archive opening in RN
            if (message.params && message.params.archiveContent !== undefined) {
              message.params.archiveContent = arrayBufferToBase64(message.params.archiveContent);
            }

            const messageAndSender = {message, sender};
            console.log('Sent message to RN:', JSON.stringify(messageAndSender));
            window.ReactNativeWebView.postMessage(JSON.stringify(messageAndSender));
        }

        if (message.params && message.params.messageId !== undefined) {
            callbackMap.set(message.params.callbackId, callback);
        }
    }
    return true;
});

/**
 * @param {GenericSettingController} genericSettingController
 */
async function setupGenericSettingController(genericSettingController) {
    await genericSettingController.prepare();
    await genericSettingController.refresh();
}

await Application.main(true, async (application) => {
    const documentFocusController = new DocumentFocusController();
    documentFocusController.prepare();

    const extensionContentController = new ExtensionContentController();
    extensionContentController.prepare();

    /** @type {HTMLElement} */
    const statusFooterElement = querySelectorNotNull(document, '.status-footer-container');
    const statusFooter = new StatusFooter(statusFooterElement);
    statusFooter.prepare();

    /** @type {?number} */
    let prepareTimer = window.setTimeout(() => {
        prepareTimer = null;
        document.documentElement.dataset.loadingStalled = 'true';
    }, 1000);

    if (prepareTimer !== null) {
        clearTimeout(prepareTimer);
        prepareTimer = null;
    }
    delete document.documentElement.dataset.loadingStalled;

    const preparePromises = [];

    const modalController = new ModalController(['shared-modals', 'settings-modals']);
    await modalController.prepare();

    const settingsController = new SettingsController(application);
    await settingsController.prepare();

    const settingsDisplayController = new SettingsDisplayController(settingsController, modalController);
    await settingsDisplayController.prepare();

    document.body.hidden = false;

    const popupPreviewController = new PopupPreviewController(settingsController);
    popupPreviewController.prepare();

    const persistentStorageController = new PersistentStorageController(application);
    preparePromises.push(persistentStorageController.prepare());

    const storageController = new StorageController(persistentStorageController);
    storageController.prepare();

    const dictionaryController = new DictionaryController(settingsController, modalController, statusFooter);
    preparePromises.push(dictionaryController.prepare());

    const dictionaryImportController = new DictionaryImportController(settingsController, modalController, statusFooter);
    dictionaryImportController.prepare();

    const genericSettingController = new GenericSettingController(settingsController);
    preparePromises.push(setupGenericSettingController(genericSettingController));

    const audioController = new AudioController(settingsController, modalController);
    preparePromises.push(audioController.prepare());

    const profileController = new ProfileController(settingsController, modalController);
    preparePromises.push(profileController.prepare());

    const settingsBackup = new BackupController(settingsController, modalController);
    preparePromises.push(settingsBackup.prepare());

    const ankiController = new AnkiController(settingsController, application, modalController);
    preparePromises.push(ankiController.prepare());

    const ankiDeckGeneratorController = new AnkiDeckGeneratorController(application, settingsController, modalController, ankiController);
    preparePromises.push(ankiDeckGeneratorController.prepare());

    const ankiTemplatesController = new AnkiTemplatesController(application, settingsController, modalController, ankiController);
    preparePromises.push(ankiTemplatesController.prepare());

    const scanInputsController = new ScanInputsController(settingsController);
    preparePromises.push(scanInputsController.prepare());

    const simpleScanningInputController = new ScanInputsSimpleController(settingsController);
    preparePromises.push(simpleScanningInputController.prepare());

    const nestedPopupsController = new NestedPopupsController(settingsController);
    preparePromises.push(nestedPopupsController.prepare());

    const permissionsToggleController = new PermissionsToggleController(settingsController);
    preparePromises.push(permissionsToggleController.prepare());

    const secondarySearchDictionaryController = new SecondarySearchDictionaryController(settingsController);
    preparePromises.push(secondarySearchDictionaryController.prepare());

    const languagesController = new LanguagesController(settingsController);
    preparePromises.push(languagesController.prepare());

    const translationTextReplacementsController = new TranslationTextReplacementsController(settingsController);
    preparePromises.push(translationTextReplacementsController.prepare());

    const sentenceTerminationCharactersController = new SentenceTerminationCharactersController(settingsController);
    preparePromises.push(sentenceTerminationCharactersController.prepare());

    const keyboardShortcutController = new KeyboardShortcutController(settingsController);
    preparePromises.push(keyboardShortcutController.prepare());

    const extensionKeyboardShortcutController = new ExtensionKeyboardShortcutController(settingsController);
    preparePromises.push(extensionKeyboardShortcutController.prepare());

    const popupWindowController = new PopupWindowController(application.api);
    popupWindowController.prepare();

    const mecabController = new MecabController(application.api);
    mecabController.prepare();

    const collapsibleDictionaryController = new CollapsibleDictionaryController(settingsController);
    preparePromises.push(collapsibleDictionaryController.prepare());

    const sortFrequencyDictionaryController = new SortFrequencyDictionaryController(settingsController);
    preparePromises.push(sortFrequencyDictionaryController.prepare());

    const recommendedSettingsController = new RecommendedSettingsController(settingsController);
    preparePromises.push(recommendedSettingsController.prepare());

    await Promise.all(preparePromises);

    document.documentElement.dataset.loaded = 'true';
});
