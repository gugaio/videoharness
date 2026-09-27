import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../../infrastructure/server.js";
vi.mock("@clerk/backend",()=>({verifyToken:vi.fn(async (token:string)=>{if(token==="a"||token==="b")return {sub:token};throw new Error("invalid");})}));
const apps: FastifyInstance[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
function setup(){const app=buildApp({host:"127.0.0.1",port:0,lensUrl:"http://lens",mockUrl:"http://mock",mockPublicUrl:"http://mock",serviceToken:"test-service",clerkSecretKey:"test"});apps.push(app);return app;}
const input={name:"User SLA",focus:{type:"user",user_id:"viewer"},slas:{startup_error_rate:{warning:0.1,critical:0.5},buffer_ratio:{warning:0.02,critical:0.1},join_time_ms:{warning:2000,critical:5000}}};
const success={session_id:"s1",user_id:"viewer",device:{id:"tv",model:"Tizen"},isp:"ISP1",pop:"POP1",media_id:"media",startup_error:false,join_time_ms:1000,buffer_ratio:0.01};
function rpc(app:FastifyInstance,secret:string,name:string,args:object){return app.inject({method:"POST",url:"/mcp",headers:{authorization:`Bearer ${secret}`,accept:"application/json, text/event-stream","mcp-protocol-version":"2025-06-18"},payload:{jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}}});}
describe("Boards HTTP/MCP integration",()=>{
 it("requires auth, isolates owner and shares board data across MCP and UI HTTP",async()=>{
  const app=setup();expect((await app.inject({url:"/v1/boards"})).statusCode).toBe(401);
  const token=(await app.inject({method:"POST",url:"/v1/mcp/tokens",headers:{authorization:"Bearer a"},payload:{name:"agent",expires_in_days:1}})).json();
  expect((await app.inject({method:"POST",url:"/mcp",payload:{}})).statusCode).toBe(401);
  const schema=await rpc(app,token.secret,"get_board_schema",{});expect(schema.json().result.structuredContent.units.buffer_ratio).toContain("not time weighted");
  const created=await rpc(app,token.secret,"create_board",input);const board=created.json().result.structuredContent;expect(board.view_path).toBe(`/dashboard/boards/${board.id}`);
  const failed={session_id:"s2",user_id:"viewer",device:{id:"phone"},isp:"ISP2",pop:"POP1",media_id:"media",startup_error:true};
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
  const tooLarge=await app.inject({method:"POST",url:`/v1/boards/${board.id}/sessions`,headers:{...headers,"content-type":"application/json"},payload:JSON.stringify({sessions:[],padding:"x".repeat(33*1024)})});expect(tooLarge.statusCode).toBe(413);
 });
});
