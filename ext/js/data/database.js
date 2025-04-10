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
import DbConnection from "@/src/database/DbConnection";

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

  async open(databaseName, targetVersion, structure) {
    if (this._db !== null) {
      throw new Error("Database already open");
    }
    if (this._isOpening) {
      throw new Error("Already opening");
    }

    try {
      this._isOpening = true;
      console.log(databaseName);
      this._db = DbConnection.getDictDb();

      await this._db.execute("PRAGMA journal_mode = WAL;");

      const { rows } = await this._db.execute("PRAGMA user_version");
      const currentVersion = rows[0].user_version;

      if (currentVersion < targetVersion) {
        await this._performMigrations(currentVersion, targetVersion, structure);
      }
    } catch (error) {
      console.error("Error opening database:", error);
      throw error;
    } finally {
      this._isOpening = false;
    }
  }

  // TODO: Check if migrations work
  async _performMigrations(currentVersion, targetVersion, structure) {
    structure.sort((a, b) => a.version - b.version);

    try {
      for (const schema of structure) {
        if (
          schema.version > currentVersion &&
          schema.version <= targetVersion
        ) {
          await this._applySchemaChanges(schema);
          await this._db.execute(`PRAGMA user_version = ${schema.version};`);
        }
      }
    } catch (error) {
      console.error("Error performing migrations:", error);
      throw error;
    }
  }

  async _applySchemaChanges(schema) {
    for (const [tableName, tableSchema] of Object.entries(schema.stores)) {
      await this._createOrUpdateTable(tableName, tableSchema);
    }
  }

  async _createOrUpdateTable(tableName, tableSchema) {
    const tableExists = await this._tableExists(tableName);

    console.log(tableExists);
    if (!tableExists) {
      await this._createTable(tableName, tableSchema);
    }

    await this._createIndices(tableName, tableSchema);
  }

  async _tableExists(tableName) {
    const result = await this._db.execute(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
      [tableName],
    );
    console.log("_tableExists");
    console.log(result.rows);
    return Array.isArray(result.rows) && result.rows.length !== 0;
  }

  async _createTable(tableName, tableSchema) {
    const createTableStmt = `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY${tableSchema.primaryKey.autoIncrement ? " AUTOINCREMENT" : ""},
      data TEXT NOT NULL
    )
  `;
    await this._db.execute(createTableStmt);
  }

  async _createIndices(tableName, tableSchema) {
    for (const indexName of tableSchema.indices) {
      const createIndexStmt = `
      CREATE INDEX IF NOT EXISTS idx_${tableName}_${indexName}
      ON ${tableName} ((json_extract(data, '$.${indexName}')))
    `;
      await this._db.execute(createIndexStmt);
    }
  }

  /**
   * @throws {Error}
   */
  close() {
    // NOP
    if (this._db === null) {
      throw new Error("Database is not open");
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
    // NOTE: Not sure if this is needed because this is expo-sqlite
    return this._db !== null;
  }

  /**
   * @param {string[]} storeNames
   * @param {IDBTransactionMode} mode
   * @returns {Dexie.Transaction}
   * @throws {Error}
   */
  transaction(storeNames, mode) {
    if (this._db === null) {
      throw new Error(
        this._isOpening ? "Database not ready" : "Database not open",
      );
    }
    return this._db;
  }

  /**
   * @param {string} tableName
   * @returns {Promise<any[]>}
   */
  async getAllEntries(tableName) {
    if (this._db === null) {
      throw new Error("Database is not open");
    }

    try {
      const sql = `SELECT id, json_extract(data, '$') as data FROM ${tableName}`;
      const { rows } = await this._db.execute(sql);
      console.log("database.js: Getting all entries from db");
      // console.log(rows);

      return rows.map((row) => ({
        ...JSON.parse(row.data),
        id: row.id,
      }));
    } catch (error) {
      throw new Error(
        `Error getting all entries from table '${tableName}': ${error.message}`,
      );
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
  async findMultiBulk(
    objectStoreName,
    indexNames,
    items,
    createQuery,
    predicate,
    createResult,
  ) {
    const itemCount = items.length;
    const indexCount = indexNames.length;
    const results = [];

    if (itemCount === 0 || indexCount === 0) {
      return results;
    }

    let completeCount = 0;
    const requiredCompleteCount = itemCount * indexCount;

    for (let i = 0; i < itemCount; ++i) {
      const item = items[i];
      const query = createQuery(item);

      for (let j = 0; j < indexCount; ++j) {
        const indexName = indexNames[j];
        const data = { item, itemIndex: i, indexIndex: j };

        const sql = `
        SELECT 
          id, 
          json_extract(data, '$') as value 
        FROM ${objectStoreName} 
        WHERE json_extract(data, '$.${indexName}') = ?
      `;
        const params = [query];

        try {
          const { rows } = await this._db.execute(sql, params);
          // console.log("Getting rows:");
          // console.log(rows);

          for (const row of rows) {
            const parsedRow = { ...JSON.parse(row.value), id: row.id };
            try {
              if (predicate(parsedRow, data.item)) {
                results.push(createResult(parsedRow, data));
              }
            } catch (e) {
              console.log(e);
              throw e;
            }
          }

          if (++completeCount >= requiredCompleteCount) {
            return results;
          }
        } catch (error) {
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * @template [TRow=unknown]
   * @template [TItem=unknown]
   * @param {string} tableName
   * @param {string} indexColumn
   * @param {TItem[]} items
   * @param {(item: TItem) => string} createQuery
   * @param {(row: TRow, item: TItem) => boolean} predicate
   * @returns {Promise<(TRow|undefined)[]>}
   */
  async findFirstBulk(tableName, indexColumn, items, createQuery, predicate) {
    if (items.length === 0) {
      return [];
    }

    const placeholders = items.map(() => "?").join(",");
    const sql = `
    SELECT 
      json_extract(data, '$.${indexColumn}') as ${indexColumn}, 
      json_extract(data, '$') as data,
      id
    FROM ${tableName} 
    WHERE json_extract(data, '$.${indexColumn}') IN (${placeholders})
  `;
    const queries = items.map(createQuery);

    // TODO: Batch this
    try {
      const { rows } = await this._db.execute(sql, queries);
      const rowMap = new Map(
        rows.map((row) => [
          row[indexColumn],
          { ...JSON.parse(row.data), id: row.id },
        ]),
      );

      return items.map((item, index) => {
        const query = queries[index];
        const row = rowMap.get(query);
        return row && predicate(row, item) ? row : undefined;
      });
    } catch (error) {
      console.error("Error executing bulk query:", error);
      return items.map(() => undefined);
    }
  }

  /**
   * @param {string[]} dictionaryNames
   * @param {boolean} getTotal
   * @returns {Promise<import('dictionary-database').DictionaryCounts>}
   */
  async getDictionaryCounts(dictionaryNames, getTotal) {
    // TODO: Check if this is working
    const targets = [
      "kanji",
      "kanjiMeta",
      "terms",
      "termMeta",
      "tagMeta",
      "media",
    ];

    /** @type {import('dictionary-database').DictionaryCountGroup[]} */
    const counts = [];
    let total = null;

    if (getTotal) {
      total = {};
      for (const target of targets) {
        const sql = `SELECT COUNT(*) as count FROM ${target}`;
        const { rows } = await this._db.execute(sql);
        // TODO: Implement
        throw new Error("Error getting total", rows);
        // total[target] = result.count;
      }
    }

    for (const dictionaryName of dictionaryNames) {
      /** @type {import('dictionary-database').DictionaryCountGroup} */
      const countGroup = {};
      for (const target of targets) {
        const sql = `SELECT COUNT(*) as count FROM ${target} WHERE dictionary = ?`;
        const result = await this._db.execute(sql, [dictionaryName]);
        countGroup[target] = result.count;
      }
      counts.push(countGroup);
    }

    return { total, counts };
  }

  /**
   * @param {TObjectStoreName} objectStoreName
   * @param {unknown[]} items List of items to add.
   * @param {number} start Start index. Added items begin at _items_[_start_].
   * @param {number} count Count of items to add.
   * @returns {Promise<void>}
   */
  async bulkAdd(objectStoreName, items, start, count) {
    if (this._db === null) {
      throw new Error("Database not open");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Items must be a non-empty array");
    }

    const end = Math.min(start + count, items.length);
    const batch = items.slice(start, end);
    const placeholders = batch.map(() => "(?)").join(",");
    const query = `INSERT INTO ${objectStoreName} (data) VALUES ${placeholders}`;

    const values = batch.map((item) => JSON.stringify(item));
    await this._db.execute(query, values);
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
        collection = collection.where(":id").inAnyRange([query]);
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
        collection = collection.where(":id").inAnyRange([query]);
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
   * @param {TObjectStoreName} objectStoreName
   * @param {?string} indexName
   * @param {?IDBValidKey|IDBKeyRange} query
   * @param {?((value: TResult|TResultDefault, predicateArg: TPredicateArg) => boolean)} predicate
   * @param {TPredicateArg} predicateArg
   * @param {TResultDefault} defaultValue
   * @returns {Promise<TResult|TResultDefault>}
   */
  async find(
    objectStoreName,
    indexName,
    query,
    predicate,
    predicateArg,
    defaultValue,
  ) {
    if (this._db === null) {
      throw new Error("Database not open");
    }

    // TODO: Do I need id from here? Might as well remove
    const sqlQuery = `SELECT id, json_extract(data, '$') as data 
                    FROM ${objectStoreName} 
                    WHERE json_extract(data, '$.${indexName}') = ?
                    LIMIT 1`;

    try {
      const { rows } = await this._db.execute(sqlQuery, [query]);
      const result = rows;

      if (!result || result.length === 0) {
        return defaultValue;
      }

      const parsedData = JSON.parse(result);

      if (predicate && typeof predicate === "function") {
        return predicate(parsedData, predicateArg) ? parsedData : defaultValue;
      }

      return parsedData;
    } catch (error) {
      console.error(`Error in find method: ${error.message}`);
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
  async findFirst(
    objectStoreOrIndex,
    query,
    resolve,
    reject,
    data,
    predicate,
    predicateArg,
    defaultValue,
  ) {
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
   * @param {import('database').CountTarget[]} targets
   * @param {(results: number[]) => void} resolve
   * @param {(reason?: unknown) => void} reject
   */
  async bulkCount(targets, resolve, reject) {
    try {
      const results = await Promise.all(
        targets.map(([objectStoreOrIndex, query]) => {
          let collection = this._applyQuery(objectStoreOrIndex, query);
          return collection.count();
        }),
      );
      resolve(results);
    } catch (error) {
      reject(error);
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
      throw new Error("Database not open");
    }
    await this._db.table(objectStoreName).where(":id").equals(key).delete();
  }

  /**
   * Delete items in bulk from the object store.
   * @param {TObjectStoreName} objectStoreName
   * @param {?string} indexName
   * @param {IDBKeyRange} query
   * @param {?(keys: IDBValidKey[]) => IDBValidKey[]} filterKeys
   * @param {?(completedCount: number, totalCount: number) => void} onProgress
   * @returns {Promise<void>}
   */
  async bulkDelete(
    objectStoreName,
    indexName,
    query,
    filterKeys = null,
    onProgress = null,
  ) {
    if (this._db === null) {
      throw new Error("Database not open");
    }

    let collection = this._db.table(objectStoreName);
    if (indexName) {
      collection = collection.orderBy(indexName);
    }
    collection = this._applyQuery(collection, query);

    const keys = await collection.primaryKeys();
    const filteredKeys = filterKeys ? filterKeys(keys) : keys;

    await this._bulkDeleteInternal(
      collection,
      filteredKeys,
      1000,
      0,
      onProgress,
    );
  }

  /**
   * Attempts to delete the named database.
   * @param {string} databaseName
   * @returns {Promise<void>}
   */
  static async deleteDatabase(databaseName) {
    try {
      await FileSystem.deleteAsync(
        `${FileSystem.documentDirectory}/SQLite/${databaseName}`,
        { idempotent: true },
      );
    } catch (error) {
      // TODO: Check if this is working
      if (error.name === "BlockedError") {
        throw new Error("Database deletion blocked");
      }
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

    db.on("upgrading", (upgrade) => {
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
        const schema = [primaryKey.keyPath, ...indices].join(",");
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
        return collection.where(":id").inAnyRange([[query.lower, query.upper]]);
      } else {
        return collection.where(":id").equals(query);
      }
    }
    return collection;
  }

  /**
   * @param {Dexie.Table|Dexie.Collection} collection
   * @param {IDBValidKey[]} keys
   * @param {number} maxActiveRequests
   * @param {number} maxActiveRequestsForContinue
   * @param {?(completedCount: number, totalCount: number) => void} onProgress
   * @returns {Promise<void>}
   */
  async _bulkDeleteInternal(
    collection,
    keys,
    maxActiveRequests,
    maxActiveRequestsForContinue,
    onProgress,
  ) {
    const totalCount = keys.length;
    let completedCount = 0;

    const chunkSize = Math.min(maxActiveRequests, 1000);
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      await collection.where(":id").anyOf(chunk).delete();
      completedCount += chunk.length;
      if (onProgress) {
        onProgress(completedCount, totalCount);
      }
    }
  }

  /**
   * @param {string[]} storeNames
   * @param {() => void} resolve
   * @param {(reason?: unknown) => void} reject
   * @returns {Dexie.Transaction}
   */
  _readWriteTransaction(storeNames, resolve, reject) {
    if (this._db === null) {
      throw new Error("Database not open");
    }
    const transaction = this._db.transaction("rw", storeNames, async () => {
      try {
        await transaction.complete();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    return transaction;
  }
}
