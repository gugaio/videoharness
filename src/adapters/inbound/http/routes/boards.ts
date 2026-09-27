import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthHook } from "../auth.js";
import { BoardError, type BoardRepository } from "../../../../application/ports/board-repository.js";
import { createBoard, getBoard, getBoardView, ingestBoardSessions, boardSchemaDescription } from "../../../../application/use-cases/boards.js";
import { BoardPageSchema, BOARD_LIMITS } from "../../../../domain/boards.js";
const QueryPage = z.object({offset:z.coerce.number().int().min(0).max(50_000).default(0),limit:z.coerce.number().int().min(1).max(50).default(20)}).strict();
export function registerBoardRoutes(app: FastifyInstance, deps: { auth: AuthHook; boards: BoardRepository }) {
  const options = { preHandler: deps.auth, bodyLimit: BOARD_LIMITS.body_bytes, onRequest: async (_request: unknown,reply: {header:(name:string,value:string)=>unknown}) => {reply.header("Cache-Control","no-store");} };
  const run = (reply: {code:(status:number)=>{send:(body:unknown)=>unknown}}, action:()=>unknown) => {
    try { return action(); } catch(error) {
      if(error instanceof z.ZodError) return reply.code(400).send({error:"invalid_board_request",details:error.issues.map(issue=>({path:issue.path,message:issue.message}))});
      if(error instanceof BoardError) return reply.code(error.status).send({error:error.code});
      throw error;
    }
  };
  app.get("/v1/boards/schema",options,()=>boardSchemaDescription);
  app.get("/v1/boards",options,(request,reply)=>run(reply,()=>{const page=BoardPageSchema.parse(QueryPage.parse(request.query));return deps.boards.list(request.vhOwnerId,page.offset,page.limit);}));
  app.post("/v1/boards",options,(request,reply)=>run(reply,()=>{const board=createBoard(deps.boards,request.vhOwnerId,request.body);reply.code(201);return board;}));
  app.get<{Params:{boardId:string}}>("/v1/boards/:boardId",options,(request,reply)=>run(reply,()=>getBoard(deps.boards,request.vhOwnerId,request.params.boardId)));
  app.post<{Params:{boardId:string}}>("/v1/boards/:boardId/sessions",options,(request,reply)=>run(reply,()=>ingestBoardSessions(deps.boards,request.vhOwnerId,request.params.boardId,request.body)));
  app.get<{Params:{boardId:string}}>("/v1/boards/:boardId/sessions",options,(request,reply)=>run(reply,()=>{getBoard(deps.boards,request.vhOwnerId,request.params.boardId);const page=QueryPage.parse(request.query);return deps.boards.sessions(request.vhOwnerId,request.params.boardId,page.offset,page.limit);}));
  app.post<{Params:{boardId:string}}>("/v1/boards/:boardId/view",options,(request,reply)=>run(reply,()=>getBoardView(deps.boards,request.vhOwnerId,request.params.boardId,request.body)));
  app.delete<{Params:{boardId:string}}>("/v1/boards/:boardId",options,(request,reply)=>run(reply,()=>{if(!deps.boards.delete(request.vhOwnerId,request.params.boardId))throw new BoardError("board_not_found",404);return {ok:true};}));
}
