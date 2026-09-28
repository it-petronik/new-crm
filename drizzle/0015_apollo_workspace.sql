-- Additive local Phase 7 expansion. No changes to existing commercial records.
CREATE TABLE ApolloOperation (id TEXT PRIMARY KEY NOT NULL, actorId TEXT NOT NULL, company TEXT NOT NULL, branch TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, data TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
CREATE INDEX ApolloOperation_actor ON ApolloOperation(actorId, company, branch);
CREATE INDEX ApolloOperation_expiry ON ApolloOperation(expiresAt);
CREATE TABLE ApolloUsage (id TEXT PRIMARY KEY NOT NULL, operationId TEXT NOT NULL, actorId TEXT NOT NULL, actorName TEXT NOT NULL, company TEXT NOT NULL, branch TEXT NOT NULL, operation TEXT NOT NULL, count INTEGER NOT NULL, estimatedCredits REAL NOT NULL, actualCredits REAL, status TEXT NOT NULL, createdAt INTEGER NOT NULL);
CREATE INDEX ApolloUsage_scope ON ApolloUsage(actorId, company, branch, createdAt);
CREATE TABLE ApolloSavedSearch (id TEXT PRIMARY KEY NOT NULL, actorId TEXT NOT NULL, company TEXT NOT NULL, branch TEXT NOT NULL, name TEXT NOT NULL, criteria TEXT NOT NULL, productId TEXT, market TEXT NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX ApolloSaved_actor ON ApolloSavedSearch(actorId, company, branch);
CREATE TABLE ApolloAccountCache (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE ApolloGate (id TEXT PRIMARY KEY NOT NULL, token TEXT NOT NULL, until INTEGER NOT NULL);
