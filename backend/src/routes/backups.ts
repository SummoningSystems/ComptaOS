import type { FastifyInstance } from "fastify";
import { actorContext } from "../services/workspaceContext.js";
import { backupStatus, createBackup } from "../services/backupService.js";
export async function backupRoutes(app:FastifyInstance){
  app.addHook("preHandler",async(_req,reply)=>{if(!["owner","admin"].includes(actorContext.getStore()?.role??""))return reply.code(403).send({error:"Administrateur requis."});});
  app.get("/",async()=>backupStatus());
  app.post("/",async()=>createBackup());
}
