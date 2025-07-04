/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
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

// TODO: Update for WASM svg stuff
// import {initWasm, Resvg} from '../../lib/resvg-wasm.js';
// import {createApiMap, invokeApiMapHandler} from '../core/api-map.js';
// import {ExtensionError} from '../core/extension-error.js';
import {log} from '../core/log.js';
// import {safePerformance} from '../core/safe-performance.js';
import {stringReverse} from '../core/utilities.js';
import {Database} from '../data/database.js';

export class DictionaryDatabase {
    constructor() {
        /** @type {Database<import('dictionary-database').ObjectStoreName>} */
        this._db = new Database();
        globalThis._db = this._db;
        /** @type {string} */
        this._dbName = 'dict';
        /** @type {(item: string) => string} */
        this._createOnlyQuery1 = (item) => item;
        /** @type {(item: import('dictionary-database').DictionaryAndQueryRequest) => string} */
        this._createOnlyQuery2 = (item) => item.query;
        /** @type {(item: import('dictionary-database').TermExactRequest) => string} */
        this._createOnlyQuery3 = (item) => item.term;
        /** @type {(item: import('dictionary-database').MediaRequest) => string} */
        this._createOnlyQuery4 = (item) => item.path;
        /** @type {(item: string) => string} */
        this._createBoundQuery1 = (item) => `${item}%`;
        /** @type {(item: string) => string} */
        this._createBoundQuery2 = (item) => {
            const reversedItem = stringReverse(item);
            return `${reversedItem}%`;
        };
        /** @type {import('dictionary-database').CreateResult<import('dictionary-database').TermExactRequest, import('dictionary-database').DatabaseTermEntryWithId, import('dictionary-database').TermEntry>} */
        this._createTermBind1 = this._createTermExact.bind(this);
        /** @type {import('dictionary-database').CreateResult<import('dictionary-database').DictionaryAndQueryRequest, import('dictionary-database').DatabaseTermEntryWithId, import('dictionary-database').TermEntry>} */
        this._createTermBind2 = this._createTermSequenceExact.bind(this);
        /** @type {import('dictionary-database').CreateResult<string, import('dictionary-database').DatabaseTermMeta, import('dictionary-database').TermMeta>} */
        this._createTermMetaBind = this._createTermMeta.bind(this);
        /** @type {import('dictionary-database').CreateResult<string, import('dictionary-database').DatabaseKanjiEntry, import('dictionary-database').KanjiEntry>} */
        this._createKanjiBind = this._createKanji.bind(this);
        /** @type {import('dictionary-database').CreateResult<string, import('dictionary-database').DatabaseKanjiMeta, import('dictionary-database').KanjiMeta>} */
        this._createKanjiMetaBind = this._createKanjiMeta.bind(this);
        /** @type {import('dictionary-database').CreateResult<import('dictionary-database').MediaRequest, import('dictionary-database').MediaDataArrayBufferContent, import('dictionary-database').Media>} */
        this._createMediaBind = this._createMedia.bind(this);
        /** @type {import('dictionary-database').CreateResult<import('dictionary-database').DrawMediaGroupedRequest, import('dictionary-database').MediaDataArrayBufferContent, import('dictionary-database').DrawMedia>} */
        this._createDrawMediaBind = this._createDrawMedia.bind(this);

        /**
         * @type {Worker?}
         */
        this._worker = null;

        /**
         * @type {Uint8Array?}
         */
        this._resvgFontBuffer = null;

        // /** @type {import('dictionary-database').ApiMap} */
        // this._apiMap = createApiMap([
        //     ['drawMedia', this._onDrawMedia.bind(this)],
        // ]);
    }

