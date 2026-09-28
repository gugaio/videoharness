import { z } from 'zod';
import { request } from '../../api';
const entity = z.string().min(1).max(128);
const focus = z.discriminatedUnion('type',[
  z.object({type:z.literal('user'),user_id:entity}),z.object({type:z.literal('device'),user_id:entity,device_id:entity}),
  z.object({type:z.literal('isp'),isp:entity}),z.object({type:z.literal('pop'),pop:entity}),
]);
const band = z.object({warning:z.number().finite().min(0),critical:z.number().finite().min(0)});
const slas = z.object({startup_error_rate:band,buffer_ratio:band,join_time_ms:band.optional(),join_over_sla_pct:band.optional()});
const sessionBaseRecord={id:z.string(),name:z.string(),focus,slas,created_at:z.string(),view_path:z.string()};
export const SessionRecordSchema=z.object({...sessionBaseRecord,board_type:z.literal('sessions').default('sessions'),session_count:z.number().int().min(0),bucket_count:z.number().int().min(0).default(0)});
export const AggregateDimensionSchema=z.enum(['pop','isp','state','media_id','device_type']);
const aggregateFocus=z.discriminatedUnion('type',[
 z.object({type:z.literal('isp'),isp:entity}),z.object({type:z.literal('pop'),pop:entity}),z.object({type:z.literal('state'),state:entity}),z.object({type:z.literal('media_id'),media_id:entity}),z.object({type:z.literal('device_type'),device_type:entity}),
]);
const aggregateSource=z.object({system:z.string(),query:z.string(),sampling:z.object({method:z.string(),coverage:z.number().finite().min(0).max(1)}),counting:z.string()});
export const AggregateRecordSchema=z.object({...sessionBaseRecord,focus:aggregateFocus,board_type:z.literal('aggregate'),primary_dimension:AggregateDimensionSchema,secondary_dimension:AggregateDimensionSchema.optional(),granularity:z.string(),window:z.object({from:z.string(),to:z.string()}),source:aggregateSource,linked_sessions_board_id:z.string().optional(),session_count:z.literal(0),bucket_count:z.number().int().min(0),requested_granularity:z.string().optional(),effective_granularity:z.string().optional()});
export const RecordSchema=z.union([AggregateRecordSchema,SessionRecordSchema]);
const filter=z.discriminatedUnion('dimension',[
 z.object({dimension:z.literal('user'),entity}),z.object({dimension:z.literal('device'),entity,user_id:entity}),z.object({dimension:z.literal('isp'),entity}),z.object({dimension:z.literal('pop'),entity}),z.object({dimension:z.literal('media'),entity}),
 z.object({dimension:z.literal('state'),entity}),z.object({dimension:z.literal('device_type'),entity}),
]);
const nodeFilter=z.discriminatedUnion('dimension',[
 z.object({dimension:z.literal('user'),entity}),z.object({dimension:z.literal('device'),entity,user_id:entity}),z.object({dimension:z.literal('isp'),entity}),z.object({dimension:z.literal('pop'),entity}),z.object({dimension:z.literal('media'),entity}),
]);
const metric=z.object({distribution:z.object({good:z.number().int().min(0),warning:z.number().int().min(0),bad:z.number().int().min(0),unknown:z.number().int().min(0)}).optional(),value:z.number().finite().nullable(),status:z.enum(['good','warning','bad','unknown']),unit:z.enum(['ratio','ms']),sample_count:z.number().int().min(0),violations:z.number().int().min(0),sla:band});
const metrics=z.object({startup_error_rate:metric.optional(),buffer_ratio:metric.optional(),join_time_ms:metric.optional()});
const dimension=z.enum(['user','device','isp','pop','media']);
export const ViewSchema=z.object({board_type:z.literal('sessions').optional(),id:z.string(),sessionCount:z.number().int().min(0),board:SessionRecordSchema,filters:z.array(filter),columns:z.array(dimension),metrics,nodes:z.array(z.object({id:z.string(),dimension,label:z.string(),volume:z.number().int().min(0),metrics,model:z.string().optional(),filter:nodeFilter.optional()})),links:z.array(z.object({id:z.string(),source:z.string(),target:z.string(),volume:z.number().int().min(0),metrics}))});
const status=z.enum(['good','warning','bad','unknown']);
const aggregateValue=z.number().finite().nullable();
const aggregateCell=z.object({ts:z.string(),status,value:aggregateValue,volume:z.number().finite().min(0),p50:aggregateValue,p95:aggregateValue,p99:aggregateValue,baseline_value:aggregateValue,baseline_delta:aggregateValue});
const aggregateEntity=z.object({dim_key:z.string(),label:z.string(),volume:z.number().finite().min(0),cells:z.array(aggregateCell)});
const aggregatePoint=z.object({ts:z.string(),value:aggregateValue,volume:z.number().finite().min(0),status:status.optional()});
export const AggregateViewSchema=z.object({
 board_type:z.literal('aggregate'),id:z.string(),board:AggregateRecordSchema,provenance:aggregateSource,sampling:z.object({method:z.string(),coverage:z.number().finite().min(0).max(1)}),counting:z.string(),requested_granularity:z.string(),effective_granularity:z.string(),coarsened:z.boolean(),coverage:z.number().finite().min(0).max(1),filters:z.array(z.object({dimension:AggregateDimensionSchema,entity:z.string()})),
 heatmap:z.object({dimension:AggregateDimensionSchema,metric:z.string(),entities:z.array(aggregateEntity),total:z.number().int().min(0),next_offset:z.number().int().nullable(),time_offset:z.number().int().min(0),time_limit:z.number().int().min(1),next_time_offset:z.number().int().min(0).nullable()}),
 ranking:z.array(z.object({dim_key:z.string(),label:z.string(),volume:z.number().finite().min(0),value:aggregateValue,status,impact_score:z.number().finite().min(0),impact_unit:z.string()})),
 baseline:z.array(aggregatePoint),series:z.array(aggregatePoint),annotations:z.array(z.object({ts:z.string(),dim_key:z.string().optional(),metric:z.string(),value:z.number().finite(),z_score:z.number().finite(),direction:z.enum(['up','down'])})),
});
export const SessionDrilldownParamsSchema=z.object({filters:z.array(z.object({dimension:z.enum(['isp','pop','media_id','state','device_type']),entity:z.string().min(1).max(128)})).max(4).optional(),dimension:z.enum(['isp','pop','media_id','state','device_type']).optional(),entity:z.string().min(1).max(128).optional(),time_from:z.string().datetime({offset:true}).optional(),time_to:z.string().datetime({offset:true}).optional(),quality:z.enum(['startup_error','warning_buffer','critical_buffer','warning_join','critical_join','any_sla_violation']).optional()}).strict().superRefine((params,ctx)=>{if((params.time_from===undefined)!==(params.time_to===undefined))ctx.addIssue({code:z.ZodIssueCode.custom,message:'time_from and time_to must be supplied together'});if(params.time_from&&params.time_to&&Date.parse(params.time_from)>=Date.parse(params.time_to))ctx.addIssue({code:z.ZodIssueCode.custom,message:'time_from must be before time_to'});if((params.dimension===undefined)!==(params.entity===undefined))ctx.addIssue({code:z.ZodIssueCode.custom,message:'dimension and entity must be supplied together'});});
const PageSchema=z.object({boards:z.array(RecordSchema),total:z.number().int().min(0),next_offset:z.number().int().nullable()});
export type ServerBoard=z.infer<typeof RecordSchema>;
export type ServerView=z.infer<typeof ViewSchema>;
export type CreateServerBoard={name:string;focus:z.infer<typeof focus>;slas:{startup_error_rate:{warning:number;critical:number};buffer_ratio:{warning:number;critical:number};join_time_ms:{warning:number;critical:number}}};
export type AggregateDimension=z.infer<typeof AggregateDimensionSchema>;
export type AggregateMetric='startup_error_rate'|'buffer_ratio'|'join_time_ms_avg'|'join_over_sla_pct';
export type AggregateView=z.infer<typeof AggregateViewSchema>;
export type CreateAggregateBoard=Pick<z.infer<typeof AggregateRecordSchema>,'name'|'focus'|'board_type'|'primary_dimension'|'granularity'|'window'|'source'> & {slas:{startup_error_rate:{warning:number;critical:number};buffer_ratio:{warning:number;critical:number};join_time_ms:{warning:number;critical:number};join_over_sla_pct?:{warning:number;critical:number}};secondary_dimension?:AggregateDimension;linked_sessions_board_id?:string};
export async function listServerBoards(offset:number) {return PageSchema.parse(await request<unknown>(`/api/v1/boards?offset=${offset}&limit=20`));}
export async function createServerBoard(input:CreateServerBoard) {return RecordSchema.parse(await request<unknown>('/api/v1/boards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));}
export type SessionFilter=z.infer<typeof filter>;
export async function getServerView(id:string,filters:SessionFilter[],context?:{time_window:{from:string;to:string};quality:'startup_error'|'warning_buffer'|'critical_buffer'|'warning_join'|'critical_join'|'any_sla_violation'}) {return ViewSchema.parse(await request<unknown>(`/api/v1/boards/${encodeURIComponent(id)}/view`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...{filters},...(context?{time_window:context.time_window,quality:context.quality}:{})})}));}
export async function getServerBoard(id:string) {return RecordSchema.parse(await request<unknown>(`/api/v1/boards/${encodeURIComponent(id)}`));}
export async function createAggregateBoard(input:CreateAggregateBoard) {return AggregateRecordSchema.parse(await request<unknown>('/api/v1/boards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));}
export async function getAggregateView(id:string,options:{dimension?:AggregateDimension;metric:AggregateMetric;filters?:{dimension:AggregateDimension;entity:string}[];offset:number;limit:number;time_offset:number;time_limit:number}) {return AggregateViewSchema.parse(await request<unknown>(`/api/v1/boards/${encodeURIComponent(id)}/view`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(options)}));}
export async function deleteServerBoard(id:string) {return z.object({ok:z.literal(true)}).parse(await request<unknown>(`/api/v1/boards/${encodeURIComponent(id)}`,{method:'DELETE'}));}
export function focusLabel(board:ServerBoard) {const f=board.focus;return f.type==='device'?`${f.user_id} · ${f.device_id}`:f.type==='user'?f.user_id:f.type==='isp'?f.isp:f.type==='pop'?f.pop:f.type==='state'?f.state:f.type==='media_id'?f.media_id:f.device_type;}
