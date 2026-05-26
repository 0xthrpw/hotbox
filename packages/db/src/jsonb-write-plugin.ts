import type {
  KyselyPlugin,
  OperationNode,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from 'kysely';
import {
  CastNode,
  ColumnNode,
  ColumnUpdateNode,
  DataTypeNode,
  InsertQueryNode,
  PrimitiveValueListNode,
  TableNode,
  UpdateQueryNode,
  ValueListNode,
  ValueNode,
  ValuesNode,
} from 'kysely';

// The columns Postgres declares as jsonb. Must stay in sync with the migrations
// in packages/db/migrations/. Array-typed columns are the strict-correctness
// cases (an empty JS [] otherwise serializes to the Postgres array literal '{}'
// and lands in jsonb as an empty object); object-typed ones are here for
// behavioural consistency.
const JSONB_COLUMNS: Readonly<Record<string, ReadonlySet<string>>> = {
  hosts: new Set(['labels']),
  services: new Set(['config']),
  deployments: new Set([
    'env_snapshot',
    'secret_refs',
    'volume_refs',
    'network_refs',
    'container_digests',
    'healthcheck',
    'command',
    'entrypoint',
  ]),
  audit_log: new Set(['payload']),
  node_metrics: new Set(['labels']),
};

function shouldSerialize(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return false;
  if (v instanceof Uint8Array) return false;
  return true;
}

function castStringAsJsonb(value: unknown): OperationNode {
  return CastNode.create(ValueNode.create(JSON.stringify(value)), DataTypeNode.create('jsonb'));
}

function jsonbColumnsForTable(table: OperationNode | undefined): ReadonlySet<string> | undefined {
  if (!table || !TableNode.is(table)) return undefined;
  return JSONB_COLUMNS[table.table.identifier.name];
}

function transformInsert(node: InsertQueryNode): InsertQueryNode {
  const jsonbCols = jsonbColumnsForTable(node.into);
  if (!jsonbCols || !node.columns || !node.values) return node;
  if (!ValuesNode.is(node.values)) return node;

  const jsonbIndices = new Set<number>();
  node.columns.forEach((c, i) => {
    if (ColumnNode.is(c) && jsonbCols.has(c.column.name)) jsonbIndices.add(i);
  });
  if (jsonbIndices.size === 0) return node;

  let changed = false;
  const newRows = node.values.values.map((row) => {
    // Kysely uses PrimitiveValueListNode for the typical .values({...}) path
    // (a flat list of JS primitives). Promote it to a ValueListNode so we can
    // selectively wrap jsonb positions in a Cast.
    if (PrimitiveValueListNode.is(row)) {
      const cells = row.values.map((v, i): OperationNode => {
        if (jsonbIndices.has(i) && shouldSerialize(v)) {
          changed = true;
          return castStringAsJsonb(v);
        }
        return ValueNode.create(v);
      });
      return ValueListNode.create(cells);
    }
    if (ValueListNode.is(row)) {
      const cells = row.values.map((cell, i) => {
        if (!jsonbIndices.has(i)) return cell;
        if (!ValueNode.is(cell) || !shouldSerialize(cell.value)) return cell;
        changed = true;
        return castStringAsJsonb(cell.value);
      });
      return ValueListNode.create(cells);
    }
    return row;
  });

  if (!changed) return node;
  return InsertQueryNode.cloneWith(node, { values: ValuesNode.create(newRows) });
}

function transformUpdate(node: UpdateQueryNode): UpdateQueryNode {
  const jsonbCols = jsonbColumnsForTable(node.table);
  if (!jsonbCols || !node.updates) return node;

  let changed = false;
  const newUpdates = node.updates.map((upd) => {
    if (!ColumnNode.is(upd.column)) return upd;
    if (!jsonbCols.has(upd.column.column.name)) return upd;
    if (!ValueNode.is(upd.value) || !shouldSerialize(upd.value.value)) return upd;
    changed = true;
    return ColumnUpdateNode.create(upd.column, castStringAsJsonb(upd.value.value));
  });

  if (!changed) return node;
  // Don't use UpdateQueryNode.cloneWithUpdates — it appends to the existing
  // updates list rather than replacing it, which would produce two SET clauses
  // for the same column ("multiple assignments to same column").
  return { ...node, updates: newUpdates };
}

export class JsonbWritePlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const node = args.node;
    if (InsertQueryNode.is(node)) return transformInsert(node);
    if (UpdateQueryNode.is(node)) return transformUpdate(node);
    return node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}