    /** */
    async prepare() {
        console.log(`Preparing: ${this._dbName}`);
        // do not do upgrades in web workers as they are considered to be children of the main thread and are not responsible for database upgrades
        // NOTE: RN does not have workers :)
        const isWorker = false
        const upgrade =
            /** @type {import('database').StructureDefinition<import('dictionary-database').ObjectStoreName>[]} */
            ([
                /** @type {import('database').StructureDefinition<import('dictionary-database').ObjectStoreName>} */
                ({
                    version: 20,
                    stores: {
                        terms: {
                            primaryKey: {keyPath: 'id', autoIncrement: true},
                            indices: ['dictionary', 'expression', 'reading'],
                        },
                        kanji: {
                            primaryKey: {autoIncrement: true},
                            indices: ['dictionary', 'character'],
                        },
                        tagMeta: {
                            primaryKey: {autoIncrement: true},
                            indices: ['dictionary'],
                        },
                        dictionaries: {
                            // TODO: Figure out why we added keyPath
                            primaryKey: {keyPath: 'id', autoIncrement: true},
                            // primaryKey: { autoIncrement: true },
                            indices: ['title', 'version'],
                        },
                    },
                }),
                {
                    version: 30,
                    stores: {
                        termMeta: {
                            primaryKey: {autoIncrement: true},
                            indices: ['dictionary', 'expression'],
                        },
                        kanjiMeta: {
                            primaryKey: {autoIncrement: true},
                            indices: ['dictionary', 'character'],
                        },
                        tagMeta: {
                            primaryKey: {autoIncrement: true},
                            indices: ['dictionary', 'name'],
                        },
                    },
                },
                {
                    version: 40,
                    stores: {
                        terms: {
                            primaryKey: {keyPath: 'id', autoIncrement: true},
                            indices: ['dictionary', 'expression', 'reading', 'sequence'],
                        },
                    },
                },
                {
                    version: 50,
                    stores: {
                        terms: {
                            primaryKey: {keyPath: 'id', autoIncrement: true},
                            indices: ['dictionary', 'expression', 'reading', 'sequence', 'expressionReverse', 'readingReverse'],
                        },
                    },
                },
                {
                    version: 60,
                    stores: {
                        media: {
                            primaryKey: {keyPath: 'id', autoIncrement: true},
                            indices: ['dictionary', 'path'],
                        },
                    },
                },
            ]);
        await this._db.open(
            this._dbName,
            60,
            isWorker ? null : upgrade,
        );

        // when we are not a worker ourselves, create a worker which is basically just a wrapper around this class, which we can use to offload some functions to
        // if (!isWorker) {
        //     this._worker = new Worker('/js/dictionary/dictionary-database-worker-main.js', {type: 'module'});
        //     this._worker.addEventListener('error', (event) => {
        //         log.log('Worker terminated with error:', event);
        //     });
        //     this._worker.addEventListener('unhandledrejection', (event) => {
        //         log.log('Unhandled promise rejection in worker:', event);
        //     });
        // } else {
        //     // when we are the worker, prepare to need to do some SVG work and load appropriate wasm & fonts
        //     await initWasm(fetch('/lib/resvg.wasm'));
        //
        //     const font = await fetch('/fonts/NotoSansJP-Regular.ttf');
        //     const fontData = await font.arrayBuffer();
        //     this._resvgFontBuffer = new Uint8Array(fontData);
        // }
    }

    /** */
    async close() {
        this._db.close();
    }

    /**
     * @returns {boolean}
     */
    isPrepared() {
        return this._db.isOpen();
    }

    /**
     * @returns {Promise<boolean>}
     */
    async purge() {
        if (this._db.isOpening()) {
            throw new Error('Cannot purge database while opening');
        }
        // if (this._db.isOpen()) {
        //     this._db.close();
        // }
        // if (this._worker !== null) {
        //     this._worker.terminate();
        //     this._worker = null;
        // }
        let result = false;
        try {
            await this._db.deleteDatabase(this._dbName);
            result = true;
        } catch (e) {
            log.error(e);
        }
        await this.prepare();
        return result;
    }

