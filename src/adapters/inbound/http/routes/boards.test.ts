import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../../infrastructure/server.js";
vi.mock("@clerk/backend",()=>({verifyToken:vi.fn(async (token:string)=>{if(token==="a"||token==="b")return {sub:token};throw new Error("invalid");})}));
const apps: FastifyInstance[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
function setup(){const app=buildApp({host:"127.0.0.1",port:0,lensUrl:"http://lens",mockUrl:"http://mock",mockPublicUrl:"http://mock",serviceToken:"test-service",clerkSecretKey:"test"});apps.push(app);return app;}
const input={name:"User SLA",focus:{type:"user",user_id:"viewer"},slas:{startup_error_rate:{warning:0.1,critical:0.5},buffer_ratio:{warning:0.02,critical:0.1},join_time_ms:{warning:2000,critical:5000}}};
const success={session_id:"s1",user_id:"viewer",device:{id:"tv",model:"Tizen"},isp:"ISP1",pop:"POP1",media_id:"media",started_at:"2026-09-24T18:00:00-03:00",startup_error:false,join_time_ms:1000,buffer_ratio:0.01};
function rpc(app:FastifyInstance,secret:string,name:string,args:object){return app.inject({method:"POST",url:"/mcp",headers:{authorization:`Bearer ${secret}`,accept:"application/json, text/event-stream","mcp-protocol-version":"2025-06-18"},payload:{jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}}});}
describe("Boards HTTP/MCP integration",()=>{
 it("requires auth, isolates owner and shares board data across MCP and UI HTTP",async()=>{
  const app=setup();expect((await app.inject({url:"/v1/boards"})).statusCode).toBe(401);
  const token=(await app.inject({method:"POST",url:"/v1/mcp/tokens",headers:{authorization:"Bearer a"},payload:{name:"agent",expires_in_days:1}})).json();
  expect((await app.inject({method:"POST",url:"/mcp",payload:{}})).statusCode).toBe(401);
  const schema=await rpc(app,token.secret,"get_board_schema",{});expect(schema.json().result.structuredContent.units.buffer_ratio).toContain("not time weighted");
  const created=await rpc(app,token.secret,"create_board",input);const board=created.json().result.structuredContent;expect(board.view_path).toBe(`/dashboard/boards/${board.id}`);
  const failed={session_id:"s2",user_id:"viewer",device:{id:"phone"},isp:"ISP2",pop:"POP1",media_id:"media",started_at:"2026-09-24T18:01:00-03:00",startup_error:true};
  const ingested=await rpc(app,token.secret,"ingest_board_sessions",{board_id:board.id,sessions:[success,failed]});expect(ingested.json().result.structuredContent).toEqual({inserted:2,updated:0,total:2});
  const listed=await app.inject({url:"/v1/boards",headers:{authorization:"Bearer a"}});expect(listed.json().boards[0].session_count).toBe(2);expect(listed.headers['cache-control']).toBe('no-store');
  expect((await app.inject({url:`/v1/boards/${board.id}`,headers:{authorization:"Bearer b"}})).statusCode).toBe(404);
  expect((await app.inject({method:"DELETE",url:`/v1/boards/${board.id}`,headers:{authorization:"Bearer b"}})).statusCode).toBe(404);
  expect((await app.inject({url:`/v1/boards/${board.id}/sessions`,headers:{authorization:"Bearer b"}})).statusCode).toBe(404);
  expect((await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers:{authorization:"Bearer b"},payload:{sessions:[success]}})).statusCode).toBe(404);
  const view=(await app.inject({method:"POST",url:`/v1/boards/${board.id}/view`,headers:{authorization:"Bearer a"},payload:{filters:[]}})).json();
  expect(view.metrics.startup_error_rate).toMatchObject({value:0.5,status:"bad",sample_count:2,violations:1});expect(view.metrics.buffer_ratio).toMatchObject({value:0.01,status:"good",sample_count:1});
  const filtered=(await rpc(app,token.secret,"get_board_view",{board_id:board.id,filters:[{dimension:"isp",entity:"ISP2"}]})).json().result.structuredContent;
  expect(filtered.sessionCount).toBe(1);expect(filtered.metrics.buffer_ratio).toMatchObject({value:null,status:"unknown",sample_count:0});expect(filtered.columns).toEqual(["user","device","isp","pop","media"]);
  const outside=(await app.inject({method:"POST",url:`/v1/boards/${board.id}/view`,headers:{authorization:"Bearer a"},payload:{filters:[{dimension:"user",entity:"other"}]}})).json();expect(outside.sessionCount).toBe(0);expect(outside.nodes).toEqual([]);
  const otherToken=(await app.inject({method:"POST",url:"/v1/mcp/tokens",headers:{authorization:"Bearer b"},payload:{name:"other",expires_in_days:1}})).json();expect((await rpc(app,otherToken.secret,"get_board",{board_id:board.id})).json().result.isError).toBe(true);
  const page=(await rpc(app,token.secret,"list_board_sessions",{board_id:board.id,limit:1,offset:0})).json().result.structuredContent;expect(page.sessions).toHaveLength(1);expect(page.next_offset).toBe(1);
  const update=(await rpc(app,token.secret,"ingest_board_sessions",{board_id:board.id,sessions:[{...success,buffer_ratio:0.2}]})).json().result.structuredContent;expect(update).toEqual({inserted:0,updated:1,total:2});
  expect((await rpc(app,token.secret,"list_boards",{})).json().result.structuredContent.boards).toHaveLength(1);
 });
 it("rejects malformed batches atomically and rejects ambiguous device identity",async()=>{
  const app=setup(),headers={authorization:"Bearer a"};const board=(await app.inject({method:"POST",url:"/v1/boards",headers,payload:input})).json();
  const {join_time_ms: _joinTime, ...withoutJoinTime}=input.slas;
  expect((await app.inject({method:"POST",url:"/v1/boards",headers,payload:{...input,slas:withoutJoinTime}})).statusCode).toBe(400);
  for(const invalid of [{...success,startup_error:true},{...success,buffer_ratio:1.01},{...success,join_time_ms:-1},{...success,startup_error:false,buffer_ratio:undefined}]){
   const response=await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers,payload:{sessions:[{...success,session_id:"valid"},invalid]}});expect(response.statusCode).toBe(400);
  }
  expect((await app.inject({url:`/v1/boards/${board.id}/sessions`,headers})).json().total).toBe(0);
  expect((await app.inject({method:"POST",url:"/v1/boards",headers,payload:{...input,focus:{type:"device",device_id:"tv"}}})).statusCode).toBe(400);
  expect((await app.inject({method:"POST",url:"/v1/boards",headers,payload:{...input,slas:{startup_error_rate:{warning:0.2,critical:0.1},buffer_ratio:{warning:0.1,critical:0.2}}}})).statusCode).toBe(400);
  expect((await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers,payload:{sessions:[success,success]}})).statusCode).toBe(400);
  const tooLarge=await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers:{...headers,"content-type":"application/json"},payload:JSON.stringify({sessions:[success],padding:"x".repeat(257*1024)})});expect(tooLarge.statusCode).toBe(413);
 });
});

