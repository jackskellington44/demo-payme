import { apiRequest, apiUpload, getPublicObjectUrl } from './api.js';

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY  = 'auth_user';
const DB_QUERY_CACHE_TTL_MS = 10000;
const dbQueryInFlight = new Map();
const dbQueryCache = new Map();

function pruneDbQueryCache(now = Date.now()) {
	for (const [cacheKey, entry] of dbQueryCache.entries()) {
		if (!entry || (now - entry.timestamp) > DB_QUERY_CACHE_TTL_MS) {
			dbQueryCache.delete(cacheKey);
		}
	}
}

function getStoredToken() {
	try {
		return window.localStorage.getItem(AUTH_TOKEN_KEY) || null;
	} catch {
		return null;
	}
}

function getStoredUser() {
	try {
		const raw = window.localStorage.getItem(AUTH_USER_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function setStoredToken(token) {
	try {
		if (token) {
			window.localStorage.setItem(AUTH_TOKEN_KEY, token);
		} else {
			window.localStorage.removeItem(AUTH_TOKEN_KEY);
			window.localStorage.removeItem(AUTH_USER_KEY);
		}
	} catch {
		// Ignore storage write errors in private browsing contexts.
	}
}

class QueryBuilder {
	constructor(table) {
		this.table = table;
		this.mode = 'select';
		this.selectColumns = '*';
		this.filters = [];
		this.orExpr = null;
		this.orderBy = [];
		this.limitValue = null;
		this.rangeValue = null;
		this.singleMode = false;
		this.maybeSingleMode = false;
		this.mutationValues = null;
		this.returningSelect = null;
	}

	select(columns = '*') {
		if (this.mode === 'select') {
			this.selectColumns = columns || '*';
			return this;
		}
		this.returningSelect = columns || '*';
		return this;
	}

	insert(values) {
		this.mode = 'insert';
		this.mutationValues = values;
		return this;
	}

	update(values) {
		this.mode = 'update';
		this.mutationValues = values;
		return this;
	}

	delete() {
		this.mode = 'delete';
		this.mutationValues = null;
		return this;
	}

	eq(column, value) {
		this.filters.push({ column, operator: 'eq', value });
		return this;
	}

	in(column, values) {
		this.filters.push({ column, operator: 'in', value: Array.isArray(values) ? values : [] });
		return this;
	}

	is(column, value) {
		this.filters.push({ column, operator: 'is', value });
		return this;
	}

	or(expression) {
		this.orExpr = expression;
		return this;
	}

	order(column, options = {}) {
		this.orderBy.push({
			column,
			ascending: options?.ascending !== false
		});
		return this;
	}

	limit(value) {
		this.limitValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
		return this;
	}

	range(from, to) {
		this.rangeValue = {
			from: Number.isFinite(from) ? Math.floor(from) : 0,
			to: Number.isFinite(to) ? Math.floor(to) : 0
		};
		return this;
	}

	single() {
		this.singleMode = true;
		this.maybeSingleMode = false;
		return this;
	}

	maybeSingle() {
		this.singleMode = false;
		this.maybeSingleMode = true;
		return this;
	}

	async execute() {
		const token = getStoredToken();

		if (this.mode === 'select') {
			const body = {
				table: this.table,
				select: this.selectColumns,
				filters: this.filters,
				or: this.orExpr,
				order: this.orderBy,
				limit: this.limitValue,
				range: this.rangeValue,
				single: this.singleMode,
				maybeSingle: this.maybeSingleMode
			};

			console.log('[db-query]', body.table, body.filters, Date.now());

			const cacheKey = JSON.stringify(body);
			const now = Date.now();
			pruneDbQueryCache(now);

			if (dbQueryInFlight.has(cacheKey)) {
				console.warn('[db-query skipped duplicate]', cacheKey);
				return dbQueryInFlight.get(cacheKey);
			}

			const cachedEntry = dbQueryCache.get(cacheKey);
			if (cachedEntry && (now - cachedEntry.timestamp) <= DB_QUERY_CACHE_TTL_MS) {
				console.warn('[db-query skipped duplicate]', cacheKey);
				return cachedEntry.result;
			}

			const requestPromise = apiRequest('/api/db/query', {
				method: 'POST',
				token,
				body
			}).then((result) => {
				if (!result?.error) {
					dbQueryCache.set(cacheKey, {
						timestamp: Date.now(),
						result
					});
				}
				return result;
			}).finally(() => {
				dbQueryInFlight.delete(cacheKey);
			});

			dbQueryInFlight.set(cacheKey, requestPromise);
			return requestPromise;
		}

		return apiRequest('/api/db/mutate', {
			method: 'POST',
			token,
			body: {
				table: this.table,
				action: this.mode,
				values: this.mutationValues,
				filters: this.filters,
				or: this.orExpr,
				select: this.returningSelect,
				single: this.singleMode,
				maybeSingle: this.maybeSingleMode
			}
		});
	}

	then(onFulfilled, onRejected) {
		return this.execute().then(onFulfilled, onRejected);
	}

	catch(onRejected) {
		return this.execute().catch(onRejected);
	}
}

class StorageBucketClient {
	constructor(bucket) {
		this.bucket = bucket;
	}

	upload(path, file, options = {}) {
		return apiUpload('/api/storage/upload', {
			token: getStoredToken(),
			fields: {
				bucket: this.bucket,
				path,
				upsert: options?.upsert ? 'true' : 'false'
			},
			file
		});
	}

	list(prefix = '') {
		return apiRequest('/api/storage/list', {
			method: 'POST',
			token: getStoredToken(),
			body: {
				bucket: this.bucket,
				prefix
			}
		});
	}

	remove(paths) {
		return apiRequest('/api/storage/remove', {
			method: 'POST',
			token: getStoredToken(),
			body: {
				bucket: this.bucket,
				paths: Array.isArray(paths) ? paths : []
			}
		});
	}

	getPublicUrl(path) {
		return {
			data: {
				publicUrl: getPublicObjectUrl(this.bucket, path)
			}
		};
	}
}

class StorageClient {
	from(bucket) {
		return new StorageBucketClient(bucket);
	}
}

class RealtimeChannel {
	constructor() {
		this.handlers = [];
	}

	on(_event, _filter, callback) {
		if (typeof callback === 'function') {
			this.handlers.push(callback);
		}
		return this;
	}

	subscribe(callback) {
		if (typeof callback === 'function') {
			window.setTimeout(() => callback('SUBSCRIBED'), 0);
		}
		return this;
	}
}

class AuthClient {
	async signUp({ email, password }) {
		return apiRequest('/api/auth/signup', {
			method: 'POST',
			body: { email, password }
		});
	}

	async signInWithPassword({ email, password }) {
		const result = await apiRequest('/api/auth/signin', {
			method: 'POST',
			body: { email, password }
		});

		const token = result?.data?.session?.access_token || null;
		setStoredToken(token);
		return result;
	}

	async signOut() {
		setStoredToken(null);
		return { data: null, error: null };
	}

	async getSession() {
		const token = getStoredToken();
		const user  = getStoredUser();
		if (!token || !user) {
			return { data: { session: null }, error: null };
		}
		return {
			data: {
				session: {
					access_token: token,
					user
				}
			},
			error: null
		};
	}

	async getUser() {
		const user = getStoredUser();
		return { data: { user: user || null }, error: null };
	}
}

export const supabase = {
	from(table) {
		return new QueryBuilder(table);
	},
	auth: new AuthClient(),
	storage: new StorageClient(),
	rpc(name, args = {}) {
		return apiRequest(`/api/rpc/${encodeURIComponent(name)}`, {
			method: 'POST',
			token: getStoredToken(),
			body: args
		});
	},
	channel(_name) {
		return new RealtimeChannel();
	}
};
