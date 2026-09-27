import { z } from 'zod';
import { request } from '../../api';
const entity = z.string().min(1).max(128);
const focus = z.discriminatedUnion('type',[
  z.object({type:z.literal('user'),user_id:entity}),z.object({type:z.literal('device'),user_id:entity,device_id:entity}),
  z.object({type:z.literal('isp'),isp:entity}),z.object({type:z.literal('pop'),pop:entity}),
]);
const band = z.object({warning:z.number().finite().min(0),critical:z.number().finite().min(0)});
const slas = z.object({startup_error_rate:band,buffer_ratio:band,join_time_ms:band.optional()});
export const RecordSchema=z.object({id:z.string(),name:z.string(),focus,slas,session_count:z.number().int().min(0),created_at:z.string(),view_path:z.string()});
const filter=z.discriminatedUnion('dimension',[
 z.object({dimension:z.literal('user'),entity}),z.object({dimension:z.literal('device'),entity,user_id:entity}),z.object({dimension:z.literal('isp'),entity}),z.object({dimension:z.literal('pop'),entity}),z.object({dimension:z.literal('media'),entity}),
]);
const metric=z.object({value:z.number().finite().nullable(),status:z.enum(['good','warning','bad','unknown']),unit:z.enum(['ratio','ms']),sample_count:z.number().int().min(0),violations:z.number().int().min(0),sla:band});
const metrics=z.object({startup_error_rate:metric.optional(),buffer_ratio:metric.optional(),join_time_ms:metric.optional()});
const dimension=z.enum(['user','device','isp','pop','media']);
export const ViewSchema=z.object({id:z.string(),sessionCount:z.number().int().min(0),board:RecordSchema,filters:z.array(filter),columns:z.array(dimension),metrics,nodes:z.array(z.object({id:z.string(),dimension,label:z.string(),volume:z.number().int().min(0),metrics,model:z.string().optional(),filter:filter.optional()})),links:z.array(z.object({id:z.string(),source:z.string(),target:z.string(),volume:z.number().int().min(0),metrics}))});
const PageSchema=z.object({boards:z.array(RecordSchema),total:z.number().int().min(0),next_offset:z.number().int().nullable()});
export type ServerBoard=z.infer<typeof RecordSchema>;
export type ServerView=z.infer<typeof ViewSchema>;
export type CreateServerBoard=Pick<ServerBoard,'name'|'focus'> & {slas: Required<ServerBoard['slas']>};
export async function listServerBoards(offset:number) {return PageSchema.parse(await request<unknown>(`/api/v1/boards?offset=${offset}&limit=20`));}
export async function createServerBoard(input:CreateServerBoard) {return RecordSchema.parse(await request<unknown>('/api/v1/boards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));}
export async function getServerView(id:string,filters:z.infer<typeof filter>[]) {return ViewSchema.parse(await request<unknown>(`/api/v1/boards/${encodeURIComponent(id)}/view`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filters})}));}
export async function deleteServerBoard(id:string) {return z.object({ok:z.literal(true)}).parse(await request<unknown>(`/api/v1/boards/${encodeURIComponent(id)}`,{method:'DELETE'}));}
export function focusLabel(board:ServerBoard) {const f=board.focus;return f.type==='device'?`${f.user_id} · ${f.device_id}`:f.type==='user'?f.user_id:f.type==='isp'?f.isp:f.pop;}
