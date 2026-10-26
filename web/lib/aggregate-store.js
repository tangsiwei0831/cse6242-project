class AggregateUnavailable extends Error {
  constructor(status, kind) {
    super(status === 'stale' ? `${kind} source data changed; refresh the prepared estimates.` : `${kind} estimates have not been prepared yet.`);
    this.status = status;
  }
}

// Check DB revision + published generation on EVERY read. Memory saves JSON
// transfer/deserialization, never bypasses import invalidation or refreshes.
function createAggregateStore(pool) {
  const cache = new Map();
  return {
    async get(kind) {
      const previous = cache.get(kind);
      let rows;
      try {
        ({ rows } = await pool.query(`
          SELECT v.revision::text, s.source_revision::text, s.generation,
            CASE WHEN s.generation IS DISTINCT FROM $2::text THEN s.payload END AS payload
          FROM map_source_versions v LEFT JOIN map_aggregate_snapshots s USING (kind)
          WHERE v.kind = $1`, [kind, previous?.generation ?? null]));
      } catch (error) {
        if (error.code === '42P01') throw new AggregateUnavailable('not_ready', kind);
        throw error;
      }
      const row = rows[0];
      if (!row?.generation) {
        cache.delete(kind);
        throw new AggregateUnavailable('not_ready', kind);
      }
      if (row.revision !== row.source_revision) {
        cache.delete(kind);
        throw new AggregateUnavailable('stale', kind);
      }
      const cacheHit = previous?.generation === row.generation;
      const payload = cacheHit ? previous.payload : row.payload;
      cache.set(kind, { generation: row.generation, payload });
      return { payload, cacheHit };
    }
  };
}
module.exports = { createAggregateStore, AggregateUnavailable };