    /**
     * @param {string} dictionaryName
     * @param {number} progressRate
     * @param {import('dictionary-database').DeleteDictionaryProgressCallback} onProgress
     */
    async deleteDictionary(dictionaryName, progressRate, onProgress) {
        /** @type {[objectStoreName: import('dictionary-database').ObjectStoreName, key: string][][]} */
        const targetGroups = [
            [
                ['kanji', 'dictionary'],
                ['kanjiMeta', 'dictionary'],
                ['terms', 'dictionary'],
                ['termMeta', 'dictionary'],
                ['tagMeta', 'dictionary'],
                ['media', 'dictionary'],
            ],
            [
                ['dictionaries', 'title'],
            ],
        ];

        let storeCount = 0;
        for (const targets of targetGroups) {
            storeCount += targets.length;
        }

        /** @type {import('dictionary-database').DeleteDictionaryProgressData} */
        const progressData = {
            count: 0,
            processed: 0,
            storeCount,
            storesProcesed: 0,
        };

        /**
         * @param {string[]} keys
         * @returns {string[]}
         */
        const filterKeys = (keys) => {
            ++progressData.storesProcesed;
            progressData.count += keys.length;
            // onProgress(progressData);
            chrome.runtime.sendMessage({action: 'progress', params: progressData});
            return keys;
        };
        const onProgressWrapper = () => {
            const processed = progressData.processed + 1;
            progressData.processed = processed;
            if ((processed % progressRate) === 0 || processed === progressData.count) {
                // onProgress(progressData);
                chrome.runtime.sendMessage({action: 'progress', params: progressData});
            }
        };

        for (const targets of targetGroups) {
            const promises = [];
            for (const [objectStoreName, indexName] of targets) {
                const query = dictionaryName;
                const promise = this._db.bulkDelete(objectStoreName, indexName, query, filterKeys, onProgressWrapper);
                promises.push(promise);
            }
            await Promise.all(promises).catch(console.error);
        }
    }

    /**
     * @param {string[]} termList
     * @param {import('dictionary-database').DictionarySet} dictionaries
     * @param {import('dictionary-database').MatchType} matchType
     * @returns {Promise<import('dictionary-database').TermEntry[]>}
     */
    findTermsBulk(termList, dictionaries, matchType) {
        const visited = new Set();
        /** @type {import('dictionary-database').FindPredicate<string, import('dictionary-database').DatabaseTermEntryWithId>} */
        const predicate = (row) => {
            if (!dictionaries.has(row.dictionary)) { return false; }
            const {id} = row;
            if (visited.has(id)) { return false; }
            visited.add(id);
            return true;
        };

        const indexNames = (matchType === 'suffix') ? ['expressionReverse', 'readingReverse'] : ['expression', 'reading'];

        let createQuery = this._createOnlyQuery1;
        switch (matchType) {
            case 'prefix':
                createQuery = this._createBoundQuery1;
                break;
            case 'suffix':
                createQuery = this._createBoundQuery2;
                break;
        }

        const createResult = this._createTermGeneric.bind(this, matchType);

        return this._findMultiBulk('terms', indexNames, termList, createQuery, predicate, createResult);
    }

    /**
     * @param {import('dictionary-database').TermExactRequest[]} termList
     * @param {import('dictionary-database').DictionarySet} dictionaries
     * @returns {Promise<import('dictionary-database').TermEntry[]>}
     */
    findTermsExactBulk(termList, dictionaries) {
        /** @type {import('dictionary-database').FindPredicate<import('dictionary-database').TermExactRequest, import('dictionary-database').DatabaseTermEntry>} */
        const predicate = (row, item) => (row.reading === item.reading && dictionaries.has(row.dictionary));
        return this._findMultiBulk('terms', ['expression'], termList, this._createOnlyQuery3, predicate, this._createTermBind1);
    }

    /**
     * @param {import('dictionary-database').DictionaryAndQueryRequest[]} items
     * @returns {Promise<import('dictionary-database').TermEntry[]>}
     */
    findTermsBySequenceBulk(items) {
        /** @type {import('dictionary-database').FindPredicate<import('dictionary-database').DictionaryAndQueryRequest, import('dictionary-database').DatabaseTermEntry>} */
        const predicate = (row, item) => (row.dictionary === item.dictionary);
        return this._findMultiBulk('terms', ['sequence'], items, this._createOnlyQuery2, predicate, this._createTermBind2);
    }

