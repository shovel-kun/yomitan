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

// NOTE: This will be found
import DbConnection from '@/src/database/DbConnection';
// import * as FileSystem from "expo-file-system";
// import {IOS_LIBRARY_PATH, ANDROID_DATABASE_PATH} from '@op-engineering/op-sqlite';
// import { Platform } from 'react-native';

// TODO: Check if we need any updates.
/**
 * @template {string} TObjectStoreName
 */
export class Database {
    constructor() {
        /** @type {import('@op-engineering/op-sqlite').DB|null} */
        this._db = null;
        /** @type {boolean} */
        this._isOpening = false;
    }

    /**
     * @param {string} databaseName
     * @param {number} version
     * @param {import('database').StructureDefinition<TObjectStoreName>[]} structure
     */
    async open(databaseName, version, structure) {
        if (this._db !== null) {
            throw new Error('Database already open');
        }
        if (this._isOpening) {
            throw new Error('Already opening');
        }

        try {
            this._isOpening = true;
            this._db = DbConnection.getDictDb();
            
            if (this._db === null) {
              throw new Error('Database is null');
            }

            // Safety level may not be changed inside a transaction
            await this._db.execute('PRAGMA journal_mode = WAL;');
            await this._db.execute('PRAGMA synchronous = normal;');
            await this._db.execute('PRAGMA journal_size_limit = 6144000;');

            const {rows} = await this._db.execute('PRAGMA user_version');
            const currentVersion = rows[0].user_version;

            if (typeof currentVersion !== 'number') {
              throw new Error('Current version is not a number');
            }

            if (currentVersion < version) {
              await this._performMigrations(currentVersion, version, structure);
            }
        } catch (error) {
            console.error('Error opening database:', error);
            throw error;
        } finally {
            this._isOpening = false;
        }
    }

    // TODO: Check if migrations work
    /**
     * @param {number} currentVersion
     * @param {number} targetVersion
     * @param {import('database').StructureDefinition<TObjectStoreName>[]} structure
     */
    async _performMigrations(currentVersion, targetVersion, structure) {
        structure.sort((a, b) => a.version - b.version);

        try {
            for (const schema of structure) {
                if (schema.version > currentVersion && schema.version <= targetVersion) {
                    await this._applySchemaChanges(schema);
                    await this._db.execute(`PRAGMA user_version = ${schema.version};`);
                }
            }
        } catch (error) {
            console.error('Error performing migrations:', error);
            throw error;
        }
    }

    /**
     * @param {import('database').StructureDefinition<TObjectStoreName>} schema
     * @returns {Promise<void>}
     */
    async _applySchemaChanges(schema) {
        for (const [tableName, tableSchema] of Object.entries(schema.stores)) {
            await this._createOrUpdateTable(tableName, tableSchema);
        }
    }

    /**
     * @param {string} tableName
     * @param {import('database').StoreDefinition} tableSchema
     * @returns {Promise<void>}
     */
    async _createOrUpdateTable(tableName, tableSchema) {
        const tableExists = await this._tableExists(tableName);

        console.log(`Table exists: ${tableExists}`);
        if (!tableExists) {
            await this._createTable(tableName, tableSchema);
        }

        await this._createIndices(tableName, tableSchema);
    }

