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

/**
 * Native SQLite module (provided by the KMP host via QuickJS bindings).
 * @typedef {{
 *  _nativeSqliteOpen: (name: string) => number,
 *  _nativeSqliteClose: (handle: number) => void,
 *  _nativeSqliteExecute: (handle: number, sql: string, paramsJson?: string) => string,
 *  _nativeSqliteExecuteRaw: (handle: number, sql: string, paramsJson?: string) => (string|null),
 *  _nativeSqliteDeleteDatabase: (name: string) => boolean
 * }} NativeSqliteApi
 */

const NATIVE_SQLITE_ERROR_PREFIX = '__NATIVE_SQLITE_ERROR__:';

/**
 * @returns {NativeSqliteApi}
 */
function getNative() {
    const api = /** @type {Partial<NativeSqliteApi>} */ (/** @type {unknown} */ (globalThis));
    if (
        typeof api._nativeSqliteOpen !== 'function' ||
        typeof api._nativeSqliteClose !== 'function' ||
        typeof api._nativeSqliteExecute !== 'function' ||
        typeof api._nativeSqliteExecuteRaw !== 'function' ||
        typeof api._nativeSqliteDeleteDatabase !== 'function'
    ) {
        throw new Error('Native SQLite bindings not available');
    }
    return /** @type {NativeSqliteApi} */ (api);
}

/**
 * @param {unknown[]} params
 * @returns {string}
 */
function encodeParams(params) {
    try {
        return JSON.stringify(params ?? []);
    } catch {
        return '[]';
    }
}

/**
 * @template T
 * @param {string} text
 * @param {T} fallback
 * @returns {T}
 */
function safeJsonParse(text, fallback) {
    try {
        return /** @type {T} */ (JSON.parse(text));
    } catch {
        return fallback;
    }
}

/**
 * @template {string} TObjectStoreName
 */
export class Database {
    constructor() {
        /** @type {number|null} */
        this._handle = null;
        /** @type {boolean} */
        this._isOpening = false;
        /** @type {NativeSqliteApi|null} */
        this._native = null;
    }

