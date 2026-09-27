import { describe, expect, it } from "vitest";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./board-store.js";
import { getBoardView, ingestBoardSessions } from "../../../application/use-cases/boards.js";
import type { BoardSession, CreateBoardInput } from "../../../domain/boards.js";
const input:CreateBoardInput={name:"SLA",focus:{type:"user",user_id:"u"},slas:{startup_error_rate:{warning:0.01,critical:0.05},buffer_ratio:{warning:0.02,critical:0.05},join_time_ms:{warning:2000,critical:5000}}};
const session:BoardSession={session_id:"s",user_id:"u",device:{id:"tv"},isp:"isp",pop:"pop",media_id:"media",startup_error:false,join_time_ms:1000,buffer_ratio:0.01};
describe("Board persistence and deterministic aggregation",()=>{
 it("persists upserts and avoids device identity collisions across users",()=>{
  const dir=mkdtempSync(join(tmpdir(),"vh-boards-"));let store=new BoardStore(join(dir,"data.db"));
  try{const board=store.create("owner",{...input,focus:{type:"device",user_id:"u",device_id:"tv"}});ingestBoardSessions(store,"owner",board.id,{sessions:[session,{...session,session_id:"other",user_id:"other"}]});store.close();store=new BoardStore(join(dir,"data.db"));
   expect(store.get("other",board.id)).toBeUndefined();expect(getBoardView(store,"owner",board.id,{filters:[]}).sessionCount).toBe(1);
   ingestBoardSessions(store,"owner",board.id,{sessions:[{...session,buffer_ratio:0.05}]});const view=getBoardView(store,"owner",board.id,{filters:[]});expect(view.metrics.buffer_ratio?.status).toBe("bad");expect(store.get("owner",board.id)?.session_count).toBe(2);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
 });
 it("conserves volumes through Others and keeps worst-case MCP output bounded",()=>{
  const store=new BoardStore(":memory:");try{const board=store.create("owner",input);const sessions:BoardSession[]=[];
   for(let d=0;d<9;d++)for(let i=0;i<9;i++)for(let p=0;p<9;p++)for(let m=0;m<9;m++)sessions.push({...session,session_id:`${d}-${i}-${p}-${m}`,device:{id:`d${d}${'x'.repeat(120)}`},isp:`i${i}${'x'.repeat(120)}`,pop:`p${p}${'x'.repeat(120)}`,media_id:`m${m}${'x'.repeat(120)}`,buffer_ratio:0.01234567890123456});
   store.ingest("owner",board.id,sessions);const view=getBoardView(store,"owner",board.id,{filters:[]});expect(view.sessionCount).toBe(6561);expect(view.nodes.filter(node=>node.label==="Outros")).toHaveLength(4);
   for(const node of view.nodes){const outgoing=view.links.filter(link=>link.source===node.id),incoming=view.links.filter(link=>link.target===node.id);if(outgoing.length)expect(outgoing.reduce((sum,link)=>sum+link.volume,0)).toBe(node.volume);if(incoming.length)expect(incoming.reduce((sum,link)=>sum+link.volume,0)).toBe(node.volume);}
   expect(Buffer.byteLength(JSON.stringify(view))).toBeLessThan(256*1024);
  }finally{store.close();}
 });
 it("rolls back batches at quotas while allowing existing session replacement",()=>{
  const store=new BoardStore(":memory:");try{const board=store.create("owner",input);store.ingest("owner",board.id,Array.from({length:10000},(_,i)=>({...session,session_id:String(i)})));
   expect(()=>store.ingest("owner",board.id,[{...session,session_id:"0",buffer_ratio:0.3},{...session,session_id:"new"}])).toThrow("board_session_limit");expect(store.sessions("owner",board.id,0,1).sessions[0]).toMatchObject({buffer_ratio:0.01});
   expect(store.ingest("owner",board.id,[{...session,session_id:"0",buffer_ratio:0.3}])).toEqual({inserted:0,updated:1,total:10000});
  }finally{store.close();}
 });
 it("enforces owner/board quotas atomically and allows upserts at the owner cap",()=>{
  const store=new BoardStore(":memory:");try{
   const filled=[];
   for(let b=0;b<5;b++){const board=store.create("owner",input);filled.push(board);store.ingest("owner",board.id,Array.from({length:10000},(_,i)=>({...session,session_id:String(i)})));}
   const sixth=store.create("owner",input);expect(()=>store.ingest("owner",sixth.id,[session])).toThrow("board_owner_session_limit");expect(store.get("owner",sixth.id)?.session_count).toBe(0);
   expect(store.ingest("owner",filled[0]!.id,[{...session,session_id:"0",buffer_ratio:0.04}]).updated).toBe(1);
   expect(store.delete("owner",filled[0]!.id)).toBe(true);expect(store.ingest("owner",sixth.id,[session]).inserted).toBe(1);
   for(let i=0;i<100;i++)store.create("other",input);expect(()=>store.create("other",input)).toThrow("board_limit");expect(store.list("other",90,20).boards).toHaveLength(10);
  }finally{store.close();}
 });
 it("evaluates explicit SLA boundaries and uses success-only arithmetic means",()=>{
  const store=new BoardStore(":memory:");try{const board=store.create("owner",input);
   store.ingest("owner",board.id,[session,{...session,session_id:"s2",buffer_ratio:0.03,join_time_ms:3000},{session_id:"failed",user_id:"u",device:{id:"tv"},isp:"isp",pop:"pop",media_id:"media",startup_error:true}]);
   const view=getBoardView(store,"owner",board.id,{filters:[]});expect(view.metrics.buffer_ratio).toMatchObject({value:0.02,status:"warning",sample_count:2});expect(view.metrics.join_time_ms).toMatchObject({value:2000,status:"warning",sample_count:2});expect(view.metrics.startup_error_rate?.sample_count).toBe(3);
   expect(()=>getBoardView(store,"owner",board.id,{filters:[{dimension:"device",entity:"tv"}]})).toThrow();
  }finally{store.close();}
 });

});