    /**
     * @param {string[]} termList
     * @param {import('dictionary-database').DictionarySet} dictionaries
     * @returns {Promise<import('dictionary-database').TermMeta[]>}
     */
    findTermMetaBulk(termList, dictionaries) {
        /** @type {import('dictionary-database').FindPredicate<string, import('dictionary-database').DatabaseTermMeta>} */
        const predicate = (row) => dictionaries.has(row.dictionary);
        return this._findMultiBulk('termMeta', ['expression'], termList, this._createOnlyQuery1, predicate, this._createTermMetaBind);
    }

    /**
     * @param {string[]} kanjiList
     * @param {import('dictionary-database').DictionarySet} dictionaries
     * @returns {Promise<import('dictionary-database').KanjiEntry[]>}
     */
    findKanjiBulk(kanjiList, dictionaries) {
        // TODO: Change predicate to something sqlite-expo compatible
        /** @type {import('dictionary-database').FindPredicate<string, import('dictionary-database').DatabaseKanjiEntry>} */
        const predicate = (row) => dictionaries.has(row.dictionary);
        return this._findMultiBulk('kanji', ['character'], kanjiList, this._createOnlyQuery1, predicate, this._createKanjiBind);
    }

    /**
     * @param {string[]} kanjiList
     * @param {import('dictionary-database').DictionarySet} dictionaries
     * @returns {Promise<import('dictionary-database').KanjiMeta[]>}
     */
    findKanjiMetaBulk(kanjiList, dictionaries) {
        /** @type {import('dictionary-database').FindPredicate<string, import('dictionary-database').DatabaseKanjiMeta>} */
        const predicate = (row) => dictionaries.has(row.dictionary);
        return this._findMultiBulk('kanjiMeta', ['character'], kanjiList, this._createOnlyQuery1, predicate, this._createKanjiMetaBind);
    }

    /**
     * @param {import('dictionary-database').DictionaryAndQueryRequest[]} items
     * @returns {Promise<(import('dictionary-database').Tag|undefined)[]>}
     */
    findTagMetaBulk(items) {
        /** @type {import('dictionary-database').FindPredicate<import('dictionary-database').DictionaryAndQueryRequest, import('dictionary-database').Tag>} */
        const predicate = (row, item) => (row.dictionary === item.dictionary);
        return this._findFirstBulk('tagMeta', 'name', items, this._createOnlyQuery2, predicate);
    }

    /**
     * @param {string} name
     * @param {string} dictionary
     * @returns {Promise<?import('dictionary-database').Tag>}
     */
    findTagForTitle(name, dictionary) {
        const query = IDBKeyRange.only(name);
        return this._db.find('tagMeta', 'name', query, (row) => (/** @type {import('dictionary-database').Tag} */ (row).dictionary === dictionary), null, null);
    }

    /**
     * @param {import('dictionary-database').MediaRequest[]} items
     * @returns {Promise<import('dictionary-database').Media[]>}
     */
    getMedia(items) {
        /** @type {import('dictionary-database').FindPredicate<import('dictionary-database').MediaRequest, import('dictionary-database').MediaDataArrayBufferContent>} */
        const predicate = (row, item) => (row.dictionary === item.dictionary);
        return this._findMultiBulk('media', ['path'], items, this._createOnlyQuery4, predicate, this._createMediaBind);
    }