    /**
     * @param {string} databaseName
     * @param {number} version
     * @param {import('database').StructureDefinition<TObjectStoreName>[]} structure
     */
    async open(databaseName, version, structure) {
        if (this._handle !== null) {
            throw new Error('Database already open');
        }
        if (this._isOpening) {
            throw new Error('Already opening');
        }

        try {
            this._isOpening = true;
            this._native = getNative();
            const handle = this._native._nativeSqliteOpen(databaseName);
            if (typeof handle !== 'number' || !Number.isFinite(handle) || handle <= 0) {
                throw new Error(`Native SQLite open failed for ${databaseName} (handle=${String(handle)})`);
            }
            this._handle = handle;

            // Safety level may not be changed inside a transaction
            await this._execute('PRAGMA journal_mode = WAL;');
            await this._execute('PRAGMA synchronous = normal;');
            await this._execute('PRAGMA journal_size_limit = 6144000;');

            // Ensure the host SQLite build supports JSONB since this port stores JSON via `jsonb(...)`.
            // Use `_executeRaw` so we can surface a clear error message if the function is missing.
            await this._executeRaw("SELECT jsonb('{}');");

            const {rows} = await this._execute('PRAGMA user_version');
            const currentVersion = rows?.[0]?.user_version ?? 0;

            if (typeof currentVersion !== 'number') {
                throw new Error('Current version is not a number');
            }

            if (currentVersion < version) {
                await this._performMigrations(currentVersion, version, structure);
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            const message = (
                error &&
                typeof error === 'object' &&
                'message' in error &&
                typeof error.message === 'string'
            ) ? error.message : String(error);
            console.error('Error opening database:', message);
            throw error;
        } finally {
            this._isOpening = false;
        }
    }

    /**
     * @param {number} currentVersion
     * @param {number} targetVersion
     * @param {import('database').StructureDefinition<TObjectStoreName>[]} structure
     */
    async _performMigrations(currentVersion, targetVersion, structure) {
        structure.sort((a, b) => a.version - b.version);

        for (const schema of structure) {
            if (schema.version > currentVersion && schema.version <= targetVersion) {
                await this._applySchemaChanges(schema);
                await this._execute(`PRAGMA user_version = ${schema.version};`);
            }
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
        const result = await this._execute(
            `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
            [tableName],
        );
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
        await this._executeRaw(createTableStmt);
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
            await this._executeRaw(createIndexStmt);
        }
    }

    /**
     * @throws {Error}
     */
    close() {
        if (this._handle === null || this._native === null) {
            throw new Error('Database is not open');
        }
        this._native._nativeSqliteClose(this._handle);
        this._handle = null;
        this._native = null;
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
        return this._handle !== null;
    }

    /**
     * @param {string} tableName
     * @returns {Promise<any[]>}
     */
    async getAllEntries(tableName) {
        const sql = `SELECT id, json(data) as data FROM ${tableName};`;
        const {rows} = await this._execute(sql);

        return rows.map((row) => ({
            ...safeJsonParse(row.data, {}),
            id: row.id,
        }));
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
    async findMultiBulk(tableName, indexColumns, items, createQuery, predicate, createResult) {
        const itemCount = items.length;
        const indexCount = indexColumns.length;
        /** @type {TResult[]} */
        const results = [];

        if (itemCount === 0 || indexCount === 0) {
            return results;
        }

        await Promise.all(items.map(async (item, itemIndex) => {
            const query = createQuery(item);

            await Promise.all(indexColumns.map(async (indexName, indexIndex) => {
                const data = {item, itemIndex, indexIndex};
                const sql = `SELECT id, json(data) as value
                             FROM ${tableName}
                             WHERE json_extract(data, '$.${indexName}') = ?`;

                const {rows} = await this._execute(sql, [query]);
                for (const row of rows) {
                    const parsedRow = { ...safeJsonParse(row.value, {}), id: row.id };
                    if (predicate(parsedRow, item)) {
                        results.push(createResult(parsedRow, data));
                    }
                }
            }));
        }));

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

        const {rows} = await this._execute(sql, queries);
        const rowMap = new Map(
            rows.map((row) => [
                row[indexColumns],
                { ...safeJsonParse(row.data, {}), id: row.id },
            ]),
        );

        return items.map((item, index) => {
            const query = queries[index];
            const row = rowMap.get(query);
            return row && predicate(row, item) ? row : undefined;
        });
    }

    /**
     * @param {TObjectStoreName} objectStoreName
     * @param {unknown[]} items List of items to add.
     * @param {number} start Start index. Added items begin at _items_[_start_].
     * @param {number} count Count of items to add.
     * @returns {Promise<void>}
     */
    async bulkAdd(objectStoreName, items, start, count) {
        if (this._handle === null) throw new Error('Database not open');

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

        await this._executeRaw(query, values);
    }

    /**
     * @template [TPredicateArg=unknown]
     * @template [TResult=unknown]
     * @template [TResultDefault=unknown]
     * @param {TObjectStoreName} tableName
     * @param {?string} indexName
     * @param {?any} query
     * @param {?((value: TResult|TResultDefault, predicateArg: TPredicateArg) => boolean)} predicate
     * @param {TPredicateArg} predicateArg
     * @param {TResultDefault} defaultValue
     * @returns {Promise<TResult|TResultDefault>}
     */
    async find(tableName, indexName, query, predicate, predicateArg, defaultValue) {
        if (this._handle === null) {
            throw new Error('Database not open');
        }
        if (typeof indexName !== 'string' || indexName.length === 0) {
            return defaultValue;
        }

        // IDBKeyRange.only(x) compatibility: accept {lower: x, upper: x}.
        const q = (query && typeof query === 'object' && 'lower' in query) ? query.lower : query;

        const sql = `SELECT json_extract(data, '$') as data
                     FROM ${tableName}
                     WHERE json_extract(data, '$.${indexName}') = ?
                     LIMIT 1`;

        const {rows} = await this._execute(sql, [q]);
        if (!rows || rows.length === 0) {
            return defaultValue;
        }

        const parsedData = safeJsonParse(rows[0].data, defaultValue);
        if (predicate && typeof predicate === 'function') {
            return predicate(parsedData, predicateArg) ? parsedData : defaultValue;
        }
        return parsedData;
    }

    /**
     * @param {{table: string, column: string, query: string|null}[]} operations
     * @returns {Promise<number[]>} Array of counts in same order as operations
     */
    async bulkCount(operations) {
        /** @type {number[]} */
        const results = new Array(operations.length);

        await Promise.all(operations.map(async (op, index) => {
            const sql = op.query
                ? `SELECT COUNT(*) as count FROM ${op.table} WHERE data->>'${op.column}' = ?`
                : `SELECT COUNT(*) as count FROM ${op.table}`;
            const params = op.query ? [op.query] : [];
            const {rows} = await this._execute(sql, params);
            results[index] = rows?.[0]?.count ?? 0;
        }));

        return results;
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
        if (this._handle === null) throw new Error('Database not open');

        if (typeof indexName !== 'string' || indexName.length === 0) {
            return;
        }

        const countResult = await this._execute(
            `SELECT COUNT(*) as count FROM ${tableName} WHERE data->>'${indexName}' = ?`,
            [query],
        );
        const totalCount = countResult.rows?.[0]?.count ?? 0;

        if (totalCount === 0) {
            if (onProgress) onProgress(0, 0);
            return;
        }

        if (typeof filterKeys === 'function') {
            const keysResult = await this._execute(
                `SELECT id FROM ${tableName} WHERE data->>'${indexName}' = ?`,
                [query],
            );
            const keys = keysResult.rows.map((row) => row.id);
            const filteredKeys = filterKeys(keys);

            if (filteredKeys.length === 0) {
                if (onProgress) onProgress(0, totalCount);
                return;
            }

            await this._executeRaw(`DELETE FROM ${tableName} WHERE id IN (${filteredKeys.join(',')})`);
            await this._executeRaw('VACUUM');

            if (onProgress) onProgress(filteredKeys.length, totalCount);
            return;
        }

        await this._executeRaw(`DELETE FROM ${tableName} WHERE data->>'${indexName}' = ?`, [query]);
        if (onProgress) onProgress(totalCount, totalCount);
    }

    /**
     * Attempts to delete the named database.
     * @param {string} databaseName
     * @returns {Promise<void>}
     */
    async deleteDatabase(databaseName) {
        const native = this._native ?? getNative();
        const ok = native._nativeSqliteDeleteDatabase(databaseName);
        if (!ok) {
            throw new Error('Failed to delete database');
        }
    }

    // Internals

    /**
     * @param {string} sql
     * @param {unknown[]} [params]
     * @returns {Promise<{rows: any[]}>}
     */
    async _execute(sql, params = []) {
        if (this._handle === null) throw new Error('Database not open');
        if (this._native === null) this._native = getNative();
        const text = this._native._nativeSqliteExecute(this._handle, sql, encodeParams(params));
        if (typeof text === 'string' && text.startsWith(NATIVE_SQLITE_ERROR_PREFIX)) {
            const message = text.slice(NATIVE_SQLITE_ERROR_PREFIX.length).trim();
            throw new Error(message.length > 0 ? message : 'SQLite execute failed');
        }
        return safeJsonParse(text, {rows: []});
    }

    /**
     * @param {string} sql
     * @param {unknown[]} [params]
     * @returns {Promise<void>}
     */
    async _executeRaw(sql, params = []) {
        if (this._handle === null) throw new Error('Database not open');
        if (this._native === null) this._native = getNative();
        const error = this._native._nativeSqliteExecuteRaw(this._handle, sql, encodeParams(params));
        if (typeof error === 'string' && error.length > 0) {
            const message = error.startsWith(NATIVE_SQLITE_ERROR_PREFIX) ? error.slice(NATIVE_SQLITE_ERROR_PREFIX.length).trim() : error;
            throw new Error(message.length > 0 ? message : 'SQLite executeRaw failed');
        }
    }
}
