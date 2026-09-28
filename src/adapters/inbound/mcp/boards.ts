import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { BoardRepository } from "../../../application/ports/board-repository.js";
import { createBoard, getBoard, getBoardView, ingestBoardSessions, patchBoard, boardSchemaDescription } from "../../../application/use-cases/boards.js";
import { ingestBoardMetrics } from "../../../application/use-cases/board-metrics.js";
import { BoardIdSchema, BoardFocusSchema, BoardFilterSchema, IngestBoardSessionsSchema, BoardViewRequestSchema, BoardPageSchema } from "../../../domain/boards.js";
import { AggregateBoardDefinitionObjectSchema, AggregateFocusSchema, AggregateFilterSchema, AggregateSlasSchema, BoardAggregateViewRequestSchema, BoardMetricsIngestSchema, PatchAggregateBoardSchema } from "../../../domain/board-metrics.js";

// MCP requires an object at the top level. The domain union performs the
// type-specific validation after this discoverable superset schema.
const AggregateDefinitionObject = AggregateBoardDefinitionObjectSchema;
const CreateToolSchema = AggregateDefinitionObject.partial().extend({
  board_type: z.enum(["sessions", "aggregate"]).optional(),
  name: AggregateDefinitionObject.shape.name,
  focus: z.union([BoardFocusSchema, AggregateFocusSchema]),
  slas: AggregateSlasSchema,
}).strict();
const ViewToolSchema = BoardAggregateViewRequestSchema.innerType().partial().extend({
  board_id: BoardIdSchema,
  filters: z.array(z.union([BoardFilterSchema, AggregateFilterSchema])).max(4).optional(),
  time_window: BoardViewRequestSchema.innerType().shape.time_window,
  quality: BoardViewRequestSchema.innerType().shape.quality,
}).strict();

export function registerBoardTools(server: McpServer, boards: BoardRepository, ownerId: string, result: (run:()=>Record<string,unknown>)=>Promise<CallToolResult>) {
  server.registerTool("get_board_schema",{description:"Discover session v1 and aggregate bucket contracts, units, limits and examples. Owner comes from authentication; aggregate source data is never converted to fake sessions.",inputSchema:z.object({}).strict(),annotations:{readOnlyHint:true,openWorldHint:false}},()=>result(()=>boardSchemaDescription));
  server.registerTool("create_board",{description:"Create an owned sessions board (default) or aggregate board with explicit SLAs. Aggregate requires source/sampling/counting, window, granularity and primary dimension. Rates are 0..1; join is ms. Returns view_path.",inputSchema:CreateToolSchema,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},input=>result(()=>createBoard(boards,ownerId,input)));
  server.registerTool("list_boards",{description:"List the owner's boards by type, with counts and pagination; excludes raw records.",inputSchema:BoardPageSchema,annotations:{readOnlyHint:true,openWorldHint:false}},({offset,limit})=>result(()=>boards.list(ownerId,offset,limit)));
  server.registerTool("get_board",{description:"Read an owned board's definition, counts and view_path.",inputSchema:z.object({board_id:BoardIdSchema}).strict(),annotations:{readOnlyHint:true,openWorldHint:false}},({board_id})=>result(()=>getBoard(boards,ownerId,board_id)));
  server.registerTool("ingest_board_sessions",{description:"Atomically upsert at most 50 sessions by session_id. Entire MCP body must fit 32 KiB. Failed startup forbids join_time_ms/buffer_ratio; successful startup requires both. started_at is optional and needed for temporal evidence drill-down.",inputSchema:z.object({board_id:BoardIdSchema,sessions:IngestBoardSessionsSchema.innerType().shape.sessions}).strict(),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},({board_id,sessions})=>result(()=>ingestBoardSessions(boards,ownerId,board_id,{sessions})));
  server.registerTool("list_board_sessions",{description:"Read raw sessions of an owned sessions board in pages of at most 50.",inputSchema:BoardPageSchema.extend({board_id:BoardIdSchema}).strict(),annotations:{readOnlyHint:true,openWorldHint:false}},({board_id,offset,limit})=>result(()=>{getBoard(boards,ownerId,board_id);return boards.sessions(ownerId,board_id,offset,limit);}));
  server.registerTool("get_board_view",{description:"Read sessions SLA graph or aggregate heatmap/ranking/baseline/series. AND filters <=4. Aggregate supports entity/time pagination, selected metric and dimension. Impact is estimated, touch volumes are not distinct users, and percentiles are never composed. Sessions support time_window and quality filters.",inputSchema:ViewToolSchema,annotations:{readOnlyHint:true,openWorldHint:false}},({board_id,...input})=>result(()=>getBoardView(boards,ownerId,board_id,input)));
  server.registerTool("ingest_board_metrics",{description:"Upsert up to 500 total aggregate buckets and baseline items, with <=256 KiB for the entire JSON-RPC body. Invalid items return indexed errors without rejecting valid items. Requires volume, configured dimensions and aligned timestamps. Baseline is separate from touch rollups. Retries replace, never add.",inputSchema:BoardMetricsIngestSchema.innerType().extend({board_id:BoardIdSchema}).strict(),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},({board_id,...input})=>result(()=>ingestBoardMetrics(boards,ownerId,board_id,input)));
  server.registerTool("patch_board",{description:"Update aggregate board metadata (name, SLAs, or same-owner sessions evidence link). Structural aggregate definition stays fixed. A null link removes the evidence link.",inputSchema:PatchAggregateBoardSchema.innerType().extend({board_id:BoardIdSchema}).strict(),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},({board_id,...input})=>result(()=>patchBoard(boards,ownerId,board_id,input)));
}