    // /**
    //  * @param {import('dictionary-database').DrawMediaRequest[]} items
    //  * @param {MessagePort} source
    //  */
    // async drawMedia(items, source) {
    //     if (this._worker !== null) { // if a worker is available, offload the work to it
    //         this._worker.postMessage({action: 'drawMedia', params: {items}}, [source]);
    //         return;
    //     }
    //     // otherwise, you are the worker, so do the work
    //     safePerformance.mark('drawMedia:start');
    //
    //     // merge items with the same path to reduce the number of database queries. collects the canvases into a single array for each path.
    //     /** @type {Map<string, import('dictionary-database').DrawMediaGroupedRequest>} */
    //     const groupedItems = new Map();
    //     for (const item of items) {
    //         const {path, dictionary, canvasIndex, canvasWidth, canvasHeight, generation} = item;
    //         const key = `${path}:::${dictionary}`;
    //         if (!groupedItems.has(key)) {
    //             groupedItems.set(key, {path, dictionary, canvasIndexes: [], canvasWidth, canvasHeight, generation});
    //         }
    //         groupedItems.get(key)?.canvasIndexes.push(canvasIndex);
    //     }
    //     const groupedItemsArray = [...groupedItems.values()];
    //
    //     /** @type {import('dictionary-database').FindPredicate<import('dictionary-database').MediaRequest, import('dictionary-database').MediaDataArrayBufferContent>} */
    //     const predicate = (row, item) => (row.dictionary === item.dictionary);
    //     const results = await this._findMultiBulk('media', ['path'], groupedItemsArray, this._createOnlyQuery5, predicate, this._createDrawMediaBind);
    //
    //     // move all svgs to front to have a hotter loop
    //     results.sort((a, _b) => (a.mediaType === 'image/svg+xml' ? -1 : 1));
    //
    //     safePerformance.mark('drawMedia:draw:start');
    //     for (const m of results) {
    //         if (m.mediaType === 'image/svg+xml') {
    //             safePerformance.mark('drawMedia:draw:svg:start');
    //             /** @type {import('@resvg/resvg-wasm').ResvgRenderOptions} */
    //             const opts = {
    //                 fitTo: {
    //                     mode: 'width',
    //                     value: m.canvasWidth,
    //                 },
    //                 font: {
    //                     fontBuffers: this._resvgFontBuffer !== null ? [this._resvgFontBuffer] : [],
    //                 },
    //             };
    //             const resvgJS = new Resvg(new Uint8Array(m.content), opts);
    //             const render = resvgJS.render();
    //             source.postMessage({action: 'drawBufferToCanvases', params: {buffer: render.pixels.buffer, width: render.width, height: render.height, canvasIndexes: m.canvasIndexes, generation: m.generation}}, [render.pixels.buffer]);
    //             safePerformance.mark('drawMedia:draw:svg:end');
    //             safePerformance.measure('drawMedia:draw:svg', 'drawMedia:draw:svg:start', 'drawMedia:draw:svg:end');
    //         } else {
    //             safePerformance.mark('drawMedia:draw:raster:start');
    //
    //             // ImageDecoder is slightly faster than Blob/createImageBitmap, but
    //             // 1) it is not available in Firefox <133
    //             // 2) it is available in Firefox >=133, but it's not possible to transfer VideoFrames cross-process
    //             //
    //             // So the second branch is a fallback for all versions of Firefox and doesn't use ImageDecoder at all
    //             // The second branch can eventually be changed to use ImageDecoder when we are okay with dropping support for Firefox <133
    //             // The branches can be unified entirely when Firefox implements support for transferring VideoFrames cross-process in postMessage
    //             if ('serviceWorker' in navigator) { // this is just a check for chrome, we don't actually use service worker functionality here
    //                 const imageDecoder = new ImageDecoder({type: m.mediaType, data: m.content});
    //                 await imageDecoder.decode().then((decodedImageResult) => {
    //                     source.postMessage({action: 'drawDecodedImageToCanvases', params: {decodedImage: decodedImageResult.image, canvasIndexes: m.canvasIndexes, generation: m.generation}}, [decodedImageResult.image]);
    //                 });
    //             } else {
    //                 const image = new Blob([m.content], {type: m.mediaType});
    //                 await createImageBitmap(image, {resizeWidth: m.canvasWidth, resizeHeight: m.canvasHeight, resizeQuality: 'high'}).then((decodedImage) => {
    //                     // we need to do a dumb hack where we convert this ImageBitmap to an ImageData by drawing it to a temporary canvas, because Firefox doesn't support transferring ImageBitmaps cross-process
    //                     const canvas = new OffscreenCanvas(decodedImage.width, decodedImage.height);
    //                     const ctx = canvas.getContext('2d');
    //                     if (ctx !== null) {
    //                         ctx.drawImage(decodedImage, 0, 0);
    //                         const imageData = ctx.getImageData(0, 0, decodedImage.width, decodedImage.height);
    //                         source.postMessage({action: 'drawBufferToCanvases', params: {buffer: imageData.data.buffer, width: decodedImage.width, height: decodedImage.height, canvasIndexes: m.canvasIndexes, generation: m.generation}}, [imageData.data.buffer]);
    //                     }
    //                 });
    //             }
    //             safePerformance.mark('drawMedia:draw:raster:end');
    //             safePerformance.measure('drawMedia:draw:raster', 'drawMedia:draw:raster:start', 'drawMedia:draw:raster:end');
    //         }
    //     }
    //     safePerformance.mark('drawMedia:draw:end');
    //     safePerformance.measure('drawMedia:draw', 'drawMedia:draw:start', 'drawMedia:draw:end');
    //
    //     safePerformance.mark('drawMedia:end');
    //     safePerformance.measure('drawMedia', 'drawMedia:start', 'drawMedia:end');
    // }