const aggregateInput = {
 board_type:"aggregate", name:"Synthetic POP health", focus:{type:"isp",isp:"Vivo"},
 granularity:"5m",window:{from:"2026-09-24T18:00:00-03:00",to:"2026-09-24T19:00:00-03:00"},
 primary_dimension:"pop",secondary_dimension:"media_id",slas:input.slas,
 source:{system:"synthetic-test",query:"fixture; not real NPAW observations",sampling:{method:"random",coverage:0.03},counting:"touch"},
};
const metricBucket = {dimension:{pop:"edge-vivo-vm-sp",media_id:"match"},ts:"2026-09-24T18:00:00-03:00",volume:412,buffer_ratio:0.12,join_time_ms_avg:3379,startup_error_rate:0.082};
describe("Aggregate boards REST/MCP",()=>{
 it("shares aggregate creation, partial ingestion, views and metadata patches across adapters",async()=>{
  const app=setup(), headers={authorization:"Bearer a"};
  const token=(await app.inject({method:"POST",url:"/v1/mcp/tokens",headers,payload:{name:"metrics",expires_in_days:1}})).json();
  const created=await rpc(app,token.secret,"create_board",aggregateInput);
  expect(created.json().result.isError).not.toBe(true);
  const board=created.json().result.structuredContent;
  expect(board).toMatchObject({board_type:"aggregate",session_count:0});
  const response=await rpc(app,token.secret,"ingest_board_metrics",{board_id:board.id,buckets:[metricBucket,{...metricBucket,ts:"2026-09-24T19:00:00-03:00"},{...metricBucket,ts:"2026-09-24T18:01:00-03:00"}]});
  expect(response.json().result.structuredContent).toMatchObject({inserted:1,rejected:2});
  const update=await app.inject({method:"POST",url:`/v1/boards/${board.id}/metrics`,headers,payload:{buckets:[{...metricBucket,volume:500}]}});
  expect(update.statusCode).toBe(200);expect(update.json()).toMatchObject({inserted:0,updated:1});
  const view=await app.inject({method:"POST",url:`/v1/boards/${board.id}/view`,headers,payload:{metric:"buffer_ratio",dimension:"pop"}});
  expect(view.statusCode).toBe(200);
  expect(view.json()).toMatchObject({board_type:"aggregate",sampling:{coverage:0.03},counting:"touch"});
  expect(view.json().heatmap.entities[0]).toMatchObject({label:"edge-vivo-vm-sp",volume:500});
  expect(view.json().ranking[0].impact_score).toBeGreaterThan(0);
  const patch=await rpc(app,token.secret,"patch_board",{board_id:board.id,name:"Renamed health"});
  expect(patch.json().result.structuredContent.name).toBe("Renamed health");
  expect((await app.inject({method:"PATCH",url:`/v1/boards/${board.id}`,headers,payload:{primary_dimension:"state"}})).statusCode).toBe(400);
  expect((await app.inject({url:"/v1/boards",headers})).json().boards[0].board_type).toBe("aggregate");
 });
 it("isolates metrics and evidence links by owner and rejects the wrong ingest type",async()=>{
  const app=setup(),headers={authorization:"Bearer a"},other={authorization:"Bearer b"};
  const board=(await app.inject({method:"POST",url:"/v1/boards",headers,payload:aggregateInput})).json();
  for(const [method,path,payload] of [["POST","metrics",{buckets:[metricBucket]}],["POST","view",{}]] as const){
   expect((await app.inject({method,url:`/v1/boards/${board.id}/${path}`,headers:other,payload})).statusCode).toBe(404);
  }
  expect((await app.inject({method:"PATCH",url:`/v1/boards/${board.id}`,headers:other,payload:{name:"stolen"}})).statusCode).toBe(404);
  expect((await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers,payload:{sessions:[success]}})).statusCode).toBe(400);
  const sessions=(await app.inject({method:"POST",url:"/v1/boards",headers:other,payload:input})).json();
  const linked=await app.inject({method:"PATCH",url:`/v1/boards/${board.id}`,headers,payload:{linked_sessions_board_id:sessions.id}});
  expect(linked.statusCode).toBe(404);
 });
 it("accepts large metrics batches without relaxing session limits",async()=>{
  const app=setup(),headers={authorization:"Bearer a"};
  const board=(await app.inject({method:"POST",url:"/v1/boards",headers,payload:aggregateInput})).json();
  const token=(await app.inject({method:"POST",url:"/v1/mcp/tokens",headers,payload:{name:"metrics",expires_in_days:1}})).json();
  const buckets=Array.from({length:500},(_,i)=>({...metricBucket,dimension:{...metricBucket.dimension,pop:`edge-${i}-sp`}}));
  const response=await rpc(app,token.secret,"ingest_board_metrics",{board_id:board.id,buckets});
  expect(response.statusCode).toBe(200);expect(response.json().result.structuredContent).toMatchObject({inserted:500,rejected:0});
  expect((await app.inject({method:"POST",url:`/v1/boards/${board.id}/metrics`,headers,payload:{buckets:[...buckets,metricBucket]}})).statusCode).toBe(400);
 });
 it("uses the revised SLA bands, weighted impact and independent ISP baseline",async()=>{
  const app=setup(),headers={authorization:"Bearer a"};
  const slas={startup_error_rate:{warning:0.02,critical:0.05},buffer_ratio:{warning:0.005,critical:0.01},join_time_ms:{warning:8000,critical:15000}};
  const board=(await app.inject({method:"POST",url:"/v1/boards",headers,payload:{...aggregateInput,slas}})).json();
  // Supplied six-hour totals are used in a synthetic single-bucket fixture,
  // never presented as a reconstructed real time series.
  const buckets=[
   {...metricBucket,volume:64852,buffer_ratio:0.00699,join_time_ms_avg:9000},
   {...metricBucket,dimension:{pop:"edge-vivo-jg-sp",media_id:"match"},volume:111844,buffer_ratio:0.00169},
   {...metricBucket,dimension:{pop:"tiny-rj",media_id:"match"},volume:10,buffer_ratio:0.5},
  ];
  const ingested=await app.inject({method:"POST",url:`/v1/boards/${board.id}/metrics`,headers,payload:{buckets,baseline:[{ts:metricBucket.ts,volume:425757,buffer_ratio:0.002}]}});
  expect(ingested.statusCode).toBe(200);
  const view=(await app.inject({method:"POST",url:`/v1/boards/${board.id}/view`,headers,payload:{metric:"buffer_ratio",dimension:"pop",limit:1}})).json();
  expect(view.heatmap.entities[0].label).toBe("edge-vivo-jg-sp");
  expect(view.ranking[0]).toMatchObject({label:"edge-vivo-vm-sp",status:"warning"});
  expect(view.ranking[0].impact_score).toBeCloseTo(64852*(0.00699-0.005));
  expect(view.baseline[0]).toMatchObject({volume:425757,value:0.002});
  const regional=(await app.inject({method:"POST",url:`/v1/boards/${board.id}/view`,headers,payload:{dimension:"state",filters:[{dimension:"state",entity:"SP"}]}})).json();
  expect(regional.heatmap.entities).toHaveLength(1);expect(regional.heatmap.entities[0].label).toBe("SP");
 });
 it("links real sessions and applies dimension, half-open time and quality filters",async()=>{
  const app=setup(),headers={authorization:"Bearer a"};
  const sessions=(await app.inject({method:"POST",url:"/v1/boards",headers,payload:{...input,focus:{type:"isp",isp:"Vivo"}}})).json();
  const rows=[
   {...success,session_id:"in",isp:"Vivo",pop:"edge-vivo-vm-sp",started_at:metricBucket.ts,buffer_ratio:0.2},
   {...success,session_id:"boundary",isp:"Vivo",pop:"edge-vivo-vm-sp",started_at:"2026-09-24T18:05:00-03:00",buffer_ratio:0.2},
   {...success,session_id:"out-of-window",isp:"Vivo",pop:"edge-vivo-vm-sp",started_at:"2026-09-24T19:00:00-03:00",buffer_ratio:0.2},
   {...success,session_id:"healthy",isp:"Vivo",pop:"edge-vivo-vm-sp",started_at:metricBucket.ts},
  ];
  expect((await app.inject({method:"POST",url:`/v1/boards/${sessions.id}/sessions`,headers,payload:{sessions:rows}})).statusCode).toBe(200);
  const board=(await app.inject({method:"POST",url:"/v1/boards",headers,payload:aggregateInput})).json();
  const linked=await app.inject({method:"PATCH",url:`/v1/boards/${board.id}`,headers,payload:{linked_sessions_board_id:sessions.id}});
  expect(linked.statusCode).toBe(200);expect(linked.json().linked_sessions_board_id).toBe(sessions.id);
  const view=(await app.inject({method:"POST",url:`/v1/boards/${sessions.id}/view`,headers,payload:{filters:[{dimension:"pop",entity:"edge-vivo-vm-sp"}],time_window:{from:metricBucket.ts,to:"2026-09-24T18:05:00-03:00"},quality:"critical_buffer"}})).json();
  expect(view.sessionCount).toBe(1);expect(view.excluded_missing_timestamp_count).toBe(0);expect(view.metrics.buffer_ratio.value).toBe(0.2);
 });
});