    /**
     * @param {string} tableName
     * @returns {Promise<boolean>}
     */
    async _tableExists(tableName) {
        const result = await this._db.execute(
            `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
            [tableName],
        );
        console.log(`_tableExists: ${result.rows}`);
        return Array.isArray(result.rows) && result.rows.length !== 0;
    }

    /**
     * @param {string} tableName
     * @param {import('database').StoreDefinition} tableSchema
     * @returns {Promise<void>}
     */
    async _createTable(tableName, tableSchema) {
        const createTableStmt = `
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id INTEGER PRIMARY KEY${tableSchema.primaryKey.autoIncrement ? ' AUTOINCREMENT' : ''},
          data TEXT NOT NULL
        );`;
        await this._db.execute(createTableStmt);
    }

    /**
     * @param {string} tableName
     * @param {import('database').StoreDefinition} tableSchema
     * @returns {Promise<void>}
     */
    async _createIndices(tableName, tableSchema) {
        for (const indexName of tableSchema.indices) {
            const createIndexStmt = `
            CREATE INDEX IF NOT EXISTS idx_${tableName}_${indexName}
            ON ${tableName} ((json_extract(data, '$.${indexName}')))`;
            await this._db.execute(createIndexStmt);
        }
    }

    /**
    * @throws {Error}
    */
    close() {
        if (this._db === null) {
            throw new Error('Database is not open');
        }

        // this._db.close();
        this._db = null;
    }

    /**
    * Returns true if the database opening is in process.
    * @returns {boolean}
    */
    isOpening() {
        return this._isOpening;
    }

    /**
    * Returns true if the database is fully opened.
    * @returns {boolean}
    */
    isOpen() {
        // NOTE: Not sure if this is needed because this is op-sqlite
        return this._db !== null;
    }

    // /**
    //  * Returns a new transaction with the given mode ("readonly" or "readwrite") and scope which can be a single object store name or an array of names.
    //  * @param {string[]} storeNames
    //  * @param {IDBTransactionMode} mode
    //  * @returns {IDBTransaction}
    //  * @throws {Error}
    //  */
    // transaction(storeNames, mode) {
    //     if (this._db === null) {
    //         throw new Error(this._isOpening ? 'Database not ready' : 'Database not open');
    //     }
    //     try {
    //         return this._db.transaction(storeNames, mode);
    //     } catch (e) {
    //         throw new Error(toError(e).message + '\nDatabase transaction error, you may need to Delete All dictionaries to reset the database or manually delete the Indexed DB database.');
    //     }
    // }

    /**
    * @param {string} tableName
    * @returns {Promise<any[]>}
    */
    async getAllEntries(tableName) {
        if (this._db === null) {
            throw new Error('Database is not open');
        }

        try {
            const sql = `SELECT id, json(data) as data FROM ${tableName};`;
            const { rows } = await this._db.execute(sql);

            return rows.map((row) => ({
              ...JSON.parse(row.data),
              id: row.id,
            }));
        } catch (error) {
            console.error(`Error getting all entries from table '${tableName}':`, error);
            throw error;
        }
    }

    /**
    * @template [TRow=unknown]
    * @template [TItem=unknown]
    * @template [TResult=unknown]
    * @param {string} tableName
    * @param {string[]} indexColumns
    * @param {TItem[]} items
    * @param {(item: TItem) => string} createQuery
    * @param {(row: TRow, item: TItem) => boolean} predicate
    * @param {(row: TRow, data: {item: TItem, itemIndex: number, indexIndex: number}) => TResult} createResult
    * @returns {Promise<TResult[]>}
    */
    // async findMultiBulk(tableName, indexColumns, items, createQuery, predicate, createResult) {
    //     const itemCount = items.length;
    //     const indexCount = indexColumns.length;
    //     /** @type {TResult[]} */
    //     const results = [];
    //     if (itemCount === 0 || indexCount === 0) {
    //         return results;
    //     }
    //
    //     let completeCount = 0;
    //     const requiredCompleteCount = itemCount * indexCount;
    //
    //     const startTime = performance.now();
    //
    //     for (let i = 0; i < itemCount; ++i) {
    //         const item = items[i];
    //         const query = createQuery(item);
    //
    //         for (let j = 0; j < indexCount; ++j) {
    //           const indexName = indexColumns[j];
    //           const data = { item, itemIndex: i, indexIndex: j };
    //
    //           const sql = `SELECT id, json(data) as value
    //                        FROM ${tableName}
    //                        WHERE json_extract(data, '$.${indexName}') = ?`;
    //
    //           try {
    //               // console.log(`query: ${query}`);
    //               const { rows } = await this._db.execute(sql, [query]);
    //
    //               for (const row of rows) {
    //                   // console.log(`value: ${row.value}`);
    //                   const parsedRow = { ...JSON.parse(row.value), id: row.id };
    //                   try {
    //                       if (predicate(parsedRow, data.item)) {
    //                         results.push(createResult(parsedRow, data));
    //                       }
    //                   } catch (e) {
    //                       console.error(e);
    //                       throw e;
    //                   }
    //               }
    //
    //               if (++completeCount >= requiredCompleteCount) {
    //                   console.log(`Completed in ${(performance.now() - startTime).toFixed(2)}ms`);
    //                   return results;
    //               }
    //           } catch (error) {
    //               throw error;
    //           }
    //         }
    //     }
    //
    //     return results;
    // }

    /**
    * @template [TRow=unknown]
    * @template [TItem=unknown]
    * @template [TResult=unknown]
    * @param {string} tableName
    * @param {string[]} indexColumns
    * @param {TItem[]} items
    * @param {(item: TItem) => string} createQuery
    * @param {(row: TRow, item: TItem) => boolean} predicate
    * @param {(row: TRow, data: {item: TItem, itemIndex: number, indexIndex: number}) => TResult} createResult
    * @returns {Promise<TResult[]>}
    */
    async findMultiBulk(tableName, indexColumns, items, createQuery, predicate, createResult) {
        const itemCount = items.length;
        const indexCount = indexColumns.length;
        /** @type {TResult[]} */
        const results = [];

        if (itemCount === 0 || indexCount === 0) {
            return results;
        }

        // const requiredCompleteCount = itemCount * indexCount;
        // let completeCount = 0;
        // const startTime = performance.now();

        try {
            await Promise.all(items.map(async (item, itemIndex) => {
                const query = createQuery(item);

                await Promise.all(indexColumns.map(async (indexName, indexIndex) => {
                    const data = { item, itemIndex, indexIndex };
                    const sql = `SELECT id, json(data) as value
                                 FROM ${tableName}
                                 WHERE json_extract(data, '$.${indexName}') = ?`;

                    try {
                        const { rows } = await this._db.execute(sql, [query]);

                        for (const row of rows) {
                            const parsedRow = { ...JSON.parse(row.value), id: row.id };
                            if (predicate(parsedRow, item)) {
                                results.push(createResult(parsedRow, data));
                            }
                        }
                    } catch (error) {
                        console.error(`Error processing item ${itemIndex} with index ${indexName}:`, error);
                        throw error;
                    }

                    // if (++completeCount >= requiredCompleteCount) {
                    //     console.log(`Completed in ${(performance.now() - startTime).toFixed(2)}ms`);
                    // }
                }));
            }));
        } catch (error) {
            console.error('Error in findMultiBulk:', error);
            throw error;
        }

        return results;
    }

    /**
    * @template [TRow=unknown]
    * @template [TItem=unknown]
    * @param {string} tableName
    * @param {string} indexColumns
    * @param {TItem[]} items
    * @param {(item: TItem) => string} createQuery
    * @param {(row: TRow, item: TItem) => boolean} predicate
    * @returns {Promise<(TRow|undefined)[]>}
    */
    async findFirstBulk(tableName, indexColumns, items, createQuery, predicate) {
        if (items.length === 0) {
          return [];
        }

        const placeholders = items.map(() => '?').join(',');
        const sql = `SELECT
                      json_extract(data, '$.${indexColumns}') as ${indexColumns},
                      json(data) as data,
                      id
                     FROM ${tableName}
                     WHERE json_extract(data, '$.${indexColumns}') IN (${placeholders})`;
        const queries = items.map(createQuery);

        // TODO: Batch this
        try {
            const { rows } = await this._db.execute(sql, queries);
            const rowMap = new Map(
                rows.map((row) => [
                    row[indexColumns],
                    { ...JSON.parse(row.data), id: row.id },
                ]),
            );

            return items.map((item, index) => {
                const query = queries[index];
                const row = rowMap.get(query);
                return row && predicate(row, item) ? row : undefined;
            });
        } catch (error) {
            console.error('Error executing bulk query:', error);
            return items.map(() => undefined);
        }
    }

    /**
    * @param {TObjectStoreName} objectStoreName
    * @param {unknown[]} items List of items to add.
    * @param {number} start Start index. Added items begin at _items_[_start_].
    * @param {number} count Count of items to add.
    * @returns {Promise<void>}
    */
    async bulkAdd(objectStoreName, items, start, count) {
        if (this._db === null) throw new Error('Database not open');

        if (start + count > items.length) {
            count = items.length - start;
        }

        if (count <= 0) {
            return;
        }

        const end = Math.min(start + count, items.length);
        const batch = items.slice(start, end);
        const placeholders = batch.map(() => '(jsonb(?))').join(',');
        const query = `INSERT INTO ${objectStoreName} (data) VALUES ${placeholders}`;
        const values = batch.map((item) => JSON.stringify(item));

        await this._db.executeRaw(query, values);
    }

    /**
    * @template [TData=unknown]
    * @template [TResult=unknown]
    * @param {Dexie.Table|Dexie.Collection} objectStoreOrIndex
    * @param {?IDBValidKey|IDBKeyRange} query
    * @param {(results: TResult[], data: TData) => void} onSuccess
    * @param {(reason: unknown, data: TData) => void} onError
    * @param {TData} data
    */
    async getAll(objectStoreOrIndex, query, onSuccess, onError, data) {
      try {
        let collection = objectStoreOrIndex;
        if (query) {
          collection = collection.where(':id').inAnyRange([query]);
        }
        const results = await collection.toArray();
        onSuccess(results, data);
      } catch (error) {
        onError(error, data);
      }
    }

    /**
    * @param {Dexie.Table|Dexie.Collection} objectStoreOrIndex
    * @param {IDBValidKey|IDBKeyRange} query
    * @param {(value: IDBValidKey[]) => void} onSuccess
    * @param {(reason?: unknown) => void} onError
    */
    async getAllKeys(objectStoreOrIndex, query, onSuccess, onError) {
      try {
        let collection = objectStoreOrIndex;
        if (query) {
          collection = collection.where(':id').inAnyRange([query]);
        }
        const keys = await collection.primaryKeys();
        onSuccess(keys);
      } catch (error) {
        onError(error);
      }
    }

    /**
    * @template [TPredicateArg=unknown]
    * @template [TResult=unknown]
    * @template [TResultDefault=unknown]
    * @param {TObjectStoreName} tableName
    * @param {?string} indexName
    * @param {?IDBValidKey|IDBKeyRange} query
    * @param {?((value: TResult|TResultDefault, predicateArg: TPredicateArg) => boolean)} predicate
    * @param {TPredicateArg} predicateArg
    * @param {TResultDefault} defaultValue
    * @returns {Promise<TResult|TResultDefault>}
    */
    async find(tableName, indexName, query, predicate, predicateArg, defaultValue) {
        if (this._db === null) {
            throw new Error('Database not open');
        }

        // TODO: Do I need id from here? Might as well remove
        const sql = `SELECT id, json_extract(data, '$') as data
                     FROM ${tableName}
                     WHERE json_extract(data, '$.${indexName}') = ?
                     LIMIT 1`;

        try {
            const { rows } = await this._db.execute(sql, [query]);
            const result = rows;

            if (!result || result.length === 0) {
                return defaultValue;
            }

            const parsedData = JSON.parse(result[0].data);

            if (predicate && typeof predicate === 'function') {
                return predicate(parsedData, predicateArg) ? parsedData : defaultValue;
            }

            return parsedData;
        } catch (error) {
            console.error(`Error finding in ${tableName}: ${error}`);
            return defaultValue;
        }
    }

    /**
    * @template [TData=unknown]
    * @template [TPredicateArg=unknown]
    * @template [TResult=unknown]
    * @template [TResultDefault=unknown]
    * @param {Dexie.Table|Dexie.Collection} objectStoreOrIndex
    * @param {?IDBValidKey|IDBKeyRange} query
    * @param {(value: TResult|TResultDefault, data: TData) => void} resolve
    * @param {(reason: unknown, data: TData) => void} reject
    * @param {TData} data
    * @param {?((value: TResult, predicateArg: TPredicateArg) => boolean)} predicate
    * @param {TPredicateArg} predicateArg
    * @param {TResultDefault} defaultValue
    */
    async findFirst(objectStoreOrIndex, query, resolve, reject, data, predicate, predicateArg, defaultValue) {
        try {
            let collection = this._applyQuery(objectStoreOrIndex, query);

            let result;
            if (predicate) {
                result = await collection.find((item) => predicate(item, predicateArg));
            } else {
                result = await collection.first();
            }

            resolve(result || defaultValue, data);
        } catch (error) {
            reject(error, data);
        }
    }

    /**
    * @param {{table: string, column: string, query: string|null}[]} operations 
    * @returns {Promise<number[]>} Array of counts in same order as operations
    */
    async bulkCount(operations) {
        /** @type {number[]} */
        const results = new Array(operations.length);

        try {
            await Promise.all(operations.map(async (op, index) => {
                const sql = op.query
                    ? `SELECT COUNT(*) as count FROM ${op.table} WHERE data->>'${op.column}' = ?`
                    : `SELECT COUNT(*) as count FROM ${op.table}`;

                const params = op.query ? [op.query] : [];

                const {rows} = await this._db.execute(sql, params);
                results[index] = rows[0].count;
            }));

            return results;
        } catch (error) {
            console.error('Bulk count failed:', error);
            throw error;
        }
    }


    /**
    * Deletes records in store with the given key or in the given key range in query.
    * @param {TObjectStoreName} objectStoreName
    * @param {IDBValidKey|IDBKeyRange} key
    * @returns {Promise<void>}
    */
    async delete(objectStoreName, key) {
      if (this._db === null) {
        throw new Error('Database not open');
      }
      await this._db.table(objectStoreName).where(':id').equals(key).delete();
    }

      /**
      * Delete items in bulk from the table.
      * @param {string} tableName
      * @param {?string} indexName
      * @param {string} query
      * @param {?(keys: string[]) => string[]} filterKeys
      * @param {?(completedCount: number, totalCount: number) => void} onProgress
      * @returns {Promise<void>}
      */
      async bulkDelete(tableName, indexName, query, filterKeys = null, onProgress = null) {
          if (this._db === null) throw new Error('Database not open');

          // Get total count for progress reporting
          const countResult = await this._db.execute(
              `SELECT COUNT(*) as count FROM ${tableName} WHERE data->>'${indexName}' = ?`,
              [query]
          );

          const totalCount = countResult.rows[0].count;

          if (totalCount === 0) {
              if (onProgress) onProgress(0, 0);
              return;
          }

          if (typeof filterKeys === 'function') {
              // Get all keys matching the query
              const keysResult = await this._db.execute(
                  `SELECT id FROM ${tableName} WHERE data->>'${indexName}' = ?`,
                  [query]
              );
              const keys = keysResult.rows.map(row => row.id);
              const filteredKeys = filterKeys(keys);

              if (filteredKeys.length === 0) {
                  if (onProgress) onProgress(0, totalCount);
                  return;
              }

              await this._db.executeRaw(`DELETE FROM ${tableName} WHERE id IN (${filteredKeys.join(',')})`);
              // Run VACUUM to reclaim space
              await this._db.executeRaw('VACUUM');

              if (onProgress) onProgress(filteredKeys.length, totalCount);
              return;
          }

          // Simple case - no key filtering needed
          await this._db.executeRaw(`DELETE FROM ${tableName} WHERE data->>'${indexName}' = ?`, [query]);

          if (onProgress) onProgress(totalCount, totalCount);
      }

    /**
     * Attempts to delete the named database.
     * If the database already exists and there are open connections that don't close in response to a versionchange event, the request will be blocked until all they close.
     * If the request is successful request's result will be null.
    * @param {string} databaseName
    * @returns {Promise<void>}
    */
    async deleteDatabase(databaseName) {
        try {
            if (this._db === null) throw new Error('Database is null');
            throw new Error('Not implemented');
            // this._db.executeRaw('PRAGMA writable_schema = 1;');
            // this._db.executeRaw(`DELETE FROM sqlite_master WHERE type='table' AND name='${databaseName}';`);
            // this._db.executeRaw(`DELETE FROM sqlite_master;`);
            // this._db.executeRaw('PRAGMA writable_schema = 0;');
            // this._db.executeRaw('VACUUM;');
            // this._db.executeRaw('PRAGMA integrity_check;');
            // this._db.delete()
            // console.log(`Deleting database: ${FileSystem.documentDirectory}`);
            // const DICT_DATABASE_PATH = `${Platform.OS === 'ios' ? IOS_LIBRARY_PATH : "file://" + ANDROID_DATABASE_PATH}`;
            // console.log(`Deleting database: ${DICT_DATABASE_PATH}${databaseName}`);
            // await FileSystem.deleteAsync(`${DICT_DATABASE_PATH}${databaseName}`, {idempotent: true});
            // this.close()
        } catch (error) {
            console.error("Error deleting database:", error);
            throw error;
        }
    }

    // Private methods

    /**
    * @param {string} name
    * @param {number} version
    * @param {import('database').UpdateFunction} onUpgradeNeeded
    * @returns {Promise<Dexie>}
    */
    async _open(name, version, onUpgradeNeeded) {
      const db = new Dexie(name);
      db.version(version).stores({});

      db.on('upgrading', (upgrade) => {
        onUpgradeNeeded(
          db,
          upgrade.transaction,
          upgrade.oldVersion,
          upgrade.newVersion,
        );
      });

      await db.open();
      return db;
    }

    /**
    * @param {Dexie} db
    * @param {Dexie.Transaction} transaction
    * @param {number} oldVersion
    * @param {import('database').StructureDefinition<TObjectStoreName>[]} upgrades
    */
    _upgrade(db, transaction, oldVersion, upgrades) {
      for (const { version, stores } of upgrades) {
        if (oldVersion >= version) {
          continue;
        }

        for (const [objectStoreName, { primaryKey, indices }] of Object.entries(
          stores,
        )) {
          const schema = [primaryKey.keyPath, ...indices].join(',');
          db.version(version).stores({ [objectStoreName]: schema });
        }
      }
    }

    /**
    * @param {Dexie.Table|Dexie.Collection} collection
    * @param {?IDBValidKey|IDBKeyRange} query
    * @returns {Dexie.Collection}
    */
    _applyQuery(collection, query) {
      if (query) {
        if (query instanceof IDBKeyRange) {
          return collection.where(':id').inAnyRange([[query.lower, query.upper]]);
        } else {
          return collection.where(':id').equals(query);
        }
      }
      return collection;
    }

    // /**
    //  * @param {IDBObjectStore} objectStore The object store from which items are being deleted.
    //  * @param {IDBValidKey[]} keys An array of keys to delete from the object store.
    //  * @param {number} maxActiveRequests The maximum number of concurrent requests.
    //  * @param {number} maxActiveRequestsForContinue The maximum number of requests that can be active before the next set of requests is started.
    //  *   For example:
    //  *   - If this value is `0`, all of the `maxActiveRequests` requests must complete before another group of `maxActiveRequests` is started off.
    //  *   - If the value is greater than or equal to `maxActiveRequests-1`, every time a single request completes, a new single request will be started.
    //  * @param {?(completedCount: number, totalCount: number) => void} onProgress An optional progress callback function.
    //  * @param {(error: ?Error) => void} onComplete A function which is called after all operations have finished.
    //  *   If an error occured, the `error` parameter will be non-`null`. Otherwise, it will be `null`.
    //  * @throws {Error} An error is thrown if the input parameters are invalid.
    //  */
    // async _bulkDeleteInternal(objectStore, keys, maxActiveRequests, maxActiveRequestsForContinue, onProgress, onComplete) {
    //     if (maxActiveRequests <= 0) { throw new Error(`maxActiveRequests has an invalid value: ${maxActiveRequests}`); }
    //     if (maxActiveRequestsForContinue < 0) { throw new Error(`maxActiveRequestsForContinue has an invalid value: ${maxActiveRequestsForContinue}`); }
    //
    //     const count = keys.length;
    //     if (count === 0) {
    //         onComplete(null);
    //         return;
    //     }
    //
    //     let completedCount = 0;
    //     let completed = false;
    //     let index = 0;
    //     let active = 0;
    //
    //     const onSuccess = () => {
    //         if (completed) { return; }
    //         --active;
    //         ++completedCount;
    //         if (onProgress !== null) {
    //             try {
    //                 onProgress(completedCount, count);
    //             } catch (e) {
    //                 // NOP
    //             }
    //         }
    //         if (completedCount >= count) {
    //             completed = true;
    //             onComplete(null);
    //         } else if (active <= maxActiveRequestsForContinue) {
    //             next();
    //         }
    //     };
    //
    //     /**
    //      * @param {Event} event
    //      */
    //     const onError = (event) => {
    //         if (completed) { return; }
    //         completed = true;
    //         const request = /** @type {IDBRequest<undefined>} */ (event.target);
    //         const {error} = request;
    //         onComplete(error);
    //     };
    //
    //     const next = () => {
    //         for (; index < count && active < maxActiveRequests; ++index) {
    //             const key = keys[index];
    //             const request = objectStore.delete(key);
    //             request.onsuccess = onSuccess;
    //             request.onerror = onError;
    //             ++active;
    //         }
    //     };
    //
    //     next();
    // }

    // /**
    //  * @param {string[]} storeNames
    //  * @param {() => void} resolve
    //  * @param {(reason?: unknown) => void} reject
    //  * @returns {IDBTransaction}
    //  */
    // _readWriteTransaction(storeNames, resolve, reject) {
    //     const transaction = this._db.transaction(storeNames, 'readwrite');
    //     transaction.onerror = (e) => reject(/** @type {IDBTransaction} */ (e.target).error);
    //     transaction.onabort = () => reject(new Error('Transaction aborted'));
    //     transaction.oncomplete = () => resolve();
    //     return transaction;
    // }
}
