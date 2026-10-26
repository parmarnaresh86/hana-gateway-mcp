// The allowlist for run_named_query. This is the only SQL the agent will
// ever execute for a named query, regardless of what the MCP server (or the
// LLM behind it) asks for - it only supplies `queryName` + `params`.
//
// HANA placeholder syntax: "?" (positional), same as mysql/sqlite. `params`
// lists the named parameters in the exact order they must be substituted
// into the "?" placeholders in `sql`, top to bottom.
//
// Example (edit or remove for your own schema):
//
// export const QUERIES = {
//   get_open_sales_orders: {
//     sql: `SELECT "DocEntry","DocNum","CardCode","CardName","DocDate","DocTotal"
//           FROM "OWMS_DEV_UK"."ORDR"
//           WHERE "DocStatus" = ? AND "DocDate" >= ?
//           ORDER BY "DocDate" DESC`,
//     params: ['docStatus', 'fromDate']
//   }
// };
export const QUERIES = {};

export function resolveParams(queryName, params = {}) {
  const query = QUERIES[queryName];
  if (!query) {
    throw new Error(`Query "${queryName}" is not in the allowlist.`);
  }

  const values = query.params.map((name) => {
    if (!(name in params)) {
      throw new Error(`Missing required parameter "${name}" for query "${queryName}".`);
    }
    return params[name];
  });

  return { sql: query.sql, values };
}