    /**
     * @returns {Promise<import('dictionary-importer').Summary[]>}
     */
    async getDictionaryInfo() {
        // TODO: Verify implementation follows Yomitan source
        return this._db.getAllEntries('dictionaries');
    }

    /**
     * @param {string[]} dictionaryNames
     * @param {boolean} getTotal
     * @returns {Promise<import('dictionary-database').DictionaryCounts>}
     */
    async getDictionaryCounts(dictionaryNames, getTotal) {
        // TODO: Verify implementation follows Yomitan source
        const tables = [
            { name: 'kanji', column: 'dictionary' },
            { name: 'kanjiMeta', column: 'dictionary' },
            { name: 'terms', column: 'dictionary' },
            { name: 'termMeta', column: 'dictionary' },
            { name: 'tagMeta', column: 'dictionary' },
            { name: 'media', column: 'dictionary' }
        ];

        /** @type {{table: string, column: string, query: string|null}[]} */
        const countOperations = [];

        // Add total counts if requested
        if (getTotal) {
            tables.forEach(table => {
                countOperations.push({
                    table: table.name,
                    column: table.column,
                    query: null
                });
            });
        }

        // Add per-dictionary counts
        dictionaryNames.forEach(name => {
            tables.forEach(table => {
                countOperations.push({
                    table: table.name,
                    column: table.column,
                    query: name
                });
            });
        });

        const rawCounts = await this._db.bulkCount(countOperations);

        /** @type {import('dictionary-database').DictionaryCounts} */
        const result = {
            total: getTotal ? {} : null,
            counts: []
        };

        let resultIndex = 0;

        // Handle totals if they exist
        if (getTotal) {
            tables.forEach(table => {
                result.total[table.name] = rawCounts[resultIndex++];
            });
        }

        // Handle per-dictionary counts
        dictionaryNames.forEach(() => {
            /** @type {import('dictionary-database').DictionaryCountGroup} */
            const group = {};
            tables.forEach(table => {
                group[table.name] = rawCounts[resultIndex++];
            });
            result.counts.push(group);
        });

        return result;
    }

    /**
     * @param {string} title
     * @returns {Promise<boolean>}
     */
    async dictionaryExists(title) {
        // TODO: Verify implementation follows Yomitan source
        const query = title;
        // console.log(`Query: ${query}`);
        const result = await this._db.find(
            'dictionaries',
            'title',
            query,
            null,
            null,
            void 0,
        );
        // console.log(`Result of dictionaryExists: ${result}`);
        // console.log(typeof result !== 'undefined');
        // TODO: What gets returned is null, and not undefined. I need to idetnify what happens in Yomitan original codebase.
        return typeof result !== 'undefined';
    }