describe("Session bulk ingest, timestamps and deletion",()=>{
 it("ingests up to 500 sessions per call and rejects larger batches",async()=>{
  const app=setup(),headers={authorization:"Bearer a"};
  const board=(await app.inject({method:"POST",url:"/v1/boards",headers,payload:input})).json();
  const batch=Array.from({length:300},(_,i)=>({...success,session_id:`bulk-${i}`}));
  const ingested=await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers,payload:{sessions:batch}});
  expect(ingested.statusCode).toBe(200);expect(ingested.json()).toMatchObject({inserted:300,updated:0,total:300});
  const oversized=await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers,payload:{sessions:Array.from({length:501},(_,i)=>({...success,session_id:`too-many-${i}`}))}});
  expect(oversized.statusCode).toBe(400);
 });
 it("rejects sessions without started_at atomically, without writing the batch",async()=>{
  const app=setup(),headers={authorization:"Bearer a"};
  const board=(await app.inject({method:"POST",url:"/v1/boards",headers,payload:input})).json();
  const { started_at: _required, ...untimed } = success;
  const rejected=await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers,payload:{sessions:[{...success,session_id:"timed"},untimed]}});
  expect(rejected.statusCode).toBe(400);
  expect((await app.inject({url:`/v1/boards/${board.id}/sessions`,headers})).json().total).toBe(0);
 });
 it("accepts the shared view envelope on sessions boards and deletes or resets data",async()=>{
  const app=setup(),headers={authorization:"Bearer a"};
  const board=(await app.inject({method:"POST",url:"/v1/boards",headers,payload:{...input,focus:{type:"isp",isp:"ISP1"}}})).json();
  const rows=[
   {...success,session_id:"keep",started_at:"2026-09-24T18:00:00-03:00"},
   {...success,session_id:"drop",started_at:"2026-09-24T18:00:00-03:00"},
   {...success,session_id:"windowed",started_at:"2026-09-24T19:00:00-03:00"},
  ];
  expect((await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers,payload:{sessions:rows}})).statusCode).toBe(200);
  const tolerant=await app.inject({method:"POST",url:`/v1/boards/${board.id}/view`,headers,payload:{filters:[{dimension:"isp",entity:"ISP1"}],metric:"buffer_ratio",limit:10}});
  expect(tolerant.statusCode).toBe(200);expect(tolerant.json().board_type).toBe("sessions");
  const byIds=await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions/delete`,headers,payload:{session_ids:["drop","missing"]}});
  expect(byIds.json()).toMatchObject({deleted:1,remaining:2});
  const byWindow=await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions/delete`,headers,payload:{time_window:{from:"2026-09-24T19:00:00-03:00",to:"2026-09-24T20:00:00-03:00"}}});
  expect(byWindow.json()).toMatchObject({deleted:1,remaining:1});
  expect((await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions/delete`,headers,payload:{}})).statusCode).toBe(400);
  const reset=await app.inject({method:"POST",url:`/v1/boards/${board.id}/reset`,headers,payload:{}});
  expect(reset.json()).toMatchObject({board_type:"sessions",deleted_sessions:1,deleted_contributions:0});
  expect((await app.inject({url:`/v1/boards/${board.id}/sessions`,headers})).json().total).toBe(0);
 });
});

const incidentInput = {
 board_type:"incident",name:"Incident cohort",incident:{started_at:"2026-09-23T18:00:00-03:00"},
 window:{from_day:"2026-09-21",to_day:"2026-09-27"},slas:{startup_error:{warning:0.1,critical:0.5},buffer:{warning:0.2,critical:0.6}},
 source:{system:"synthetic-test",query:"fixture",buffer_ratio_session_threshold:0.01},
};
describe("Incident boards REST/MCP",()=>{
 it("shares creation, cohort, daily ingestion and views across adapters with owner isolation",async()=>{
  const app=setup(),headers={authorization:"Bearer a"},other={authorization:"Bearer b"};
  const token=(await app.inject({method:"POST",url:"/v1/mcp/tokens",headers,payload:{name:"incident",expires_in_days:1}})).json();
  const created=await rpc(app,token.secret,"create_incident_board",incidentInput);expect(created.json().result.isError).not.toBe(true);
  const board=created.json().result.structuredContent;expect(board).toMatchObject({board_type:"incident",user_count:0,session_count:0});
  const users=await rpc(app,token.secret,"add_incident_users",{board_id:board.id,user_ids:["u1","u2"]});expect(users.json().result.structuredContent).toEqual({added:2,existing:0,total:2});
  const dayItem={user_id:"u1",day:"2026-09-23",sessions:10,startup_error_sessions:0,buffer_over_sla_sessions:7};
  const ingested=await rpc(app,token.secret,"ingest_incident_user_days",{board_id:board.id,user_days:[dayItem,{...dayItem,user_id:"ghost"}]});
  expect(ingested.json().result.structuredContent).toMatchObject({inserted:1,rejected:1});
  const rest=await app.inject({method:"POST",url:`/v1/boards/${board.id}/user-days`,headers,payload:{user_days:[{...dayItem,day:"2026-09-24",buffer_over_sla_sessions:1}]}});
  expect(rest.statusCode).toBe(200);expect(rest.json()).toMatchObject({inserted:1,rejected:0});
  const view=await app.inject({method:"POST",url:`/v1/boards/${board.id}/view`,headers,payload:{metric:"buffer"}});
  expect(view.statusCode).toBe(200);expect(view.json()).toMatchObject({board_type:"incident",metric:"buffer",users:{total:2,with_data:1}});
  expect(view.json().users.rows[0].cells.find((cell:{day:string})=>cell.day==="2026-09-23")).toMatchObject({status:"bad",intensity:1});
  const viaMcp=(await rpc(app,token.secret,"get_incident_board_view",{board_id:board.id,metric:"startup_error"})).json().result.structuredContent;expect(viaMcp.metric).toBe("startup_error");
  expect((await app.inject({method:"POST",url:`/v1/boards/${board.id}/users`,headers:other,payload:{user_ids:["x"]}})).statusCode).toBe(404);
  expect((await app.inject({method:"POST",url:`/v1/boards/${board.id}/view`,headers:other,payload:{}})).statusCode).toBe(404);
  expect((await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers,payload:{sessions:[success]}})).statusCode).toBe(400);
  expect((await app.inject({method:"POST",url:`/v1/boards/${board.id}/user-days/delete`,headers,payload:{}})).statusCode).toBe(400);
  const removed=await app.inject({method:"POST",url:`/v1/boards/${board.id}/users/delete`,headers,payload:{user_ids:["u1"]}});expect(removed.json()).toEqual({deleted:1,deleted_user_days:2,remaining:1});
  expect((await app.inject({url:"/v1/boards",headers})).json().boards[0].board_type).toBe("incident");
 });
});