    /**
     * @template {import('dictionary-database').ObjectStoreName} T
     * @param {T} objectStoreName
     * @param {import('dictionary-database').ObjectStoreData<T>[]} items
     * @param {number} start
     * @param {number} count
     * @returns {Promise<void>}
     */
    bulkAdd(objectStoreName, items, start, count) {
        // TODO: Verify implementation follows Yomitan source
        try {
            return this._db.bulkAdd(objectStoreName, items, start, count);
        } catch (e) {
            throw e;
        }
    }

    // Private

    /**
     * @template [TRow=unknown]
     * @template [TItem=unknown]
     * @template [TResult=unknown]
     * @param {import('dictionary-database').ObjectStoreName} objectStoreName
     * @param {string[]} indexNames
     * @param {TItem[]} items
     * @param {import('dictionary-database').CreateQuery<TItem>} createQuery
     * @param {import('dictionary-database').FindPredicate<TItem, TRow>} predicate
     * @param {import('dictionary-database').CreateResult<TItem, TRow, TResult>} createResult
     * @returns {Promise<TResult[]>}
     */
    _findMultiBulk(objectStoreName, indexNames, items, createQuery, predicate, createResult) {
        // TODO: Verify implementation follows Yomitan source
        return this._db.findMultiBulk(
            objectStoreName,
            indexNames,
            items,
            createQuery,
            predicate,
            createResult,
        );
    }

    /**
     * @template [TRow=unknown]
     * @template [TItem=unknown]
     * @param {import('dictionary-database').ObjectStoreName} objectStoreName
     * @param {string} indexName
     * @param {TItem[]} items
     * @param {import('dictionary-database').CreateQuery<TItem>} createQuery
     * @param {import('dictionary-database').FindPredicate<TItem, TRow>} predicate
     * @returns {Promise<(TRow|undefined)[]>}
     */
    _findFirstBulk(objectStoreName, indexName, items, createQuery, predicate) {
        // TODO: Verify implementation follows Yomitan source
        return this._db.findFirstBulk(
            objectStoreName,
            indexName,
            items,
            createQuery,
            predicate,
        );
    }

    /**
     * @param {import('dictionary-database').MatchType} matchType
     * @param {import('dictionary-database').DatabaseTermEntryWithId} row
     * @param {import('dictionary-database').FindMultiBulkData<string>} data
     * @returns {import('dictionary-database').TermEntry}
     */
    _createTermGeneric(matchType, row, data) {
        const matchSourceIsTerm = (data.indexIndex === 0);
        const matchSource = (matchSourceIsTerm ? 'term' : 'reading');
        if ((matchSourceIsTerm ? row.expression : row.reading) === data.item) {
            matchType = 'exact';
        }
        return this._createTerm(matchSource, matchType, row, data.itemIndex);
    }

    /**
     * @param {import('dictionary-database').DatabaseTermEntryWithId} row
     * @param {import('dictionary-database').FindMultiBulkData<import('dictionary-database').TermExactRequest>} data
     * @returns {import('dictionary-database').TermEntry}
     */
    _createTermExact(row, data) {
        return this._createTerm('term', 'exact', row, data.itemIndex);
    }

    /**
     * @param {import('dictionary-database').DatabaseTermEntryWithId} row
     * @param {import('dictionary-database').FindMultiBulkData<import('dictionary-database').DictionaryAndQueryRequest>} data
     * @returns {import('dictionary-database').TermEntry}
     */
    _createTermSequenceExact(row, data) {
        return this._createTerm('sequence', 'exact', row, data.itemIndex);
    }

    /**
     * @param {import('dictionary-database').MatchSource} matchSource
     * @param {import('dictionary-database').MatchType} matchType
     * @param {import('dictionary-database').DatabaseTermEntryWithId} row
     * @param {number} index
     * @returns {import('dictionary-database').TermEntry}
     */
    _createTerm(matchSource, matchType, row, index) {
        const {sequence} = row;
        return {
            index,
            matchType,
            matchSource,
            term: row.expression,
            reading: row.reading,
            definitionTags: this._splitField(row.definitionTags || row.tags),
            termTags: this._splitField(row.termTags),
            rules: this._splitField(row.rules),
            definitions: row.glossary,
            score: row.score,
            dictionary: row.dictionary,
            id: row.id,
            sequence: typeof sequence === 'number' ? sequence : -1,
        };
    }

    /**
     * @param {import('dictionary-database').DatabaseKanjiEntry} row
     * @param {import('dictionary-database').FindMultiBulkData<string>} data
     * @returns {import('dictionary-database').KanjiEntry}
     */
    _createKanji(row, {itemIndex: index}) {
        const {stats} = row;
        return {
            index,
            character: row.character,
            onyomi: this._splitField(row.onyomi),
            kunyomi: this._splitField(row.kunyomi),
            tags: this._splitField(row.tags),
            definitions: row.meanings,
            stats: typeof stats === 'object' && stats !== null ? stats : {},
            dictionary: row.dictionary,
        };
    }

    /**
     * @param {import('dictionary-database').DatabaseTermMeta} row
     * @param {import('dictionary-database').FindMultiBulkData<string>} data
     * @returns {import('dictionary-database').TermMeta}
     * @throws {Error}
     */
    _createTermMeta({expression: term, mode, data, dictionary}, {itemIndex: index}) {
        switch (mode) {
            case 'freq':
                return {index, term, mode, data, dictionary};
            case 'pitch':
                return {index, term, mode, data, dictionary};
            case 'ipa':
                return {index, term, mode, data, dictionary};
            default:
                throw new Error(`Unknown mode: ${mode}`);
        }
    }

    /**
     * @param {import('dictionary-database').DatabaseKanjiMeta} row
     * @param {import('dictionary-database').FindMultiBulkData<string>} data
     * @returns {import('dictionary-database').KanjiMeta}
     */
    _createKanjiMeta({character, mode, data, dictionary}, {itemIndex: index}) {
        return {index, character, mode, data, dictionary};
    }

    /**
     * @param {import('dictionary-database').MediaDataArrayBufferContent} row
     * @param {import('dictionary-database').FindMultiBulkData<import('dictionary-database').MediaRequest>} data
     * @returns {import('dictionary-database').Media}
     */
    _createMedia(row, {itemIndex: index}) {
        const {dictionary, path, mediaType, width, height, content} = row;
        return {index, dictionary, path, mediaType, width, height, content};
    }

    /**
     * @param {import('dictionary-database').MediaDataArrayBufferContent} row
     * @param {import('dictionary-database').FindMultiBulkData<import('dictionary-database').DrawMediaGroupedRequest>} data
     * @returns {import('dictionary-database').DrawMedia}
     */
    _createDrawMedia(row, {itemIndex: index, item: {canvasIndexes, canvasWidth, canvasHeight, generation}}) {
        const {dictionary, path, mediaType, width, height, content} = row;
        return {index, dictionary, path, mediaType, width, height, content, canvasIndexes, canvasWidth, canvasHeight, generation};
    }

    /**
     * @param {unknown} field
     * @returns {string[]}
     */
    _splitField(field) {
        return typeof field === 'string' && field.length > 0 ? field.split(' ') : [];
    }

    // // Parent-Worker API
    //
    // /**
    //  * @param {MessagePort} port
    //  */
    // async connectToDatabaseWorker(port) {
    //     if (this._worker !== null) {
    //         // executes outside of worker
    //         this._worker.postMessage({action: 'connectToDatabaseWorker'}, [port]);
    //         return;
    //     }
    //     // executes inside worker
    //     port.onmessage = (/** @type {MessageEvent<import('dictionary-database').ApiMessageAny>} */event) => {
    //         const {action, params} = event.data;
    //         return invokeApiMapHandler(this._apiMap, action, params, [port], () => {});
    //     };
    //     port.onmessageerror = (event) => {
    //         const error = new ExtensionError('DictionaryDatabase: Error receiving message from main thread');
    //         error.data = event;
    //         log.error(error);
    //     };
    // }
    //
    // /** @type {import('dictionary-database').ApiHandler<'drawMedia'>} */
    // _onDrawMedia(params, port) {
    //     void this.drawMedia(params.requests, port);
    // }
}
